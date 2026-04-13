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
      // Audio features API returns 403 for apps without the scope — skip gracefully
      if (e instanceof SpotifyImportError && e.status === 403) {
        console.warn("[spotify-import-tracks] audio features API returned 403 — skipping (likely deprecated for this app)");
        return featureMap; // stop trying further batches
      }
      console.warn("[spotify-import-tracks] audio features batch failed:", e);
    }
  }
  return featureMap;
}

async function getAllUnfetchedAudioFeatureIds(adminClient: any, userId: string): Promise<string[]> {
  const ids: string[] = [];
  const pageSize = 1000;
  let from = 0;

  while (true) {
    const { data, error } = await adminClient
      .from("liked_songs")
      .select("spotify_track_id")
      .eq("user_id", userId)
      .is("audio_features_fetched_at", null)
      .range(from, from + pageSize - 1);

    if (error) throw error;

    const rows = data || [];
    ids.push(...rows.map((row: any) => row.spotify_track_id).filter(Boolean));

    if (rows.length < pageSize) break;
    from += pageSize;
  }

  return ids;
}

// ─── Sync helpers ───

function shouldDoFullSync(connection: SpotifyConnectionRow, forceFullSync: boolean): boolean {
  if (forceFullSync) return true;
  if (!connection.last_full_sync_at) return true;
  const lastFull = new Date(connection.last_full_sync_at).getTime();
  if (Date.now() - lastFull > 24 * 60 * 60 * 1000) return true;
  return false;
}

/**
 * LIKED SONGS — full bidirectional sync.
 * Fetches ALL Spotify liked track IDs, diffs against DB, adds new, removes deleted.
 */
