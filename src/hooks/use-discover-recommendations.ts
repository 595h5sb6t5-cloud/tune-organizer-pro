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

export function useDiscoverRecommendations() {
  const { user } = useAuth();
  const [categories, setCategories] = useState<DiscoverCategory[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);

  const generate = useCallback(async (discoveryMode: string = "balanced") => {
    setLoading(true);
    try {
      if (!user) { setLoading(false); return; }

      // Fetch ALL relevant data in parallel for a rich taste model
      const [
        importedRes, likedRes, playlistsRes, playlistTracksRes,
        historyRes, clustersRes, vibeRes, tasteRes,
      ] = await Promise.all([
        supabase.from("imported_tracks").select("track_name, artist_name, album_name").eq("user_id", user.id),
        supabase.from("liked_songs").select("track_name, artist_name, album_name, genre_tags, mood, atmosphere, energy, production_style, era, audio_tempo, audio_energy, audio_valence, audio_danceability, audio_acousticness, audio_instrumentalness, audio_speechiness, audio_loudness, groove_feel, vocal_style, sonic_brightness, spatial_quality, rhythmic_identity, listening_context, sonic_texture, intimacy_scale, tension_level").eq("user_id", user.id),
        supabase.from("spotify_playlists").select("spotify_playlist_id, name, description, track_count").eq("user_id", user.id),
        supabase.from("spotify_playlist_tracks").select("track_name, artist_name").eq("user_id", user.id).limit(1000),
        supabase.from("recommendation_history").select("track_title, track_artist, status").eq("user_id", user.id),
        supabase.from("liked_song_clusters").select("name, vibe_description, mood_tags, energy_level, tempo_range, era_range, track_count").eq("user_id", user.id),
        supabase.from("playlist_vibe_analysis").select("primary_vibe, secondary_vibes, mood_summary, energy_summary, tempo_summary, production_summary, listening_context, emotional_keywords, genre_blend").eq("user_id", user.id),
        supabase.from("user_taste_profile").select("*").eq("user_id", user.id).maybeSingle(),
      ]);

      const importedTracks = importedRes.data ?? [];
      const likedSongs = likedRes.data ?? [];

      if (importedTracks.length === 0 && likedSongs.length === 0) {
        setCategories([]);
        setHasLoaded(true);
        setLoading(false);
        return;
      }

      // Build comprehensive known songs set
      const knownSet = new Set<string>();
      for (const t of importedTracks) knownSet.add(`${t.track_name}|||${t.artist_name}`.toLowerCase());
      for (const t of likedSongs) knownSet.add(`${t.track_name}|||${t.artist_name}`.toLowerCase());
      for (const t of playlistTracksRes.data ?? []) knownSet.add(`${t.track_name}|||${t.artist_name}`.toLowerCase());
      for (const t of historyRes.data ?? []) knownSet.add(`${t.track_title}|||${t.track_artist}`.toLowerCase());

      const knownSongs = [...knownSet].slice(0, 600).map(k => {
        const [title, artist] = k.split("|||");
        return { title, artist };
      });

      // Compute audio feature averages from liked songs
      const audioSongs = likedSongs.filter(s => s.audio_tempo != null);
      const audioProfile = audioSongs.length > 0 ? {
        count: audioSongs.length,
        avgTempo: +(audioSongs.reduce((a, s) => a + (s.audio_tempo || 0), 0) / audioSongs.length).toFixed(1),
        avgEnergy: +(audioSongs.reduce((a, s) => a + (s.audio_energy || 0), 0) / audioSongs.length).toFixed(3),
        avgValence: +(audioSongs.reduce((a, s) => a + (s.audio_valence || 0), 0) / audioSongs.length).toFixed(3),
        avgDanceability: +(audioSongs.reduce((a, s) => a + (s.audio_danceability || 0), 0) / audioSongs.length).toFixed(3),
        avgAcousticness: +(audioSongs.reduce((a, s) => a + (s.audio_acousticness || 0), 0) / audioSongs.length).toFixed(3),
        avgInstrumentalness: +(audioSongs.reduce((a, s) => a + (s.audio_instrumentalness || 0), 0) / audioSongs.length).toFixed(3),
        avgLoudness: +(audioSongs.reduce((a, s) => a + (s.audio_loudness || 0), 0) / audioSongs.length).toFixed(1),
        tempoRange: [
          Math.min(...audioSongs.map(s => s.audio_tempo || 120)),
          Math.max(...audioSongs.map(s => s.audio_tempo || 120)),
        ],
        energyRange: [
          +Math.min(...audioSongs.map(s => s.audio_energy || 0.5)).toFixed(2),
          +Math.max(...audioSongs.map(s => s.audio_energy || 0.5)).toFixed(2),
        ],
      } : null;

      // Aggregate mood/genre/atmosphere from liked songs
      const moodCounts: Record<string, number> = {};
      const atmosphereCounts: Record<string, number> = {};
      const prodStyleCounts: Record<string, number> = {};
      const eraCounts: Record<string, number> = {};
      const genreTagCounts: Record<string, number> = {};
      const artistCounts: Record<string, number> = {};

      for (const s of likedSongs) {
        if (s.mood) moodCounts[s.mood] = (moodCounts[s.mood] || 0) + 1;
        if (s.atmosphere) atmosphereCounts[s.atmosphere] = (atmosphereCounts[s.atmosphere] || 0) + 1;
        if (s.production_style) prodStyleCounts[s.production_style] = (prodStyleCounts[s.production_style] || 0) + 1;
        if (s.era) eraCounts[s.era] = (eraCounts[s.era] || 0) + 1;
        artistCounts[s.artist_name] = (artistCounts[s.artist_name] || 0) + 1;
        for (const g of s.genre_tags || []) genreTagCounts[g] = (genreTagCounts[g] || 0) + 1;
      }
      for (const t of importedTracks) {
        artistCounts[t.artist_name] = (artistCounts[t.artist_name] || 0) + 1;
      }

      const topN = (obj: Record<string, number>, n: number) =>
        Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, n).map(e => e[0]);

      // Feedback history
      const history = historyRes.data ?? [];
      const acceptedHistory = history.filter(h => h.status === "accepted").map(h => ({ title: h.track_title, artist: h.track_artist }));
      const dismissedHistory = history.filter(h => h.status === "dismissed").map(h => ({ title: h.track_title, artist: h.track_artist }));

      // Build the playlists summary
      const playlists = (playlistsRes.data ?? []).map(pl => ({
        id: pl.spotify_playlist_id,
        name: pl.name,
        description: pl.description || "",
        trackCount: pl.track_count,
      }));

      const { data, error } = await supabase.functions.invoke("discover-recommendations", {
        body: {
          discoveryMode,
          knownSongs,
          playlists,
          audioProfile,
          tasteSignals: {
            topGenres: topN(genreTagCounts, 10),
            topMoods: topN(moodCounts, 6),
            topAtmospheres: topN(atmosphereCounts, 5),
            topProductionStyles: topN(prodStyleCounts, 5),
            topEras: topN(eraCounts, 4),
            topArtists: topN(artistCounts, 15),
          },
          clusters: (clustersRes.data ?? []).map(c => ({
            name: c.name,
            vibe: c.vibe_description,
            moods: c.mood_tags,
            energy: c.energy_level,
            tempo: c.tempo_range,
            era: c.era_range,
            trackCount: c.track_count,
          })),
          playlistVibes: (vibeRes.data ?? []).map(v => ({
            primaryVibe: v.primary_vibe,
            secondaryVibes: v.secondary_vibes,
            moodSummary: v.mood_summary,
            energySummary: v.energy_summary,
            tempoSummary: v.tempo_summary,
            productionSummary: v.production_summary,
            listeningContext: v.listening_context,
            emotionalKeywords: v.emotional_keywords,
            genreBlend: v.genre_blend,
          })),
          userTasteProfile: tasteRes.data || null,
          acceptedHistory: acceptedHistory.slice(-15),
          dismissedHistory: dismissedHistory.slice(-15),
          sampleTracks: likedSongs.slice(0, 30).map(s => ({
            title: s.track_name,
            artist: s.artist_name,
            album: s.album_name,
            mood: s.mood,
            atmosphere: s.atmosphere,
            energy: s.energy,
            production: s.production_style,
            tempo: s.audio_tempo,
            audioEnergy: s.audio_energy,
            valence: s.audio_valence,
            danceability: s.audio_danceability,
            acousticness: s.audio_acousticness,
            grooveFeel: (s as any).groove_feel,
            vocalStyle: (s as any).vocal_style,
            sonicBrightness: (s as any).sonic_brightness,
            spatialQuality: (s as any).spatial_quality,
            rhythmicIdentity: (s as any).rhythmic_identity,
            listeningContext: (s as any).listening_context,
            sonicTexture: (s as any).sonic_texture,
            intimacyScale: (s as any).intimacy_scale,
            tensionLevel: (s as any).tension_level,
          })),
        },
      });

      if (error) throw new Error(error.message || "Failed to get recommendations");

      // Post-filter: remove any that match known songs
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
            aiExplanation: r.aiExplanation || null,
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
  }, [user]);

  const recordFeedback = useCallback(async (
    track: { title: string; artist: string; album?: string },
    status: "accepted" | "dismissed",
    rec?: Recommendation,
  ) => {
    if (!user) return;
    try {
      await supabase.from("recommendation_history").insert([{
        user_id: user.id,
        track_title: track.title,
        track_artist: track.artist,
        track_album: track.album || null,
        status,
        discovery_mode: "discover",
        reason: rec?.reason || null,
        mood_tags: rec?.moodTags || null,
        compatibility_score: rec?.matchScore || null,
        popularity_tier: rec?.popularityTier || null,
        compatibility_breakdown: rec?.compatibilityBreakdown as any || null,
      }]);

      // Update taste profile counters
      const isAccepted = status === "accepted";
      const { data: existing } = await supabase
        .from("user_taste_profile")
        .select("id, accepted_count, dismissed_count")
        .eq("user_id", user.id)
        .maybeSingle();
      if (existing) {
        await supabase.from("user_taste_profile").update(
          isAccepted
            ? { accepted_count: (existing.accepted_count || 0) + 1 }
            : { dismissed_count: (existing.dismissed_count || 0) + 1 }
        ).eq("id", existing.id);
      } else {
        await supabase.from("user_taste_profile").insert([
          isAccepted
            ? { user_id: user.id, accepted_count: 1 }
            : { user_id: user.id, dismissed_count: 1 }
        ]);
      }
    } catch (e) {
      console.error("Failed to record feedback:", e);
    }
  }, [user]);

  return { categories, loading, hasLoaded, generate, recordFeedback };
}
