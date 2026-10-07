// Background library analysis: fills artist_genres (Spotify GET /artists/{id})
// and track_ai_classification (OpenAI) for songs/artists with no data yet.
// Started after each sync; chains itself in bounded hops until done. If
// Spotify asks to wait > 30s (or QUOTA_EXCEEDED) it pauses and a cron sweep
// resumes it after paused_until.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const CONCURRENCY = 2;
const GAP_MS = 350;
const HOP_BUDGET_MS = 45_000;
const MAX_WAIT_S = 30;
const MAX_DEPTH = 80;
const AI_BATCH = 40;

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const CLASSIFY_SYSTEM = `You are a music analyst. For each song you receive, estimate how it SOUNDS so an app can build playlists that flow without skips.
Use your knowledge of the specific song when you know it; otherwise infer from the artist, album, year and genres.

Return ONLY JSON, no prose and no markdown fences, with this exact shape:
{"results": [ ...one object per song, same order... ]}

Each object has exactly these keys:
- "id": the id you received
- "lang": language the lyrics are SUNG in (not the title language). One of: "es","en","pt","fr","it","de","ko","ja","zh","instrumental","other". Mostly-Spanish songs with a few English words are "es".
- "energy": 0 to 1 (0 = very calm, 1 = very intense)
- "valence": 0 to 1 (0 = sad/dark, 1 = happy/bright)
- "danceability": 0 to 1
- "tempo": approximate BPM as a number
- "mood": one of "chill","melancholic","romantic","upbeat","party","intense","dreamy","empowering"
- "original_year": the year the song was FIRST released (not a remaster, compilation or reissue year). If you are not sure, return the album year you received.`;

const LANGS = ["es", "en", "pt", "fr", "it", "de", "ko", "ja", "zh", "instrumental", "other"];
const MOODS = ["chill", "melancholic", "romantic", "upbeat", "party", "intense", "dreamy", "empowering"];
const c01 = (n: unknown) => { const v = Number(n); return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0.5; };

class Pause extends Error {
  constructor(public until: number, public reason: string, public status: number, public retryAfter: number | null) { super(reason); }
}

async function getToken(admin: any, userId: string): Promise<string> {
  const { data: conn } = await admin.from("spotify_connections")
    .select("access_token, refresh_token, expires_at").eq("user_id", userId).maybeSingle();
  if (!conn) throw new Error("Spotify not connected");
  if (new Date(conn.expires_at) > new Date(Date.now() + 5 * 60_000)) return conn.access_token;
  const cid = Deno.env.get("SPOTIFY_CLIENT_ID")!.trim();
  const cs = Deno.env.get("SPOTIFY_CLIENT_SECRET")!.trim();
  const r = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: `Basic ${btoa(`${cid}:${cs}`)}` },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: conn.refresh_token }),
  });
  const tok = await r.json();
  if (!r.ok) throw new Error("Spotify session expired. Reconnect Spotify in Settings.");
  await admin.from("spotify_connections").update({
    access_token: tok.access_token, refresh_token: tok.refresh_token ?? conn.refresh_token,
    expires_at: new Date(Date.now() + tok.expires_in * 1000).toISOString(),
  }).eq("user_id", userId);
  return tok.access_token;
}

async function likedRows(admin: any, userId: string) {
  const out: any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin.from("liked_songs")
      .select("spotify_track_id, track_name, album_name, artists, album_release_date")
      .eq("user_id", userId).eq("is_active", true).eq("is_available", true).range(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) return out;
  }
}

async function existing(admin: any, table: string, col: string, ids: string[], userId?: string) {
  const known = new Map<string, any>();
  for (let i = 0; i < ids.length; i += 300) {
    let q = admin.from(table).select(table === "artist_genres" ? "artist_id, genres" : "spotify_track_id, year_checked").in(col, ids.slice(i, i + 300));
    if (userId) q = q.eq("user_id", userId);
    const { data } = await q;
    for (const r of data ?? []) known.set(r[col], r);
  }
  return known;
}

