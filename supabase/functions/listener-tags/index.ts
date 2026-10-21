// Background: collects how real listeners describe each song (Last.fm tags, YouTube
// comment summaries) and re-describes feeling/melodic_focus/arc/instruments with that
// evidence using the strong model. Manual "Edit sound" corrections still win (applied in ai.ts).
// Bounded hops, single-flight lease, self-chains only while work remains.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { INSTRUMENTS, FEELINGS, ARCS, DANCE_STYLES, sanitizeSound } from "../_shared/sound.ts";
import { vibeHasPriority } from "../_shared/analysis-priority.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const HOP_BUDGET_MS = 45_000;
const MAX_DEPTH = 120;
const YT_DAILY = 80;
const MODELS = ["gpt-5.2", "gpt-5.1", "gpt-5", "gpt-4.1"];
let chosen: string | null = null;
const c01 = (n: unknown) => { const v = Number(n); return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : null; };
const utcDay = () => new Date().toISOString().slice(0, 10);
const nextUtcMidnight = () => { const d = new Date(); d.setUTCHours(24, 0, 0, 0); return d.toISOString(); };

export function cleanTitle(t: string) {
  return t.replace(/\s*[\(\[][^\)\]]*(feat|ft\.|with|remaster|version|edit|mix|radio)[^\)\]]*[\)\]]/gi, "")
    .replace(/\s+-\s+.*(remaster|version|edit|radio|live|mono|stereo).*$/i, "").trim();
}

const RECLASS = `You are an expert music curator. Basa el feeling en cómo los oyentes describen la canción. Si la evidencia contradice lo que suele hacer el artista, gana la evidencia. La confidence depende de cuánta evidencia hay y qué tan consistente es.
For each song you get listener evidence: Last.fm tags (with counts; tags marked "artist" describe the artist, not the song, so they are weaker) and/or a summary of YouTube comments.
"feeling": main emotion the LISTENER feels, ONLY one of: ${FEELINGS.map((x) => `"${x}"`).join(",")}.
"feeling_2": optional secondary emotion from the same list (different from "feeling"), or null. "inspirational" = calm hope, healing, reflection (goosebumps, tears, sunrise); "euphoric" = dance-floor euphoria, hands in the air — never confuse them.
"melodic_focus": 0 = lives on rhythm and groove; 1 = lives on melody and emotion.
"arc": ONLY one of: ${ARCS.map((x) => `"${x}"`).join(",")}.
"instruments": 2 to 5, ONLY from: ${INSTRUMENTS.map((x) => `"${x}"`).join(",")}.
"confidence": 0–1.
Return ONLY JSON: {"results":[{"id":"<id>","feeling":"...","feeling_2":null,"melodic_focus":0.0,"arc":"...","instruments":[...],"confidence":0.0}]}`;

async function lastfm(method: string, params: Record<string, string>) {
  const u = new URL("https://ws.audioscrobbler.com/2.0/");
  u.search = new URLSearchParams({ method, api_key: Deno.env.get("LASTFM_API_KEY")!.trim(), format: "json", autocorrect: "1", ...params }).toString();
  const r = await fetch(u);
  if (r.status === 429) return { rate: true, tags: [] as any[] };
  const b = await r.json().catch(() => null);
  const tags = (b?.toptags?.tag ?? []) as any[];
  return { rate: b?.error === 29, tags: tags.slice(0, 15).map((t) => ({ name: String(t.name).toLowerCase().slice(0, 40), count: Number(t.count) || 0 })).filter((t) => t.count > 0) };
}

