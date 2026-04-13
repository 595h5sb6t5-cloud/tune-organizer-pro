import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./use-auth";


export interface LikedSongCluster {
  id: string;
  name: string;
  description: string | null;
  vibe_description: string | null;
  ai_explanation: string | null;
  mood_tags: string[];
  color_hex: string;
  energy_level: string | null;
  tempo_range: string | null;
  era_range: string | null;
  track_count: number;
  cover_tracks: { image_url: string; track_name: string }[];
  sort_order: number;
  tracks: ClusterTrack[];
  spotify_playlist_id: string | null;
  spotify_exported_at: string | null;
  spotify_playlist_url: string | null;
}

export interface ClusterTrack {
  id: string;
  liked_song_id: string;
  spotify_track_id: string;
  track_name: string;
  artist_name: string;
  album_name: string | null;
  image_url: string | null;
  mood: string | null;
  energy: string | null;
  atmosphere: string | null;
}

export interface AnalysisProgress {
  totalAnalyzed: number;
  totalSongs: number;
  phase: "idle" | "clustering" | "tagging" | "done";
}

export function useLikedSongClusters() {
  const { user, profile } = useAuth();
  const spotifyConnected = profile?.spotify_connected ?? false;

  const [clusters, setClusters] = useState<LikedSongCluster[]>([]);
  const [loading, setLoading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [hasAnalyzed, setHasAnalyzed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [likedCount, setLikedCount] = useState(0);
  const [progress, setProgress] = useState<AnalysisProgress>({ totalAnalyzed: 0, totalSongs: 0, phase: "idle" });

  const loadClusters = useCallback(async () => {
    if (!user || !spotifyConnected) {
      setClusters([]);
      return;
    }

    setLoading(true);

    // Get liked count + analyzed count in parallel
    const [countRes, analyzedRes] = await Promise.all([
      supabase.from("liked_songs").select("id", { count: "exact", head: true }).eq("user_id", user.id),
      supabase.from("liked_songs").select("id", { count: "exact", head: true }).eq("user_id", user.id).not("analyzed_at", "is", null),
    ]);
    const totalSongs = countRes.count ?? 0;
    const totalAnalyzed = analyzedRes.count ?? 0;
    setLikedCount(totalSongs);
    setProgress(prev => ({ ...prev, totalAnalyzed, totalSongs }));

    // Get clusters
    const { data: clusterData } = await supabase
      .from("liked_song_clusters")
      .select("id, name, description, vibe_description, ai_explanation, mood_tags, color_hex, energy_level, tempo_range, era_range, track_count, sort_order, cover_tracks, spotify_playlist_id, spotify_exported_at, spotify_playlist_url")
      .eq("user_id", user.id)
      .order("sort_order");

    if (!clusterData || clusterData.length === 0) {
      setClusters([]);
      setHasAnalyzed(false);
      setLoading(false);
      return;
    }

    // Get cluster tracks with song details
    const clusterIds = clusterData.map(c => c.id);
    const { data: trackData } = await supabase
      .from("liked_song_cluster_tracks")
      .select("id, cluster_id, liked_song_id, spotify_track_id")
      .eq("user_id", user.id)
      .in("cluster_id", clusterIds);

    // Get liked song details for the tracks
    const likedSongIds = [...new Set((trackData || []).map(t => t.liked_song_id))];
    
    let songMap = new Map<string, any>();
    if (likedSongIds.length > 0) {
      for (let i = 0; i < likedSongIds.length; i += 100) {
        const batch = likedSongIds.slice(i, i + 100);
        const { data: songs } = await supabase
          .from("liked_songs")
          .select("id, track_name, artist_name, album_name, image_url, mood, energy, atmosphere")
          .in("id", batch);
        for (const s of songs || []) songMap.set(s.id, s);
      }
    }

    // Build enriched clusters
    const enriched: LikedSongCluster[] = clusterData.map(c => {
      const clusterTracks = (trackData || [])
        .filter(t => t.cluster_id === c.id)
        .map(t => {
          const song = songMap.get(t.liked_song_id);
          return {
            id: t.id,
            liked_song_id: t.liked_song_id,
            spotify_track_id: t.spotify_track_id,
            track_name: song?.track_name || "Unknown",
            artist_name: song?.artist_name || "Unknown",
            album_name: song?.album_name || null,
            image_url: song?.image_url || null,
            mood: song?.mood || null,
            energy: song?.energy || null,
            atmosphere: song?.atmosphere || null,
          };
        });

      return {
        ...c,
        mood_tags: c.mood_tags || [],
        ai_explanation: c.ai_explanation ?? null,
        cover_tracks: (Array.isArray(c.cover_tracks) ? c.cover_tracks : []) as { image_url: string; track_name: string }[],
        spotify_playlist_id: (c as any).spotify_playlist_id ?? null,
        spotify_exported_at: (c as any).spotify_exported_at ?? null,
        spotify_playlist_url: (c as any).spotify_playlist_url ?? null,
        tracks: clusterTracks,
      };
    });

    setClusters(enriched);
    setHasAnalyzed(true);
    setLoading(false);
  }, [user, spotifyConnected]);

  useEffect(() => {
    void loadClusters();
  }, [loadClusters]);

  const runAnalysis = useCallback(async (options?: { forceRetag?: boolean }) => {
    if (!user) return;
    const forceRetag = options?.forceRetag ?? false;

    setAnalyzing(true);
    setError(null);
    setProgress({ totalAnalyzed: 0, totalSongs: likedCount, phase: forceRetag ? "tagging" : "clustering" });

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData.session?.access_token) {
        throw new Error("Session expired. Please sign in again.");
      }

      if (forceRetag) {
        // Phase 1: Force re-tag all songs with deep analysis (clears old tags + clusters)
        let done = false;
        let batchNum = 0;
        const maxBatches = 80;

        while (!done && batchNum < maxBatches) {
          batchNum++;
          const tagRes = await supabase.functions.invoke("analyze-liked-songs", {
            body: {
              mode: "tag_only",
              batch_size: 150,
              ...(batchNum === 1 ? { force_retag: true } : {}),
            },
          });

          if (tagRes.error) {
            console.error("Tag batch error:", tagRes.error);
            break;
          }
          if (tagRes.data?.error) {
            console.error("Tag batch data error:", tagRes.data.error);
            break;
          }

          const tagData = tagRes.data;
          done = tagData?.done ?? true;

          setProgress({
            totalAnalyzed: tagData?.total_analyzed ?? 0,
            totalSongs: tagData?.total_liked_songs ?? likedCount,
            phase: done ? "clustering" : "tagging",
          });

          console.log(`[rebuild] tag batch ${batchNum}: ${tagData?.total_analyzed}/${tagData?.total_liked_songs} analyzed, done=${done}`);
        }

        // Phase 2: Re-cluster with deep tags
        setProgress(prev => ({ ...prev, phase: "clustering" }));
        const clusterRes = await supabase.functions.invoke("analyze-liked-songs");
        if (clusterRes.error) {
          throw new Error(clusterRes.error.message || "Clustering failed");
        }
        if (clusterRes.data?.error) {
          throw new Error(clusterRes.data.error);
        }
        setProgress(prev => ({ ...prev, phase: "done" }));
      } else {
        // Standard flow: cluster first, then tag remaining
        const clusterRes = await supabase.functions.invoke("analyze-liked-songs");
        
        if (clusterRes.error) {
          throw new Error(clusterRes.error.message || "Analysis failed");
        }
        if (clusterRes.data?.error) {
          throw new Error(clusterRes.data.error);
        }

        const clusterData = clusterRes.data;
        setProgress({
          totalAnalyzed: clusterData?.total_analyzed ?? 0,
          totalSongs: clusterData?.total_liked_songs ?? likedCount,
          phase: "tagging",
        });

        // Tag remaining unanalyzed songs in batches
        if (!clusterData?.done) {
          let done = false;
          let batchNum = 0;
          const maxBatches = 50;

          while (!done && batchNum < maxBatches) {
            batchNum++;
            const tagRes = await supabase.functions.invoke("analyze-liked-songs", {
              body: { mode: "tag_only", batch_size: 150 },
            });

            if (tagRes.error) {
              console.error("Tag batch error:", tagRes.error);
              break;
            }
            if (tagRes.data?.error) {
              console.error("Tag batch data error:", tagRes.data.error);
              break;
            }

            const tagData = tagRes.data;
            done = tagData?.done ?? true;

            setProgress({
              totalAnalyzed: tagData?.total_analyzed ?? 0,
              totalSongs: tagData?.total_liked_songs ?? likedCount,
              phase: done ? "done" : "tagging",
            });

            console.log(`[analyze] batch ${batchNum}: ${tagData?.total_analyzed}/${tagData?.total_liked_songs} analyzed, done=${done}`);
          }
        } else {
          setProgress(prev => ({ ...prev, phase: "done" }));
        }
      }

      await loadClusters();
    } catch (e: any) {
      setError(e.message || "Analysis failed");
    } finally {
      setAnalyzing(false);
    }
  }, [user, loadClusters, likedCount]);

  return {
    clusters,
    loading,
    analyzing,
    hasAnalyzed,
    error,
    likedCount,
    progress,
    runAnalysis,
    refresh: loadClusters,
  };
}
