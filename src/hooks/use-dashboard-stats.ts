import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./use-auth";

export interface TopArtist {
  name: string;
  count: number;
}

export interface GenreCount {
  genre: string;
  count: number;
}

export interface MoodCount {
  mood: string;
  count: number;
}

export interface EnergyCount {
  energy: string;
  count: number;
}

export interface TempoCount {
  tempo: string;
  count: number;
}

export interface AtmosphereCount {
  atmosphere: string;
  count: number;
}

export interface ClusterInfo {
  name: string;
  description: string | null;
  vibe_description: string | null;
  mood_tags: string[];
  energy_level: string | null;
  color_hex: string;
  track_count: number;
}

export interface DashboardStats {
  // Library overview
  totalLikedSongs: number;
  totalPlaylists: number;
  totalFollowedArtists: number;
  totalAnalyzedSongs: number;
  totalClusters: number;
  uniqueArtists: number;

  // Top artists
  topArtists: TopArtist[];

  // Genres
  topGenres: GenreCount[];

  // Moods
  moods: MoodCount[];

  // Energy distribution
  energyLevels: EnergyCount[];

  // Tempo distribution
  tempos: TempoCount[];

  // Atmospheres
  atmospheres: AtmosphereCount[];

  // Clusters / sonic worlds
  clusters: ClusterInfo[];

  // Discovery stats
  totalRecommendations: number;
  acceptedRecommendations: number;
  dismissedRecommendations: number;

  // Audio feature averages
  avgTempo: number | null;
  avgEnergy: number | null;
  avgValence: number | null;
  avgDanceability: number | null;
  avgAcousticness: number | null;
  hasAudioFeatures: boolean;

  // Library timeline
  songsThisMonth: number;
  recentArtists: string[];
}

const EMPTY_STATS: DashboardStats = {
  totalLikedSongs: 0,
  totalPlaylists: 0,
  totalFollowedArtists: 0,
  totalAnalyzedSongs: 0,
  totalClusters: 0,
  uniqueArtists: 0,
  topArtists: [],
  topGenres: [],
  moods: [],
  energyLevels: [],
  tempos: [],
  atmospheres: [],
  clusters: [],
  totalRecommendations: 0,
  acceptedRecommendations: 0,
  dismissedRecommendations: 0,
  avgTempo: null,
  avgEnergy: null,
  avgValence: null,
  avgDanceability: null,
  avgAcousticness: null,
  hasAudioFeatures: false,
  songsThisMonth: 0,
  recentArtists: [],
};

/** Normalize genre/mood strings for grouping: lowercase, trim */
function normalizeTag(tag: string): string {
  return tag.trim().toLowerCase().replace(/,\s*/g, ", ");
}

/** Group and count tags, merging case variants */
function countTags(rows: { tag: string }[]): { tag: string; count: number }[] {
  const map = new Map<string, { display: string; count: number }>();
  for (const { tag } of rows) {
    const key = normalizeTag(tag);
    const existing = map.get(key);
    if (existing) {
      existing.count++;
    } else {
      // Use first occurrence as display form
      map.set(key, { display: tag.trim(), count: 1 });
    }
  }
  return Array.from(map.values())
    .sort((a, b) => b.count - a.count)
    .map(v => ({ tag: v.display, count: v.count }));
}

