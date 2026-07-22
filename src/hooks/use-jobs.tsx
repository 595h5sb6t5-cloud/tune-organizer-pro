import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";

export type JobStatus = "pending" | "running" | "completed" | "failed" | "retrying";

export type JobType =
  | "spotify_import"
  | "sync_liked"
  | "sync_playlists"
  | "sync_artists"
  | "sync_albums"
  | "ai_analysis"
  | "playlist_generation"
  | "playlist_export"
  | "playlist_review"
  | "recommendations";

export interface JobState {
  id: string;
  type: JobType;
  label: string;
  status: JobStatus;
  itemsProcessed: number;
  totalItems: number;
  message: string;
  error: string | null;
  errorStep?: string;
  startedAt: number;
  finishedAt: number | null;
  technical?: string;
  retry?: () => void;
}

interface JobsContextValue {
  jobs: JobState[];
  startJob: (input: {
    type: JobType;
    label: string;
    totalItems?: number;
    message?: string;
    retry?: () => void;
  }) => string;
  updateJob: (id: string, patch: Partial<JobState>) => void;
  completeJob: (id: string, message?: string) => void;
  failJob: (id: string, error: string, opts?: { step?: string; technical?: string }) => void;
  retryJob: (id: string) => void;
  dismissJob: (id: string) => void;
  clearCompleted: () => void;
}

const JobsContext = createContext<JobsContextValue | null>(null);

const newId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

async function persistJob(job: JobState, action: "create" | "update" | "finish") {
  try {
    const { data: auth } = await supabase.auth.getUser();
    const userId = auth?.user?.id;
    if (!userId) return;
    if (action === "create") {
      await supabase.from("sync_jobs").insert({
        id: job.id.length === 36 ? job.id : undefined,
        user_id: userId,
        job_type: job.type,
        status: job.status,
        items_processed: job.itemsProcessed,
        total_items: job.totalItems,
        started_at: new Date(job.startedAt).toISOString(),
      } as any);
    } else if (action === "update") {
      await supabase.from("sync_jobs").update({
        status: job.status,
        items_processed: job.itemsProcessed,
        total_items: job.totalItems,
      } as any).eq("user_id", userId).eq("job_type", job.type).is("finished_at", null);
    } else {
      await supabase.from("sync_jobs").update({
        status: job.status,
        items_processed: job.itemsProcessed,
        total_items: job.totalItems,
        finished_at: new Date(job.finishedAt ?? Date.now()).toISOString(),
        error_message: job.error,
      } as any).eq("user_id", userId).eq("job_type", job.type).is("finished_at", null);
    }
  } catch {
    // best-effort persistence
  }
}

export function JobsProvider({ children }: { children: ReactNode }) {
  const [jobs, setJobs] = useState<JobState[]>([]);
  const retryRef = useRef<Map<string, () => void>>(new Map());

  const startJob: JobsContextValue["startJob"] = useCallback((input) => {
    const id = newId();
    const job: JobState = {
      id,
      type: input.type,
      label: input.label,
      status: "running",
      itemsProcessed: 0,
      totalItems: input.totalItems ?? 0,
      message: input.message ?? "Iniciando…",
      error: null,
      startedAt: Date.now(),
      finishedAt: null,
      retry: input.retry,
    };
    if (input.retry) retryRef.current.set(id, input.retry);
    setJobs((prev) => [job, ...prev.filter((j) => !(j.type === input.type && j.status === "completed"))]);
    void persistJob(job, "create");
    return id;
  }, []);

  const updateJob: JobsContextValue["updateJob"] = useCallback((id, patch) => {
    setJobs((prev) => {
      const next = prev.map((j) => (j.id === id ? { ...j, ...patch } : j));
      const updated = next.find((j) => j.id === id);
      if (updated) void persistJob(updated, "update");
      return next;
    });
  }, []);

  const completeJob: JobsContextValue["completeJob"] = useCallback((id, message) => {
    setJobs((prev) => {
      const next = prev.map((j) =>
        j.id === id
          ? { ...j, status: "completed" as JobStatus, finishedAt: Date.now(), message: message ?? "Completado", error: null }
          : j
      );
      const updated = next.find((j) => j.id === id);
      if (updated) void persistJob(updated, "finish");
      return next;
    });
  }, []);

  const failJob: JobsContextValue["failJob"] = useCallback((id, error, opts) => {
    setJobs((prev) => {
      const next = prev.map((j) =>
        j.id === id
          ? {
              ...j,
              status: "failed" as JobStatus,
              finishedAt: Date.now(),
              error,
              errorStep: opts?.step,
              technical: opts?.technical,
              message: `Error: ${error}`,
            }
          : j
      );
      const updated = next.find((j) => j.id === id);
      if (updated) void persistJob(updated, "finish");
      return next;
    });
  }, []);

  const retryJob: JobsContextValue["retryJob"] = useCallback((id) => {
    const fn = retryRef.current.get(id);
    setJobs((prev) =>
      prev.map((j) =>
        j.id === id ? { ...j, status: "retrying" as JobStatus, error: null, message: "Reintentando…" } : j
      )
    );
    if (fn) {
      try { fn(); } catch (e: any) {
        setJobs((prev) => prev.map((j) => (j.id === id ? { ...j, status: "failed", error: e?.message ?? "retry failed" } : j)));
      }
    }
  }, []);

  const dismissJob: JobsContextValue["dismissJob"] = useCallback((id) => {
    retryRef.current.delete(id);
    setJobs((prev) => prev.filter((j) => j.id !== id));
  }, []);

  const clearCompleted: JobsContextValue["clearCompleted"] = useCallback(() => {
    setJobs((prev) => prev.filter((j) => j.status !== "completed"));
  }, []);

  const value = useMemo<JobsContextValue>(
    () => ({ jobs, startJob, updateJob, completeJob, failJob, retryJob, dismissJob, clearCompleted }),
    [jobs, startJob, updateJob, completeJob, failJob, retryJob, dismissJob, clearCompleted]
  );

  return <JobsContext.Provider value={value}>{children}</JobsContext.Provider>;
}

export function useJobs() {
  const ctx = useContext(JobsContext);
  if (!ctx) throw new Error("useJobs must be used within JobsProvider");
  return ctx;
}

/** Wrap an async operation with automatic job tracking. */
export async function runWithJob<T>(
  jobs: JobsContextValue,
  opts: {
    type: JobType;
    label: string;
    totalItems?: number;
    message?: string;
    retry?: () => void;
  },
  fn: (helpers: {
    update: (patch: Partial<JobState>) => void;
    setProgress: (processed: number, total?: number, message?: string) => void;
  }) => Promise<T>,
): Promise<T | null> {
  const id = jobs.startJob(opts);
  try {
    const result = await fn({
      update: (patch) => jobs.updateJob(id, patch),
      setProgress: (processed, total, message) =>
        jobs.updateJob(id, {
          itemsProcessed: processed,
          ...(total != null ? { totalItems: total } : {}),
          ...(message ? { message } : {}),
        }),
    });
    jobs.completeJob(id);
    return result;
  } catch (e: any) {
    jobs.failJob(id, e?.message ?? "Error desconocido", { technical: e?.stack });
    return null;
  }
}
