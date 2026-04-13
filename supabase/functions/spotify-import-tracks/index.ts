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

type SpotifyConnectionRow = {
  access_token: string;
  refresh_token: string;
  expires_at: string;
  last_full_sync_at: string | null;
  last_incremental_sync_at: string | null;
};

async function refreshTokenIfNeeded(supabase: any, userId: string): Promise<{ token: string; connection: SpotifyConnectionRow }> {
  const { data: conn, error } = await supabase
    .from("spotify_connections")
    .select("access_token, refresh_token, expires_at, last_full_sync_at, last_incremental_sync_at")
    .eq("user_id", userId)
    .single();

  const connection = isRecord(conn)
    && typeof conn.access_token === "string"
    && typeof conn.refresh_token === "string"
    && typeof conn.expires_at === "string"
    ? (conn as SpotifyConnectionRow)
    : null;

  if (error || !connection) {
    throw new SpotifyImportError("load_connection", "No Spotify connection found.", 404);
  }

  if (new Date(connection.expires_at) > new Date(Date.now() + 5 * 60 * 1000)) {
    return { token: connection.access_token, connection };
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
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: connection.refresh_token }),
  });

  const refreshData = parseJsonText(await refreshRes.text());
  if (!refreshRes.ok || !isRecord(refreshData) || typeof refreshData.access_token !== "string") {
    throw new SpotifyImportError("refresh_token", "Token refresh failed.", refreshRes.status || 400);
  }

  const expires_at = new Date(Date.now() + (refreshData.expires_in as number) * 1000).toISOString();
  await supabase.from("spotify_connections").update({
    access_token: refreshData.access_token,
    refresh_token: typeof refreshData.refresh_token === "string" ? refreshData.refresh_token : connection.refresh_token,
    expires_at,
  }).eq("user_id", userId);

  connection.access_token = refreshData.access_token as string;
  return { token: refreshData.access_token as string, connection };
}

async function spotifyGet(url: string, token: string) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    const body = parseJsonText(await res.text());
    throw new SpotifyImportError("spotify_api", `Spotify API error: ${res.status}`, res.status, { body, url });
  }
  return await res.json();
}

function getSpotifyErrorMessage(body: unknown) {
  if (!isRecord(body)) return null;
  if (typeof body.message === "string") return body.message;
  const nestedError = body.error;
  if (isRecord(nestedError) && typeof nestedError.message === "string") return nestedError.message;
  if (typeof nestedError === "string") return nestedError;
  return null;
}

