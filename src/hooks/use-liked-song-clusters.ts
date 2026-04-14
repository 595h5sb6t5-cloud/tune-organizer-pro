import { useCallback, useEffect, useState, useRef } from "react";
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

export type AnalysisPhase =
  | "idle"
  | "tagging"
  | "defining_worlds"
  | "assigning"
  | "saving"
  | "validating"
  | "done";

export interface AnalysisProgress {
  totalAnalyzed: number;
  totalSongs: number;
  phase: AnalysisPhase;
  worldsCount: number;
  assignedCount: number;
  savedWorlds: number;
  totalWorlds: number;
  statusMessage: string;
}

const INITIAL_PROGRESS: AnalysisProgress = {
  totalAnalyzed: 0, totalSongs: 0, phase: "idle",
  worldsCount: 0, assignedCount: 0, savedWorlds: 0, totalWorlds: 0, statusMessage: "",
};

async function fetchAllFromTable(table: "liked_song_clusters" | "liked_song_cluster_tracks" | "liked_songs", userId: string, columns: string) {
  const all: any[] = [];
  let from = 0;
  while (true) {
    const { data } = await (supabase.from(table) as any).select(columns).eq("user_id", userId).range(from, from + 999);
    const rows = data || [];
    all.push(...rows);
    if (rows.length < 1000) break;
    from += 1000;
  }
  return all;
}

