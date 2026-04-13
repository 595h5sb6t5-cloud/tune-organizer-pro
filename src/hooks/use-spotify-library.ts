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
export type SyncStage = "liked_songs" | "albums" | "playlists" | "artists" | "analysis";

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

const INITIAL_STAGES: SyncStageState[] = [
  { stage: "liked_songs", label: "Liked songs", status: "pending" },
  { stage: "albums", label: "Saved albums", status: "pending" },
  { stage: "playlists", label: "Playlists", status: "pending" },
  { stage: "artists", label: "Followed artists", status: "pending" },
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
    const [countRes, listRes] = await Promise.all([
      supabase.from("liked_songs").select("id", { count: "exact", head: true }).eq("user_id", user.id),
      supabase.from("liked_songs")
        .select("id, spotify_track_id, track_name, artist_name, album_name, image_url, added_at")
        .eq("user_id", user.id)
        .order("added_at", { ascending: false, nullsFirst: false })
        .limit(50),
    ]);
    setLikedCount(countRes.count ?? 0);
    setLikedSongs((listRes.data as LikedSong[]) ?? []);
  }, [user]);

  const refreshPlaylists = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from("spotify_playlists")
      .select("id, spotify_playlist_id, name, description, image_url, track_count, is_owned_by_user, is_collaborative, owner_display_name, last_synced_at")
      .eq("user_id", user.id)
      .order("is_owned_by_user", { ascending: false })
      .order("name");
    setPlaylists((data as SpotifyPlaylist[]) ?? []);
  }, [user]);

  const refreshArtists = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from("spotify_followed_artists")
      .select("id, spotify_artist_id, artist_name, image_url, genres, popularity")
      .eq("user_id", user.id)
      .order("artist_name");
    setFollowedArtists((data as FollowedArtist[]) ?? []);
  }, [user]);

  const refreshAlbums = useCallback(async () => {
    if (!user) return;
    const [countRes, listRes] = await Promise.all([
      supabase.from("spotify_saved_albums").select("id", { count: "exact", head: true }).eq("user_id", user.id),
      supabase.from("spotify_saved_albums")
        .select("id, spotify_album_id, album_name, artist_name, image_url, release_date, total_tracks, album_type, added_at")
        .eq("user_id", user.id)
        .order("added_at", { ascending: false, nullsFirst: false })
        .limit(50),
    ]);
    setAlbumCount(countRes.count ?? 0);
    setSavedAlbums((listRes.data as SavedAlbum[]) ?? []);
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
      // Stage 1: Liked songs
      setStage("liked_songs", "active");
      const likedRes = await invokeSync("liked", forceFullSync);
      Object.assign(combinedResult, likedRes);
      setStage("liked_songs", "done", `+${likedRes.liked_songs_added ?? 0}`);
      await refreshLiked();
      if (abortRef.current) return;

      // Stage 2: Saved albums
      setStage("albums", "active");
      const albumRes = await invokeSync("albums", forceFullSync);
      Object.assign(combinedResult, albumRes);
      setStage("albums", "done", `+${albumRes.albums_added ?? 0}`);
      await refreshAlbums();
      if (abortRef.current) return;

      // Stage 3: Playlists
      setStage("playlists", "active");
      const plRes = await invokeSync("playlists", forceFullSync);
      Object.assign(combinedResult, plRes);
      setStage("playlists", "done", `${plRes.playlists_changed ?? 0} updated`);
      await refreshPlaylists();
      if (abortRef.current) return;

      // Stage 4: Artists
      setStage("artists", "active");
      const artRes = await invokeSync("artists", forceFullSync);
      Object.assign(combinedResult, artRes);
      setStage("artists", "done", `+${artRes.artists_added ?? 0}`);
      await refreshArtists();
      if (abortRef.current) return;

      // Stage 5: Audio analysis (background)
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
