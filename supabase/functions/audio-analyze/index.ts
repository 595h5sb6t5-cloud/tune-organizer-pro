// Edge Function: audio-analyze — Gemini listens to public previews and stores the SOUND only
// (instruments, piano, melodic_focus, percussive_drive, texture, warmth, scale, groove) in track_audio_analysis.
// Feeling/arc stay with listener evidence. Electronic songs first. Audio is never stored.
// NOTE: Revisar términos de Deezer antes de lanzar al público.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { AUDIO_MODEL, findPreview, fetchAudioB64, gemini, audioPrompt, textPrompt, cleanSound, GatewayRetry, GatewayStop } from "../_shared/audio.ts";
import { vibeHasPriority } from "../_shared/analysis-priority.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CONCURRENCY = 5;
const HOP_MS = 45_000;
const MAX_DEPTH = 80;
const ITEM_MS = 35_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
// Never let one slow preview/model call hold the request open past the platform idle limit.
const withTimeout = <T,>(p: Promise<T>, ms: number) => Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error("item timeout")), ms))]);
function background(p: Promise<unknown>) {
  // @ts-ignore EdgeRuntime
  if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) EdgeRuntime.waitUntil(p.catch((e) => console.error("[audio-analyze] bg", e)));
}
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

interface Row { spotify_track_id: string; isrc: string | null; track_name: string; artist_name: string }

async function analyzeOne(admin: any, t: Row) {
  const ref = await findPreview(t.isrc, t.track_name, t.artist_name);
  const b64 = ref ? await fetchAudioB64(ref.url) : null;
  const ask = () => b64
    ? gemini([{ type: "text", text: audioPrompt(t.track_name, t.artist_name) }, { type: "input_audio", input_audio: { data: b64, format: "mp3" } }])
    : gemini([{ type: "text", text: textPrompt(t.track_name, t.artist_name) }]);
  const s = cleanSound(await ask());
  const source = b64 && ref ? ref.source : "none";
  const { error } = await admin.from("track_audio_analysis").upsert({
    spotify_track_id: t.spotify_track_id, source, ...s,
    confidence: b64 ? 0.85 : 0.4, model: AUDIO_MODEL, analyzed_at: new Date().toISOString(),
  }, { onConflict: "spotify_track_id" });
  if (error) throw new Error(error.message);
  return source;
}

async function runList(admin: any, list: Row[], deadline: number) {
  let i = 0, done = 0;
  let stop: GatewayStop | null = null;
  const worker = async () => {
    while (!stop && i < list.length && Date.now() < deadline) {
      if (await vibeHasPriority(admin)) return;
      const t = list[i++];
      for (let attempt = 0; attempt < 2; attempt++) {
        try { await withTimeout(analyzeOne(admin, t), Math.min(ITEM_MS, Math.max(5_000, deadline + 20_000 - Date.now()))); done++; break; }
        catch (e) {
          if (e instanceof GatewayStop) { stop = e; return; }
          if (e instanceof GatewayRetry && attempt === 0) { await sleep(Math.min(e.waitMs, 10_000)); if (await vibeHasPriority(admin)) return; continue; }
          if (!(e instanceof GatewayStop) && attempt === 0) continue;
          console.error("[audio-analyze]", t.spotify_track_id, e instanceof Error ? e.message : e);
          break;
        }
      }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return { done, stop: stop as GatewayStop | null };
}

function kick(depth: number) {
  const p = (async () => {
    await sleep(1500);
    await fetch(`${SUPABASE_URL}/functions/v1/audio-analyze`, {
      method: "POST", headers: { Authorization: `Bearer ${SERVICE_KEY}`, apikey: SERVICE_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ depth }),
    }).catch((e) => console.error("[audio-analyze] kick failed", e));
  })();
  // @ts-ignore EdgeRuntime
  if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) EdgeRuntime.waitUntil(p);
}

