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
  | "queued"
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

const QUEUED_RETRY_MS = 15_000;
const QUEUED_TIMEOUT_MS = 60_000;
const PROCESSOR_REQUEST_TIMEOUT_MS = 60_000;
const RUNNING_STALE_MS = 60_000;
const RUNNING_RESUME_MAX = 8;

type JobSnapshot = {
  status: string;
  phase: string;
  total_songs: number;
  total_analyzed: number;
  assigned_count: number;
  worlds_count: number;
  saved_worlds: number | null;
  total_worlds: number | null;
  status_message: string | null;
  error_message: string | null;
  created_at: string;
  started_at: string | null;
  updated_at: string;
  force_retag?: boolean;
};

async function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(message)), ms);
      }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

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

function mapJobPhase(phase: string, status?: string): AnalysisPhase {
  if (status === "pending") return "queued";
  const mapping: Record<string, AnalysisPhase> = {
    queued: "queued",
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
  const retryAttemptsRef = useRef<Record<string, number>>({});
  const retryInFlightRef = useRef<string | null>(null);
  const forceRetagRef = useRef(false);

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

  const clearLocalJobState = useCallback(() => {
    jobIdRef.current = null;
    retryInFlightRef.current = null;
    setAnalyzing(false);
  }, []);

  const markJobFailed = useCallback(async (jobId: string, message: string) => {
    await supabase
      .from("playlist_generation_jobs")
      .update({
        status: "failed",
        phase: "failed",
        status_message: "Generation failed to start.",
        error_message: message,
        completed_at: new Date().toISOString(),
      } as never)
      .eq("id", jobId);
  }, []);

  const triggerPipeline = useCallback(async (jobId: string, forceRetag: boolean, isRetry = false) => {
    const body = { mode: "run_pipeline", job_id: jobId, force_retag: forceRetag, batch_size: 10 };
    const { data: { session } } = await supabase.auth.getSession();

    if (!session?.access_token) {
      throw new Error("Your session expired. Please sign in again.");
    }

    try {
      const result = await withTimeout(
        supabase.functions.invoke("analyze-liked-songs", { body }),
        PROCESSOR_REQUEST_TIMEOUT_MS,
        "Timed out while contacting the playlist processor.",
      );

      if (result.error) {
        throw new Error(result.error.message || "Failed to contact the playlist processor.");
      }

      if ((result.data as { error?: string } | null)?.error) {
        throw new Error((result.data as { error?: string }).error || "Failed to start playlist generation.");
      }

      return;
    } catch (invokeError) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), PROCESSOR_REQUEST_TIMEOUT_MS);

      try {
        const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/analyze-liked-songs`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });

        let payload: { error?: string } | null = null;
        try {
          payload = await response.json();
        } catch {
          payload = null;
        }

        if (!response.ok || payload?.error) {
          throw new Error(payload?.error || `Processor returned ${response.status}`);
        }
      } catch (fetchError) {
        const fallbackMessage = fetchError instanceof Error
          ? (fetchError.name === "AbortError"
            ? "Timed out while contacting the playlist processor."
            : fetchError.message)
          : (invokeError instanceof Error ? invokeError.message : "Failed to contact the playlist processor.");

        throw new Error(isRetry ? `Retry failed: ${fallbackMessage}` : fallbackMessage);
      } finally {
        clearTimeout(timeoutId);
      }
    }
  }, []);

  const syncProgressFromJob = useCallback((data: JobSnapshot) => {
    setProgress({
      totalAnalyzed: data.total_analyzed,
      totalSongs: data.total_songs,
      phase: mapJobPhase(data.phase, data.status),
      worldsCount: data.worlds_count,
      assignedCount: data.assigned_count,
      savedWorlds: data.saved_worlds ?? 0,
      totalWorlds: data.total_worlds ?? 0,
      statusMessage: data.status_message || "Working…",
    });
  }, []);

  const startPolling = useCallback((jobId: string, fallbackForceRetag = false) => {
    stopPolling();

    const poll = async () => {
      try {
        const { data, error: pollError } = await supabase
          .from("playlist_generation_jobs")
          .select("status, phase, total_songs, total_analyzed, assigned_count, worlds_count, saved_worlds, total_worlds, status_message, error_message, created_at, started_at, updated_at, force_retag")
          .eq("id", jobId)
          .single();

        if (pollError || !data) {
          throw new Error(pollError?.message || "Generation job not found.");
        }

        const job = data as JobSnapshot;
        forceRetagRef.current = job.force_retag ?? fallbackForceRetag;
        syncProgressFromJob(job);

        if (job.status === "pending") {
          const queuedForMs = Date.now() - new Date(job.created_at).getTime();
          const attempts = retryAttemptsRef.current[jobId] ?? 0;

          if (!job.started_at && queuedForMs >= QUEUED_TIMEOUT_MS) {
            const message = "The backend processor did not start within 20 seconds. Please retry generation.";
            await markJobFailed(jobId, message);
            stopPolling();
            clearLocalJobState();
            setError(message);
            setProgress(INITIAL_PROGRESS);
            return;
          }

          if (!job.started_at && queuedForMs >= QUEUED_RETRY_MS && attempts < 1 && retryInFlightRef.current !== jobId) {
            retryInFlightRef.current = jobId;
            retryAttemptsRef.current[jobId] = attempts + 1;

            await supabase
              .from("playlist_generation_jobs")
              .update({ status_message: "Retrying backend processor…", error_message: null } as never)
              .eq("id", jobId);

            try {
              await triggerPipeline(jobId, forceRetagRef.current, true);
            } catch (retryError) {
              console.error("Retry start error:", retryError);
            } finally {
              retryInFlightRef.current = null;
            }
          }

          return;
        }

        if (job.status === "running") {
          const resumeKey = `${jobId}:running`;
          const staleForMs = Date.now() - new Date(job.updated_at).getTime();
          const resumeAttempts = retryAttemptsRef.current[resumeKey] ?? 0;

          if (staleForMs >= RUNNING_STALE_MS && resumeAttempts < RUNNING_RESUME_MAX && retryInFlightRef.current !== jobId) {
            retryInFlightRef.current = jobId;
            retryAttemptsRef.current[resumeKey] = resumeAttempts + 1;

            await supabase
              .from("playlist_generation_jobs")
              .update({ status_message: "Resuming backend processor…", error_message: null } as never)
              .eq("id", jobId);

            try {
              await triggerPipeline(jobId, forceRetagRef.current, true);
            } catch (resumeError) {
              console.error("Resume start error:", resumeError);
            } finally {
              retryInFlightRef.current = null;
            }
          }
        }

        if (job.status === "completed") {
          stopPolling();
          clearLocalJobState();
          setProgress(prev => ({ ...prev, phase: "done", statusMessage: "Playlists ready!" }));
          await loadClusters();
        } else if (job.status === "failed" || job.status === "cancelled") {
          stopPolling();
          clearLocalJobState();
          setError(job.status === "cancelled" ? "Generation cancelled." : (job.error_message || "Pipeline failed"));
          setProgress(INITIAL_PROGRESS);
        }
      } catch (e) {
        console.warn("Poll error:", e);
      }
    };

    poll();
    pollingRef.current = setInterval(poll, 2000);
  }, [clearLocalJobState, loadClusters, markJobFailed, stopPolling, syncProgressFromJob, triggerPipeline]);

  const cancelAnalysis = useCallback(async () => {
    if (!jobIdRef.current) return;

    await supabase
      .from("playlist_generation_jobs")
      .update({
        status: "cancelled",
        phase: "failed",
        status_message: "Generation cancelled.",
        error_message: null,
        completed_at: new Date().toISOString(),
      } as never)
      .eq("id", jobIdRef.current);

    stopPolling();
    clearLocalJobState();
    setError(null);
    setProgress(INITIAL_PROGRESS);
  }, [clearLocalJobState, stopPolling]);

  const resetStuckJob = useCallback(async () => {
    if (!user) return;

    await supabase
      .from("playlist_generation_jobs")
      .update({
        status: "failed",
        phase: "failed",
        status_message: "Generation reset.",
        error_message: "Generation reset manually.",
        completed_at: new Date().toISOString(),
      } as never)
      .eq("user_id", user.id)
      .in("status", ["pending", "running"]);

    stopPolling();
    clearLocalJobState();
    setError(null);
    setProgress(INITIAL_PROGRESS);
  }, [clearLocalJobState, stopPolling, user]);

  const retryGeneration = useCallback(async () => {
    if (jobIdRef.current && analyzing) {
      setError(null);
      await supabase
        .from("playlist_generation_jobs")
        .update({ status_message: "Retrying backend processor…", error_message: null } as never)
        .eq("id", jobIdRef.current);
      await triggerPipeline(jobIdRef.current, forceRetagRef.current, true);
      return;
    }

    await runAnalysis({ forceRetag: forceRetagRef.current });
  }, [analyzing, triggerPipeline]);

  // Check for active job on mount
  useEffect(() => {
    if (!user) return undefined;
    let cancelled = false;
    const checkActiveJob = async () => {
      const { data } = await supabase
        .from("playlist_generation_jobs")
        .select("id, status, phase, total_songs, total_analyzed, assigned_count, worlds_count, saved_worlds, total_worlds, status_message, error_message, created_at, started_at, updated_at, force_retag")
        .eq("user_id", user.id)
        .in("status", ["pending", "running"])
        .order("created_at", { ascending: false })
        .limit(1);

      if (cancelled) return;

      if (data?.length) {
        const job = data[0] as JobSnapshot & { id: string };
        jobIdRef.current = job.id;
        forceRetagRef.current = job.force_retag ?? false;
        setAnalyzing(true);
        syncProgressFromJob(job);
        startPolling(job.id, job.force_retag ?? false);
      }
    };
    checkActiveJob();
    return () => {
      cancelled = true;
      stopPolling();
    };
  }, [startPolling, stopPolling, syncProgressFromJob, user]);

  const runAnalysis = useCallback(async (options?: { forceRetag?: boolean }) => {
    if (!user) return;
    const forceRetag = options?.forceRetag ?? false;
    forceRetagRef.current = forceRetag;

    setAnalyzing(true);
    setError(null);
    setProgress({ ...INITIAL_PROGRESS, totalSongs: likedCount, phase: "queued", statusMessage: "Queued…" });

    try {
      await supabase
        .from("playlist_generation_jobs")
        .update({
          status: "failed",
          phase: "failed",
          status_message: "Superseded by a new generation request.",
          error_message: "Replaced by a newer generation request.",
          completed_at: new Date().toISOString(),
        } as never)
        .eq("user_id", user.id)
        .in("status", ["pending", "running"]);

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
      retryAttemptsRef.current[job.id] = 0;
      retryAttemptsRef.current[`${job.id}:running`] = 0;

      // Start polling BEFORE invoking the function
      startPolling(job.id, forceRetag);

      await triggerPipeline(job.id, forceRetag);

    } catch (e: any) {
      if (jobIdRef.current) {
        await markJobFailed(jobIdRef.current, e.message || "Analysis failed");
      }
      setError(e.message || "Analysis failed");
      stopPolling();
      clearLocalJobState();
      setProgress(INITIAL_PROGRESS);
    }
  }, [clearLocalJobState, likedCount, markJobFailed, startPolling, stopPolling, triggerPipeline, user]);

  return {
    clusters,
    loading,
    analyzing,
    hasAnalyzed,
    error,
    likedCount,
    progress,
    runAnalysis,
    retryGeneration,
    cancelAnalysis,
    resetStuckJob,
    refresh: loadClusters,
  };
}
