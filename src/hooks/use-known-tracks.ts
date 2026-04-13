import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./use-auth";

/**
 * Aggregates all "known" Spotify track IDs across:
 * - liked songs
 * - imported tracks
 * - spotify playlist tracks
 * - saved album tracks
 * - accepted recommendation history
 *
 * Returns a Set<string> of spotify_track_id values for filtering.
 */
export function useKnownTracks() {
  const { user } = useAuth();
  const [knownTrackIds, setKnownTrackIds] = useState<Set<string>>(new Set());
  const [knownTitles, setKnownTitles] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!user) {
      setKnownTrackIds(new Set());
      setKnownTitles(new Set());
      return;
    }

    setLoading(true);
    const ids = new Set<string>();
    const titles = new Set<string>();

    // Fetch in parallel — all sources of known music
    const [likedRes, importedRes, playlistTracksRes, acceptedRes, albumTracksRes] = await Promise.all([
      supabase.from("liked_songs").select("spotify_track_id, track_name, artist_name").eq("user_id", user.id),
      supabase.from("imported_tracks").select("spotify_track_id, track_name, artist_name").eq("user_id", user.id),
      supabase.from("spotify_playlist_tracks").select("spotify_track_id, track_name, artist_name").eq("user_id", user.id),
      supabase.from("recommendation_history").select("track_title, track_artist").eq("user_id", user.id).eq("status", "accepted"),
      supabase.from("spotify_album_tracks").select("spotify_track_id, track_name, artist_name").eq("user_id", user.id),
    ]);

    for (const row of likedRes.data || []) {
      ids.add(row.spotify_track_id);
      titles.add(`${row.track_name}|||${row.artist_name}`.toLowerCase());
    }
    for (const row of importedRes.data || []) {
      ids.add(row.spotify_track_id);
      titles.add(`${row.track_name}|||${row.artist_name}`.toLowerCase());
    }
    for (const row of playlistTracksRes.data || []) {
      ids.add(row.spotify_track_id);
      titles.add(`${row.track_name}|||${row.artist_name}`.toLowerCase());
    }
    for (const row of albumTracksRes.data || []) {
      ids.add(row.spotify_track_id);
      titles.add(`${row.track_name}|||${row.artist_name}`.toLowerCase());
    }
    for (const row of acceptedRes.data || []) {
      titles.add(`${row.track_title}|||${row.track_artist}`.toLowerCase());
    }

    setKnownTrackIds(ids);
    setKnownTitles(titles);
    setLoading(false);
  }, [user]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const isKnown = useCallback(
    (titleOrId: string, artist?: string) => {
      if (knownTrackIds.has(titleOrId)) return true;
      if (artist) {
        return knownTitles.has(`${titleOrId}|||${artist}`.toLowerCase());
      }
      return false;
    },
    [knownTrackIds, knownTitles]
  );

  return { knownTrackIds, knownTitles, isKnown, loading, refresh };
}
