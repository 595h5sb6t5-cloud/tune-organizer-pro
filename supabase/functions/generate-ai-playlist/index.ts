// Generate one AI playlist as draft from the user's library + ai_track_analysis.
// Body: { concept?: string, name?: string, target_size?: number }
// If no concept provided, model picks one based on the user's library signals.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const MODEL = "gpt-4o";

function json(b: unknown, s = 200) {
  return new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

const SYSTEM = `You are Tempo — a world-class music curator. Build a single playlist as a "sonic world" with deep coherence.

IRON RULES:
- NEVER group by language. Spanish and English songs sit together if their sonic DNA matches.
- NEVER pick generic concepts ("Pop", "English Songs", "Spanish Hits", "Rock Mix").
- Concept must be specific: mood + energy + texture + scenario.
- Mix songs ONLY when they share groove, mood family, energy band (±1 level), production texture, and listening context.
- Respect a 7-section energy arc when ordering: 1) Intro, 2) Mood setup, 3) Energy rise, 4) Peak, 5) Stable groove, 6) Cool down, 7) Closing.

For each picked track output: position (1..N), spotify_track_id (echo exact), section (one of intro|mood_setup|energy_rise|peak|stable_groove|cool_down|closing), fit_score (0-1), reason (one short sentence about WHY it belongs).

Return ONLY JSON of this shape:
{
  "name": "string",
  "description": "string (1-2 sentences)",
  "concept": "string (the sonic world)",
  "vibe": "string (mood + energy + texture)",
  "context": "string (best listening scenario)",
  "tracks": [ { "position": number, "spotify_track_id": "string", "section": "string", "fit_score": number, "reason": "string" } ]
}`;

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

    // Plan gating
    const { data: sub } = await adm
      .from("user_subscription")
      .select("plan, playlists_limit")
      .eq("user_id", user.id)
      .maybeSingle();
    const playlistsLimit = sub?.playlists_limit ?? 3;
    if (playlistsLimit !== -1) {
      const { count: plCount } = await adm
        .from("generated_playlists")
        .select("id", { head: true, count: "exact" })
        .eq("user_id", user.id);
      if ((plCount ?? 0) >= playlistsLimit) {
        return json({
          error: `Free plan limit reached (${playlistsLimit} playlists). Upgrade to Premium for unlimited.`,
          plan_limited: true,
          plan: sub?.plan ?? "free",
          limit: playlistsLimit,
        }, 402);
      }
    }

    const body = await req.json().catch(() => ({}));
    const concept: string | undefined = body.concept;
    const targetSize = Math.min(Math.max(body.target_size ?? 25, 12), 40);

    // Pull liked songs (cap pool to keep prompt size sane)
    const { data: liked } = await adm
      .from("liked_songs")
      .select("spotify_track_id, track_name, artist_name, album_name, audio_tempo, audio_energy, audio_valence, audio_danceability, mood, energy, genre_tags")
      .eq("user_id", user.id)
      .order("added_at", { ascending: false })
      .limit(400);

    if (!liked || liked.length < 5) return json({ error: "Need more liked songs to generate a playlist" }, 400);

    // Pull AI analysis joined to spotify_track_id
    const { data: analyses } = await adm
      .from("ai_track_analysis")
      .select("primary_genre, secondary_genres, language, moods, energy_level, rhythm_type, vibe_tags, best_contexts, compatibility_notes, confidence_score, tracks:track_id(spotify_track_id)")
      .eq("user_id", user.id)
      .limit(800);

    const analysisById = new Map<string, any>();
    for (const a of analyses ?? []) {
      const sid = (a as any).tracks?.spotify_track_id;
      if (sid) analysisById.set(sid, a);
    }

    // Build compact catalog string
    const catalog = liked.slice(0, 250).map((s, i) => {
      const a = analysisById.get(s.spotify_track_id);
      const parts: string[] = [`#${i + 1}`, `id:${s.spotify_track_id}`, `"${s.track_name}" – ${s.artist_name}`];
      if (s.audio_tempo) parts.push(`bpm:${Math.round(s.audio_tempo)}`);
      if (typeof s.audio_energy === "number") parts.push(`e:${s.audio_energy.toFixed(2)}`);
      if (typeof s.audio_valence === "number") parts.push(`v:${s.audio_valence.toFixed(2)}`);
      if (a?.primary_genre) parts.push(`g:${a.primary_genre}`);
      if (a?.energy_level) parts.push(`E:${a.energy_level}`);
      if (a?.moods?.length) parts.push(`m:${a.moods.slice(0, 2).join("/")}`);
      if (a?.vibe_tags?.length) parts.push(`v:${a.vibe_tags.slice(0, 2).join("/")}`);
      if (a?.rhythm_type) parts.push(`r:${a.rhythm_type}`);
      else if (s.mood) parts.push(`m:${s.mood}`);
      return parts.join(" ");
    }).join("\n");

    const userPrompt = concept
      ? `Build a coherent "${concept}" playlist of ~${targetSize} songs from this library:\n\n${catalog}`
      : `Pick a specific, evocative concept that this library naturally supports (NOT generic), then build a coherent ~${targetSize}-song playlist:\n\n${catalog}`;

    const aiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${openaiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: userPrompt },
        ],
        response_format: { type: "json_object" },
      }),
    });

    if (!aiRes.ok) {
      const t = await aiRes.text();
      console.error("OpenAI fail", aiRes.status, t.substring(0, 300));
      return json({ error: `OpenAI ${aiRes.status}` }, 502);
    }

    const aiData = await aiRes.json();
    const content = aiData.choices?.[0]?.message?.content;
    let parsed: any = {};
    try { parsed = JSON.parse(content); } catch { return json({ error: "Bad AI JSON" }, 502); }

    const name: string = (body.name || parsed.name || concept || "Untitled").toString().slice(0, 100);
    const tracksRaw: any[] = Array.isArray(parsed.tracks) ? parsed.tracks : [];
    if (tracksRaw.length === 0) return json({ error: "AI returned no tracks" }, 502);

    // Map AI picks to actual liked songs (dedupe + validate)
    const validIds = new Set(liked.map((l) => l.spotify_track_id));
    const seen = new Set<string>();
    const picked = tracksRaw
      .filter((t) => t.spotify_track_id && validIds.has(t.spotify_track_id) && !seen.has(t.spotify_track_id) && (seen.add(t.spotify_track_id), true))
      .sort((a, b) => (a.position ?? 999) - (b.position ?? 999));

    if (picked.length < 5) return json({ error: "Not enough valid tracks selected" }, 502);

    // Insert generated_playlists
    const { data: pl, error: plErr } = await adm
      .from("generated_playlists")
      .insert({
        user_id: user.id,
        name,
        description: parsed.description ?? null,
        concept: parsed.concept ?? concept ?? null,
        vibe: parsed.vibe ?? null,
        context: parsed.context ?? null,
        status: "draft",
        is_exported_to_spotify: false,
        created_by_ai: true,
      })
      .select("id")
      .single();

    if (plErr || !pl) return json({ error: "Failed to save playlist", detail: plErr?.message }, 500);

    // Ensure tracks rows exist for picked spotify_track_ids; collect uuid map
    const idMap = new Map<string, string>();
    const likedById = new Map(liked.map((l) => [l.spotify_track_id, l]));
    const sids = picked.map((p) => p.spotify_track_id);
    const { data: existingTracks } = await adm
      .from("tracks")
      .select("id, spotify_track_id")
      .in("spotify_track_id", sids);
    for (const t of existingTracks ?? []) idMap.set(t.spotify_track_id, t.id);

    const toInsert = sids.filter((s) => !idMap.has(s)).map((sid) => {
      const l: any = likedById.get(sid);
      return {
        spotify_track_id: sid,
        name: l?.track_name ?? "Unknown",
        artist_names: l?.artist_name ? [l.artist_name] : [],
        album_name: l?.album_name ?? null,
      };
    });
    if (toInsert.length) {
      const { data: ins } = await adm.from("tracks").insert(toInsert).select("id, spotify_track_id");
      for (const t of ins ?? []) idMap.set(t.spotify_track_id, t.id);
    }

    // Insert generated_playlist_tracks
    const rows = picked.map((p, i) => ({
      generated_playlist_id: pl.id,
      user_id: user.id,
      track_id: idMap.get(p.spotify_track_id)!,
      position: i + 1,
      added_by: "ai",
      fit_score: typeof p.fit_score === "number" ? p.fit_score : null,
      reason_for_inclusion: [p.section ? `[${p.section}]` : "", p.reason ?? ""].filter(Boolean).join(" ").trim() || null,
    })).filter((r) => r.track_id);

    if (rows.length) {
      const { error: trErr } = await adm.from("generated_playlist_tracks").insert(rows);
      if (trErr) console.error("track insert", trErr);
    }

    return json({
      success: true,
      playlist_id: pl.id,
      name,
      track_count: rows.length,
    });
  } catch (e: any) {
    console.error("generate-ai-playlist", e);
    return json({ error: e.message ?? "unknown" }, 500);
  }
});
