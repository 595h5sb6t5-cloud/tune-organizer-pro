// Edge Function: vibe-listen — Gemini hears up to 8 candidate previews and rates 0–10 whether each
// SOUNDS like the same world as the seed. The seed is NOT re-heard: its stored analysis is sent as text.
// Audio is never stored. NOTE: Revisar términos de Deezer antes de lanzar al público.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { findPreview, fetchAudioB64, gemini, GatewayStop, GatewayRetry } from "../_shared/audio.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const PROMPT = `You are a DJ checking if songs belong in the same playlist as the SEED.
Read the SEED's sound description (heard earlier), then listen to each numbered SONG clip (15 s from the middle of the song). For each song rate 0–10 how much it SOUNDS like the same sonic world as the seed:
instrument palette (piano, synths, organic percussion, vocals…), melody-led vs groove/percussion-led, texture (organic vs synthetic), warmth and drive.
10 = could be the next track in the same set; 8 = clearly the same world; 7 = close with one small difference; 6 or less = a listener would notice it doesn't belong.
Considera la producción: ¿la grabación, la batería y la mezcla suenan del mismo mundo, aunque sean de épocas distintas? Dos canciones del mismo género con producciones que chocan no encajan.
Judge ONLY what you hear. Return ONLY JSON: {"results":[{"n":<song number>,"s":<score>,"why":"one short Spanish sentence explaining the heard fit or clash"}]}`;

const PROMPT_DESC = `You are a DJ checking if songs fit a described vibe.
Read the VIBE description, then listen to each numbered SONG clip (15 s from the middle of the song). For each song rate 0–10 how well what you HEAR fits the vibe:
voices (or lack of them), instrument palette, melody-led vs groove/percussion-led, texture (organic vs synthetic), warmth, energy and drive, and the moment it evokes.
10 = perfect for that moment; 8 = clearly fits; 7 = fits with one small difference; 6 or less = a listener in that moment would skip it.
Considera la producción: ¿la grabación, la batería y la mezcla suenan del mismo mundo, aunque sean de épocas distintas? Dos canciones del mismo género con producciones que chocan no encajan.
For background listening, all accepted songs must share one sonic world: production, instrumentation and vocal type. A chill label alone is not enough.
Judge ONLY what you hear. Return ONLY JSON: {"results":[{"n":<song number>,"s":<score>,"why":"one short Spanish sentence explaining the heard fit or clash"}]}`;

const PLAYLIST_PROMPT = `Escucha TODOS los fragmentos de 15 segundos en el orden final de esta playlist, incluyendo el traslape con el grupo vecino. La playlist debe tener UN momento y UN mundo sonoro.
¿Cuáles de estas canciones no pertenecen a esta playlist porque rompen el momento o el mundo sonoro?
No juzgues por artista ni género; manda lo que escuchas. Considera la producción: ¿la grabación, la batería y la mezcla suenan del mismo mundo, aunque sean de épocas distintas? Dos canciones del mismo género con producciones que chocan no encajan.
También compara CADA canción con CADA una de las tres ANCLAS cuyo audio recibes. Califica 0–10: 8 = claramente el mismo mundo y momento, 7 = una diferencia que puede causar skip. No cuentes comparar una canción consigo misma como una aprobación.
No inventes intrusos si todo encaja. Devuelve TODAS las canciones del GRUPO en results, y únicamente intrusos reales en intruders. Razones cortas en español basadas en el oído.
JSON: {"results":[{"id":"spotify id del GRUPO","anchor_scores":{"id de ancla":8},"why":"por qué encaja o choca"}],"intruders":[{"id":"spotify id del GRUPO","reason":"qué rompe el momento o mundo sonoro"}]}`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const bearer = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
    const { data: { user } } = await admin.auth.getUser(bearer);
    if (!user) return json({ error: "Unauthorized" }, 401);
    const body = await req.json().catch(() => ({}));
    if (body?.warm) return json({ ok: true });
    const str = (a: unknown, n: number) => Array.isArray(a) ? a.filter((x) => typeof x === "string").slice(0, n) as string[] : [];
    const playlistMode = body?.mode === "playlist";
    const ids = [...new Set(str(body?.ids, playlistMode ? 20 : 8))];
    const anchorIds = playlistMode ? [...new Set(str(body?.anchor_ids, 3))] : [];
    const seed = body?.seed && typeof body.seed === "object" ? body.seed : null;
    const description = typeof body?.description === "string" ? body.description.trim().slice(0, 400) : "";
    const context = typeof body?.context === "string" ? body.context.trim().slice(0, 1200) : "";
    if (!ids.length || (playlistMode ? anchorIds.length !== 3 : (!seed && !description))) return json({ error: "Send songs and a seed/description, or three distinct playlist anchors." }, 400);

    const fetchIds = [...new Set([...ids, ...anchorIds])];

    const { data: rows } = await admin.from("liked_songs").select("spotify_track_id, isrc, track_name, artist_name")
      .eq("user_id", user.id).in("spotify_track_id", fetchIds);
    const byId = new Map((rows ?? []).map((r: any) => [r.spotify_track_id, r]));
    const clip = async (id: string) => {
      const r: any = byId.get(id);
      if (!r) return null;
      const ref = await findPreview(r.isrc, r.track_name, r.artist_name);
      const b64 = ref ? await fetchAudioB64(ref.url, 0.5) : null;
      return b64 ? { id, b64, label: `"${r.track_name}" by ${r.artist_name}` } : null;
    };
    const t0 = Date.now();
    const songs = (await Promise.all(fetchIds.map(clip))).filter(Boolean) as any[];
    const unheard = fetchIds.filter((id) => !songs.some((s) => s.id === id));
    if (!songs.length) return json({ results: [], unheard });

    if (playlistMode) {
      // Never judge an incomplete group or replace absent audio with a text verdict.
      if (unheard.length) return json({ results: [], intruders: [], unheard, complete: false });
      const content: any[] = [{ type: "text", text: `${PLAYLIST_PROMPT}\nMOMENTO: ${context}\nORDEN COMPLETO: ${str(body?.ordered_ids, 120).join(", ")}\nANCLAS: ${anchorIds.join(", ")}` }];
      for (const id of ids) {
        const song = songs.find((s) => s.id === id);
        content.push({ type: "text", text: `GRUPO id=${id}${anchorIds.includes(id) ? " (también ANCLA)" : ""}: ${song.label}` });
        content.push({ type: "input_audio", input_audio: { data: song.b64, format: "mp3" } });
      }
      for (const id of anchorIds.filter((id) => !ids.includes(id))) {
        const song = songs.find((s) => s.id === id);
        content.push({ type: "text", text: `ANCLA de referencia id=${id}: ${song.label}` });
        content.push({ type: "input_audio", input_audio: { data: song.b64, format: "mp3" } });
      }
      const verdict = await gemini(content, typeof body.run_id === "string" ? body.run_id : undefined);
      if (!Array.isArray(verdict?.results) || !Array.isArray(verdict?.intruders)) return json({ error: "Incomplete playlist ear verdict", complete: false }, 502);
      const results = verdict.results.filter((r: any) => ids.includes(r?.id)).map((r: any) => ({
        id: r.id, why: typeof r.why === "string" ? r.why.slice(0, 300) : null,
        anchor_scores: Object.fromEntries(anchorIds.filter((id) => id !== r.id && typeof r.anchor_scores?.[id] === "number" && Number.isFinite(r.anchor_scores[id]))
          .map((id) => [id, Math.max(0, Math.min(10, r.anchor_scores[id]))])),
      }));
      const intruders = verdict.intruders.filter((r: any) => ids.includes(r?.id) && typeof r.reason === "string").map((r: any) => ({ id: r.id, reason: r.reason.slice(0, 300) }));
      console.log(`[playlist-ear] run=${body.run_id ?? ""} songs=${ids.length} intruders=${intruders.length} ms=${Date.now() - t0}`);
      return json({ results, intruders, unheard: [], complete: results.length === ids.length });
    }

    const f = (v: unknown) => (v === null || v === undefined || v === "" ? "?" : Array.isArray(v) ? v.slice(0, 8).map(String).join(", ") : String(v).slice(0, 80));
    const seedText = seed
      ? `SEED: "${f(seed.name)}" by ${f(seed.artists)} | instruments: ${f(seed.instruments)} | piano: ${f(seed.piano)} | melodic_focus: ${f(seed.melodic_focus)} | percussive_drive: ${f(seed.percussive_drive)} | texture: ${f(seed.texture)} | warmth: ${f(seed.warmth)} | scale: ${f(seed.scale)} | groove: ${f(seed.groove)} | energy: ${f(seed.energy)} | style: ${f(seed.style)} | feeling: ${f(seed.feeling)}${seed.feeling_2 ? ` (also ${f(seed.feeling_2)})` : ""} | arc: ${f(seed.arc)}`
      : `VIBE: ${description}`;
    const production = seed ? `\nSTORED PRODUCTION: era=${f(seed.production_era)}; drums=${f(seed.drum_sound)}; mix=${f(seed.mix_character)}; voice space=${f(seed.vocal_space)}; voice type=${f(seed.vocal_style)}; moments=${f(seed.moments)}; moment story=${f(seed.moment_story)}` : "";
    const ctxText = production + (context ? `\nAdemás de sonar del mismo mundo que la semilla, ¿encaja con este contexto: ${context}? A song that sounds right but does not fit this context scores 7 or less.` : "");
    const content: any[] = [{ type: "text", text: (seed ? PROMPT : PROMPT_DESC) + ctxText }, { type: "text", text: seedText }];
    songs.forEach((s, i) => {
      content.push({ type: "text", text: `SONG ${i + 1}: ${s.label}` });
      content.push({ type: "input_audio", input_audio: { data: s.b64, format: "mp3" } });
    });
    const t1 = Date.now();
    let parsed: any;
    // Client owns the single bounded retry; do not multiply provider requests here.
    try { parsed = await gemini(content); }
    catch (e) {
      if (e instanceof GatewayStop) return json({ error: e.message }, e.status);
      if (e instanceof GatewayRetry) return json({ error: "The listening step is busy. Try again in a moment.", retry_after_ms: e.waitMs }, 429);
      throw e;
    }
    console.log(`[vibe-listen] clips ${t1 - t0}ms gemini ${Date.now() - t1}ms songs ${songs.length}`);
    const results = (Array.isArray(parsed?.results) ? parsed.results : [])
      .map((r: any) => ({ id: songs[Number(r?.n) - 1]?.id, score: Number(r?.s ?? r?.score), why: typeof r?.why === "string" ? r.why.slice(0, 240) : null }))
      .filter((r: any) => r.id && Number.isFinite(r.score))
      .map((r: any) => ({ id: r.id, score: Math.max(0, Math.min(10, r.score)), why: r.why }));
    return json({ results, unheard });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});
