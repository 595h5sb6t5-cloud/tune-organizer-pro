import { useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { type Recommendation } from "@/lib/sample-data";
import { toast } from "sonner";
import { useAuth } from "./use-auth";

interface DiscoverCategory {
  id: string;
  title: string;
  subtitle: string;
  recommendations: Recommendation[];
}

interface FeedbackTrack {
  title: string;
  artist: string;
}

export function useDiscoverRecommendations() {
  const { user } = useAuth();
  const [categories, setCategories] = useState<DiscoverCategory[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [acceptedSongs, setAcceptedSongs] = useState<FeedbackTrack[]>([]);
  const [dismissedSongs, setDismissedSongs] = useState<FeedbackTrack[]>([]);

  const generate = useCallback(async (discoveryMode: string = "balanced") => {
    setLoading(true);
    try {
      // Fetch real imported tracks from DB
      let importedTracks: { track_name: string; artist_name: string; album_name: string | null }[] = [];
      if (user) {
        const { data } = await supabase
          .from("imported_tracks")
          .select("track_name, artist_name, album_name")
          .eq("user_id", user.id)
          .limit(200);
        importedTracks = data ?? [];
      }

      if (importedTracks.length === 0) {
        setCategories([]);
        setHasLoaded(true);
        setLoading(false);
        return;
      }

      const { data, error } = await supabase.functions.invoke("discover-recommendations", {
        body: {
          allPlaylists: [],
          allTracks: importedTracks.map((t) => ({
            title: t.track_name,
            artist: t.artist_name,
            album: t.album_name || "Unknown",
            genre: "Unknown",
            mood: "Unknown",
            tempo: 100,
            energy: 0.5,
          })),
          discoveryMode,
          acceptedSongs,
          dismissedSongs,
        },
      });

      if (error) {
        throw new Error(error.message || "Failed to get discover recommendations");
      }

      const cats: DiscoverCategory[] = (data.categories || []).map((cat: any) => ({
        id: cat.id,
        title: cat.title,
        subtitle: cat.subtitle,
        recommendations: (cat.recommendations || []).map((r: any, i: number) => ({
          id: `disc-${cat.id}-${i}-${Date.now()}`,
          track: {
            id: `disc-track-${cat.id}-${i}-${Date.now()}`,
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
          reason: r.reason || "AI-selected for you",
          moodTags: r.moodTags || [],
          popularityTier: r.popularityTier || "mid",
          compatibilityBreakdown: r.compatibilityBreakdown || null,
          targetPlaylistId: r.targetPlaylistId || undefined,
          targetPlaylistName: r.targetPlaylistName || undefined,
          status: "pending" as const,
        })),
      }));

      setCategories(cats);
      setHasLoaded(true);
    } catch (err: any) {
      console.error("Discover recommendation error:", err);
      toast.error("Failed to load recommendations", {
        description: err.message || "Please try again.",
      });
    } finally {
      setLoading(false);
    }
  }, [user, acceptedSongs, dismissedSongs]);

  const recordAccepted = useCallback((track: { title: string; artist: string }) => {
    setAcceptedSongs((prev) => [...prev, { title: track.title, artist: track.artist }]);
  }, []);

  const recordDismissed = useCallback((track: { title: string; artist: string }) => {
    setDismissedSongs((prev) => [...prev, { title: track.title, artist: track.artist }]);
  }, []);

  return {
    categories,
    loading,
    hasLoaded,
    generate,
    recordAccepted,
    recordDismissed,
  };
}
