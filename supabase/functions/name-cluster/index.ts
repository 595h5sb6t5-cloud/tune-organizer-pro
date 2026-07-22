// Names an already-validated cluster and promotes it to generated_playlists.
// Body: { cluster_id: string }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const MODEL = "gpt-4o";
const SYSTEM = `Eres el revisor musical y curador final de Tempo. Recibirás un cluster de canciones que YA pasó todas las validaciones sonoras (tamaño, compatibilidad promedio, mínimo por canción, dispersión). Tu único trabajo es:
1. Verificar que la identidad sonora es específica y no una etiqueta genérica.
2. Nombrar el cluster.
3. Escribir una descripción precisa del sonido que comparte el grupo.

Reglas absolutas:
- El nombre debe ser corto, natural, específico, evocativo. Prohibidos: "Chill", "Good Vibes", "Nostalgic Dreams", "Mixed Feelings", "Timeless Energy", "Enigma Tropical Vibes", "Musical Journey", "Eclectic Sounds", "Chill Mood" o cualquier nombre que sirva para cientos de playlists.
- La descripción debe usar elementos concretos: percusión, bajo, textura, producción, voz, ambiente. Prohibido justificar con género, década, artista o mood general por sí solos. Prohibido decir "para cualquier momento".
- No inventes canciones, no reordenes, no elimines.
- No expongas IDs.
- Devuelve SOLO JSON: { "name": string, "description": string, "vibe": string, "context": string }
  * vibe: 2-4 palabras del ambiente real
  * context: 2-4 palabras del momento donde encaja (ej: "noche manejando", "trabajo enfocado")`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const auth = req.headers.get("Authorization") ?? "";
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const svc = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const openaiKey = Deno.env.get("OPENAI_API_KEY");
    if (!openaiKey) return json({ error: "OPENAI_API_KEY missing" }, 500);

    const userClient = createClient(supabaseUrl, anon, { global: { headers: { Authorization: auth } } });
    const adm = createClient(supabaseUrl, svc);
    const { data: { user }, error: uerr } = await userClient.auth.getUser();
    if (uerr || !user) return json({ error: "unauthorized" }, 401);

    const { cluster_id } = await req.json();
    if (!cluster_id) return json({ error: "cluster_id required" }, 400);

    const { data: cluster } = await adm.from("cluster_candidates").select("*").eq("id", cluster_id).eq("user_id", user.id).maybeSingle();
    if (!cluster) return json({ error: "cluster not found" }, 404);
    if (cluster.status !== "candidate") return json({ error: `cluster status is ${cluster.status}` }, 400);

    const { data: cts } = await adm.from("cluster_candidate_tracks")
      .select("spotify_track_id, compat_to_centroid, position")
      .eq("cluster_id", cluster_id)
      .order("position", { ascending: true });
    const sids = (cts ?? []).map((t: any) => t.spotify_track_id);
    if (sids.length < 10) return json({ error: "cluster too small (min 10)" }, 400);

    // Fetch names
    const { data: liked } = await adm.from("liked_songs").select("spotify_track_id, track_name, artist_name").eq("user_id", user.id).in("spotify_track_id", sids);
    const nameMap = new Map((liked ?? []).map((l: any) => [l.spotify_track_id, l]));

    const trackLines = sids.map((s, i) => {
      const l: any = nameMap.get(s) ?? {};
      return `${i + 1}. "${l.track_name ?? "?"}" — ${l.artist_name ?? "?"}`;
    }).join("\n");

    const prompt = `Cluster metrics:
- size: ${cluster.size}
- avg_compat: ${cluster.avg_compat?.toFixed(3)}
- min_compat: ${cluster.min_compat?.toFixed(3)}
- language_group: ${cluster.language_group}
- dominant sonic dimensions: ${JSON.stringify(cluster.dominant_dimensions)}
- centroid: ${JSON.stringify(cluster.centroid)}

Tracks in this cluster:
${trackLines}

Name this specific sonic world.`;

    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${openaiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: "system", content: SYSTEM }, { role: "user", content: prompt }],
        response_format: { type: "json_object" },
      }),
    });
    if (!r.ok) return json({ error: `OpenAI ${r.status}`, detail: (await r.text()).slice(0, 300) }, 502);
    const d = await r.json();
    let parsed: any = {};
    try { parsed = JSON.parse(d.choices?.[0]?.message?.content ?? "{}"); } catch { /* noop */ }
    const name = String(parsed.name ?? "Untitled").slice(0, 100);
    const description = parsed.description ? String(parsed.description).slice(0, 500) : null;

    // Create playlist
    const { data: pl, error: plErr } = await adm.from("generated_playlists").insert({
      user_id: user.id,
      name, description,
      concept: name,
      vibe: parsed.vibe ?? null,
      context: parsed.context ?? null,
      status: "draft",
      is_exported_to_spotify: false,
      created_by_ai: true,
      avg_compat: cluster.avg_compat,
      min_compat: cluster.min_compat,
      dimensions_summary: cluster.dominant_dimensions,
      source_cluster_id: cluster_id,
    }).select("id").single();
    if (plErr || !pl) return json({ error: "failed to create playlist", detail: plErr?.message }, 500);

    // Ensure tracks rows
    const { data: existing } = await adm.from("tracks").select("id, spotify_track_id").in("spotify_track_id", sids);
    const idMap = new Map<string, string>();
    for (const t of existing ?? []) idMap.set(t.spotify_track_id, t.id);
    const toInsert = sids.filter((s) => !idMap.has(s)).map((s) => {
      const l: any = nameMap.get(s) ?? {};
      return { spotify_track_id: s, name: l.track_name ?? "Unknown", artist_names: l.artist_name ? [l.artist_name] : [], album_name: null };
    });
    if (toInsert.length) {
      const { data: ins } = await adm.from("tracks").insert(toInsert).select("id, spotify_track_id");
      for (const t of ins ?? []) idMap.set(t.spotify_track_id, t.id);
    }

    const rows = (cts ?? []).map((t: any, i: number) => ({
      generated_playlist_id: pl.id,
      user_id: user.id,
      track_id: idMap.get(t.spotify_track_id)!,
      position: i + 1,
      added_by: "ai",
      fit_score: t.compat_to_centroid,
      reason_for_inclusion: null,
    })).filter((r) => r.track_id);
    if (rows.length) await adm.from("generated_playlist_tracks").insert(rows);

    await adm.from("cluster_candidates").update({ status: "promoted", promoted_playlist_id: pl.id }).eq("id", cluster_id);

    return json({ success: true, playlist_id: pl.id, name, track_count: rows.length });
  } catch (e: any) {
    console.error("name-cluster", e);
    return json({ error: e?.message ?? "unknown" }, 500);
  }
});