async function openai(body: unknown) {
  return fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${Deno.env.get("OPENAI_API_KEY")}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function summarizeComments(name: string, comments: string[]) {
  const r = await openai({
    model: "gpt-4.1-mini",
    messages: [
      { role: "system", content: "Summarize in at most 2 short sentences (English, under 300 characters) what these YouTube comments say about the song's EMOTION, the MOMENT people listen to it, and the INSTRUMENTS. No usernames, no quotes. If they say nothing useful, reply exactly: none" },
      { role: "user", content: `Song: ${name}\n\n${comments.map((c) => `- ${c.slice(0, 300)}`).join("\n")}` },
    ],
  });
  if (!r.ok) throw new Error(`AI ${r.status}`);
  const t = String((await r.json()).choices?.[0]?.message?.content ?? "").trim().slice(0, 400);
  return /^none\.?$/i.test(t) ? null : t;
}

async function runHop(admin: any, userId: string, started: number, priority: string[]) {
  if (await vibeHasPriority(admin)) return { status: "foreground-priority" };
  // Evidence any user already gathered is copied from the shared table first.
  await admin.rpc("hydrate_track_analysis", { _user_id: userId });
  const left = () => HOP_BUDGET_MS - (Date.now() - started);
  const liked: any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await admin.from("liked_songs").select("spotify_track_id, track_name, artists, artist_name").eq("user_id", userId).eq("is_active", true).range(from, from + 999);
    liked.push(...(data ?? [])); if (!data || data.length < 1000) break;
  }
  const byId = new Map(liked.map((t) => [t.spotify_track_id, t]));
  const ev = new Map<string, any>();
  for (let from = 0; ; from += 1000) {
    const { data } = await admin.from("listener_evidence").select("*").eq("user_id", userId).range(from, from + 999);
    for (const r of data ?? []) ev.set(r.spotify_track_id, r); if (!data || data.length < 1000) break;
  }
  const prio = new Set(priority);
  const order = (ids: string[]) => [...ids.filter((i) => prio.has(i)), ...ids.filter((i) => !prio.has(i))];
  const upsert = (id: string, patch: Record<string, unknown>) => {
    const row = { ...(ev.get(id) ?? { user_id: userId, spotify_track_id: id }), ...patch, updated_at: new Date().toISOString() };
    ev.set(id, row);
    return admin.from("listener_evidence").upsert(row, { onConflict: "user_id,spotify_track_id" });
  };

  // 2) YouTube comments: seeds + electronic songs with confidence < 0.6; 80 searches/day.
  const cls = new Map<string, any>();
  for (let from = 0; ; from += 1000) {
    const { data } = await admin.from("track_ai_classification").select("spotify_track_id, style, family, confidence, manual_sound, feeling, melodic_focus, arc, instruments").eq("user_id", userId).range(from, from + 999);
    for (const r of data ?? []) cls.set(r.spotify_track_id, r); if (!data || data.length < 1000) break;
  }
  const { data: fb } = await admin.from("playlist_feedback").select("seed_track_id").eq("user_id", userId).not("seed_track_id", "is", null);
  const seeds = new Set<string>([...priority, ...(fb ?? []).map((r: any) => r.seed_track_id)]);
  for (const [id, c] of cls) if (c.manual_sound) seeds.add(id);
  const appear = new Map<string, number>();
  const { data: gp } = await admin.from("generated_playlists").select("track_ids").eq("user_id", userId);
  for (const p of gp ?? []) for (const id of p.track_ids ?? []) appear.set(id, (appear.get(id) ?? 0) + 1);
  const isYtCandidate = (id: string) => {
    const c = cls.get(id);
    return seeds.has(id) || (!!c && (DANCE_STYLES.includes(c.style) || c.family === "electronic") && c.confidence !== null && c.confidence < 0.6);
  };
  const ytQueue = liked.map((t) => t.spotify_track_id).filter((id) => byId.has(id) && isYtCandidate(id) && !ev.get(id)?.youtube_checked)
    .sort((a, b) => (Number(prio.has(b)) - Number(prio.has(a))) || (Number(seeds.has(b)) - Number(seeds.has(a))) || ((appear.get(b) ?? 0) - (appear.get(a) ?? 0)));
  const ytKey = Deno.env.get("YOUTUBE_API_KEY")?.trim();
  const { data: st } = await admin.from("listener_evidence_state").select("*").eq("user_id", userId).single();
  let used = st.youtube_day === utcDay() ? st.youtube_searches_today : 0;
  let ytBlocked = !ytKey || used >= YT_DAILY || (st.youtube_paused_until && new Date(st.youtube_paused_until) > new Date());
  for (const id of ytQueue) {
    if (ytBlocked || left() < 32_000) break;
    if (used >= YT_DAILY) { ytBlocked = true; break; }
    const t = byId.get(id)!;
    const artist = ((t.artists ?? []) as any[])[0]?.name ?? t.artist_name;
    used++;
    await admin.from("listener_evidence_state").update({ youtube_day: utcDay(), youtube_searches_today: used }).eq("user_id", userId);
    const s = await fetch(`https://www.googleapis.com/youtube/v3/search?${new URLSearchParams({ part: "snippet", type: "video", maxResults: "1", q: `${artist} ${cleanTitle(t.track_name)}`, key: ytKey! })}`);
    if (s.status === 403 || s.status === 429) {
      console.log(`[listener-tags] YouTube search ${s.status} ${(await s.text()).slice(0, 200)}`);
      await admin.from("listener_evidence_state").update({ youtube_paused_until: nextUtcMidnight() }).eq("user_id", userId);
      ytBlocked = true; break;
    }
    const vid = s.ok ? (await s.json()).items?.[0]?.id?.videoId : null;
    let summary: string | null = null;
    if (vid) {
      const c = await fetch(`https://www.googleapis.com/youtube/v3/commentThreads?${new URLSearchParams({ part: "snippet", videoId: vid, maxResults: "50", order: "relevance", textFormat: "plainText", key: ytKey! })}`);
      const cb = c.ok ? await c.json() : null;
      const comments = ((cb?.items ?? []) as any[]).map((x) => String(x.snippet?.topLevelComment?.snippet?.textDisplay ?? "")).filter(Boolean);
      if (comments.length) summary = await summarizeComments(`${t.track_name} by ${artist}`, comments);
    }
    await upsert(id, { youtube_summary: summary, youtube_checked: true, ...(summary ? { evidence_applied: false } : {}) });
  }
  const ytLeft = ytBlocked ? 0 : ytQueue.filter((id) => !ev.get(id)?.youtube_checked).length;
  // 1) Last.fm tags, max 4 requests/second.
  const lfQueue = order(liked.map((t) => t.spotify_track_id).filter((id) => !ev.get(id)?.lastfm_checked));
  const artistCache = new Map<string, any[]>();
  if (Deno.env.get("LASTFM_API_KEY")) {
    // 4 workers share one gate: at most 4 Last.fm requests start per second.
    let nextSlot = 0; let rated = false;
    const gate = async () => { const now = Date.now(); const at = Math.max(now, nextSlot); nextSlot = at + 250; if (at > now) await sleep(at - now); };
    const q = [...lfQueue];
    const worker = async () => {
      while (q.length && !rated && left() >= 25_000) {
        if (await vibeHasPriority(admin)) return;
        const id = q.shift()!;
        const t = byId.get(id)!;
        const artist = ((t.artists ?? []) as any[])[0]?.name ?? String(t.artist_name).split(",")[0];
        await gate();
        let r = await lastfm("track.gettoptags", { artist, track: cleanTitle(t.track_name) });
        if (r.rate) { rated = true; return; }
        let source = "track";
        if (!r.tags.length) {
          source = "artist";
          if (!artistCache.has(artist)) { await gate(); const a = await lastfm("artist.gettoptags", { artist }); if (a.rate) { rated = true; return; } artistCache.set(artist, a.tags); }
          r = { rate: false, tags: artistCache.get(artist)! };
        }
        await upsert(id, { tags: r.tags.length ? r.tags : null, tag_source: r.tags.length ? source : null, lastfm_checked: true });
      }
    };
    await Promise.all(Array.from({ length: 4 }, worker));
  }
  const lfLeft = liked.filter((t) => !ev.get(t.spotify_track_id)?.lastfm_checked).length;


  // 3) Re-describe with evidence (strong model). Wait for YouTube on candidates still in today's budget.
  const ready = order([...ev.values()].filter((e) => !e.evidence_applied && e.lastfm_checked && (e.tags?.length || e.youtube_summary) && byId.has(e.spotify_track_id)
    && (e.youtube_checked || !isYtCandidate(e.spotify_track_id) || ytBlocked)).map((e) => e.spotify_track_id));
  // Up to 5 strong-model batches at once.
  const groups: string[][] = [];
  for (let i = 0; i < ready.length; i += 15) groups.push(ready.slice(i, i + 15));
  let stop = false;
  const reWorker = async () => {
    while (groups.length && !stop && left() > 10_000) {
      if (await vibeHasPriority(admin)) return;
      const ids = groups.shift()!;
        const lines = ids.map((id, n) => {
          const t = byId.get(id)!; const e = ev.get(id); const c = cls.get(id);
          const tags = (e.tags ?? []).map((x: any) => `${x.name} (${x.count})`).join(", ");
          return `${n + 1}. id=${id} | "${t.track_name}" by ${((t.artists ?? []) as any[]).map((a) => a?.name).join(", ")} | style: ${c?.style ?? "?"} | last.fm ${e.tag_source ?? ""} tags: ${tags || "none"} | youtube comments: ${e.youtube_summary ?? "none"}`;
        }).join("\n");
        let res: Response | null = null;
        for (const model of chosen ? [chosen] : MODELS) {
          res = await openai({ model, response_format: { type: "json_object" }, messages: [{ role: "system", content: RECLASS }, { role: "user", content: lines }] });
          if ([400, 403, 404].includes(res.status) && !chosen) continue;
          if (res.ok) chosen = model;
          break;
        }
        if (!res || !res.ok) { console.log(`[listener-tags] AI ${res?.status}`); stop = true; return; }
        let parsed: any = {};
        try { parsed = JSON.parse(String((await res.json()).choices?.[0]?.message?.content ?? "{}")); } catch { /* skip */ }
        for (const r of (parsed.results ?? []) as any[]) {
          if (!ids.includes(r?.id)) continue;
          const patch: Record<string, unknown> = {
            feeling: FEELINGS.includes(r.feeling) ? r.feeling : undefined,
            feeling_2: FEELINGS.includes(r.feeling) ? (FEELINGS.includes(r.feeling_2) && r.feeling_2 !== r.feeling ? r.feeling_2 : null) : undefined,
            melodic_focus: c01(r.melodic_focus) ?? undefined,
            arc: ARCS.includes(r.arc) ? r.arc : undefined,
            instruments: sanitizeSound(r).instruments ?? undefined,
            confidence: c01(r.confidence) ?? undefined,
            feel_checked: true,
          };
          for (const k of Object.keys(patch)) if (patch[k] === undefined) delete patch[k];
          await admin.from("track_ai_classification").update(patch).eq("user_id", userId).eq("spotify_track_id", r.id);
        }
        for (const id of ids) await upsert(id, { evidence_applied: true });

    }
  };
  await Promise.all(Array.from({ length: 5 }, reWorker));
  const reLeft = [...ev.values()].filter((e) => !e.evidence_applied && e.lastfm_checked && (e.tags?.length || e.youtube_summary)).length;
  return { lastfm_left: lfLeft, youtube_left: ytLeft, reclassify_left: reLeft, youtube_searches_today: used };
}