async function runHop(admin: any, userId: string, started: number, skipSpotify = false) {
  const liked = await likedRows(admin, userId);
  const allArtists = [...new Set(liked.flatMap((r) => ((r.artists ?? []) as any[]).map((a) => a?.id).filter(Boolean)))] as string[];
  const genres = await existing(admin, "artist_genres", "artist_id", allArtists);
  const artistQueue = allArtists.filter((id) => !genres.has(id));
  const trackIds = liked.map((r) => r.spotify_track_id);
  const cls = await existing(admin, "track_ai_classification", "spotify_track_id", trackIds, userId);
  const trackQueue = liked.filter((r) => !cls.get(r.spotify_track_id)?.year_checked);

  const save = (patch: Record<string, unknown>) =>
    admin.from("library_enrichment").update({ ...patch, updated_at: new Date().toISOString() }).eq("user_id", userId);
  let artistsDone = allArtists.length - artistQueue.length;
  let tracksDone = trackIds.length - trackQueue.length;
  await save({ status: "running", artists_total: allArtists.length, artists_done: artistsDone, tracks_total: trackIds.length, tracks_done: tracksDone, error: null, ...(skipSpotify ? {} : { paused_until: null, pause_reason: null }) });

  // 1) Artist genres from Spotify.
  let spotifyPause: Pause | null = null;
  if (artistQueue.length && !skipSpotify) {
    const token = await getToken(admin, userId);
    const rows: any[] = [];
    let pause: Pause | null = null;
    const flush = async () => {
      if (!rows.length) return;
      await admin.from("artist_genres").upsert(rows.splice(0, rows.length), { onConflict: "artist_id" });
      await save({ artists_done: artistsDone });
    };
    const worker = async () => {
      while (artistQueue.length && !pause && Date.now() - started < HOP_BUDGET_MS) {
        const id = artistQueue.shift()!;
        const r = await fetch(`https://api.spotify.com/v1/artists/${id}`, { headers: { Authorization: `Bearer ${token}` } });
        if (r.status === 429) {
          const raHeader = r.headers.get("retry-after");
          const ra = Number(raHeader ?? "5");
          const text = await r.text().catch(() => "");
          console.log(`[library-enrich] Spotify 429 retry-after=${raHeader} body=${text.slice(0, 200)}`);
          artistQueue.unshift(id);
          const quota = /QUOTA_EXCEEDED/i.test(text);
          const wait = Number.isFinite(ra) ? ra : 5;
          if (quota || wait > MAX_WAIT_S) {
            pause = new Pause(Date.now() + Math.max(wait, quota ? 3600 : 0) * 1000, quota ? "quota" : "rate_limit", 429, Number.isFinite(ra) ? ra : null);
            return;
          }
          await sleep(wait * 1000);
          continue;
        }
        if (r.status === 401) throw new Error("Spotify session expired. Reconnect Spotify in Settings.");
        if (!r.ok) console.log(`[library-enrich] Spotify ${r.status} for artist ${id}`);
        const body = r.ok ? await r.json().catch(() => null) : null;
        rows.push({ artist_id: id, genres: Array.isArray(body?.genres) ? body.genres : [], updated_at: new Date().toISOString() });
        artistsDone++;
        if (rows.length >= 25) await flush();
        await sleep(GAP_MS);
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    await flush();
    spotifyPause = pause;
  }

  // 2) AI classification (only songs with no data). Uses whatever genres exist.
  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (trackQueue.length && apiKey && Date.now() - started < HOP_BUDGET_MS) {
    const genreMap = await existing(admin, "artist_genres", "artist_id", allArtists);
    const maxYear = new Date().getFullYear();
    const batches: any[][] = [];
    for (let i = 0; i < trackQueue.length; i += AI_BATCH) batches.push(trackQueue.slice(i, i + AI_BATCH));
    const worker = async () => {
      while (batches.length && Date.now() - started < HOP_BUDGET_MS) {
        const batch = batches.shift()!;
        const list = batch.map((t, i) => {
          const artists = ((t.artists ?? []) as any[]);
          const g = [...new Set(artists.flatMap((a) => genreMap.get(a?.id)?.genres ?? []))].slice(0, 6);
          const y = parseInt(String(t.album_release_date ?? "").slice(0, 4));
          return `${i + 1}. id=${t.spotify_track_id} | "${String(t.track_name).slice(0, 200)}" by ${artists.map((a) => a?.name).join(", ")} | album: ${t.album_name ?? ""} | year: ${Number.isFinite(y) ? y : "?"} | genres: ${g.join(", ") || "none"}`;
        }).join("\n");
        const res = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "gpt-4.1-mini", response_format: { type: "json_object" },
            messages: [{ role: "system", content: CLASSIFY_SYSTEM }, { role: "user", content: list }],
          }),
        });
        if (res.status === 429) { batches.length = 0; throw new Pause(Date.now() + 120_000, "ai_rate_limit", 429, null); }
        if (!res.ok) { console.log(`[library-enrich] OpenAI ${res.status}`); throw new Error(`AI request failed (${res.status})`); }
        const data = await res.json();
        let parsed: any = {};
        try { parsed = JSON.parse(String(data.choices?.[0]?.message?.content ?? "{}")); } catch { /* skip */ }
        const valid = new Set(batch.map((t) => t.spotify_track_id));
        const rows = (Array.isArray(parsed?.results) ? parsed.results : []).filter((r: any) => r && valid.has(r.id)).map((r: any) => {
          const y = Number(r.original_year); const tempo = Number(r.tempo);
          return {
            user_id: userId, spotify_track_id: r.id,
            lang: LANGS.includes(r.lang) ? r.lang : "other",
            energy: c01(r.energy), valence: c01(r.valence), danceability: c01(r.danceability),
            tempo: Number.isFinite(tempo) && tempo >= 50 && tempo <= 220 ? tempo : 110,
            mood: MOODS.includes(r.mood) ? r.mood : "chill",
            original_year: Number.isInteger(y) && y >= 1900 && y <= maxYear ? y : null,
            year_checked: true,
          };
        });
        if (rows.length) await admin.from("track_ai_classification").upsert(rows, { onConflict: "user_id,spotify_track_id" });
        tracksDone += rows.length;
        await save({ tracks_done: tracksDone });
        await sleep(GAP_MS);
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  }

  if (spotifyPause) throw spotifyPause; // AI step above still ran with the genres we have
  const remaining = artistQueue.length + Math.max(0, trackIds.length - tracksDone);
  return { remaining, artistsDone, tracksDone };
}

