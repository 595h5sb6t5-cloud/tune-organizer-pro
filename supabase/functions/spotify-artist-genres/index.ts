// Fills public.artist_genres for the artists in the user's Liked Songs.
// GET /artists (batch) no longer exists, so each artist is fetched with
// GET /artists/{id}, max 3 in parallel, honoring Retry-After on 429.
// Only artists not already in the table are requested. Works in time-boxed
// chunks: the client calls again while `remaining > 0`.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const CONCURRENCY = 3;
const TIME_BUDGET_MS = 90_000;

async function getToken(admin: any, userId: string): Promise<string> {
  const { data: conn } = await admin
    .from("spotify_connections")
    .select("access_token, refresh_token, expires_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (!conn) throw new Error("Spotify not connected");
  if (new Date(conn.expires_at) > new Date(Date.now() + 5 * 60_000)) return conn.access_token;
  const cid = Deno.env.get("SPOTIFY_CLIENT_ID")!;
  const cs = Deno.env.get("SPOTIFY_CLIENT_SECRET")!;
  const r = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: `Basic ${btoa(`${cid}:${cs}`)}` },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: conn.refresh_token }),
  });
  const tok = await r.json();
  if (!r.ok) throw new Error("Spotify session expired. Reconnect Spotify in Settings.");
  await admin.from("spotify_connections").update({
    access_token: tok.access_token,
    refresh_token: tok.refresh_token ?? conn.refresh_token,
    expires_at: new Date(Date.now() + tok.expires_in * 1000).toISOString(),
  }).eq("user_id", userId);
  return tok.access_token;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const started = Date.now();
  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const jwt = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
    const { data: { user } } = await admin.auth.getUser(jwt);
    if (!user) return json({ error: "Unauthorized" }, 401);

    // Collect artist IDs from the user's active Liked Songs.
    const ids = new Set<string>();
    for (let from = 0; ; from += 1000) {
      const { data, error } = await admin.from("liked_songs").select("artists")
        .eq("user_id", user.id).eq("is_active", true).eq("is_available", true)
        .range(from, from + 999);
      if (error) throw new Error(error.message);
      for (const row of data ?? []) for (const a of (row.artists ?? []) as any[]) if (a?.id) ids.add(a.id);
      if (!data || data.length < 1000) break;
    }

    // Skip artists already stored.
    const all = [...ids];
    const known = new Set<string>();
    for (let i = 0; i < all.length; i += 300) {
      const { data } = await admin.from("artist_genres").select("artist_id").in("artist_id", all.slice(i, i + 300));
      for (const r of data ?? []) known.add(r.artist_id);
    }
    const queue = all.filter((id) => !known.has(id));
    const total = all.length;
    if (!queue.length) return json({ total, done: total, remaining: 0 });

    const token = await getToken(admin, user.id);
    let pauseUntil = 0;
    let processed = 0;
    const rows: { artist_id: string; genres: string[]; updated_at: string }[] = [];
    const flush = async () => {
      if (!rows.length) return;
      const batch = rows.splice(0, rows.length);
      await admin.from("artist_genres").upsert(batch, { onConflict: "artist_id" });
    };

    const worker = async () => {
      while (queue.length && Date.now() - started < TIME_BUDGET_MS) {
        const wait = pauseUntil - Date.now();
        if (wait > 0) await sleep(wait);
        const id = queue.shift();
        if (!id) return;
        const r = await fetch(`https://api.spotify.com/v1/artists/${id}`, { headers: { Authorization: `Bearer ${token}` } });
        if (r.status === 429) {
          const ra = Number(r.headers.get("retry-after") ?? "5");
          pauseUntil = Date.now() + (Number.isFinite(ra) ? ra : 5) * 1000;
          queue.unshift(id);
          if (pauseUntil - started > TIME_BUDGET_MS) return; // let the next call continue after the wait
          continue;
        }
        if (r.status === 401) throw new Error("Spotify session expired. Reconnect Spotify in Settings.");
        const body = r.ok ? await r.json().catch(() => null) : null;
        // 404 / unknown artist: store empty genres so we don't ask again.
        rows.push({ artist_id: id, genres: Array.isArray(body?.genres) ? body.genres : [], updated_at: new Date().toISOString() });
        processed++;
        if (rows.length >= 50) await flush();
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    await flush();

    const remaining = queue.length;
    return json({
      total,
      done: total - remaining,
      remaining,
      processed,
      retry_after_ms: Math.max(0, pauseUntil - Date.now()),
    });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});
