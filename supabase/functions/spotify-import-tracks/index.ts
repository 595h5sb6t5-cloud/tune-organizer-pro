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

type SupabaseMutationResult = {
  error: {
    message: string;
    code?: string;
    details?: string | null;
    hint?: string | null;
  } | null;
};

async function ensureDbWrite<T extends SupabaseMutationResult>(
  promise: Promise<T>,
  step: string,
  details: Record<string, unknown> = {},
) {
  const result = await promise;
  if (result.error) {
    throw new SpotifyImportError(step, result.error.message, 500, {
      ...details,
      db_code: result.error.code ?? null,
      db_details: result.error.details ?? null,
      db_hint: result.error.hint ?? null,
    });
  }
  return result;
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

  const refreshText = await refreshRes.text();
  const refreshData = parseJsonText(refreshText);
  if (!refreshRes.ok || !isRecord(refreshData) || typeof refreshData.access_token !== "string") {
    console.error("[spotify-import] Token refresh failed:", refreshRes.status, refreshText.substring(0, 300));
    // If Spotify says "invalid_grant", the refresh token is permanently dead — user must re-auth
    const isInvalidGrant = isRecord(refreshData) && (refreshData.error === "invalid_grant" || refreshData.error === "invalid_client");
    if (isInvalidGrant || refreshRes.status === 400) {
      // Mark the connection as broken so the frontend knows to prompt re-auth
      await supabase.from("spotify_connections").update({
        sync_error: "Spotify authorization expired. Please reconnect your Spotify account.",
        sync_status: "error",
      }).eq("user_id", userId);
      throw new SpotifyImportError("refresh_token", "Spotify authorization expired. Please disconnect and reconnect your Spotify account in Settings.", 401);
    }
    throw new SpotifyImportError("refresh_token", "Token refresh failed.", refreshRes.status || 500);
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
      if (e instanceof SpotifyImportError && e.status === 403) {
        console.warn("[spotify-import-tracks] audio features API returned 403 — skipping");
        return featureMap;
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
 */
async function syncLikedSongs(
  adminClient: any, userId: string, token: string, isFullSync: boolean, existingTrackIds: Set<string>
): Promise<{ added: number; removed: number; total: number }> {
  const spotifyLiked: TrackRow[] = [];
  const spotifyLikedIds = new Set<string>();
  let offset = 0;
  let total = Infinity;
  let consecutiveKnown = 0;
  const KNOWN_THRESHOLD = 100;

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
    if (offset % 500 === 0) {
      console.log(`[spotify-import-tracks] liked songs: ${offset}/${total}, new: ${spotifyLiked.length}`);
    }
    if (!isFullSync && consecutiveKnown >= KNOWN_THRESHOLD) {
      console.log("[spotify-import-tracks] incremental: stopping liked songs scan");
      break;
    }
    if (items.length === 0) break;
  }

  console.log(`[spotify-import-tracks] liked songs done: scanned ${offset}, total ${total}, new ${spotifyLiked.length}`);

  for (let i = 0; i < spotifyLiked.length; i += 100) {
    const batch = spotifyLiked.slice(i, i + 100);
    await adminClient.from("liked_songs").upsert(batch, { onConflict: "user_id,spotify_track_id", ignoreDuplicates: true });
    await adminClient.from("imported_tracks").upsert(batch, { onConflict: "user_id,spotify_track_id", ignoreDuplicates: true });
  }

  let removedCount = 0;
  if (isFullSync && offset >= total) {
    const toRemove: string[] = [];
    for (const existingId of existingTrackIds) {
      if (!spotifyLikedIds.has(existingId)) toRemove.push(existingId);
    }
    if (toRemove.length > 0) {
      for (let i = 0; i < toRemove.length; i += 100) {
        await adminClient.from("liked_songs").delete().eq("user_id", userId).in("spotify_track_id", toRemove.slice(i, i + 100));
      }
      removedCount = toRemove.length;
      console.info("[spotify-import-tracks] removed liked songs:", removedCount);
    }
  }

  return { added: spotifyLiked.length, removed: removedCount, total };
}

/**
 * SAVED ALBUMS — full bidirectional sync with album tracks.
 */
async function syncSavedAlbums(
  adminClient: any, userId: string, token: string, isFullSync: boolean, existingAlbumIds: Set<string>
): Promise<{ added: number; removed: number; total: number; tracksImported: number }> {
  const spotifyAlbums: any[] = [];
  const spotifyAlbumIds = new Set<string>();
  let offset = 0;
  let total = Infinity;
  let consecutiveKnown = 0;
  const KNOWN_THRESHOLD = 50;

  try {
    while (offset < total) {
      const data = await spotifyGet(`https://api.spotify.com/v1/me/albums?limit=50&offset=${offset}`, token);
      total = data.total ?? 0;
      const items = data.items || [];

      for (const item of items) {
        const album = item?.album;
        if (!album || !album.id) continue;
        spotifyAlbumIds.add(album.id);

        const artists = (album.artists || []).map((a: any) => a?.name).filter(Boolean).join(", ");
        spotifyAlbums.push({
          user_id: userId,
          spotify_album_id: album.id,
          album_name: album.name || "Untitled",
          artist_name: artists,
          image_url: album.images?.[0]?.url || null,
          release_date: album.release_date || null,
          total_tracks: album.total_tracks || 0,
          album_type: album.album_type || null,
          genres: album.genres || [],
          label: album.label || null,
          popularity: album.popularity || null,
          added_at: item.added_at || null,
        });

        if (existingAlbumIds.has(album.id)) {
          consecutiveKnown++;
        } else {
          consecutiveKnown = 0;
        }
      }

      offset += 50;
      if (offset % 200 === 0) {
        console.log(`[spotify-import-tracks] saved albums: ${offset}/${total}, collected: ${spotifyAlbums.length}`);
      }
      if (!isFullSync && consecutiveKnown >= KNOWN_THRESHOLD) {
        console.log("[spotify-import-tracks] incremental: stopping albums scan");
        break;
      }
      if (items.length === 0) break;
    }

    console.log(`[spotify-import-tracks] saved albums done: ${spotifyAlbums.length} total`);
  } catch (e) {
    if (isInsufficientScopeError(e)) {
      console.warn("[spotify-import-tracks] saved albums skipped - missing scope");
      return { added: 0, removed: 0, total: 0, tracksImported: 0 };
    }
    throw e;
  }

  // Upsert albums
  const newAlbums = spotifyAlbums.filter(a => !existingAlbumIds.has(a.spotify_album_id));
  for (let i = 0; i < spotifyAlbums.length; i += 50) {
    await adminClient.from("spotify_saved_albums").upsert(
      spotifyAlbums.slice(i, i + 50),
      { onConflict: "user_id,spotify_album_id" }
    );
  }

  // Remove albums no longer saved (full sync only)
  let removedCount = 0;
  if (isFullSync && offset >= total) {
    const toRemove: string[] = [];
    for (const existingId of existingAlbumIds) {
      if (!spotifyAlbumIds.has(existingId)) toRemove.push(existingId);
    }
    if (toRemove.length > 0) {
      // Get DB IDs for these albums to delete their tracks too
      const { data: albumRows } = await adminClient
        .from("spotify_saved_albums")
        .select("id, spotify_album_id")
        .eq("user_id", userId)
        .in("spotify_album_id", toRemove);
      
      for (const row of albumRows || []) {
        await adminClient.from("spotify_album_tracks").delete().eq("album_id", row.id);
      }
      
      for (let i = 0; i < toRemove.length; i += 100) {
        await adminClient.from("spotify_saved_albums").delete().eq("user_id", userId).in("spotify_album_id", toRemove.slice(i, i + 100));
      }
      removedCount = toRemove.length;
      console.info("[spotify-import-tracks] removed saved albums:", removedCount);
    }
  }

  // Import tracks for NEW albums only (or all in full sync with no prior data)
  const albumsToFetchTracks = newAlbums.length > 0 ? newAlbums : [];
  
  // Get DB IDs for the new albums
  let totalTracksImported = 0;
  if (albumsToFetchTracks.length > 0) {
    const newAlbumSpotifyIds = albumsToFetchTracks.map(a => a.spotify_album_id);
    const { data: dbAlbums } = await adminClient
      .from("spotify_saved_albums")
      .select("id, spotify_album_id")
      .eq("user_id", userId)
      .in("spotify_album_id", newAlbumSpotifyIds);
    
    const dbIdMap = new Map<string, string>();
    for (const row of dbAlbums || []) {
      dbIdMap.set(row.spotify_album_id, row.id);
    }

    for (const album of albumsToFetchTracks) {
      const dbId = dbIdMap.get(album.spotify_album_id);
      if (!dbId) continue;

      try {
        const trackRows: any[] = [];
        let trackOffset = 0;

        while (true) {
          const data = await spotifyGet(
            `https://api.spotify.com/v1/albums/${album.spotify_album_id}/tracks?limit=50&offset=${trackOffset}`,
            token
          );
          const items = data.items || [];

          for (const track of items) {
            if (!track || !track.id) continue;
            const artists = (track.artists || []).map((a: any) => a?.name).filter(Boolean).join(", ");
            trackRows.push({
              user_id: userId,
              album_id: dbId,
              spotify_track_id: track.id,
              track_name: track.name || "Untitled",
              artist_name: artists,
              track_number: track.track_number || 1,
              disc_number: track.disc_number || 1,
              duration_ms: track.duration_ms || null,
            });
          }

          if (items.length === 0 || trackOffset + items.length >= (data.total || 0)) break;
          trackOffset += 50;
        }

        for (let i = 0; i < trackRows.length; i += 100) {
          await adminClient.from("spotify_album_tracks").upsert(
            trackRows.slice(i, i + 100),
            { onConflict: "album_id,spotify_track_id", ignoreDuplicates: true }
          );
        }
        totalTracksImported += trackRows.length;
      } catch (e) {
        console.warn(`[spotify-import-tracks] Failed to import tracks for album ${album.album_name}:`, e);
      }
    }
  }

  return { added: newAlbums.length, removed: removedCount, total: spotifyAlbums.length, tracksImported: totalTracksImported };
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
 */
async function syncPlaylists(
  adminClient: any, userId: string, token: string, spotifyUserId: string,
  existingSnapshots: Map<string, string>,
  targetPlaylistDbId?: string,
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
        const playlistTrackTotal = typeof pl.tracks?.total === "number"
          ? pl.tracks.total
          : typeof pl.items?.total === "number"
            ? pl.items.total
            : 0;
        playlists.push({
          id: pl.id,
          name: pl.name || "Untitled",
          description: pl.description || null,
          image_url: pl.images?.[0]?.url || null,
          track_count: playlistTrackTotal,
          owner_id: pl.owner?.id || "",
          owner_display_name: pl.owner?.display_name || null,
          is_owned: pl.owner?.id === spotifyUserId,
          is_collaborative: pl.collaborative === true,
          snapshot_id: pl.snapshot_id || null,
        });
      }
      offset += 50;
      console.log(`[spotify-import-tracks] playlists: ${offset}/${totalPl}, collected: ${playlists.length}`);
      if (items.length === 0) break;
    }
    console.log(`[spotify-import-tracks] playlists done: ${playlists.length} total`);
  } catch (e) {
    if (isInsufficientScopeError(e)) {
      warning = "Spotify connection is missing playlist read access. Reconnect Spotify to sync playlists.";
      console.warn("[spotify-import-tracks] playlist import skipped due to missing scope");
      return { total: 0, changed: 0, removed: 0, tracksSynced: 0, warning };
    }
    throw e;
  }

  const changedPlaylistIds: string[] = [];
  for (const pl of playlists) {
    const oldSnapshot = existingSnapshots.get(pl.id);
    if (!oldSnapshot || oldSnapshot !== pl.snapshot_id) {
      changedPlaylistIds.push(pl.id);
    }
  }

  // IMPORTANT: Do NOT store Spotify's reported track_count here.
  // track_count is only updated AFTER tracks are actually inserted into DB (see below).
  // This prevents the UI from showing "X tracks" when 0 are actually stored.
  const playlistRows = playlists.map(pl => ({
    user_id: userId,
    spotify_playlist_id: pl.id,
    name: pl.name,
    description: pl.description,
    image_url: pl.image_url,
    // track_count intentionally omitted — will be set after track import
    spotify_owner_id: pl.owner_id,
    owner_display_name: pl.owner_display_name,
    is_owned_by_user: pl.is_owned,
    is_collaborative: pl.is_collaborative,
    snapshot_id: pl.snapshot_id,
    last_synced_at: new Date().toISOString(),
  }));

  for (let i = 0; i < playlistRows.length; i += 50) {
    const batch = playlistRows.slice(i, i + 50);
    await ensureDbWrite(
      adminClient.from("spotify_playlists").upsert(batch, { onConflict: "user_id,spotify_playlist_id" }),
      "sync_playlists",
      { batch_start: i, batch_size: batch.length },
    );
  }

  const currentSpotifyIds = new Set(playlists.map(p => p.id));
  const { data: dbPlaylists, error: dbPlaylistsError } = await adminClient
    .from("spotify_playlists")
    .select("id, spotify_playlist_id")
    .eq("user_id", userId);
  if (dbPlaylistsError) {
    throw new SpotifyImportError("sync_playlists", dbPlaylistsError.message, 500);
  }

  let removedCount = 0;
  for (const dbPl of dbPlaylists || []) {
    if (!currentSpotifyIds.has(dbPl.spotify_playlist_id)) {
      await ensureDbWrite(
        adminClient.from("spotify_playlist_tracks").delete().eq("playlist_id", dbPl.id),
        "sync_playlists_cleanup_tracks",
        { playlist_id: dbPl.id, spotify_playlist_id: dbPl.spotify_playlist_id },
      );
      await adminClient.from("playlist_vibe_analysis").delete().eq("playlist_id", dbPl.id);
      await ensureDbWrite(
        adminClient.from("spotify_playlists").delete().eq("id", dbPl.id),
        "sync_playlists_cleanup_playlist",
        { playlist_id: dbPl.id, spotify_playlist_id: dbPl.spotify_playlist_id },
      );
      removedCount++;
    }
  }

  const playlistIdMap = new Map<string, string>();
  const { data: freshDbPlaylists, error: freshDbPlaylistsError } = await adminClient
    .from("spotify_playlists")
    .select("id, spotify_playlist_id")
    .eq("user_id", userId);
  if (freshDbPlaylistsError) {
    throw new SpotifyImportError("sync_playlists", freshDbPlaylistsError.message, 500);
  }
  for (const p of freshDbPlaylists || []) {
    playlistIdMap.set(p.spotify_playlist_id, p.id);
  }

  // Also force re-import for playlists that have 0 tracks in DB
  const trackCountByPlaylist = new Map<string, number>();
  for (const p of freshDbPlaylists || []) {
    const { count, error: countError } = await adminClient
      .from("spotify_playlist_tracks")
      .select("id", { count: "exact", head: true })
      .eq("playlist_id", p.id);
    if (countError) {
      throw new SpotifyImportError("sync_playlists", countError.message, 500, { playlist_id: p.id });
    }
    trackCountByPlaylist.set(p.spotify_playlist_id, count ?? 0);
  }

  const changedSet = new Set(changedPlaylistIds);
  // Also re-sync any playlist whose stored track rows do not match Spotify's reported total.
  for (const pl of playlists) {
    if ((trackCountByPlaylist.get(pl.id) ?? 0) !== pl.track_count) {
      changedSet.add(pl.id);
    }
  }

  let toSync: PlaylistMeta[];
  if (targetPlaylistDbId) {
    // Targeted single-playlist sync: find the spotify ID for this DB playlist
    let targetSpotifyId: string | undefined;
    for (const [spotId, dbId] of playlistIdMap.entries()) {
      if (dbId === targetPlaylistDbId) { targetSpotifyId = spotId; break; }
    }
    toSync = targetSpotifyId ? playlists.filter(pl => pl.id === targetSpotifyId) : [];
    console.log(`[spotify-import-tracks] targeted sync for playlist ${targetPlaylistDbId}: ${toSync.length > 0 ? toSync[0].name : "not found"}`);
  } else {
    toSync = playlists.filter(pl => changedSet.has(pl.id));
  }
  console.log(`[spotify-import-tracks] playlists to sync tracks: ${toSync.length}`);
  let totalTracks = 0;
  const failedPlaylists: string[] = [];

  for (const pl of toSync) {
    const dbId = playlistIdMap.get(pl.id);
    if (!dbId) continue;

    try {
      await ensureDbWrite(
        adminClient.from("spotify_playlist_tracks").delete().eq("playlist_id", dbId),
        "sync_playlist_tracks_delete_existing",
        { playlist_id: dbId, spotify_playlist_id: pl.id, playlist_name: pl.name },
      );

      const trackRows: any[] = [];
      let nextUrl: string | null = `https://api.spotify.com/v1/playlists/${pl.id}/items?limit=100&offset=0&fields=items(added_at,track(id,name,uri,preview_url,duration_ms,artists(name),album(name,images))),next,total`;
      let expectedTotal = pl.track_count;

      while (nextUrl) {
        const data = await spotifyGet(nextUrl, token);
        const items = data.items || [];
        if (typeof data.total === "number") {
          expectedTotal = data.total;
        }
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
            position: trackRows.length,
          });
        }
        console.log(`[spotify-import-tracks] playlist ${pl.name}: ${trackRows.length}/${expectedTotal}`);
        nextUrl = typeof data.next === "string" && data.next.length > 0 ? data.next : null;
        if (items.length === 0) break;
      }

      for (let i = 0; i < trackRows.length; i += 100) {
        const batch = trackRows.slice(i, i + 100);
        await ensureDbWrite(
          adminClient.from("spotify_playlist_tracks").upsert(batch, {
            onConflict: "playlist_id,spotify_track_id",
            ignoreDuplicates: true,
          }),
          "sync_playlist_tracks_upsert",
          {
            playlist_id: dbId,
            spotify_playlist_id: pl.id,
            playlist_name: pl.name,
            batch_start: i,
            batch_size: batch.length,
          },
        );
      }

      await ensureDbWrite(
        adminClient
          .from("spotify_playlists")
          .update({
            track_count: trackRows.length,
            last_synced_at: new Date().toISOString(),
          })
          .eq("id", dbId),
        "sync_playlists_update_metadata",
        {
          playlist_id: dbId,
          spotify_playlist_id: pl.id,
          playlist_name: pl.name,
          imported_tracks: trackRows.length,
        },
      );

      totalTracks += trackRows.length;
    } catch (e) {
      failedPlaylists.push(pl.name);
      console.warn(`[spotify-import-tracks] Failed to import tracks for playlist ${pl.name}:`, e);
    }
  }

  if (failedPlaylists.length > 0) {
    const failureWarning = `Some playlist tracks could not be saved: ${failedPlaylists.slice(0, 3).join(", ")}${failedPlaylists.length > 3 ? ` +${failedPlaylists.length - 3} more` : ""}.`;
    warning = warning ? `${warning} ${failureWarning}` : failureWarning;
  }

  return { total: playlists.length, changed: changedPlaylistIds.length, removed: removedCount, tracksSynced: totalTracks, warning };
}

