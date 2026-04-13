import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

class SpotifyImportError extends Error {
  step: string;
  status: number;
  details: Record<string, unknown>;
  constructor(step: string, message: string, status = 500, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "SpotifyImportError";
    this.step = step;
    this.status = status;
    this.details = details;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseJsonText(text: string) {
  if (!text) return null;
  try { return JSON.parse(text) as unknown; } catch { return { raw_body: text }; }
}

function fail(step: string, error: string, status = 500, details: Record<string, unknown> = {}) {
  console.error("[spotify-import-tracks]", step, { error, status, ...details });
  return json({ error, step, status, ...details }, status);
}

async function refreshTokenIfNeeded(supabase: ReturnType<typeof createClient>, userId: string) {
  const { data: conn, error } = await supabase
    .from("spotify_connections")
    .select("access_token, refresh_token, expires_at")
    .eq("user_id", userId)
    .single();

  if (error || !conn) {
    throw new SpotifyImportError("load_connection", "No Spotify connection found.", 404);
  }

  if (new Date(conn.expires_at) > new Date(Date.now() + 5 * 60 * 1000)) {
    return conn.access_token;
  }

  const clientId = Deno.env.get("SPOTIFY_CLIENT_ID");
  const clientSecret = Deno.env.get("SPOTIFY_CLIENT_SECRET");
  if (!clientId || !clientSecret) {
    throw new SpotifyImportError("runtime_config", "Spotify credentials not configured.", 500);
  }

  const refreshRes = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
    },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: conn.refresh_token }),
  });

  const refreshData = parseJsonText(await refreshRes.text());
  if (!refreshRes.ok || !isRecord(refreshData) || typeof refreshData.access_token !== "string") {
    throw new SpotifyImportError("refresh_token", "Token refresh failed.", refreshRes.status || 400);
  }

  const expires_at = new Date(Date.now() + (refreshData.expires_in as number) * 1000).toISOString();
  await supabase.from("spotify_connections").update({
    access_token: refreshData.access_token,
    refresh_token: typeof refreshData.refresh_token === "string" ? refreshData.refresh_token : conn.refresh_token,
    expires_at,
  }).eq("user_id", userId);

  return refreshData.access_token as string;
}

async function spotifyGet(url: string, token: string) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    const body = parseJsonText(await res.text());
    throw new SpotifyImportError("spotify_api", `Spotify API error: ${res.status}`, res.status, { body });
  }
  return await res.json();
}

type TrackRow = {
  user_id: string;
  spotify_track_id: string;
  track_name: string;
  artist_name: string;
  album_name: string | null;
  image_url: string | null;
  added_at: string | null;
};

function extractTrack(item: any, userId: string): TrackRow | null {
  const track = item?.track;
  if (!track || typeof track.id !== "string") return null;
  const artists = Array.isArray(track.artists) ? track.artists.map((a: any) => a?.name).filter(Boolean).join(", ") : "";
  const album = track.album;
  const images = album?.images || [];
  const img = images.find((i: any) => i?.url);
  return {
    user_id: userId,
    spotify_track_id: track.id,
    track_name: track.name || "Untitled",
    artist_name: artists,
    album_name: album?.name || null,
    image_url: img?.url || null,
    added_at: typeof item.added_at === "string" ? item.added_at : null,
  };
}