function isInsufficientScopeError(error: unknown) {
  if (!(error instanceof SpotifyImportError) || error.status !== 403) return false;
  const message = getSpotifyErrorMessage(error.details.body);
  return typeof message === "string" && message.toLowerCase().includes("insufficient client scope");
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

async function fetchAudioFeatures(trackIds: string[], token: string): Promise<Map<string, any>> {
  const featureMap = new Map<string, any>();
  for (let i = 0; i < trackIds.length; i += 100) {
    const batch = trackIds.slice(i, i + 100);
    try {
      const data = await spotifyGet(`https://api.spotify.com/v1/audio-features?ids=${batch.join(",")}`, token);
      for (const feat of data.audio_features || []) {
        if (feat && feat.id) featureMap.set(feat.id, feat);
      }
    } catch (e) {
      console.warn("[spotify-import-tracks] audio features batch failed:", e);
    }
  }
  return featureMap;
}

// ─── Incremental sync helpers ───

/** Determine if this should be a full or incremental sync */
function shouldDoFullSync(connection: SpotifyConnectionRow, forceFullSync: boolean): boolean {
  if (forceFullSync) return true;
  // No previous full sync => must do full
  if (!connection.last_full_sync_at) return true;
  // Full sync older than 24 hours => do full
  const lastFull = new Date(connection.last_full_sync_at).getTime();
  if (Date.now() - lastFull > 24 * 60 * 60 * 1000) return true;
  return false;
}

/** Import liked songs - incremental: only fetch pages until we hit songs we already have */
async function importLikedSongs(
  adminClient: any, userId: string, token: string, isIncremental: boolean, existingTrackIds: Set<string>
): Promise<{ songs: TrackRow[]; total: number }> {
  const likedSongs: TrackRow[] = [];
  let offset = 0;
  let total = Infinity;
  const MAX_SONGS = 2000;

  while (offset < total && offset < MAX_SONGS) {
    const data = await spotifyGet(`https://api.spotify.com/v1/me/tracks?limit=50&offset=${offset}`, token);
    total = data.total ?? 0;
    let foundExisting = false;

    for (const item of data.items || []) {
      const t = extractTrack(item, userId);
      if (!t) continue;

      if (isIncremental && existingTrackIds.has(t.spotify_track_id)) {
        foundExisting = true;
        continue; // skip already-known, but keep scanning this page
      }
      likedSongs.push(t);
    }

    offset += 50;

    // In incremental mode, stop once we hit a full page of known songs
    if (isIncremental && foundExisting && likedSongs.length === 0) break;
    // If this page had some new and some old, keep going a bit but stop if next page is all old
    if (isIncremental && foundExisting) {
      // Fetch one more page to be sure, then stop
      const nextData = await spotifyGet(`https://api.spotify.com/v1/me/tracks?limit=50&offset=${offset}`, token);
      let allKnown = true;
      for (const item of nextData.items || []) {
        const t = extractTrack(item, userId);
        if (t && !existingTrackIds.has(t.spotify_track_id)) {
          likedSongs.push(t);
          allKnown = false;
        }
      }
      if (allKnown) break;
      offset += 50;
    }
  }

  // Write to DB in batches
  for (let i = 0; i < likedSongs.length; i += 100) {
    const batch = likedSongs.slice(i, i + 100);
    await adminClient.from("liked_songs").upsert(batch, { onConflict: "user_id,spotify_track_id", ignoreDuplicates: true });
    await adminClient.from("imported_tracks").upsert(batch, { onConflict: "user_id,spotify_track_id", ignoreDuplicates: true });
  }

  return { songs: likedSongs, total };
}

/** Import followed artists */
async function importFollowedArtists(adminClient: any, userId: string, token: string): Promise<number> {
  const artists: any[] = [];
  let after: string | null = null;

  try {
    // Paginate through followed artists
    while (true) {
      const url = `https://api.spotify.com/v1/me/following?type=artist&limit=50${after ? `&after=${after}` : ""}`;
      const data = await spotifyGet(url, token);
      const items = data?.artists?.items || [];
      if (items.length === 0) break;

      for (const artist of items) {
        if (!artist?.id) continue;
        artists.push({
          user_id: userId,
          spotify_artist_id: artist.id,
          artist_name: artist.name || "Unknown",
          image_url: artist.images?.[0]?.url || null,
          genres: artist.genres || [],
          follower_count: artist.followers?.total || null,
          popularity: artist.popularity || null,
        });
      }

      after = data?.artists?.cursors?.after || null;
      if (!after) break;
    }
  } catch (e) {
    if (isInsufficientScopeError(e)) {
      console.warn("[spotify-import-tracks] followed artists skipped - missing user-follow-read scope");
      return 0;
    }
    console.warn("[spotify-import-tracks] followed artists import failed:", e);
    return 0;
  }

  // Upsert in batches
  for (let i = 0; i < artists.length; i += 50) {
    await adminClient.from("spotify_followed_artists").upsert(
      artists.slice(i, i + 50),
      { onConflict: "user_id,spotify_artist_id" }
    );
  }

  return artists.length;
}

type PlaylistMeta = {
  id: string;
  name: string;
  description: string | null;
  image_url: string | null;
  track_count: number;
  owner_id: string;
  owner_display_name: string | null;
  is_owned: boolean;
  is_collaborative: boolean;
  snapshot_id: string | null;
};

/** Import playlists - all from user's library (owned, saved, collaborative, private) */
async function importPlaylists(
  adminClient: any, userId: string, token: string, spotifyUserId: string,
  existingSnapshots: Map<string, string>
): Promise<{ playlists: PlaylistMeta[]; warning: string | null; changedPlaylistIds: string[] }> {
  const playlists: PlaylistMeta[] = [];
  let offset = 0;
  let total = Infinity;
  let warning: string | null = null;

  try {
    while (offset < total) {
      const data = await spotifyGet(`https://api.spotify.com/v1/me/playlists?limit=50&offset=${offset}`, token);
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
          owner_display_name: pl.owner?.display_name || null,
          is_owned: pl.owner?.id === spotifyUserId,
          is_collaborative: pl.collaborative === true,
          snapshot_id: pl.snapshot_id || null,
        });
      }
      offset += 50;
      if (!data.items || data.items.length === 0) break;
    }
  } catch (e) {
    if (isInsufficientScopeError(e)) {
      warning = "Spotify connection is missing playlist read access. Reconnect Spotify to sync playlists.";
      console.warn("[spotify-import-tracks] playlist import skipped due to missing scope");
    } else {
      throw e;
    }
  }

  // Detect which playlists actually changed (via snapshot_id comparison)
  const changedPlaylistIds: string[] = [];
  for (const pl of playlists) {
    const oldSnapshot = existingSnapshots.get(pl.id);
    if (!oldSnapshot || oldSnapshot !== pl.snapshot_id) {
      changedPlaylistIds.push(pl.id);
    }
  }

  // Upsert all playlist metadata
  const playlistRows = playlists.map(pl => ({
    user_id: userId,
    spotify_playlist_id: pl.id,
    name: pl.name,
    description: pl.description,
    image_url: pl.image_url,
    track_count: pl.track_count,
    spotify_owner_id: pl.owner_id,
    owner_display_name: pl.owner_display_name,
    is_owned_by_user: pl.is_owned,
    is_collaborative: pl.is_collaborative,
    snapshot_id: pl.snapshot_id,
    last_synced_at: new Date().toISOString(),
  }));

  for (let i = 0; i < playlistRows.length; i += 50) {
    await adminClient.from("spotify_playlists").upsert(
      playlistRows.slice(i, i + 50),
      { onConflict: "user_id,spotify_playlist_id" }
    );
  }

  // Remove playlists no longer in user's library
  const currentSpotifyIds = new Set(playlists.map(p => p.id));
  const { data: dbPlaylists } = await adminClient
    .from("spotify_playlists")
    .select("id, spotify_playlist_id")
    .eq("user_id", userId);

  for (const dbPl of dbPlaylists || []) {
    if (!currentSpotifyIds.has(dbPl.spotify_playlist_id)) {
      await adminClient.from("spotify_playlist_tracks").delete().eq("playlist_id", dbPl.id);
      await adminClient.from("spotify_playlists").delete().eq("id", dbPl.id);
    }
  }

  return { playlists, warning, changedPlaylistIds };
}