/**
 * FOLLOWED ARTISTS — full bidirectional sync.
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
      console.log(`[spotify-import-tracks] artists page ${page}: collected ${artists.length}`);
      if (!after) break;
    }
    console.log(`[spotify-import-tracks] artists done: ${artists.length} total`);
  } catch (e) {
    if (isInsufficientScopeError(e)) {
      console.warn("[spotify-import-tracks] followed artists skipped - missing scope");
      return { added: 0, removed: 0, total: 0 };
    }
    console.warn("[spotify-import-tracks] followed artists import failed:", e);
    return { added: 0, removed: 0, total: 0 };
  }

  for (let i = 0; i < artists.length; i += 50) {
    await adminClient.from("spotify_followed_artists").upsert(
      artists.slice(i, i + 50),
      { onConflict: "user_id,spotify_artist_id" }
    );
  }

  let removedCount = 0;
  const toRemove: string[] = [];
  for (const existingId of existingArtistIds) {
    if (!spotifyArtistIds.has(existingId)) toRemove.push(existingId);
  }
  if (toRemove.length > 0) {
    for (let i = 0; i < toRemove.length; i += 100) {
      await adminClient.from("spotify_followed_artists").delete().eq("user_id", userId).in("spotify_artist_id", toRemove.slice(i, i + 100));
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

    let forceFullSync = false;
    let syncScope: "all" | "liked" | "playlists" | "artists" | "albums" = "all";
    let targetPlaylistId: string | undefined; // DB UUID of a single playlist to sync
    try {
      const body = await req.json();
      if (body?.force_full) forceFullSync = true;
      if (body?.scope && ["liked", "playlists", "artists", "albums"].includes(body.scope)) {
        syncScope = body.scope;
      }
      if (body?.playlist_id && typeof body.playlist_id === "string") {
        targetPlaylistId = body.playlist_id;
        syncScope = "playlists"; // force scope to playlists when targeting one
      }
    } catch { /* no body is fine */ }

    step = "refresh_access_token";
    const { token: accessToken, connection } = await refreshTokenIfNeeded(supabase, user.id);

    const isFullSync = shouldDoFullSync(connection, forceFullSync);
    const syncMode = isFullSync ? "full" : "incremental";
    console.log("[spotify-import-tracks] === STARTING SYNC ===", { user_id: user.id, mode: syncMode, scope: syncScope });

    await adminClient.from("spotify_connections").update({
      sync_status: "syncing",
      sync_error: null,
    }).eq("user_id", user.id);

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
    const [trackRes, playlistRes, artistRes, albumRes] = await Promise.all([
      adminClient.from("liked_songs").select("spotify_track_id").eq("user_id", user.id),
      adminClient.from("spotify_playlists").select("spotify_playlist_id, snapshot_id").eq("user_id", user.id),
      adminClient.from("spotify_followed_artists").select("spotify_artist_id").eq("user_id", user.id),
      adminClient.from("spotify_saved_albums").select("spotify_album_id").eq("user_id", user.id),
    ]);

    const existingTrackIds = new Set((trackRes.data || []).map((r: any) => r.spotify_track_id));
    const existingSnapshots = new Map<string, string>();
    for (const p of playlistRes.data || []) {
      if (p.snapshot_id) existingSnapshots.set(p.spotify_playlist_id, p.snapshot_id);
    }
    const existingArtistIds = new Set((artistRes.data || []).map((r: any) => r.spotify_artist_id));
    const existingAlbumIds = new Set((albumRes.data || []).map((r: any) => r.spotify_album_id));

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

      if (syncScope === "all") {
        step = "fetch_audio_features";
        const pendingAudioFeatureIds = await getAllUnfetchedAudioFeatureIds(adminClient, user.id);
        if (pendingAudioFeatureIds.length > 0) {
          console.log("[spotify-import-tracks] fetching audio features", { pending: pendingAudioFeatureIds.length });
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
      }
    }

    // Step 2: Saved Albums
    if (syncScope === "all" || syncScope === "albums") {
      step = "sync_saved_albums";
      const albumResult = await syncSavedAlbums(adminClient, user.id, accessToken, isFullSync, existingAlbumIds);
      result.albums_total = albumResult.total;
      result.albums_added = albumResult.added;
      result.albums_removed = albumResult.removed;
      result.album_tracks_imported = albumResult.tracksImported;
      console.log("[spotify-import-tracks] saved_albums_done", albumResult);
      await adminClient.from("spotify_connections").update({ last_album_sync_at: now }).eq("user_id", user.id);
    }

    // Step 3: Playlists + playlist tracks
    if (syncScope === "all" || syncScope === "playlists") {
      step = "sync_playlists";
      const plResult = await syncPlaylists(adminClient, user.id, accessToken, spotifyUserId, existingSnapshots, targetPlaylistId);
      result.playlists_total = plResult.total;
      result.playlists_changed = plResult.changed;
      result.playlists_removed = plResult.removed;
      result.playlist_tracks_synced = plResult.tracksSynced;
      if (plResult.warning) warnings.push(plResult.warning);
      console.log("[spotify-import-tracks] playlists_done", plResult);
      await adminClient.from("spotify_connections").update({ last_playlist_sync_at: now }).eq("user_id", user.id);
    }

    // Step 4: Followed artists
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
    if (isFullSync) syncUpdate.last_full_sync_at = now;
    syncUpdate.last_incremental_sync_at = now;
    await adminClient.from("spotify_connections").update(syncUpdate).eq("user_id", user.id);

    result.partial_success = warnings.length > 0;
    result.warnings = warnings;

    return json(result);
  } catch (e) {
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
