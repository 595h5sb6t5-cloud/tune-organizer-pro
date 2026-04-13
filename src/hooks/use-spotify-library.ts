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
  }, [user, spotifyConnected]);

  const resync = useCallback(async (forceFullSync = false) => {
    if (syncing || !user || !spotifyConnected) return;

    setSyncing(true);
    setSyncPhase("starting");
    setLastSyncResult(null);

    try {
      // Show progress phases optimistically
      setTimeout(() => setSyncPhase("liked_songs"), 500);
      setTimeout(() => setSyncPhase("playlists"), 3000);
      setTimeout(() => setSyncPhase("artists"), 6000);

      const res = await supabase.functions.invoke("spotify-import-tracks", {
        body: forceFullSync ? { force_full: true } : undefined,
      });

      if (res.error) throw new Error(res.error.message);
      if (res.data?.error) throw new Error(res.data.error);

      setLastSyncResult(res.data);
      setSyncPhase("complete");
      await refresh();

      // Reset phase after a moment
      setTimeout(() => setSyncPhase("idle"), 3000);
    } catch (e: any) {
      setSyncPhase("error");
      throw e;
    } finally {
      setSyncing(false);
    }
  }, [syncing, user, spotifyConnected, refresh]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return {
    playlists,
    likedSongs,
    likedCount,
    followedArtists,
    loading,
    syncing,
    syncPhase,
    lastSyncResult,
    refresh,
    resync,
  };
}
