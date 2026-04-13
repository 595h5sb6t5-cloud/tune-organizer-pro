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
      if (!user) { setLoading(false); return; }

      // Fetch imported tracks, liked songs, and playlist info in parallel
      const [importedRes, likedRes, playlistsRes, playlistTracksRes, historyRes] = await Promise.all([
        supabase.from("imported_tracks").select("track_name, artist_name, album_name").eq("user_id", user.id).limit(200),
        supabase.from("liked_songs").select("track_name, artist_name").eq("user_id", user.id).limit(500),
        supabase.from("spotify_playlists").select("spotify_playlist_id, name, description, track_count").eq("user_id", user.id),
        supabase.from("spotify_playlist_tracks").select("track_name, artist_name").eq("user_id", user.id).limit(1000),
        supabase.from("recommendation_history").select("track_title, track_artist").eq("user_id", user.id),
      ]);

      const importedTracks = importedRes.data ?? [];
      if (importedTracks.length === 0) {
        setCategories([]);
        setHasLoaded(true);
        setLoading(false);
        return;
      }

      // Build known songs set for exclusion
      const knownSongs: { title: string; artist: string }[] = [];
      for (const t of importedTracks) knownSongs.push({ title: t.track_name, artist: t.artist_name });
      for (const t of likedRes.data ?? []) knownSongs.push({ title: t.track_name, artist: t.artist_name });
      for (const t of playlistTracksRes.data ?? []) knownSongs.push({ title: t.track_name, artist: t.artist_name });
      for (const t of historyRes.data ?? []) knownSongs.push({ title: t.track_title, artist: t.track_artist });

      // Deduplicate
      const knownSet = new Set(knownSongs.map(s => `${s.title}|||${s.artist}`.toLowerCase()));
      const uniqueKnown = [...knownSet].slice(0, 500).map(k => {
        const [title, artist] = k.split("|||");
        return { title, artist };
      });

      const playlists = (playlistsRes.data ?? []).map(pl => ({
        id: pl.spotify_playlist_id,
        name: pl.name,
        description: pl.description || "",
        mood: "Mixed",
        avgTempo: 100,
        tracks: [],
      }));

      const { data, error } = await supabase.functions.invoke("discover-recommendations", {
        body: {
          allPlaylists: playlists,
          allTracks: importedTracks.map((t) => ({
            title: t.track_name,
            artist: t.artist_name,
            album: t.album_name || "Unknown",
            genre: "Unknown",
            mood: "Unknown",
            tempo: 100,
            energy: 0.5,
          })),
          knownSongs: uniqueKnown,
          discoveryMode,
          acceptedSongs,
          dismissedSongs,
        },
      });

      if (error) throw new Error(error.message || "Failed to get recommendations");

      // Post-filter: remove any recommendations that match known songs
      const cats: DiscoverCategory[] = (data.categories || []).map((cat: any) => ({
        id: cat.id,
        title: cat.title,
        subtitle: cat.subtitle,
        recommendations: (cat.recommendations || [])
          .filter((r: any) => !knownSet.has(`${r.title}|||${r.artist}`.toLowerCase()))
          .map((r: any, i: number) => ({
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
      toast.error("Failed to load recommendations", { description: err.message });
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

  return { categories, loading, hasLoaded, generate, recordAccepted, recordDismissed };
}