/** Import tracks only for playlists that changed */
async function importPlaylistTracks(
  adminClient: any, userId: string, token: string,
  playlists: PlaylistMeta[], changedPlaylistIds: string[], isIncremental: boolean
): Promise<number> {
  const { data: dbPlaylists } = await adminClient
    .from("spotify_playlists")
    .select("id, spotify_playlist_id")
    .eq("user_id", userId);

  const playlistIdMap = new Map<string, string>();
  for (const p of dbPlaylists || []) {
    playlistIdMap.set(p.spotify_playlist_id, p.id);
  }

  // In incremental mode, only sync changed playlists; in full mode, sync top 50
  const changedSet = new Set(changedPlaylistIds);
  const toSync = isIncremental
    ? playlists.filter(pl => changedSet.has(pl.id))
    : [...playlists].sort((a, b) => {
        if (a.is_owned !== b.is_owned) return a.is_owned ? -1 : 1;
        return b.track_count - a.track_count;
      }).slice(0, 50);

  let totalTracks = 0;

  for (const pl of toSync) {
    const dbId = playlistIdMap.get(pl.id);
    if (!dbId) continue;

    try {
      // Clear existing tracks for this playlist if doing a re-import
      await adminClient.from("spotify_playlist_tracks").delete().eq("playlist_id", dbId);

      const trackRows: any[] = [];
      let plOffset = 0;
      const plTotal = Math.min(pl.track_count, 300);

      while (plOffset < plTotal) {
        const data = await spotifyGet(
          `https://api.spotify.com/v1/playlists/${pl.id}/tracks?limit=50&offset=${plOffset}&fields=items(added_at,track(id,name,artists(name),album(name,images)))`,
          token
        );
        for (let idx = 0; idx < (data.items || []).length; idx++) {
          const item = data.items[idx];
          const track = item?.track;
          if (!track || !track.id) continue;
          const artists = (track.artists || []).map((a: any) => a?.name).filter(Boolean).join(", ");
          trackRows.push({
            user_id: userId,
            playlist_id: dbId,
            spotify_track_id: track.id,
            track_name: track.name || "Untitled",
            artist_name: artists,
            album_name: track.album?.name || null,
            image_url: track.album?.images?.[0]?.url || null,
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
      totalTracks += trackRows.length;
    } catch (e) {
      console.warn(`[spotify-import-tracks] Failed to import tracks for playlist ${pl.name}:`, e);
    }
  }

  return totalTracks;
}

// ─── Main handler ───

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

    // Parse request body for sync options
    let forceFullSync = false;
    try {
      const body = await req.json();
      if (body?.force_full) forceFullSync = true;
    } catch { /* no body is fine */ }

    step = "refresh_access_token";
    const { token: accessToken, connection } = await refreshTokenIfNeeded(supabase, user.id);

    const isFullSync = shouldDoFullSync(connection, forceFullSync);
    const syncMode = isFullSync ? "full" : "incremental";
    console.info("[spotify-import-tracks] starting sync", { user_id: user.id, mode: syncMode });

    // Update sync status
    await adminClient.from("spotify_connections").update({ sync_status: "syncing" }).eq("user_id", user.id);

    // Get Spotify profile
    let spotifyUserId = "";
    try {
      const profile = await spotifyGet("https://api.spotify.com/v1/me", accessToken);
      spotifyUserId = profile.id || "";
      // Store spotify_user_id if not set
      if (spotifyUserId) {
        await adminClient.from("spotify_connections").update({ spotify_user_id: spotifyUserId }).eq("user_id", user.id);
      }
    } catch (e) {
      console.warn("[spotify-import-tracks] /v1/me failed, continuing:", e);
    }

    // For incremental sync: load existing track IDs and playlist snapshots
    let existingTrackIds = new Set<string>();
    let existingSnapshots = new Map<string, string>();

    if (!isFullSync) {
      const [trackRes, playlistRes] = await Promise.all([
        adminClient.from("liked_songs").select("spotify_track_id").eq("user_id", user.id),
        adminClient.from("spotify_playlists").select("spotify_playlist_id, snapshot_id").eq("user_id", user.id),
      ]);
      existingTrackIds = new Set((trackRes.data || []).map((r: any) => r.spotify_track_id));
      for (const p of playlistRes.data || []) {
        if (p.snapshot_id) existingSnapshots.set(p.spotify_playlist_id, p.snapshot_id);
      }
    }

    // 1. Import liked songs
    step = "import_liked_songs";
    const { songs: newLikedSongs, total: likedTotal } = await importLikedSongs(
      adminClient, user.id, accessToken, !isFullSync, existingTrackIds
    );
    console.info("[spotify-import-tracks] liked_songs_done", { new: newLikedSongs.length, total: likedTotal });

    // 2. Import playlists (all from library - owned, saved, collaborative, private)
    step = "import_playlists";
    const { playlists, warning: playlistWarning, changedPlaylistIds } = await importPlaylists(
      adminClient, user.id, accessToken, spotifyUserId, existingSnapshots
    );
    console.info("[spotify-import-tracks] playlists_done", {
      count: playlists.length,
      changed: changedPlaylistIds.length,
    });

    // 3. Import playlist tracks (only changed playlists in incremental mode)
    step = "import_playlist_tracks";
    const totalPlaylistTracks = await importPlaylistTracks(
      adminClient, user.id, accessToken, playlists, changedPlaylistIds, !isFullSync
    );
    console.info("[spotify-import-tracks] playlist_tracks_done", { count: totalPlaylistTracks });

    // 4. Import followed artists (non-blocking, best effort)
    step = "import_followed_artists";
    const artistCount = await importFollowedArtists(adminClient, user.id, accessToken);
    console.info("[spotify-import-tracks] followed_artists_done", { count: artistCount });

    // 5. Fetch audio features for new liked songs only
    step = "fetch_audio_features";
    let audioFeaturesCount = 0;
    const newTrackIds = newLikedSongs.map(s => s.spotify_track_id);
    if (newTrackIds.length > 0) {
      const featureMap = await fetchAudioFeatures(newTrackIds, accessToken);
      const now = new Date().toISOString();
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

    // Update sync timestamps
    const now = new Date().toISOString();
    const syncUpdate: Record<string, any> = { sync_status: "idle" };
    if (isFullSync) {
      syncUpdate.last_full_sync_at = now;
    }
    syncUpdate.last_incremental_sync_at = now;
    await adminClient.from("spotify_connections").update(syncUpdate).eq("user_id", user.id);

    const warnings = [playlistWarning].filter((w): w is string => Boolean(w));

    return json({
      success: true,
      sync_mode: syncMode,
      liked_songs: newLikedSongs.length,
      liked_songs_total: likedTotal,
      audio_features: audioFeaturesCount,
      playlists: playlists.length,
      playlists_changed: changedPlaylistIds.length,
      playlist_tracks: totalPlaylistTracks,
      followed_artists: artistCount,
      imported: newLikedSongs.length,
      partial_success: warnings.length > 0,
      warnings,
    });
  } catch (e) {
    // Mark sync as failed
    try {
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      const adminClient = createClient(supabaseUrl, serviceKey);
      const authHeader = req.headers.get("Authorization");
      if (authHeader) {
        const supabase = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
          global: { headers: { Authorization: authHeader } },
        });
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          await adminClient.from("spotify_connections").update({ sync_status: "error" }).eq("user_id", user.id);
        }
      }
    } catch { /* best effort */ }

    if (e instanceof SpotifyImportError) return fail(e.step, e.message, e.status, e.details);
    const message = e instanceof Error ? e.message : "Spotify import failed.";
    return fail(step, message, 500);
  }
});
