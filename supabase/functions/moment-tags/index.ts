// Edge Function: moment-tags — for every song, decides up to 3 life "moments" (with scores)
// and one human moment_story, using the STORED audio analysis and listener evidence
// (no re-listening). Fast text model, once per song, shared in track_analysis_global.
// Chains itself in bounded hops until every liked song is tagged.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { MOMENTS } from "../_shared/moments.ts";
import { vibeHasPriority } from "../_shared/analysis-priority.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BATCH = 25;
const CONCURRENCY = 5;
const HOP_MS = 45_000;
const MAX_DEPTH = 80;

const SYSTEM = `You are an expert music curator who has built thousands of playlists for real people. For EACH song, think about when, where and with whom someone would play THIS song and feel it is perfect for that moment. Base yourself on how it SOUNDS (the audio analysis) and on how listeners describe it — not on the genre name.
Return ONLY JSON: {"results":[{"id":"<id>","moments":[{"m":"<moment>","s":<0-1>}],"story":"<one phrase>"}]}
- "moments": up to 3 moments from this exact list, scored 0–1 by how well the song fits: ${MOMENTS.join(", ")}
- "story": ONE short, human, concrete phrase in Spanish describing the perfect moment for this song (e.g. "Manejando de noche por la ciudad, ventanas abajo, sin ganas de hablar"). No genre names, no artist names.`;

interface SongRow {
  spotify_track_id: string; track_name: string; artist_name: string; year: number | null;
  style: string | null; scene: string | null; instruments: string[] | null;
  feeling: string | null; feeling_2: string | null; energy: number | null; arc: string | null;
  melodic_focus: number | null; youtube_summary: string | null; tags: unknown;
}

async function tagBatch(apiKey: string, songs: SongRow[]) {
  const list = songs.map((t, i) =>
    `${i + 1}. id=${t.spotify_track_id} | "${String(t.track_name).slice(0, 150)}" by ${t.artist_name} | year: ${t.year ?? "?"} | style: ${t.style ?? "?"} | scene: ${t.scene ?? "?"} | instruments: ${(t.instruments ?? []).join(", ") || "?"} | feeling: ${t.feeling ?? "?"}${t.feeling_2 ? ` / ${t.feeling_2}` : ""} | energy: ${t.energy ?? "?"} | arc: ${t.arc ?? "?"} | melodic_focus: ${t.melodic_focus ?? "?"}${t.youtube_summary ? ` | listeners say: ${String(t.youtube_summary).slice(0, 200)}` : ""}${Array.isArray(t.tags) && t.tags.length ? ` | tags: ${t.tags.slice(0, 6).join(", ")}` : ""}`
  ).join("\n");
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-4.1-mini", response_format: { type: "json_object" },
      messages: [{ role: "system", content: SYSTEM }, { role: "user", content: list }],
    }),
  });
  if (res.status === 429) return { status: 429, rows: [] as any[] };
  if (!res.ok) throw new Error(`AI request failed (${res.status})`);
  const data = await res.json();
  let parsed: any = {};
  try { parsed = JSON.parse(String(data.choices?.[0]?.message?.content ?? "{}")); } catch { /* skip */ }
  const valid = new Set(songs.map((s) => s.spotify_track_id));
  const rows = (Array.isArray(parsed?.results) ? parsed.results : [])
    .filter((r: any) => r && valid.has(r.id))
    .map((r: any) => {
      const moments = (Array.isArray(r.moments) ? r.moments : [])
        .filter((m: any) => m && MOMENTS.includes(m.m))
        .map((m: any) => ({ m: m.m as string, s: Math.max(0, Math.min(1, Number(m.s) || 0)) }))
        .sort((a: any, b: any) => b.s - a.s)
        .slice(0, 3);
      return { id: r.id as string, moments, story: typeof r.story === "string" ? r.story.slice(0, 200) : null };
    });
  return { status: 200, rows };
}

function kick(depth: number) {
  const p = (async () => {
    await sleep(1500);
    await fetch(`${SUPABASE_URL}/functions/v1/moment-tags`, {
      method: "POST", headers: { Authorization: `Bearer ${SERVICE_KEY}`, apikey: SERVICE_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ depth }),
    }).catch((e) => console.error("[moment-tags] kick failed", e));
  })();
  // @ts-ignore EdgeRuntime
  if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) EdgeRuntime.waitUntil(p);
}

