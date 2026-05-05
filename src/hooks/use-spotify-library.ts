import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./use-auth";

export interface SpotifyPlaylist {
  id: string;
  spotify_playlist_id: string;
  name: string;
  description: string | null;
  image_url: string | null;
  track_count: number;
  is_owned_by_user: boolean;
  is_collaborative: boolean;
  owner_display_name: string | null;
  last_synced_at: string;
}

export interface LikedSong {
  id: string;
  spotify_track_id: string;
  track_name: string;
  artist_name: string;
  album_name: string | null;
  image_url: string | null;
  added_at: string | null;
}

export interface FollowedArtist {
  id: string;
  spotify_artist_id: string;
  artist_name: string;
  image_url: string | null;
  genres: string[];
  popularity: number | null;
}

export interface SavedAlbum {
  id: string;
  spotify_album_id: string;
  album_name: string;
  artist_name: string;
  image_url: string | null;
  release_date: string | null;
  total_tracks: number;
  album_type: string | null;
  added_at: string | null;
}

/** Each stage the sync pipeline goes through, in order */
export type SyncStage = "profile" | "liked_songs" | "albums" | "playlists" | "artists" | "tops" | "analysis";

export type StageStatus = "pending" | "active" | "done" | "error" | "skipped";

export interface SyncStageState {
  stage: SyncStage;
  label: string;
  status: StageStatus;
  detail?: string;
}

export type SyncStatus = "idle" | "syncing" | "error";

export interface SyncMetadata {
  syncStatus: SyncStatus;
  syncError: string | null;
  lastFullSyncAt: string | null;
  lastIncrementalSyncAt: string | null;
  lastLibrarySyncAt: string | null;
  lastPlaylistSyncAt: string | null;
  lastArtistSyncAt: string | null;
  lastAlbumSyncAt: string | null;
}

