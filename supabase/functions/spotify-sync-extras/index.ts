// Imports Spotify profile, top tracks/artists, and recent plays.
// Tracks progress in sync_jobs and updates app_users.last_sync_at.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

async function refreshSpotifyToken(supabase: any, userId: string): Promise<string> {
  const { data: conn } = await supabase
    .from("spotify_connections")
    .select("access_token, refresh_token, expires_at")
    .eq("user_id", userId).single();
  if (!conn) throw new Error("No Spotify connection");
  if (new Date(conn.expires_at) > new Date(Date.now() + 5 * 60_000)) return conn.access_token;

  const cid = Deno.env.get("SPOTIFY_CLIENT_ID")!;
  const cs = Deno.env.get("SPOTIFY_CLIENT_SECRET")!;
  const r = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Authorization": `Basic ${btoa(`${cid}:${cs}`)}`,
    },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: conn.refresh_token }),
  });
  const tok = await r.json();
  if (!r.ok) throw new Error(`Token refresh failed: ${tok.error_description || r.statusText}`);
  const expiresAt = new Date(Date.now() + tok.expires_in * 1000).toISOString();
  await supabase.from("spotify_connections").update({
    access_token: tok.access_token,
    refresh_token: tok.refresh_token ?? conn.refresh_token,
    expires_at: expiresAt,
  }).eq("user_id", userId);
  return tok.access_token;
}

async function spotifyGet(token: string, url: string) {
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (r.status === 403 || r.status === 404) return null; // scope/permission missing
  if (!r.ok) throw new Error(`Spotify ${r.status}: ${await r.text()}`);
  return r.json();
}

async function upsertArtists(svc: any, items: any[]): Promise<Map<string, string>> {
  if (!items.length) return new Map();
  const rows = items.map((a) => ({
    spotify_artist_id: a.id,
    name: a.name,
    genres: a.genres ?? [],
    popularity: a.popularity ?? null,
    followers_count: a.followers?.total ?? null,
    image_url: a.images?.[0]?.url ?? null,
    spotify_url: a.external_urls?.spotify ?? null,
  }));
  await svc.from("artists").upsert(rows, { onConflict: "spotify_artist_id" });
  const ids = items.map((a) => a.id);
  const { data } = await svc.from("artists").select("id, spotify_artist_id").in("spotify_artist_id", ids);
  return new Map((data ?? []).map((r: any) => [r.spotify_artist_id, r.id]));
}