export function useDashboardStats() {
  const { user, profile } = useAuth();
  const spotifyConnected = profile?.spotify_connected ?? false;
  const [stats, setStats] = useState<DashboardStats>(EMPTY_STATS);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!user || !spotifyConnected) {
      setStats(EMPTY_STATS);
      return;
    }

    setLoading(true);

    try {
      // Parallel fetch all data
      const [
        likedCountRes,
        playlistCountRes,
        followedArtistCountRes,
        analyzedCountRes,
        clusterCountRes,
        artistsRes,
        genresRes,
        moodsRes,
        energyRes,
        temposRes,
        atmospheresRes,
        clustersRes,
        recsRes,
        audioAvgRes,
        thisMonthRes,
        recentArtistsRes,
      ] = await Promise.all([
        supabase.from("liked_songs").select("id", { count: "exact", head: true }).eq("user_id", user.id),
        supabase.from("spotify_playlists").select("id", { count: "exact", head: true }).eq("user_id", user.id),
        supabase.from("spotify_followed_artists").select("id", { count: "exact", head: true }).eq("user_id", user.id),
        supabase.from("liked_songs").select("id", { count: "exact", head: true }).eq("user_id", user.id).not("analyzed_at", "is", null),
        supabase.from("liked_song_clusters").select("id", { count: "exact", head: true }).eq("user_id", user.id),
        // Top artists: fetch all artist names to count
        supabase.from("liked_songs").select("artist_name").eq("user_id", user.id),
        // Genres
        supabase.from("liked_songs").select("genre_tags").eq("user_id", user.id).not("genre_tags", "is", null),
        // Moods
        supabase.from("liked_songs").select("mood").eq("user_id", user.id).not("mood", "is", null),
        // Energy
        supabase.from("liked_songs").select("energy").eq("user_id", user.id).not("energy", "is", null),
        // Tempo estimates
        supabase.from("liked_songs").select("tempo_estimate").eq("user_id", user.id).not("tempo_estimate", "is", null),
        // Atmospheres
        supabase.from("liked_songs").select("atmosphere").eq("user_id", user.id).not("atmosphere", "is", null),
        // Clusters
        supabase.from("liked_song_clusters").select("name, description, vibe_description, mood_tags, energy_level, color_hex, track_count").eq("user_id", user.id).order("track_count", { ascending: false }).limit(10),
        // Recommendation stats
        supabase.from("recommendation_history").select("status").eq("user_id", user.id),
        // Audio features - fetch raw values to compute averages client-side
        supabase.from("liked_songs").select("audio_tempo, audio_energy, audio_valence, audio_danceability, audio_acousticness").eq("user_id", user.id).not("audio_features_fetched_at", "is", null).limit(1000),
        // Songs this month
        supabase.from("liked_songs").select("id", { count: "exact", head: true }).eq("user_id", user.id).gte("added_at", new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString()),
        // Recent new artists (last 30 days)
        supabase.from("liked_songs").select("artist_name").eq("user_id", user.id).gte("added_at", new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()).order("added_at", { ascending: false }).limit(100),
      ]);

      // Count artists
      const artistCounts = new Map<string, number>();
      for (const row of artistsRes.data || []) {
        // Handle multi-artist strings
        const names = (row.artist_name as string).split(", ");
        for (const name of names) {
          const key = name.trim().toLowerCase();
          artistCounts.set(key, (artistCounts.get(key) || 0) + 1);
        }
      }
      const topArtists = Array.from(artistCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 15)
        .map(([name, count]) => ({
          name: name.split(" ").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" "),
          count,
        }));

      // Count genres (flatten arrays)
      const genreRows: { tag: string }[] = [];
      for (const row of genresRes.data || []) {
        const tags = row.genre_tags as string[] | null;
        if (tags) {
          for (const t of tags) {
            if (t) genreRows.push({ tag: t });
          }
        }
      }
      const topGenres = countTags(genreRows).slice(0, 12).map(g => ({ genre: g.tag, count: g.count }));

      // Count moods
      const moodRows = (moodsRes.data || []).map(r => ({ tag: r.mood as string }));
      const moods = countTags(moodRows).slice(0, 10).map(m => ({ mood: m.tag, count: m.count }));

      // Count energy
      const energyRows = (energyRes.data || []).map(r => ({ tag: r.energy as string }));
      const energyLevels = countTags(energyRows).slice(0, 6).map(e => ({ energy: e.tag, count: e.count }));

      // Count tempos
      const tempoRows = (temposRes.data || []).map(r => ({ tag: r.tempo_estimate as string }));
      const tempos = countTags(tempoRows).slice(0, 8).map(t => ({ tempo: t.tag, count: t.count }));

      // Count atmospheres
      const atmosphereRows = (atmospheresRes.data || []).map(r => ({ tag: r.atmosphere as string }));
      const atmospheres = countTags(atmosphereRows).slice(0, 8).map(a => ({ atmosphere: a.tag, count: a.count }));

      // Clusters
      const clusters: ClusterInfo[] = (clustersRes.data || []).map((c: any) => ({
        name: c.name,
        description: c.description,
        vibe_description: c.vibe_description,
        mood_tags: c.mood_tags || [],
        energy_level: c.energy_level,
        color_hex: c.color_hex || "#6366f1",
        track_count: c.track_count,
      }));

      // Recommendation stats
      const recs = recsRes.data || [];
      const totalRecommendations = recs.length;
      const acceptedRecommendations = recs.filter((r: any) => r.status === "accepted").length;
      const dismissedRecommendations = recs.filter((r: any) => r.status === "dismissed").length;

      // Audio feature averages
      const audioData = audioAvgRes.data || [];
      let avgTempo: number | null = null;
      let avgEnergy: number | null = null;
      let avgValence: number | null = null;
      let avgDanceability: number | null = null;
      let avgAcousticness: number | null = null;

      if (audioData.length > 0) {
        const sum = (key: string) => {
          const vals = audioData.map((r: any) => r[key]).filter((v: any) => v != null) as number[];
          return vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
        };
        avgTempo = sum("audio_tempo");
        avgEnergy = sum("audio_energy");
        avgValence = sum("audio_valence");
        avgDanceability = sum("audio_danceability");
        avgAcousticness = sum("audio_acousticness");
      }

      // Recent artists
      const recentArtistSet = new Set<string>();
      for (const row of recentArtistsRes.data || []) {
        recentArtistSet.add(row.artist_name as string);
      }

      setStats({
        totalLikedSongs: likedCountRes.count ?? 0,
        totalPlaylists: playlistCountRes.count ?? 0,
        totalFollowedArtists: followedArtistCountRes.count ?? 0,
        totalAnalyzedSongs: analyzedCountRes.count ?? 0,
        totalClusters: clusterCountRes.count ?? 0,
        uniqueArtists: artistCounts.size,
        topArtists,
        topGenres,
        moods,
        energyLevels,
        tempos,
        atmospheres,
        clusters,
        totalRecommendations,
        acceptedRecommendations,
        dismissedRecommendations,
        avgTempo,
        avgEnergy,
        avgValence,
        avgDanceability,
        avgAcousticness,
        hasAudioFeatures: audioData.length > 0,
        songsThisMonth: thisMonthRes.count ?? 0,
        recentArtists: Array.from(recentArtistSet).slice(0, 10),
      });
    } catch (e) {
      console.error("[useDashboardStats] Failed to load stats:", e);
    } finally {
      setLoading(false);
    }
  }, [user, spotifyConnected]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { stats, loading, refresh };
}
