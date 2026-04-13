import { useCallback, useEffect, useState } from "react";
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

export type SyncPhase =
  | "idle"
  | "starting"
  | "liked_songs"
  | "playlists"
  | "artists"
  | "complete"
  | "error";

export type SyncStatus = "idle" | "syncing" | "error";

export interface SyncMetadata {
  syncStatus: SyncStatus;
  syncError: string | null;
  lastFullSyncAt: string | null;
  lastIncrementalSyncAt: string | null;
  lastLibrarySyncAt: string | null;
  lastPlaylistSyncAt: string | null;
  lastArtistSyncAt: string | null;
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

export function useSpotifyLibrary() {
  const { user, profile } = useAuth();
  const spotifyConnected = profile?.spotify_connected ?? false;

  const [playlists, setPlaylists] = useState<SpotifyPlaylist[]>([]);
  const [likedSongs, setLikedSongs] = useState<LikedSong[]>([]);
  const [likedCount, setLikedCount] = useState(0);
  const [followedArtists, setFollowedArtists] = useState<FollowedArtist[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncPhase, setSyncPhase] = useState<SyncPhase>("idle");
  const [lastSyncResult, setLastSyncResult] = useState<Record<string, any> | null>(null);
  const [syncMeta, setSyncMeta] = useState<SyncMetadata>({
    syncStatus: "idle",
    syncError: null,
    lastFullSyncAt: null,
    lastIncrementalSyncAt: null,
    lastLibrarySyncAt: null,
    lastPlaylistSyncAt: null,
    lastArtistSyncAt: null,
  });

  const loadSyncMeta = useCallback(async () => {
    if (!user || !spotifyConnected) return;
    const { data } = await supabase
      .from("spotify_connections")
      .select("sync_status, sync_error, last_full_sync_at, last_incremental_sync_at, last_library_sync_at, last_playlist_sync_at, last_artist_sync_at")
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
      });
    }
  }, [user, spotifyConnected]);

  const refresh = useCallback(async () => {
    if (!user || !spotifyConnected) {
      setPlaylists([]);
      setLikedSongs([]);
      setLikedCount(0);
      setFollowedArtists([]);
      return;
    }

    setLoading(true);

    const [playlistRes, likedCountRes, likedRes, artistRes] = await Promise.all([
      supabase
        .from("spotify_playlists")
        .select("id, spotify_playlist_id, name, description, image_url, track_count, is_owned_by_user, is_collaborative, owner_display_name, last_synced_at")
        .eq("user_id", user.id)
        .order("is_owned_by_user", { ascending: false })
        .order("name"),
      supabase
        .from("liked_songs")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id),
      supabase
        .from("liked_songs")
        .select("id, spotify_track_id, track_name, artist_name, album_name, image_url, added_at")
        .eq("user_id", user.id)
        .order("added_at", { ascending: false, nullsFirst: false })
        .limit(50),
      supabase
        .from("spotify_followed_artists")
        .select("id, spotify_artist_id, artist_name, image_url, genres, popularity")
        .eq("user_id", user.id)
        .order("artist_name"),
    ]);

    setPlaylists((playlistRes.data as SpotifyPlaylist[]) ?? []);
    setLikedCount(likedCountRes.count ?? 0);
    setLikedSongs((likedRes.data as LikedSong[]) ?? []);
    setFollowedArtists((artistRes.data as FollowedArtist[]) ?? []);
    setLoading(false);

    // Also refresh sync metadata
    await loadSyncMeta();
  }, [user, spotifyConnected, loadSyncMeta]);

  const resync = useCallback(async (forceFullSync = false) => {
    if (syncing || !user || !spotifyConnected) return;

    setSyncing(true);
    setSyncPhase("starting");
    setLastSyncResult(null);

    try {
      // Show progress phases optimistically
      const t1 = setTimeout(() => setSyncPhase("liked_songs"), 500);
      const t2 = setTimeout(() => setSyncPhase("playlists"), 3000);
      const t3 = setTimeout(() => setSyncPhase("artists"), 6000);

      const res = await supabase.functions.invoke("spotify-import-tracks", {
        body: forceFullSync ? { force_full: true } : undefined,
      });

      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);

      if (res.error) throw new Error(res.error.message);
      if (res.data?.error) throw new Error(res.data.error);

      setLastSyncResult(res.data);
      setSyncPhase("complete");
      await refresh();

      // Reset phase after a moment
      setTimeout(() => setSyncPhase("idle"), 3000);
    } catch (e: any) {
      setSyncPhase("error");
      await loadSyncMeta(); // Refresh to get the error message from DB
      throw e;
    } finally {
      setSyncing(false);
    }
  }, [syncing, user, spotifyConnected, refresh, loadSyncMeta]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Compute last synced display string
  const lastSyncedLabel = formatTimeAgo(syncMeta.lastIncrementalSyncAt || syncMeta.lastFullSyncAt);

  return {
    playlists,
    likedSongs,
    likedCount,
    followedArtists,
    loading,
    syncing,
    syncPhase,
    lastSyncResult,
    syncMeta,
    lastSyncedLabel,
    refresh,
    resync,
  };
}