function mapJobPhase(phase: string): AnalysisPhase {
  const mapping: Record<string, AnalysisPhase> = {
    queued: "tagging",
    tagging: "tagging",
    defining_worlds: "defining_worlds",
    assigning: "assigning",
    saving: "saving",
    validating: "validating",
    done: "done",
    failed: "idle",
  };
  return mapping[phase] || "idle";
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
  const [progress, setProgress] = useState<AnalysisProgress>(INITIAL_PROGRESS);
  const jobIdRef = useRef<string | null>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadClusters = useCallback(async () => {
    if (!user || !spotifyConnected) { setClusters([]); return; }
    setLoading(true);

    const { count: totalSongs } = await supabase.from("liked_songs").select("id", { count: "exact", head: true }).eq("user_id", user.id);
    setLikedCount(totalSongs ?? 0);

    const clusterData = await fetchAllFromTable("liked_song_clusters", user.id,
      "id, name, description, vibe_description, ai_explanation, mood_tags, color_hex, energy_level, tempo_range, era_range, track_count, sort_order, cover_tracks, spotify_playlist_id, spotify_exported_at, spotify_playlist_url");

    if (!clusterData.length) {
      setClusters([]); setHasAnalyzed(false); setLoading(false); return;
    }

    const allTrackData = await fetchAllFromTable("liked_song_cluster_tracks", user.id, "id, cluster_id, liked_song_id, spotify_track_id");

    const likedSongIds = [...new Set(allTrackData.map(t => t.liked_song_id))];
    const songMap = new Map<string, any>();
    for (let i = 0; i < likedSongIds.length; i += 500) {
      const batch = likedSongIds.slice(i, i + 500);
      const { data: songs } = await supabase
        .from("liked_songs")
        .select("id, track_name, artist_name, album_name, image_url, mood, energy, atmosphere")
        .in("id", batch);
      for (const s of songs || []) songMap.set(s.id, s);
    }

    const enriched: LikedSongCluster[] = clusterData.map(c => {
      const clusterTracks = allTrackData
        .filter(t => t.cluster_id === c.id)
        .map(t => {
          const song = songMap.get(t.liked_song_id);
          return {
            id: t.id, liked_song_id: t.liked_song_id, spotify_track_id: t.spotify_track_id,
            track_name: song?.track_name || "Unknown", artist_name: song?.artist_name || "Unknown",
            album_name: song?.album_name || null, image_url: song?.image_url || null,
            mood: song?.mood || null, energy: song?.energy || null, atmosphere: song?.atmosphere || null,
          };
        });
      return {
        ...c, mood_tags: c.mood_tags || [],
        ai_explanation: c.ai_explanation ?? null,
        cover_tracks: (Array.isArray(c.cover_tracks) ? c.cover_tracks : []) as { image_url: string; track_name: string }[],
        spotify_playlist_id: c.spotify_playlist_id ?? null,
        spotify_exported_at: c.spotify_exported_at ?? null,
        spotify_playlist_url: c.spotify_playlist_url ?? null,
        tracks: clusterTracks,
      };
    });

    setClusters(enriched); setHasAnalyzed(true); setLoading(false);
  }, [user, spotifyConnected]);

  useEffect(() => { void loadClusters(); }, [loadClusters]);

  const stopPolling = useCallback(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  }, []);

  const startPolling = useCallback((jobId: string) => {
    stopPolling();

    const poll = async () => {
      try {
        const { data } = await supabase
          .from("playlist_generation_jobs")
          .select("status, phase, total_songs, total_analyzed, assigned_count, worlds_count, saved_worlds, total_worlds, status_message, error_message")
          .eq("id", jobId)
          .single();

        if (!data) return;

        setProgress({
          totalAnalyzed: data.total_analyzed,
          totalSongs: data.total_songs,
          phase: mapJobPhase(data.phase),
          worldsCount: data.worlds_count,
          assignedCount: data.assigned_count,
          savedWorlds: data.saved_worlds ?? 0,
          totalWorlds: data.total_worlds ?? 0,
          statusMessage: data.status_message || "Working…",
        });

        if (data.status === "completed") {
          stopPolling();
          setAnalyzing(false);
          setProgress(prev => ({ ...prev, phase: "done", statusMessage: "Playlists ready!" }));
          await loadClusters();
        } else if (data.status === "failed") {
          stopPolling();
          setAnalyzing(false);
          setError(data.error_message || "Pipeline failed");
          setProgress(INITIAL_PROGRESS);
        }
      } catch (e) {
        console.warn("Poll error:", e);
      }
    };

    poll();
    pollingRef.current = setInterval(poll, 2000);
  }, [stopPolling, loadClusters]);

  // Check for active job on mount
  useEffect(() => {
    if (!user) return undefined;
    let cancelled = false;
    const checkActiveJob = async () => {
      const { data } = await supabase
        .from("playlist_generation_jobs")
        .select("id, status, phase, total_songs, total_analyzed, assigned_count, worlds_count, saved_worlds, total_worlds, status_message, error_message")
        .eq("user_id", user.id)
        .in("status", ["pending", "running"])
        .order("created_at", { ascending: false })
        .limit(1);

      if (cancelled) return;

      if (data?.length) {
        const job = data[0];
        jobIdRef.current = job.id;
        setAnalyzing(true);
        setProgress({
          totalAnalyzed: job.total_analyzed,
          totalSongs: job.total_songs,
          phase: mapJobPhase(job.phase),
          worldsCount: job.worlds_count,
          assignedCount: job.assigned_count,
          savedWorlds: job.saved_worlds ?? 0,
          totalWorlds: job.total_worlds ?? 0,
          statusMessage: job.status_message || "Resuming…",
        });
        startPolling(job.id);
      }
    };
    checkActiveJob();
    return () => {
      cancelled = true;
      stopPolling();
    };
  }, [user, startPolling, stopPolling]);

  const runAnalysis = useCallback(async (options?: { forceRetag?: boolean }) => {
    if (!user) return;
    const forceRetag = options?.forceRetag ?? false;

    setAnalyzing(true);
    setError(null);
    setProgress({ ...INITIAL_PROGRESS, totalSongs: likedCount, phase: "tagging", statusMessage: "Starting deep analysis…" });

    try {
      const { data: job, error: jobErr } = await supabase
        .from("playlist_generation_jobs")
        .insert({
          user_id: user.id,
          force_retag: forceRetag,
          total_songs: likedCount,
          status: "pending",
          phase: "queued",
          status_message: "Queued…",
        })
        .select("id")
        .single();

      if (jobErr || !job) {
        throw new Error(jobErr?.message || "Failed to create job");
      }

      jobIdRef.current = job.id;

      // Start polling BEFORE invoking the function
      startPolling(job.id);

      // Invoke edge function — returns 202 immediately, work happens in background
      const { error: fnErr } = await supabase.functions.invoke("analyze-liked-songs", {
        body: { mode: "run_pipeline", job_id: job.id, force_retag: forceRetag, batch_size: 25 },
      });

      if (fnErr) {
        console.error("Pipeline invoke error:", fnErr);
      }

    } catch (e: any) {
      setError(e.message || "Analysis failed");
      setAnalyzing(false);
      stopPolling();
    }
  }, [user, likedCount, startPolling, stopPolling]);

  return { clusters, loading, analyzing, hasAnalyzed, error, likedCount, progress, runAnalysis, refresh: loadClusters };
}