function formatTimeAgo(dateStr: string | null): string | null {
  if (!dateStr) return null;
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

/** Fetch all rows from a table, bypassing the 1000-row default limit */
async function fetchAllRows<T>(
  table: string,
  select: string,
  userId: string,
  orderCol: string,
  ascending = true,
): Promise<T[]> {
  const PAGE = 1000;
  let offset = 0;
  const all: T[] = [];
  while (true) {
    const { data, error } = await (supabase
      .from(table as any)
      .select(select)
      .eq("user_id", userId)
      .order(orderCol, { ascending })
      .range(offset, offset + PAGE - 1) as any);
    if (error || !data || data.length === 0) break;
    all.push(...(data as T[]));
    if (data.length < PAGE) break;
    offset += PAGE;
  }
  return all;
}

const INITIAL_STAGES: SyncStageState[] = [
  { stage: "profile", label: "Reading your profile", status: "pending" },
  { stage: "liked_songs", label: "Importing liked songs", status: "pending" },
  { stage: "albums", label: "Importing saved albums", status: "pending" },
  { stage: "playlists", label: "Importing playlists", status: "pending" },
  { stage: "artists", label: "Importing followed artists", status: "pending" },
  { stage: "tops", label: "Top tracks & recent plays", status: "pending" },
  { stage: "analysis", label: "Audio analysis", status: "pending" },
];

export function useSpotifyLibrary() {
  const { user, profile } = useAuth();
  const spotifyConnected = profile?.spotify_connected ?? false;

  const [playlists, setPlaylists] = useState<SpotifyPlaylist[]>([]);
  const [likedSongs, setLikedSongs] = useState<LikedSong[]>([]);
  const [likedCount, setLikedCount] = useState(0);
  const [followedArtists, setFollowedArtists] = useState<FollowedArtist[]>([]);
  const [savedAlbums, setSavedAlbums] = useState<SavedAlbum[]>([]);
  const [albumCount, setAlbumCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncStages, setSyncStages] = useState<SyncStageState[]>(INITIAL_STAGES);
  const [lastSyncResult, setLastSyncResult] = useState<Record<string, any> | null>(null);
  const [syncMeta, setSyncMeta] = useState<SyncMetadata>({
    syncStatus: "idle",
    syncError: null,
    lastFullSyncAt: null,
    lastIncrementalSyncAt: null,
    lastLibrarySyncAt: null,
    lastPlaylistSyncAt: null,
    lastArtistSyncAt: null,
    lastAlbumSyncAt: null,
  });

  const setStage = useCallback((stage: SyncStage, status: StageStatus, detail?: string) => {
    setSyncStages(prev =>
      prev.map(s => s.stage === stage ? { ...s, status, detail: detail ?? s.detail } : s)
    );
  }, []);

  const loadSyncMeta = useCallback(async () => {
    if (!user || !spotifyConnected) return;
    const { data } = await supabase
      .from("spotify_connections")
      .select("sync_status, sync_error, last_full_sync_at, last_incremental_sync_at, last_library_sync_at, last_playlist_sync_at, last_artist_sync_at, last_album_sync_at")
      .eq("user_id", user.id)
      .single();

    if (data) {
      setSyncMeta({
        syncStatus: (data.sync_status as SyncStatus) || "idle",
        syncError: data.sync_error || null,
        lastFullSyncAt: data.last_full_sync_at || null,
        lastIncrementalSyncAt: data.last_incremental_sync_at || null,
        lastLibrarySyncAt: data.last_library_sync_at || null,
        lastPlaylistSyncAt: data.last_playlist_sync_at || null,
        lastArtistSyncAt: data.last_artist_sync_at || null,
        lastAlbumSyncAt: (data as any).last_album_sync_at || null,
      });
    }
  }, [user, spotifyConnected]);

  const refreshLiked = useCallback(async () => {
    if (!user) return;
    // Get count
    const countRes = await supabase.from("liked_songs").select("id", { count: "exact", head: true }).eq("user_id", user.id);
    setLikedCount(countRes.count ?? 0);
    // Fetch ALL liked songs
    const all = await fetchAllRows<LikedSong>(
      "liked_songs",
      "id, spotify_track_id, track_name, artist_name, album_name, image_url, added_at",
      user.id,
      "added_at",
      false,
    );
    setLikedSongs(all);
  }, [user]);

  const refreshPlaylists = useCallback(async () => {
    if (!user) return;
    const all = await fetchAllRows<SpotifyPlaylist>(
      "spotify_playlists",
      "id, spotify_playlist_id, name, description, image_url, track_count, is_owned_by_user, is_collaborative, owner_display_name, last_synced_at",
      user.id,
      "name",
      true,
    );
    setPlaylists(all);
  }, [user]);

  const refreshArtists = useCallback(async () => {
    if (!user) return;
    const all = await fetchAllRows<FollowedArtist>(
      "spotify_followed_artists",
      "id, spotify_artist_id, artist_name, image_url, genres, popularity",
      user.id,
      "artist_name",
      true,
    );
    setFollowedArtists(all);
  }, [user]);

  const refreshAlbums = useCallback(async () => {
    if (!user) return;
    const countRes = await supabase.from("spotify_saved_albums").select("id", { count: "exact", head: true }).eq("user_id", user.id);
    setAlbumCount(countRes.count ?? 0);
    const all = await fetchAllRows<SavedAlbum>(
      "spotify_saved_albums",
      "id, spotify_album_id, album_name, artist_name, image_url, release_date, total_tracks, album_type, added_at",
      user.id,
      "added_at",
      false,
    );
    setSavedAlbums(all);
  }, [user]);

  const refresh = useCallback(async () => {
    if (!user || !spotifyConnected) {
      setPlaylists([]);
      setLikedSongs([]);
      setLikedCount(0);
      setFollowedArtists([]);
      setSavedAlbums([]);
      setAlbumCount(0);
      return;
    }
    setLoading(true);
    await Promise.all([refreshLiked(), refreshPlaylists(), refreshArtists(), refreshAlbums(), loadSyncMeta()]);
    setLoading(false);
  }, [user, spotifyConnected, refreshLiked, refreshPlaylists, refreshArtists, refreshAlbums, loadSyncMeta]);

  const invokeSync = useCallback(async (scope: string, forceFullSync: boolean) => {
    const body: Record<string, any> = { scope };
    if (forceFullSync) body.force_full = true;
    const res = await supabase.functions.invoke("spotify-import-tracks", { body });
    if (res.error) throw new Error(res.error.message);
    if (res.data?.error) throw new Error(res.data.error);
    return res.data as Record<string, any>;
  }, []);

  const abortRef = useRef(false);

  const resync = useCallback(async (forceFullSync = false) => {
    if (syncing || !user || !spotifyConnected) return;

    abortRef.current = false;
    setSyncing(true);
    setSyncStages(INITIAL_STAGES.map(s => ({ ...s, status: "pending" as StageStatus })));
    setLastSyncResult(null);

    const combinedResult: Record<string, any> = { success: true };

    try {
      setStage("profile", "active");
      try {
        const ext = await supabase.functions.invoke("spotify-sync-extras", { body: {} });
        if (ext.error || ext.data?.error) throw new Error(ext.error?.message || ext.data?.error);
        setStage("profile", "done", "ready");
      } catch (e: any) {
        setStage("profile", "skipped", e.message);
      }
      if (abortRef.current) return;

      setStage("liked_songs", "active");
      const likedRes = await invokeSync("liked", forceFullSync);
      Object.assign(combinedResult, likedRes);
      setStage("liked_songs", "done", `${likedRes.liked_songs_added ?? 0} new`);
      await refreshLiked();
      if (abortRef.current) return;

      setStage("albums", "active");
      const albumRes = await invokeSync("albums", forceFullSync);
      Object.assign(combinedResult, albumRes);
      setStage("albums", "done", `+${albumRes.albums_added ?? 0}`);
      await refreshAlbums();
      if (abortRef.current) return;

      setStage("playlists", "active");
      let playlistsRemaining = Infinity;
      let totalPlaylistTracksSynced = 0;
      let plBatchNum = 0;
      // Loop until all playlist tracks are imported (edge function processes max 10 per call)
      while (playlistsRemaining > 0) {
        plBatchNum++;
        const plRes = await invokeSync("playlists", forceFullSync);
        Object.assign(combinedResult, plRes);
        totalPlaylistTracksSynced += plRes.playlist_tracks_synced ?? 0;
        playlistsRemaining = plRes.playlists_remaining ?? 0;
        setStage("playlists", "active", `batch ${plBatchNum}: ${plRes.playlist_tracks_synced ?? 0} tracks, ${playlistsRemaining} playlists remaining`);
        if (plBatchNum > 50) break; // safety limit
      }
      setStage("playlists", "done", `${totalPlaylistTracksSynced} tracks synced`);
      await refreshPlaylists();
      if (abortRef.current) return;

      setStage("artists", "active");
      const artRes = await invokeSync("artists", forceFullSync);
      Object.assign(combinedResult, artRes);
      setStage("artists", "done", `+${artRes.artists_added ?? 0}`);
      await refreshArtists();
      if (abortRef.current) return;

      setStage("analysis", "active");
      try {
        const analysisRes = await supabase.functions.invoke("spotify-import-tracks", {
          body: { scope: "all", skip_core: false, ...(forceFullSync ? { force_full: true } : {}) },
        });
        const featureCount = analysisRes.data?.audio_features ?? 0;
        setStage("analysis", "done", featureCount > 0 ? `${featureCount} tracks` : "up to date");
      } catch {
        setStage("analysis", "skipped", "will retry later");
      }

      combinedResult.sync_mode = forceFullSync ? "full" : "incremental";
      setLastSyncResult(combinedResult);
      await loadSyncMeta();
    } catch (e: any) {
      setSyncStages(prev =>
        prev.map(s => s.status === "active" ? { ...s, status: "error" as StageStatus, detail: e.message } : s)
      );
      await loadSyncMeta();
      throw e;
    } finally {
      setSyncing(false);
    }
  }, [syncing, user, spotifyConnected, invokeSync, refreshLiked, refreshAlbums, refreshPlaylists, refreshArtists, loadSyncMeta, setStage]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    return () => { abortRef.current = true; };
  }, []);

  const lastSyncedLabel = formatTimeAgo(syncMeta.lastIncrementalSyncAt || syncMeta.lastFullSyncAt);
  const allDone = syncing === false && syncStages.some(s => s.status === "done");

  return {
    playlists,
    likedSongs,
    likedCount,
    followedArtists,
    savedAlbums,
    albumCount,
    loading,
    syncing,
    syncStages,
    allDone,
    lastSyncResult,
    syncMeta,
    lastSyncedLabel,
    refresh,
    resync,
  };
}
