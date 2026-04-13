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

export function useSpotifyLibrary() {
  const { user, profile } = useAuth();
  const spotifyConnected = profile?.spotify_connected ?? false;

  const [playlists, setPlaylists] = useState<SpotifyPlaylist[]>([]);
  const [likedSongs, setLikedSongs] = useState<LikedSong[]>([]);
  const [likedCount, setLikedCount] = useState(0);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!user || !spotifyConnected) {
      setPlaylists([]);
      setLikedSongs([]);
      setLikedCount(0);
      return;
    }

    setLoading(true);

    const [playlistRes, likedCountRes, likedRes] = await Promise.all([
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
    ]);

    setPlaylists((playlistRes.data as SpotifyPlaylist[]) ?? []);
    setLikedCount(likedCountRes.count ?? 0);
    setLikedSongs((likedRes.data as LikedSong[]) ?? []);
    setLoading(false);
  }, [user, spotifyConnected]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { playlists, likedSongs, likedCount, loading, refresh };
}