function kick(userId: string, depth: number, priority: string[]) {
  const p = (async () => {
    await sleep(3000);
    await fetch(`${SUPABASE_URL}/functions/v1/listener-tags`, {
      method: "POST", headers: { Authorization: `Bearer ${SERVICE_KEY}`, apikey: SERVICE_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: userId, depth, priority_ids: priority }),
    }).catch((e) => console.error("[listener-tags] kick failed", e));
  })();
  // @ts-ignore EdgeRuntime
  if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) EdgeRuntime.waitUntil(p);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    const body = await req.json().catch(() => ({}));
    const bearer = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
    let userId: string | null = null;
    if (bearer === SERVICE_KEY && typeof body.user_id === "string") userId = body.user_id;
    else userId = (await admin.auth.getUser(bearer)).data.user?.id ?? null;
    if (!userId) return json({ error: "Unauthorized" }, 401);
    const depth = Math.max(0, Math.min(MAX_DEPTH, Number.isFinite(Number(body.depth)) ? Number(body.depth) : MAX_DEPTH));
    const priority = (Array.isArray(body.priority_ids) ? body.priority_ids : []).filter((x: unknown) => typeof x === "string").slice(0, 60);

    await admin.from("listener_evidence_state").upsert({ user_id: userId }, { onConflict: "user_id", ignoreDuplicates: true });
    const { data: st } = await admin.from("listener_evidence_state").select("lease_until").eq("user_id", userId).single();
    const now = Date.now();
    if (st.lease_until && new Date(st.lease_until).getTime() > now) return json({ status: "busy" });
    let q = admin.from("listener_evidence_state").update({ lease_until: new Date(now + 90_000).toISOString(), status: "running" }).eq("user_id", userId);
    q = st.lease_until ? q.eq("lease_until", st.lease_until) : q.is("lease_until", null);
    const { data: got } = await q.select("user_id");
    if (!got?.length) return json({ status: "busy" });
    try {
      const r = await runHop(admin, userId, now, priority);
      const more = r.lastfm_left + r.youtube_left + r.reclassify_left > 0;
      await admin.from("listener_evidence_state").update({ status: more ? "running" : "done", lease_until: null, error: null, updated_at: new Date().toISOString() }).eq("user_id", userId);
      if (more && depth > 0) kick(userId, depth - 1, priority);
      return json({ status: more ? "running" : "done", ...r });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      await admin.from("listener_evidence_state").update({ status: "error", error: msg, lease_until: null }).eq("user_id", userId);
      return json({ status: "error", error: msg });
    }
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});