function kick(userId: string, depth: number) {
  const p = (async () => {
    await sleep(3000); // cooldown between hops
    await fetch(`${SUPABASE_URL}/functions/v1/library-enrich`, {
      method: "POST",
      headers: { Authorization: `Bearer ${SERVICE_KEY}`, apikey: SERVICE_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: userId, depth }),
    }).catch((e) => console.error("[library-enrich] kick failed", e));
  })();
  // @ts-ignore EdgeRuntime is provided by the edge runtime.
  if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) EdgeRuntime.waitUntil(p);
}

async function process(admin: any, userId: string, depth: number, force: boolean) {
  const now = Date.now();
  await admin.from("library_enrichment").upsert({ user_id: userId }, { onConflict: "user_id", ignoreDuplicates: true });
  const { data: st } = await admin.from("library_enrichment").select("*").eq("user_id", userId).single();
  const pausedFor = st.paused_until && new Date(st.paused_until).getTime() > now ? st.pause_reason : null;
  if (pausedFor === "ai_rate_limit") return { status: "paused", paused_until: st.paused_until };
  const skipSpotify = !!pausedFor; // Spotify asked to wait: still classify songs with the data we have
  if (!force && st.lease_until && new Date(st.lease_until).getTime() > now) return { status: "busy" };
  // Single-flight lease.
  const leaseUntil = new Date(now + 90_000).toISOString();
  let q = admin.from("library_enrichment").update({ lease_until: leaseUntil }).eq("user_id", userId);
  q = st.lease_until ? q.eq("lease_until", st.lease_until) : q.is("lease_until", null);
  const { data: got } = await q.select("user_id");
  if (!got?.length) return { status: "busy" };

  const started = Date.now();
  await admin.rpc("enrich_resume_arm", { _on: true }); // backstop while work is pending
  try {
    const r = await runHop(admin, userId, started, skipSpotify);
    if (skipSpotify) {
      const tracksLeft = r.tracksDone < (await admin.from("library_enrichment").select("tracks_total").eq("user_id", userId).single()).data.tracks_total;
      await admin.from("library_enrichment").update({ status: "paused", lease_until: null, updated_at: new Date().toISOString() }).eq("user_id", userId);
      if (tracksLeft && depth > 0) kick(userId, depth - 1);
      return { status: "paused", ...r };
    }
    const done = r.remaining === 0;
    await admin.from("library_enrichment").update({
      status: done ? "done" : "running", lease_until: null, updated_at: new Date().toISOString(),
    }).eq("user_id", userId);
    if (!done && depth > 0) kick(userId, depth - 1);
    return { status: done ? "done" : "running", ...r };
  } catch (e) {
    if (e instanceof Pause) {
      await admin.from("library_enrichment").update({
        status: "paused", paused_until: new Date(e.until).toISOString(), pause_reason: e.reason,
        last_spotify_status: e.status, last_retry_after: e.retryAfter, lease_until: null, updated_at: new Date().toISOString(),
      }).eq("user_id", userId);
      return { status: "paused", reason: e.reason, retry_after: e.retryAfter };
    }
    const msg = e instanceof Error ? e.message : "Unknown error";
    await admin.from("library_enrichment").update({ status: "error", error: msg, lease_until: null, updated_at: new Date().toISOString() }).eq("user_id", userId);
    return { status: "error", error: msg };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    let body: any = {};
    try { body = await req.json(); } catch { body = {}; }
    const bearer = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
    const internal = bearer === SERVICE_KEY;

    // Cron sweep: resume paused jobs whose wait is over, and stalled chains.
    if (body.sweep) {
      const nowIso = new Date().toISOString();
      const { data: due } = await admin.from("library_enrichment").select("user_id")
        .in("status", ["paused", "running"]).or(`paused_until.is.null,paused_until.lte.${nowIso}`)
        .or(`lease_until.is.null,lease_until.lte.${nowIso}`)
        .lte("updated_at", new Date(Date.now() - 60_000).toISOString()).limit(5);
      for (const r of due ?? []) {
        await admin.from("library_enrichment").update({ paused_until: null }).eq("user_id", r.user_id);
        kick(r.user_id, MAX_DEPTH);
      }
      const { count } = await admin.from("library_enrichment").select("user_id", { count: "exact", head: true })
        .in("status", ["paused", "running"]);
      if (!count) await admin.rpc("enrich_resume_arm", { _on: false });
      return json({ resumed: (due ?? []).length });
    }

    let userId: string | null = null;
    if (internal && typeof body.user_id === "string") userId = body.user_id;
    else {
      const { data: { user } } = await admin.auth.getUser(bearer);
      userId = user?.id ?? null;
    }
    if (!userId) return json({ error: "Unauthorized" }, 401);
    const depth = Math.max(0, Math.min(MAX_DEPTH, Number.isFinite(Number(body.depth)) ? Number(body.depth) : MAX_DEPTH));
    return json(await process(admin, userId, depth, false));
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});
