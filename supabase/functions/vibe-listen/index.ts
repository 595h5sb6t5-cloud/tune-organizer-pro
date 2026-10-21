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
Judge ONLY what you hear. Return ONLY JSON: {"results":[{"n":<song number>,"s":<score>}]}`;

const PROMPT_DESC = `You are a DJ checking if songs fit a described vibe.
Read the VIBE description, then listen to each numbered SONG clip (15 s from the middle of the song). For each song rate 0–10 how well what you HEAR fits the vibe:
voices (or lack of them), instrument palette, melody-led vs groove/percussion-led, texture (organic vs synthetic), warmth, energy and drive, and the moment it evokes.
10 = perfect for that moment; 8 = clearly fits; 7 = fits with one small difference; 6 or less = a listener in that moment would skip it.
Judge ONLY what you hear. Return ONLY JSON: {"results":[{"n":<song number>,"s":<score>}]}`;

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
    const ids = str(body?.ids, 8);
    const seed = body?.seed && typeof body.seed === "object" ? body.seed : null;
    const context = typeof body?.context === "string" ? body.context.trim().slice(0, 120) : "";
    if (!seed || !ids.length) return json({ error: "Send a seed profile and 1–8 songs." }, 400);

    const { data: rows } = await admin.from("liked_songs").select("spotify_track_id, isrc, track_name, artist_name")
      .eq("user_id", user.id).in("spotify_track_id", ids);
    const byId = new Map((rows ?? []).map((r: any) => [r.spotify_track_id, r]));
    const clip = async (id: string) => {
      const r: any = byId.get(id);
      if (!r) return null;
      const ref = await findPreview(r.isrc, r.track_name, r.artist_name);
      const b64 = ref ? await fetchAudioB64(ref.url, 0.5) : null;
      return b64 ? { id, b64, label: `"${r.track_name}" by ${r.artist_name}` } : null;
    };
    const t0 = Date.now();
    const songs = (await Promise.all(ids.map(clip))).filter(Boolean) as any[];
    const unheard = ids.filter((id) => !songs.some((s) => s.id === id));
    if (!songs.length) return json({ results: [], unheard });

    const f = (v: unknown) => (v === null || v === undefined || v === "" ? "?" : Array.isArray(v) ? v.slice(0, 8).map(String).join(", ") : String(v).slice(0, 80));
    const seedText = `SEED: "${f(seed.name)}" by ${f(seed.artists)} | instruments: ${f(seed.instruments)} | piano: ${f(seed.piano)} | melodic_focus: ${f(seed.melodic_focus)} | percussive_drive: ${f(seed.percussive_drive)} | texture: ${f(seed.texture)} | warmth: ${f(seed.warmth)} | scale: ${f(seed.scale)} | groove: ${f(seed.groove)} | energy: ${f(seed.energy)} | style: ${f(seed.style)} | feeling: ${f(seed.feeling)}${seed.feeling_2 ? ` (also ${f(seed.feeling_2)})` : ""} | arc: ${f(seed.arc)}`;
    const ctxText = context ? `\nAdemás de sonar del mismo mundo que la semilla, ¿encaja con este contexto: ${context}? A song that sounds right but does not fit this context scores 7 or less.` : "";
    const content: any[] = [{ type: "text", text: PROMPT + ctxText }, { type: "text", text: seedText }];
    songs.forEach((s, i) => {
      content.push({ type: "text", text: `SONG ${i + 1}: ${s.label}` });
      content.push({ type: "input_audio", input_audio: { data: s.b64, format: "mp3" } });
    });
    const t1 = Date.now();
    let parsed: any;
    try { try { parsed = await gemini(content); } catch (e) { if (!(e instanceof GatewayRetry)) throw e; await new Promise((r) => setTimeout(r, 1500)); parsed = await gemini(content); } }
    catch (e) {
      if (e instanceof GatewayStop) return json({ error: e.message }, e.status);
      if (e instanceof GatewayRetry) return json({ error: "The listening step is busy. Try again in a moment." }, 429);
      throw e;
    }
    console.log(`[vibe-listen] clips ${t1 - t0}ms gemini ${Date.now() - t1}ms songs ${songs.length}`);
    const results = (Array.isArray(parsed?.results) ? parsed.results : [])
      .map((r: any) => ({ id: songs[Number(r?.n) - 1]?.id, score: Number(r?.s ?? r?.score) }))
      .filter((r: any) => r.id && Number.isFinite(r.score))
      .map((r: any) => ({ id: r.id, score: Math.max(0, Math.min(10, r.score)) }));
    return json({ results, unheard });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});