/** Fetch audio features for a batch of track IDs (max 100 per call) */
async function fetchAudioFeatures(trackIds: string[], token: string): Promise<Map<string, any>> {
  const featureMap = new Map<string, any>();
  for (let i = 0; i < trackIds.length; i += 100) {
    const batch = trackIds.slice(i, i + 100);
    const ids = batch.join(",");
    try {
      const data = await spotifyGet(
        `https://api.spotify.com/v1/audio-features?ids=${ids}`,
        token
      );
      for (const feat of data.audio_features || []) {
        if (feat && feat.id) {
          featureMap.set(feat.id, feat);
        }
      }
    } catch (e) {
      console.warn("[spotify-import-tracks] audio features batch failed:", e);
    }
  }
  return featureMap;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  let step = "auth_validation";
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return fail(step, "Not authenticated.", 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const supabase = createClient(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const adminClient = createClient(supabaseUrl, serviceKey);

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) return fail("user_session", "Invalid session.", 401);

    step = "refresh_access_token";
    const accessToken = await refreshTokenIfNeeded(supabase, user.id);
    console.info("[spotify-import-tracks] access_token_ready", { user_id: user.id });

    // 1. Import liked/saved songs
    step = "import_liked_songs";
    const likedSongs: TrackRow[] = [];
    let offset = 0;
    let total = Infinity;

    while (offset < total && offset < 2000) {
      const data = await spotifyGet(`https://api.spotify.com/v1/me/tracks?limit=50&offset=${offset}`, accessToken);
      total = data.total ?? likedSongs.length;
      for (const item of data.items || []) {
        const t = extractTrack(item, user.id);
        if (t) likedSongs.push(t);
      }
      offset += 50;
    }

    console.info("[spotify-import-tracks] liked_songs_fetched", { count: likedSongs.length });

    // Write liked songs
    for (let i = 0; i < likedSongs.length; i += 100) {
      const batch = likedSongs.slice(i, i + 100);
      await adminClient.from("liked_songs").upsert(batch, { onConflict: "user_id,spotify_track_id", ignoreDuplicates: true });
    }

    // Also write to imported_tracks for backward compat
    for (let i = 0; i < likedSongs.length; i += 100) {
      const batch = likedSongs.slice(i, i + 100);
      await adminClient.from("imported_tracks").upsert(batch, { onConflict: "user_id,spotify_track_id", ignoreDuplicates: true });
    }

    // 2. Fetch audio features for liked songs
    step = "fetch_audio_features";
    const trackIdsNeedingFeatures: string[] = [];

    // Check which songs already have audio features
    const { data: existingFeatures } = await adminClient
      .from("liked_songs")
      .select("spotify_track_id, audio_features_fetched_at")
      .eq("user_id", user.id)
      .not("audio_features_fetched_at", "is", null);

    const alreadyFetched = new Set((existingFeatures || []).map(r => r.spotify_track_id));

    for (const song of likedSongs) {
      if (!alreadyFetched.has(song.spotify_track_id)) {
        trackIdsNeedingFeatures.push(song.spotify_track_id);
      }
    }

    console.info("[spotify-import-tracks] audio_features_needed", { count: trackIdsNeedingFeatures.length, already: alreadyFetched.size });

    let audioFeaturesCount = 0;
    if (trackIdsNeedingFeatures.length > 0) {
      const featureMap = await fetchAudioFeatures(trackIdsNeedingFeatures, accessToken);
      const now = new Date().toISOString();

      // Update in batches
      for (const [trackId, feat] of featureMap) {
        await adminClient.from("liked_songs").update({
          audio_tempo: feat.tempo ?? null,
          audio_energy: feat.energy ?? null,
          audio_valence: feat.valence ?? null,
          audio_danceability: feat.danceability ?? null,
          audio_acousticness: feat.acousticness ?? null,
          audio_instrumentalness: feat.instrumentalness ?? null,
          audio_speechiness: feat.speechiness ?? null,
          audio_loudness: feat.loudness ?? null,
          audio_liveness: feat.liveness ?? null,
          audio_key: feat.key ?? null,
          audio_mode: feat.mode ?? null,
          audio_time_signature: feat.time_signature ?? null,
          audio_features_fetched_at: now,
        }).eq("user_id", user.id).eq("spotify_track_id", trackId);
        audioFeaturesCount++;
      }
    }

    console.info("[spotify-import-tracks] audio_features_stored", { count: audioFeaturesCount });

    // 3. Import playlists
    step = "import_playlists";
    const spotifyProfile = await spotifyGet("https://api.spotify.com/v1/me", accessToken);
    const spotifyUserId = spotifyProfile.id;

    type PlaylistMeta = {
      id: string;
      name: string;
      description: string | null;
      image_url: string | null;
      track_count: number;
      owner_id: string;
      is_owned: boolean;
      snapshot_id: string | null;
    };

    const playlists: PlaylistMeta[] = [];
    offset = 0;
    total = Infinity;

    while (offset < total && offset < 500) {
      const data = await spotifyGet(`https://api.spotify.com/v1/me/playlists?limit=50&offset=${offset}`, accessToken);
      total = data.total ?? 0;
      for (const pl of data.items || []) {
        if (!pl || !pl.id) continue;
        playlists.push({
          id: pl.id,
          name: pl.name || "Untitled",
          description: pl.description || null,
          image_url: pl.images?.[0]?.url || null,
          track_count: pl.tracks?.total || 0,
          owner_id: pl.owner?.id || "",
          is_owned: pl.owner?.id === spotifyUserId,
          snapshot_id: pl.snapshot_id || null,
        });
      }
      offset += 50;
    }

    console.info("[spotify-import-tracks] playlists_fetched", { count: playlists.length });

    const playlistRows = playlists.map(pl => ({
      user_id: user.id,
      spotify_playlist_id: pl.id,
      name: pl.name,
      description: pl.description,
      image_url: pl.image_url,
      track_count: pl.track_count,
      spotify_owner_id: pl.owner_id,
      is_owned_by_user: pl.is_owned,
      snapshot_id: pl.snapshot_id,
      last_synced_at: new Date().toISOString(),
    }));

    for (let i = 0; i < playlistRows.length; i += 50) {
      await adminClient.from("spotify_playlists").upsert(
        playlistRows.slice(i, i + 50),
        { onConflict: "user_id,spotify_playlist_id" }
      );
    }

    // 4. Import playlist tracks
    step = "import_playlist_tracks";

    const { data: dbPlaylists } = await adminClient
      .from("spotify_playlists")
      .select("id, spotify_playlist_id")
      .eq("user_id", user.id);

    const playlistIdMap = new Map<string, string>();
    for (const p of dbPlaylists || []) {
      playlistIdMap.set(p.spotify_playlist_id, p.id);
    }

    const sortedPlaylists = [...playlists].sort((a, b) => {
      if (a.is_owned !== b.is_owned) return a.is_owned ? -1 : 1;
      return b.track_count - a.track_count;
    }).slice(0, 20);

    let totalPlaylistTracks = 0;

    for (const pl of sortedPlaylists) {
      const dbId = playlistIdMap.get(pl.id);
      if (!dbId) continue;

      try {
        const trackRows: any[] = [];
        let plOffset = 0;
        const plTotal = Math.min(pl.track_count, 200);

        while (plOffset < plTotal) {
          const data = await spotifyGet(
            `https://api.spotify.com/v1/playlists/${pl.id}/tracks?limit=50&offset=${plOffset}&fields=items(added_at,track(id,name,artists(name),album(name,images)))`,
            accessToken
          );
          for (let idx = 0; idx < (data.items || []).length; idx++) {
            const item = data.items[idx];
            const track = item?.track;
            if (!track || !track.id) continue;
            const artists = (track.artists || []).map((a: any) => a?.name).filter(Boolean).join(", ");
            const img = track.album?.images?.[0]?.url || null;
            trackRows.push({
              user_id: user.id,
              playlist_id: dbId,
              spotify_track_id: track.id,
              track_name: track.name || "Untitled",
              artist_name: artists,
              album_name: track.album?.name || null,
              image_url: img,
              added_at: item.added_at || null,
              position: plOffset + idx,
            });
          }
          plOffset += 50;
        }

        for (let i = 0; i < trackRows.length; i += 100) {
          await adminClient.from("spotify_playlist_tracks").upsert(
            trackRows.slice(i, i + 100),
            { onConflict: "playlist_id,spotify_track_id", ignoreDuplicates: true }
          );
        }
        totalPlaylistTracks += trackRows.length;
      } catch (e) {
        console.warn(`[spotify-import-tracks] Failed to import tracks for playlist ${pl.name}:`, e);
      }
    }

    console.info("[spotify-import-tracks] playlist_tracks_imported", { count: totalPlaylistTracks });

    return json({
      success: true,
      step: "complete",
      liked_songs: likedSongs.length,
      audio_features: audioFeaturesCount,
      playlists: playlists.length,
      playlist_tracks: totalPlaylistTracks,
      imported: likedSongs.length,
    });
  } catch (e) {
    if (e instanceof SpotifyImportError) return fail(e.step, e.message, e.status, e.details);
    const message = e instanceof Error ? e.message : "Spotify import failed.";
    return fail(step, message, 500);
  }
});
