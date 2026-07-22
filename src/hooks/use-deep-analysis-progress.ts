// Deep analysis progress hook.
// - Kicks off the orchestrator (server-side loop that survives client disconnect).
// - Subscribes to sync_jobs via Realtime so progress updates without polling.
// - On mount, hydrates the latest deep_analysis job so users returning to the
//   page see live progress or the last completed state.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const JOB_TYPE = "deep_analysis";

export type AnalysisStage =
  | "preparing_library"
  | "analyzing_songs"
  | "recovering"
  | "chaining"
  | "finalizing"
  | "done"
  | "error"
  | null;

export const STAGE_LABEL: Record<Exclude<AnalysisStage, null>, string> = {
  preparing_library: "Preparando biblioteca",
  analyzing_songs: "Analizando canciones",
  recovering: "Recuperando de un error",
  chaining: "Continuando en segundo plano",
  finalizing: "Guardando resultados",
  done: "Listo",
  error: "Error",
};

export interface DeepAnalysisJob {
  id: string;
  status: "running" | "completed" | "failed" | "pending";
  stage: AnalysisStage;
  itemsProcessed: number;
  totalItems: number;
  cacheHits: number;
  failedCount: number;
  retryCount: number;
  batchesCompleted: number;
  etaSeconds: number | null;
  avgMsPerTrack: number | null;
  lastError: string | null;
  errorMessage: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  updatedAt: string;
}

function rowToJob(row: any): DeepAnalysisJob {
  const meta = (row.meta ?? {}) as Record<string, unknown>;
  return {
    id: row.id,
    status: row.status,
    stage: (row.stage ?? null) as AnalysisStage,
    itemsProcessed: row.items_processed ?? 0,
    totalItems: row.total_items ?? 0,
    cacheHits: Number(meta.cache_hits ?? 0),
    failedCount: Number(meta.failed_count ?? 0),
    retryCount: Number(meta.retry_count ?? 0),
    batchesCompleted: Number(meta.batches_completed ?? 0),
    etaSeconds: meta.eta_seconds == null ? null : Number(meta.eta_seconds),
    avgMsPerTrack: meta.avg_ms_per_track == null ? null : Number(meta.avg_ms_per_track),
    lastError: (meta.last_error as string | null) ?? null,
    errorMessage: row.error_message ?? null,
    startedAt: row.started_at ?? null,
    finishedAt: row.finished_at ?? null,
    updatedAt: row.updated_at,
  };
}

export function useDeepAnalysisProgress() {
  const [job, setJob] = useState<DeepAnalysisJob | null>(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const userIdRef = useRef<string | null>(null);
  const shownCompleteRef = useRef<string | null>(null);

  // Load the latest job on mount so returning users see current progress.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (cancelled || !user) { setLoading(false); return; }
      userIdRef.current = user.id;

      const { data } = await supabase
        .from("sync_jobs")
        .select("*")
        .eq("user_id", user.id)
        .eq("job_type", JOB_TYPE)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!cancelled) {
        if (data) setJob(rowToJob(data));
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Realtime subscription: track all sync_jobs updates for this user and this job type.
  useEffect(() => {
    if (!userIdRef.current) return;
    const uid = userIdRef.current;
    const channel = supabase
      .channel(`deep-analysis-${uid}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "sync_jobs",
          filter: `user_id=eq.${uid}`,
        },
        (payload) => {
          const row = (payload.new ?? payload.old) as any;
          if (!row || row.job_type !== JOB_TYPE) return;
          setJob((prev) => {
            // Only replace with the most recent job by created_at
            if (!prev || new Date(row.created_at) >= new Date(prev.startedAt ?? row.created_at)) {
              return rowToJob(row);
            }
            if (row.id === prev.id) return rowToJob(row);
            return prev;
          });
        },
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [loading]);

  // Toast when a run finishes (once per job id)
  useEffect(() => {
    if (!job) return;
    if (job.status === "completed" && shownCompleteRef.current !== job.id) {
      shownCompleteRef.current = job.id;
      toast.success("Análisis profundo completado", {
        description: `${job.itemsProcessed} de ${job.totalItems} canciones${job.failedCount ? ` · ${job.failedCount} pendientes` : ""}`,
      });
    } else if (job.status === "failed" && shownCompleteRef.current !== job.id) {
      shownCompleteRef.current = job.id;
      toast.error("Análisis interrumpido", { description: job.errorMessage ?? "Error desconocido" });
    }
  }, [job?.status, job?.id]);

  const start = useCallback(async (force = false) => {
    setStarting(true);
    try {
      const { data, error } = await supabase.functions.invoke("orchestrate-deep-analysis", {
        body: { force },
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);

      if (data?.status === "already_running") {
        toast.info("Ya hay un análisis en progreso", { description: "Sigue corriendo en segundo plano." });
      } else {
        toast.success("Análisis iniciado", { description: "Puedes cerrar la pantalla; continúa en segundo plano." });
      }
    } catch (e: any) {
      toast.error("No pudimos iniciar el análisis", { description: e?.message ?? "Error desconocido" });
    } finally {
      setStarting(false);
    }
  }, []);

  const progressPct = useMemo(() => {
    if (!job || !job.totalItems) return 0;
    return Math.min(100, Math.round((job.itemsProcessed / job.totalItems) * 100));
  }, [job]);

  const isRunning = job?.status === "running";
  const isDone = job?.status === "completed";
  const isFailed = job?.status === "failed";

  return {
    job,
    loading,
    starting,
    isRunning,
    isDone,
    isFailed,
    progressPct,
    start,
  };
}
