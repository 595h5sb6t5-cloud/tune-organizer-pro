import { useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface SpotifyTrackInfo {
  spotify_id: string;
  preview_url: string | null;
  image_url: string | null;
  album: string | null;
  uri: string | null;
}

/**
 * Enriches an array of recommended tracks with Spotify data (preview URLs, artwork).
 * Returns a Map keyed by "title|||artist" lowercase.
 */
export function useSpotifySearch() {
  const enrich = useCallback(async (
    tracks: { title: string; artist: string }[]
  ): Promise<Map<string, SpotifyTrackInfo>> => {
    const map = new Map<string, SpotifyTrackInfo>();
    if (tracks.length === 0) return map;

    try {
      const { data, error } = await supabase.functions.invoke("spotify-search-tracks", {
        body: { tracks: tracks.slice(0, 20) },
      });

      if (error || !data?.results) return map;

      const results: (SpotifyTrackInfo | null)[] = data.results;
      tracks.slice(0, 20).forEach((t, i) => {
        const info = results[i];
        if (info) {
          map.set(`${t.title}|||${t.artist}`.toLowerCase(), info);
        }
      });
    } catch (e) {
      console.warn("Spotify search enrichment failed:", e);
    }

    return map;
  }, []);

  return { enrich };
}