async function hop(admin: any, depth: number) {
  if (await vibeHasPriority(admin)) return { status: "foreground-priority" };
  const now = Date.now();
  const { data: st } = await admin.from("audio_analysis_state").select("*").eq("id", 1).single();
  if (st?.paused_until && new Date(st.paused_until).getTime() > now) return { status: "paused", reason: st.last_error };
  if (st?.lease_until && new Date(st.lease_until).getTime() > now) return { status: "busy" };
  let q = admin.from("audio_analysis_state").update({ lease_until: new Date(now + 90_000).toISOString(), status: "running" }).eq("id", 1);
  q = st?.lease_until ? q.eq("lease_until", st.lease_until) : q.is("lease_until", null);
  const { data: got } = await q.select("id");
  if (!got?.length) return { status: "busy" };

  const { data: list } = await admin.rpc("audio_queue_next", { _limit: 120 });
  const r = await runList(admin, (list ?? []) as Row[], now + HOP_MS);
  const { data: left } = await admin.rpc("audio_queue_count");
  const remaining = Number(left ?? 0);
  if (r.stop) {
    // 402/403: pause the whole chain; resume only on a later fresh kick after the wait.
    const pause = r.stop.status === 402 || r.stop.status === 403 ? 6 * 3600_000 : 3600_000;
    await admin.from("audio_analysis_state").update({ status: "paused", lease_until: null, paused_until: new Date(Date.now() + pause).toISOString(), last_error: r.stop.message, analyzed: (st?.analyzed ?? 0) + r.done, updated_at: new Date().toISOString() }).eq("id", 1);
    return { status: "paused", error: r.stop.message, done: r.done, remaining };
  }
  const finished = remaining === 0;
  await admin.from("audio_analysis_state").update({ status: finished ? "done" : "running", lease_until: null, last_error: null, analyzed: (st?.analyzed ?? 0) + r.done, updated_at: new Date().toISOString() }).eq("id", 1);
  if (!finished && depth > 0 && r.done > 0) kick(depth - 1);
  return { status: finished ? "done" : "running", done: r.done, remaining };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    let body: any = {};
    try { body = await req.json(); } catch { body = {}; }
    const bearer = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
    if (bearer !== SERVICE_KEY) {
      const { data: { user } } = await admin.auth.getUser(bearer);
      if (!user) return json({ error: "Unauthorized" }, 401);
    }
    // Queue requests are acknowledged immediately; the shared missing-analysis query is the queue.
    if (Array.isArray(body.queue_ids)) {
      kick(MAX_DEPTH);
      return json({ status: "queued" });
    }
    // Seed requests use the same single analysis queue; completed recordings are never re-heard.
    if (Array.isArray(body.seed_ids)) {
      const ids = body.seed_ids.filter((x: unknown) => typeof x === "string").slice(0, 3);
      const { data: done } = await admin.from("track_audio_analysis").select("spotify_track_id").in("spotify_track_id", ids)
        .not("drum_sound", "is", null).not("mix_character", "is", null).not("vocal_space", "is", null);
      const skip = new Set((done ?? []).map((r: any) => r.spotify_track_id));
      const need = ids.filter((id: string) => !skip.has(id));
      if (!need.length) return json({ done: 0 });
      const { data: rows } = await admin.from("liked_songs").select("spotify_track_id, isrc, track_name, artist_name").in("spotify_track_id", need);
      const uniq = [...new Map((rows ?? []).map((r: any) => [r.spotify_track_id, r])).values()] as Row[];
      const r = await runList(admin, uniq, Date.now() + 40_000);
      if (r.stop) return json({ error: r.stop.message }, r.stop.status);
      return json({ done: r.done });
    }
    // On demand (seeds / a few songs): analyze now and return.
    if (Array.isArray(body.ids)) {
      const ids = body.ids.filter((x: unknown) => typeof x === "string").slice(0, 30);
      if (!ids.length) return json({ done: 0 });
      const { data: list } = await admin.rpc("audio_queue", { _limit: ids.length, _ids: ids });
      const r = await runList(admin, (list ?? []) as Row[], Date.now() + 40_000);
      if (r.stop) return json({ error: r.stop.message }, r.stop.status);
      return json({ done: r.done });
    }
    if (body.status) {
      const { data: st } = await admin.from("audio_analysis_state").select("*").eq("id", 1).single();
      const { data: left } = await admin.rpc("audio_queue_count");
      return json({ ...st, remaining: left });
    }
    const depth = Math.max(0, Math.min(MAX_DEPTH, Number.isFinite(Number(body.depth)) ? Number(body.depth) : MAX_DEPTH));
    // Background chain hops run after the response so callers never hit the idle timeout.
    background(hop(admin, depth).then((r) => console.log("[audio-analyze] hop", JSON.stringify(r))));
    return json({ status: "started" });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});