async function upsertTracks(svc: any, items: any[]): Promise<Map<string, string>> {
  if (!items.length) return new Map();
  // First upsert albums
  const albumRows = items
    .filter((t) => t.album)
    .map((t) => ({
      spotify_album_id: t.album.id,
      name: t.album.name,
      artist_names: (t.album.artists ?? []).map((a: any) => a.name),
      release_date: t.album.release_date ?? null,
      album_type: t.album.album_type ?? null,
      total_tracks: t.album.total_tracks ?? null,
      image_url: t.album.images?.[0]?.url ?? null,
      spotify_url: t.album.external_urls?.spotify ?? null,
    }));
  if (albumRows.length) await svc.from("albums").upsert(albumRows, { onConflict: "spotify_album_id" });
  const albumIds = albumRows.map((a) => a.spotify_album_id);
  const { data: albums } = albumIds.length
    ? await svc.from("albums").select("id, spotify_album_id").in("spotify_album_id", albumIds)
    : { data: [] };
  const albumMap = new Map((albums ?? []).map((r: any) => [r.spotify_album_id, r.id]));

  const trackRows = items.map((t) => ({
    spotify_track_id: t.id,
    name: t.name,
    artist_names: (t.artists ?? []).map((a: any) => a.name),
    album_name: t.album?.name ?? null,
    album_id: t.album ? albumMap.get(t.album.id) ?? null : null,
    duration_ms: t.duration_ms ?? null,
    explicit: !!t.explicit,
    popularity: t.popularity ?? null,
    preview_url: t.preview_url ?? null,
    spotify_url: t.external_urls?.spotify ?? null,
    release_date: t.album?.release_date ?? null,
  }));
  await svc.from("tracks").upsert(trackRows, { onConflict: "spotify_track_id" });
  const ids = items.map((t) => t.id);
  const { data: tracks } = await svc.from("tracks").select("id, spotify_track_id").in("spotify_track_id", ids);
  return new Map((tracks ?? []).map((r: any) => [r.spotify_track_id, r.id]));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const svcKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const auth = req.headers.get("Authorization") ?? req.headers.get("authorization");
    if (!auth) return json({ error: "Missing Authorization" }, 401);

    const userClient = createClient(url, anon, { global: { headers: { Authorization: auth } } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "Unauthorized" }, 401);

    const svc = createClient(url, svcKey);

    // Create sync job
    const { data: job } = await svc.from("sync_jobs").insert({
      user_id: user.id, job_type: "spotify_extras", status: "running",
      started_at: new Date().toISOString(), total_items: 0, items_processed: 0,
    }).select("id").single();
    const jobId = job?.id;

    const updateJob = async (patch: Record<string, any>) => {
      if (jobId) await svc.from("sync_jobs").update(patch).eq("id", jobId);
    };

    const result: Record<string, any> = {};
    try {
      const token = await refreshSpotifyToken(svc, user.id);

      // 1. Profile
      const profile = await spotifyGet(token, "https://api.spotify.com/v1/me");
      if (profile) {
        await svc.from("app_users").upsert({
          user_id: user.id,
          spotify_user_id: profile.id,
          display_name: profile.display_name ?? null,
          email: profile.email ?? null,
          profile_image_url: profile.images?.[0]?.url ?? null,
          country: profile.country ?? null,
          product_type: profile.product ?? null,
          last_sync_at: new Date().toISOString(),
        }, { onConflict: "user_id" });
        result.profile = profile.id;
      }

      // 2. Top tracks (3 ranges)
      let topTrackCount = 0;
      for (const range of ["short_term", "medium_term", "long_term"]) {
        const data = await spotifyGet(token, `https://api.spotify.com/v1/me/top/tracks?limit=50&time_range=${range}`);
        const items = data?.items ?? [];
        if (items.length) {
          const trackMap = await upsertTracks(svc, items);
          await svc.from("user_top_tracks").delete().eq("user_id", user.id).eq("time_range", range);
          const rows = items.map((t: any, i: number) => ({
            user_id: user.id, track_id: trackMap.get(t.id), time_range: range, rank: i + 1,
          })).filter((r: any) => r.track_id);
          if (rows.length) await svc.from("user_top_tracks").insert(rows);
          topTrackCount += rows.length;
        }
      }
      result.top_tracks = topTrackCount;

      // 3. Top artists (3 ranges)
      let topArtistCount = 0;
      for (const range of ["short_term", "medium_term", "long_term"]) {
        const data = await spotifyGet(token, `https://api.spotify.com/v1/me/top/artists?limit=50&time_range=${range}`);
        const items = data?.items ?? [];
        if (items.length) {
          const artistMap = await upsertArtists(svc, items);
          await svc.from("user_top_artists").delete().eq("user_id", user.id).eq("time_range", range);
          const rows = items.map((a: any, i: number) => ({
            user_id: user.id, artist_id: artistMap.get(a.id), time_range: range, rank: i + 1,
          })).filter((r: any) => r.artist_id);
          if (rows.length) await svc.from("user_top_artists").insert(rows);
          topArtistCount += rows.length;
        }
      }
      result.top_artists = topArtistCount;

      // 4. Recent plays (last 50)
      const recent = await spotifyGet(token, "https://api.spotify.com/v1/me/player/recently-played?limit=50");
      if (recent?.items?.length) {
        const tracks = recent.items.map((it: any) => it.track).filter(Boolean);
        const trackMap = await upsertTracks(svc, tracks);
        const rows = recent.items.map((it: any) => ({
          user_id: user.id,
          track_id: trackMap.get(it.track?.id),
          played_at: it.played_at,
          context_uri: it.context?.uri ?? null,
        })).filter((r: any) => r.track_id);
        if (rows.length) await svc.from("user_recent_plays").upsert(rows, { onConflict: "user_id,track_id,played_at" });
        result.recent_plays = rows.length;
      } else {
        result.recent_plays = 0;
      }

      await updateJob({
        status: "completed",
        finished_at: new Date().toISOString(),
        items_processed: topTrackCount + topArtistCount + (result.recent_plays ?? 0),
        total_items: topTrackCount + topArtistCount + (result.recent_plays ?? 0),
      });

      return json({ success: true, ...result });
    } catch (e: any) {
      await updateJob({ status: "failed", finished_at: new Date().toISOString(), error_message: String(e?.message || e) });
      throw e;
    }
  } catch (e: any) {
    console.error("[spotify-sync-extras]", e);
    return json({ error: String(e?.message || e) }, 500);
  }
});
