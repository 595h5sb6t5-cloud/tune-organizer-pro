import { useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { type Track, type Recommendation } from "@/lib/sample-data";
import { toast } from "sonner";

interface UseAIRecommendationsOptions {
  playlistId: string;
  playlistName: string;
  playlistMood: string;
  playlistDescription: string;
  tracks: Track[];
  discoveryMode?: string;
}

interface FeedbackTrack {
  title: string;
  artist: string;
}

export function useAIRecommendations({
  playlistId,
  playlistName,
  playlistMood,
  playlistDescription,
  tracks,
  discoveryMode = "balanced",
}: UseAIRecommendationsOptions) {
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [acceptedSongs, setAcceptedSongs] = useState<FeedbackTrack[]>([]);
  const [dismissedSongs, setDismissedSongs] = useState<FeedbackTrack[]>([]);

  const generate = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("recommend-songs", {
        body: {
          playlistName,
          playlistMood,
          playlistDescription,
          tracks: tracks.map((t) => ({
            title: t.title,
            artist: t.artist,
            genre: t.genre,
            mood: t.mood,
            tempo: t.tempo,
            energy: t.energy,
            valence: t.valence,
            acousticness: t.acousticness,
            danceability: t.danceability,
            year: t.year,
          })),
          discoveryMode,
          acceptedSongs,
          dismissedSongs,
        },
      });

      if (error) {
        throw new Error(error.message || "Failed to get recommendations");
      }

      const recs: Recommendation[] = (data.recommendations || []).map(
        (r: any, i: number) => ({
          id: `ai-${playlistId}-${i}-${Date.now()}`,
          track: {
            id: `ai-track-${playlistId}-${i}-${Date.now()}`,
            title: r.title,
            artist: r.artist,
            album: r.album || "Unknown",
            year: r.year || 2024,
            genre: r.genre || "Unknown",
            tempo: r.tempo || 100,
            energy: r.energy || 0.5,
            valence: r.valence || 0.5,
            danceability: r.danceability || 0.5,
            acousticness: r.acousticness || 0.3,
            mood: r.mood || "Mixed",
          },
          matchScore: r.matchScore || 80,
          reason: r.reason || "AI-selected for this playlist",
          moodTags: r.moodTags || [],
          popularityTier: r.popularityTier || "mid",
          compatibilityBreakdown: r.compatibilityBreakdown || null,
          targetPlaylistId: playlistId,
          status: "pending" as const,
        })
      );

      setRecommendations(recs);
      setHasLoaded(true);
    } catch (err: any) {
      console.error("AI recommendation error:", err);
      toast.error("Failed to generate recommendations", {
        description: err.message || "Please try again.",
      });
    } finally {
      setLoading(false);
    }
  }, [playlistId, playlistName, playlistMood, playlistDescription, tracks, discoveryMode, acceptedSongs, dismissedSongs]);

  const recordAccepted = useCallback((track: Track) => {
    setAcceptedSongs((prev) => [...prev, { title: track.title, artist: track.artist }]);
  }, []);

  const recordDismissed = useCallback((track: Track) => {
    setDismissedSongs((prev) => [...prev, { title: track.title, artist: track.artist }]);
  }, []);

  return {
    recommendations,
    loading,
    hasLoaded,
    generate,
    setRecommendations,
    recordAccepted,
    recordDismissed,
  };
}