async function hop(admin: any, depth: number) {
  if (await vibeHasPriority(admin)) return { status: "foreground-priority" };
  const now = Date.now();
  const { data: st } = await admin.from("moment_tags_state").select("*").eq("id", 1).single();
  if (st?.paused_until && new Date(st.paused_until).getTime() > now) return { status: "paused", reason: st.last_error };
  if (st?.lease_until && new Date(st.lease_until).getTime() > now) return { status: "busy" };
  let q = admin.from("moment_tags_state").update({ lease_until: new Date(now + 90_000).toISOString(), status: "running" }).eq("id", 1);
  q = st?.lease_until ? q.eq("lease_until", st.lease_until) : q.is("lease_until", null);
  const { data: got } = await q.select("id");
  if (!got?.length) return { status: "busy" };

  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) {
    await admin.from("moment_tags_state").update({ status: "error", lease_until: null, last_error: "OPENAI_API_KEY is not set." }).eq("id", 1);
    return { status: "error", error: "OPENAI_API_KEY is not set." };
  }

  // Songs someone liked that have analysis but no moments yet.
  const { data: list } = await admin.rpc("moment_queue_next", { _limit: 250 });
  const songs = (list ?? []) as SongRow[];
  let done = 0;
  let paused = false;
  let pauseReason = "ai_rate_limit";
  const batches: SongRow[][] = [];
  for (let i = 0; i < songs.length; i += BATCH) batches.push(songs.slice(i, i + BATCH));
  const started = Date.now();
  const worker = async () => {
    while (!paused && batches.length && Date.now() - started < HOP_MS) {
      if (await vibeHasPriority(admin)) return;
      const batch = batches.shift();
      if (!batch) return;
      try {
        let r = await tagBatch(apiKey, batch).catch(() => ({ status: 500, rows: [] as any[] }));
        if (r.status !== 200 && !(await vibeHasPriority(admin))) r = await tagBatch(apiKey, batch);
        if (r.status === 429) { paused = true; batches.unshift(batch); return; }
        if (r.status !== 200) throw new Error(`AI request failed (${r.status})`);
        for (const row of r.rows) {
          const { error } = await admin.from("track_analysis_global").update({
            moments: row.moments, moment_story: row.story, moments_checked: true, updated_at: new Date().toISOString(),
          }).eq("spotify_track_id", row.id);
          if (error) throw new Error(error.message);
        }
        // Missing model output remains pending; it is not a completed analysis.
        done += r.rows.length;
        await sleep(250);
      } catch (e) {
        console.error("[moment-tags]", e instanceof Error ? e.message : e);
        paused = true;
        pauseReason = e instanceof Error ? e.message.slice(0, 200) : "unknown_error";
        batches.unshift(batch);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, batches.length) }, worker));

  // Copy the new moments to every user who liked these songs.
  const ids = songs.map((s) => s.spotify_track_id);
  if (ids.length) {
    const { data: users } = await admin.from("liked_songs").select("user_id").in("spotify_track_id", ids);
    for (const uid of [...new Set((users ?? []).map((u: any) => u.user_id))]) {
      await admin.rpc("hydrate_track_analysis", { _user_id: uid }).catch(() => null);
    }
  }

  const { count: left } = await admin.from("track_analysis_global").select("spotify_track_id", { count: "exact", head: true })
    .eq("moments_checked", false);
  const remaining = left ?? 0;
  if (paused) {
    await admin.from("moment_tags_state").update({ status: "paused", lease_until: null, paused_until: new Date(Date.now() + 120_000).toISOString(), last_error: pauseReason, done: (st?.done ?? 0) + done, updated_at: new Date().toISOString() }).eq("id", 1);
    return { status: "paused", reason: pauseReason, done, remaining };
  }
  const finished = remaining === 0 || !songs.length;
  await admin.from("moment_tags_state").update({ status: finished ? "done" : "running", lease_until: null, last_error: null, done: (st?.done ?? 0) + done, updated_at: new Date().toISOString() }).eq("id", 1);
  if (!finished && depth > 0 && done > 0) kick(depth - 1);
  return { status: finished ? "done" : "running", done, remaining };
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
    if (body?.warm) return json({ ok: true });
    if (body?.status) {
      const { data: st } = await admin.from("moment_tags_state").select("*").eq("id", 1).single();
      const { count } = await admin.from("track_analysis_global").select("spotify_track_id", { count: "exact", head: true }).eq("moments_checked", false);
      return json({ ...st, remaining: count });
    }
    const depth = Math.max(0, Math.min(MAX_DEPTH, Number.isFinite(Number(body.depth)) ? Number(body.depth) : MAX_DEPTH));
    // Hops run after the response so callers never hit the platform idle timeout.
    const p = hop(admin, depth).then((r) => console.log("[moment-tags] hop", JSON.stringify(r))).catch((e) => console.error("[moment-tags] bg", e));
    // @ts-ignore EdgeRuntime
    if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) EdgeRuntime.waitUntil(p); else await p;
    return json({ status: "started" });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});
