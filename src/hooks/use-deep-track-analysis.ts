import { useCallback, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useJobs } from "./use-jobs";

export interface DeepAnalysisProgress {
  running: boolean;
  totalLiked: number;
  alreadyAnalyzed: number;
  analyzedThisRun: number;
  failedThisRun: number;
  currentBatch: number;
  totalBatches: number;
  message: string;
  done: boolean;
  error: string | null;
}

const BATCH_SIZE = 10;
const MAX_BATCHES = 200; // safety

export function useDeepTrackAnalysis() {
  const jobsApi = useJobs();
  const [state, setState] = useState<DeepAnalysisProgress>({
    running: false,
    totalLiked: 0,
    alreadyAnalyzed: 0,
    analyzedThisRun: 0,
    failedThisRun: 0,
    currentBatch: 0,
    totalBatches: 0,
    message: "",
    done: false,
    error: null,
  });

  const start = useCallback(async (force = false) => {
    setState((s) => ({
      ...s,
      running: true,
      analyzedThisRun: 0,
      failedThisRun: 0,
      currentBatch: 0,
      totalBatches: 0,
      message: "Iniciando análisis…",
      done: false,
      error: null,
    }));

    const jobId = jobsApi.startJob({
      type: "ai_analysis",
      label: "Análisis profundo con IA",
      message: "Iniciando análisis…",
      retry: () => { void start(force); },
    });

    let batchNum = 0;
    let analyzedAcc = 0;
    let failedAcc = 0;

    try {
      while (batchNum < MAX_BATCHES) {
        batchNum++;
        const batchMsg = `Analizando lote ${batchNum}…`;
        setState((s) => ({ ...s, currentBatch: batchNum, message: batchMsg }));
        jobsApi.updateJob(jobId, { message: batchMsg });

        const { data, error } = await supabase.functions.invoke("analyze-tracks-deep", {
          body: { batch_size: BATCH_SIZE, force },
        });

        if (error) throw new Error(error.message);
        if (data?.error) throw new Error(data.error);

        analyzedAcc += data?.analyzed ?? 0;
        failedAcc += data?.failed ?? 0;

        const total = data?.total ?? 0;
        const alreadyAnalyzed = data?.already_analyzed ?? 0;
        const remaining = data?.remaining ?? 0;
        const totalBatches = Math.max(batchNum, batchNum + Math.ceil(remaining / BATCH_SIZE));

        const progressMsg = data?.done
          ? "Guardando análisis…"
          : `Analizando canción ${alreadyAnalyzed} de ${total} · lote ${batchNum} de ${totalBatches}`;

        setState((s) => ({
          ...s,
          totalLiked: total,
          alreadyAnalyzed,
          analyzedThisRun: analyzedAcc,
          failedThisRun: failedAcc,
          totalBatches,
          message: progressMsg,
        }));
        jobsApi.updateJob(jobId, {
          itemsProcessed: alreadyAnalyzed,
          totalItems: total,
          message: progressMsg,
        });

        if (data?.done || (data?.analyzed ?? 0) === 0) break;
        await new Promise((r) => setTimeout(r, 800));
      }

      setState((s) => ({ ...s, running: false, done: true, message: "Análisis completado." }));
      jobsApi.completeJob(jobId, `Análisis completado · ${analyzedAcc} canciones${failedAcc ? ` · ${failedAcc} pendientes` : ""}`);
      toast.success("Análisis profundo completado", {
        description: `${analyzedAcc} canciones analizadas${failedAcc ? ` · ${failedAcc} pendientes` : ""}`,
      });
    } catch (e: any) {
      const msg = e?.message ?? "Error desconocido";
      setState((s) => ({ ...s, running: false, error: msg, message: `Error: ${msg}` }));
      jobsApi.failJob(jobId, msg, { technical: e?.stack });
      toast.error("Análisis interrumpido", { description: msg });
    }
  }, [jobsApi]);

  return { ...state, start };
}