async function syncLikedSongs(
  adminClient: any, userId: string, token: string, isFullSync: boolean, existingTrackIds: Set<string>
): Promise<{ added: number; removed: number; total: number }> {
  // Fetch all liked song IDs + metadata from Spotify
  const spotifyLiked: TrackRow[] = [];
  const spotifyLikedIds = new Set<string>();
  let offset = 0;
  let total = Infinity;

  // For incremental: stop early once we hit a run of known tracks
  let consecutiveKnown = 0;
  const KNOWN_THRESHOLD = 100; // stop after 100 consecutive known tracks in incremental mode

  while (offset < total) {
    const data = await spotifyGet(`https://api.spotify.com/v1/me/tracks?limit=50&offset=${offset}`, token);
    total = data.total ?? 0;
    const items = data.items || [];

    for (const item of items) {
      const t = extractTrack(item, userId);
      if (!t) continue;
      spotifyLikedIds.add(t.spotify_track_id);

      if (!existingTrackIds.has(t.spotify_track_id)) {
        spotifyLiked.push(t);
        consecutiveKnown = 0;
      } else {
        consecutiveKnown++;
      }
    }

    offset += 50;

    // Log progress every 500 tracks
    if (offset % 500 === 0) {
      console.log(`[spotify-import-tracks] liked songs pagination: ${offset}/${total}, new: ${spotifyLiked.length}`);
    }

    // In incremental mode, stop early if we've hit a long run of known tracks
    if (!isFullSync && consecutiveKnown >= KNOWN_THRESHOLD) {
      console.log("[spotify-import-tracks] incremental: stopping liked songs scan after consecutive known run");
      break;
    }

    // If no items returned, we're done regardless of total
    if (items.length === 0) break;
  }

  console.log(`[spotify-import-tracks] liked songs pagination complete: scanned ${offset}, total ${total}, new ${spotifyLiked.length}`);

  // Upsert new tracks
  for (let i = 0; i < spotifyLiked.length; i += 100) {
    const batch = spotifyLiked.slice(i, i + 100);
    await adminClient.from("liked_songs").upsert(batch, { onConflict: "user_id,spotify_track_id", ignoreDuplicates: true });
    await adminClient.from("imported_tracks").upsert(batch, { onConflict: "user_id,spotify_track_id", ignoreDuplicates: true });
  }

  // Delete removed tracks (only in full sync when we've scanned everything)
  let removedCount = 0;
  if (isFullSync && offset >= total) {
    // Find tracks in DB that are no longer in Spotify
    const toRemove: string[] = [];
    for (const existingId of existingTrackIds) {
      if (!spotifyLikedIds.has(existingId)) {
        toRemove.push(existingId);
      }
    }

    if (toRemove.length > 0) {
      // Delete in batches
      for (let i = 0; i < toRemove.length; i += 100) {
        const batch = toRemove.slice(i, i + 100);
        await adminClient.from("liked_songs").delete().eq("user_id", userId).in("spotify_track_id", batch);
      }
      removedCount = toRemove.length;
      console.info("[spotify-import-tracks] removed liked songs no longer in Spotify:", removedCount);
    }
  }

  return { added: spotifyLiked.length, removed: removedCount, total };
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

/**
 * PLAYLISTS — full bidirectional sync.
 * Fetches all playlists from Spotify library, upserts metadata,
 * removes playlists no longer in library, re-imports tracks for changed playlists.
 */
async function syncPlaylists(
  adminClient: any, userId: string, token: string, spotifyUserId: string,
  existingSnapshots: Map<string, string>
): Promise<{ total: number; changed: number; removed: number; tracksSynced: number; warning: string | null }> {
  const playlists: PlaylistMeta[] = [];
  let offset = 0;
  let totalPl = Infinity;
  let warning: string | null = null;

  try {
    while (offset < totalPl) {
      const data = await spotifyGet(`https://api.spotify.com/v1/me/playlists?limit=50&offset=${offset}`, token);
      totalPl = data.total ?? 0;
      const items = data.items || [];
      for (const pl of items) {
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
      console.log(`[spotify-import-tracks] playlists pagination: ${offset}/${totalPl}, collected: ${playlists.length}`);
      if (items.length === 0) break;
    }
    console.log(`[spotify-import-tracks] playlists pagination complete: ${playlists.length} total`);
  } catch (e) {
    if (isInsufficientScopeError(e)) {
      warning = "Spotify connection is missing playlist read access. Reconnect Spotify to sync playlists.";
      console.warn("[spotify-import-tracks] playlist import skipped due to missing scope");
      return { total: 0, changed: 0, removed: 0, tracksSynced: 0, warning };
    }
    throw e;
  }

  // Detect changed playlists (via snapshot_id comparison)
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

  let removedCount = 0;
  for (const dbPl of dbPlaylists || []) {
    if (!currentSpotifyIds.has(dbPl.spotify_playlist_id)) {
      await adminClient.from("spotify_playlist_tracks").delete().eq("playlist_id", dbPl.id);
      await adminClient.from("playlist_vibe_analysis").delete().eq("playlist_id", dbPl.id);
      await adminClient.from("spotify_playlists").delete().eq("id", dbPl.id);
      removedCount++;
    }
  }

  // Re-import tracks for changed playlists
  const playlistIdMap = new Map<string, string>();
  const { data: freshDbPlaylists } = await adminClient
    .from("spotify_playlists")
    .select("id, spotify_playlist_id")
    .eq("user_id", userId);
  for (const p of freshDbPlaylists || []) {
    playlistIdMap.set(p.spotify_playlist_id, p.id);
  }

  const changedSet = new Set(changedPlaylistIds);
  const toSync = playlists.filter(pl => changedSet.has(pl.id));
  let totalTracks = 0;

  for (const pl of toSync) {
    const dbId = playlistIdMap.get(pl.id);
    if (!dbId) continue;

    try {
      await adminClient.from("spotify_playlist_tracks").delete().eq("playlist_id", dbId);

      const trackRows: any[] = [];
      let plOffset = 0;

      while (true) {
        const data = await spotifyGet(
          `https://api.spotify.com/v1/playlists/${pl.id}/tracks?limit=50&offset=${plOffset}&fields=items(added_at,track(id,name,artists(name),album(name,images)))`,
          token
        );
        const items = data.items || [];
        for (let idx = 0; idx < items.length; idx++) {
          const item = items[idx];
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
        console.log(`[spotify-import-tracks] playlist ${pl.name} pagination: ${plOffset + items.length}/${pl.track_count}`);
        if (items.length === 0) break;
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

  return { total: playlists.length, changed: changedPlaylistIds.length, removed: removedCount, tracksSynced: totalTracks, warning };
}

/**
 * FOLLOWED ARTISTS — full bidirectional sync.
 * Fetches all followed artists, upserts, removes unfollowed.
 */
async function syncFollowedArtists(
  adminClient: any, userId: string, token: string, existingArtistIds: Set<string>
): Promise<{ added: number; removed: number; total: number }> {
  const artists: any[] = [];
  const spotifyArtistIds = new Set<string>();
  let after: string | null = null;

  try {
    let page = 0;
    while (true) {
      const url = `https://api.spotify.com/v1/me/following?type=artist&limit=50${after ? `&after=${after}` : ""}`;
      const data = await spotifyGet(url, token);
      const items = data?.artists?.items || [];
      if (items.length === 0) break;

      for (const artist of items) {
        if (!artist?.id) continue;
        spotifyArtistIds.add(artist.id);
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
      page++;
      console.log(`[spotify-import-tracks] artists pagination page ${page}: collected ${artists.length}, has_next: ${Boolean(after)}`);
      if (!after) break;
    }
    console.log(`[spotify-import-tracks] artists pagination complete: ${artists.length} total`);
  } catch (e) {
    if (isInsufficientScopeError(e)) {
      console.warn("[spotify-import-tracks] followed artists skipped - missing user-follow-read scope");
      return { added: 0, removed: 0, total: 0 };
    }
    console.warn("[spotify-import-tracks] followed artists import failed:", e);
    return { added: 0, removed: 0, total: 0 };
  }

  // Upsert artists
  for (let i = 0; i < artists.length; i += 50) {
    await adminClient.from("spotify_followed_artists").upsert(
      artists.slice(i, i + 50),
      { onConflict: "user_id,spotify_artist_id" }
    );
  }

  // Remove unfollowed artists
  let removedCount = 0;
  const toRemove: string[] = [];
  for (const existingId of existingArtistIds) {
    if (!spotifyArtistIds.has(existingId)) {
      toRemove.push(existingId);
    }
  }
  if (toRemove.length > 0) {
    for (let i = 0; i < toRemove.length; i += 100) {
      const batch = toRemove.slice(i, i + 100);
      await adminClient.from("spotify_followed_artists").delete().eq("user_id", userId).in("spotify_artist_id", batch);
    }
    removedCount = toRemove.length;
  }

  const addedCount = artists.filter(a => !existingArtistIds.has(a.spotify_artist_id)).length;
  return { added: addedCount, removed: removedCount, total: artists.length };
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
    let syncScope: "all" | "liked" | "playlists" | "artists" = "all";
    try {
      const body = await req.json();
      if (body?.force_full) forceFullSync = true;
      if (body?.scope && ["liked", "playlists", "artists"].includes(body.scope)) {
        syncScope = body.scope;
      }
    } catch { /* no body is fine */ }

    step = "refresh_access_token";
    const { token: accessToken, connection } = await refreshTokenIfNeeded(supabase, user.id);

    const isFullSync = shouldDoFullSync(connection, forceFullSync);
    const syncMode = isFullSync ? "full" : "incremental";
    console.log("[spotify-import-tracks] === STARTING SYNC ===", { user_id: user.id, mode: syncMode, scope: syncScope, forceFullSync });

    // Update sync status
    await adminClient.from("spotify_connections").update({
      sync_status: "syncing",
      sync_error: null,
    }).eq("user_id", user.id);

    // Get Spotify profile
    let spotifyUserId = "";
    try {
      const profile = await spotifyGet("https://api.spotify.com/v1/me", accessToken);
      spotifyUserId = profile.id || "";
      if (spotifyUserId) {
        await adminClient.from("spotify_connections").update({ spotify_user_id: spotifyUserId }).eq("user_id", user.id);
      }
    } catch (e) {
      console.warn("[spotify-import-tracks] /v1/me failed, continuing:", e);
    }

    // Load existing data for diffing
    const [trackRes, playlistRes, artistRes] = await Promise.all([
      adminClient.from("liked_songs").select("spotify_track_id").eq("user_id", user.id),
      adminClient.from("spotify_playlists").select("spotify_playlist_id, snapshot_id").eq("user_id", user.id),
      adminClient.from("spotify_followed_artists").select("spotify_artist_id").eq("user_id", user.id),
    ]);

    const existingTrackIds = new Set((trackRes.data || []).map((r: any) => r.spotify_track_id));
    const existingSnapshots = new Map<string, string>();
    for (const p of playlistRes.data || []) {
      if (p.snapshot_id) existingSnapshots.set(p.spotify_playlist_id, p.snapshot_id);
    }
    const existingArtistIds = new Set((artistRes.data || []).map((r: any) => r.spotify_artist_id));

    const now = new Date().toISOString();
    const result: Record<string, any> = { success: true, sync_mode: syncMode };
    const warnings: string[] = [];

    // Step 1: Liked songs
    if (syncScope === "all" || syncScope === "liked") {
      step = "sync_liked_songs";
      const likedResult = await syncLikedSongs(adminClient, user.id, accessToken, isFullSync, existingTrackIds);
      result.liked_songs_added = likedResult.added;
      result.liked_songs_removed = likedResult.removed;
      result.liked_songs_total = likedResult.total;
      console.log("[spotify-import-tracks] liked_songs_done", likedResult);

      await adminClient.from("spotify_connections").update({ last_library_sync_at: now }).eq("user_id", user.id);

      // Fetch audio features for NEW tracks only (skip in scoped sync to be fast)
      if (syncScope === "all") {
        step = "fetch_audio_features";
        const pendingAudioFeatureIds = await getAllUnfetchedAudioFeatureIds(adminClient, user.id);

        if (pendingAudioFeatureIds.length > 0) {
          console.log("[spotify-import-tracks] fetching audio features for all remaining tracks", {
            pending: pendingAudioFeatureIds.length,
          });

          const featureMap = await fetchAudioFeatures(pendingAudioFeatureIds, accessToken);
          const featNow = new Date().toISOString();
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
              audio_features_fetched_at: featNow,
            }).eq("user_id", user.id).eq("spotify_track_id", trackId);
          }
          result.audio_features = featureMap.size;
        }

        const [analyzedCountRes, likedCountRes] = await Promise.all([
          adminClient
            .from("liked_songs")
            .select("id", { count: "exact", head: true })
            .eq("user_id", user.id)
            .not("audio_features_fetched_at", "is", null),
          adminClient
            .from("liked_songs")
            .select("id", { count: "exact", head: true })
            .eq("user_id", user.id),
        ]);

        result.audio_features_analyzed = analyzedCountRes.count ?? 0;
        result.audio_features_total = likedCountRes.count ?? 0;
      }
    }

    // Step 2: Playlists + playlist tracks
    if (syncScope === "all" || syncScope === "playlists") {
      step = "sync_playlists";
      const plResult = await syncPlaylists(adminClient, user.id, accessToken, spotifyUserId, existingSnapshots);
      result.playlists_total = plResult.total;
      result.playlists_changed = plResult.changed;
      result.playlists_removed = plResult.removed;
      result.playlist_tracks_synced = plResult.tracksSynced;
      if (plResult.warning) warnings.push(plResult.warning);
      console.log("[spotify-import-tracks] playlists_done", plResult);

      await adminClient.from("spotify_connections").update({ last_playlist_sync_at: now }).eq("user_id", user.id);
    }

    // Step 3: Followed artists
    if (syncScope === "all" || syncScope === "artists") {
      step = "sync_followed_artists";
      const artistResult = await syncFollowedArtists(adminClient, user.id, accessToken, existingArtistIds);
      result.artists_total = artistResult.total;
      result.artists_added = artistResult.added;
      result.artists_removed = artistResult.removed;
      console.log("[spotify-import-tracks] followed_artists_done", artistResult);

      await adminClient.from("spotify_connections").update({ last_artist_sync_at: now }).eq("user_id", user.id);
    }

    // Update final sync timestamps
    const syncUpdate: Record<string, any> = { sync_status: "idle", sync_error: null };
    if (isFullSync) {
      syncUpdate.last_full_sync_at = now;
    }
    syncUpdate.last_incremental_sync_at = now;
    await adminClient.from("spotify_connections").update(syncUpdate).eq("user_id", user.id);

    result.partial_success = warnings.length > 0;
    result.warnings = warnings;

    return json(result);
  } catch (e) {
    // Mark sync as failed with error message
    const errorMessage = e instanceof Error ? e.message : "Spotify import failed.";
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
          await adminClient.from("spotify_connections").update({
            sync_status: "error",
            sync_error: errorMessage,
          }).eq("user_id", user.id);
        }
      }
    } catch { /* best effort */ }

    if (e instanceof SpotifyImportError) return fail(e.step, e.message, e.status, e.details);
    return fail(step, errorMessage, 500);
  }
});
