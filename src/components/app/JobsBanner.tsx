import { useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, AlertTriangle, Loader2, RefreshCw, X, ChevronUp, ChevronDown, Settings, Activity } from "lucide-react";
import { useJobs, type JobState } from "@/hooks/use-jobs";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

function progressValue(j: JobState): number {
  if (j.status === "completed") return 100;
  if (j.totalItems > 0) return Math.min(100, Math.round((j.itemsProcessed / j.totalItems) * 100));
  if (j.status === "running" || j.status === "retrying") return undefined as unknown as number;
  return 0;
}

function StatusIcon({ status }: { status: JobState["status"] }) {
  if (status === "completed") return <CheckCircle2 className="w-4 h-4 text-emerald-500" />;
  if (status === "failed") return <AlertTriangle className="w-4 h-4 text-destructive" />;
  return <Loader2 className="w-4 h-4 text-accent animate-spin" />;
}

function JobRow({ job }: { job: JobState }) {
  const { retryJob, dismissJob } = useJobs();
  const [showDebug, setShowDebug] = useState(false);
  const pct = progressValue(job);
  const showBar = job.status !== "completed" && job.totalItems > 0;
  const isFailed = job.status === "failed";

  return (
    <div className="rounded-xl border border-border/50 bg-card/80 backdrop-blur p-3">
      <div className="flex items-start gap-2">
        <div className="mt-0.5"><StatusIcon status={job.status} /></div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium truncate">{job.label}</p>
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{job.status}</span>
          </div>
          <p className={cn("text-xs mt-0.5 truncate", isFailed ? "text-destructive" : "text-muted-foreground")}>
            {job.message}
          </p>
          {showBar && (
            <div className="mt-2">
              <Progress value={pct ?? 0} className="h-1" />
              {job.totalItems > 0 && (
                <p className="text-[10px] text-muted-foreground mt-1">
                  {job.itemsProcessed} de {job.totalItems}
                </p>
              )}
            </div>
          )}
          {isFailed && (
            <div className="mt-2 flex flex-wrap gap-2">
              {job.retry && (
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => retryJob(job.id)}>
                  <RefreshCw className="w-3 h-3 mr-1" />Reintentar
                </Button>
              )}
              <Button size="sm" variant="ghost" className="h-7 text-xs" asChild>
                <Link to="/settings"><Settings className="w-3 h-3 mr-1" />Revisar conexión</Link>
              </Button>
              {job.technical && (
                <button
                  className="text-[10px] text-muted-foreground underline"
                  onClick={() => setShowDebug((v) => !v)}
                >
                  {showDebug ? "Ocultar debug" : "Ver detalle técnico"}
                </button>
              )}
              {showDebug && job.technical && (
                <pre className="mt-1 w-full text-[10px] text-muted-foreground bg-muted/40 p-2 rounded overflow-auto max-h-32">{job.technical}</pre>
              )}
              {job.errorStep && (
                <p className="w-full text-[10px] text-muted-foreground">Paso fallido: <span className="font-mono">{job.errorStep}</span></p>
              )}
            </div>
          )}
        </div>
        <button
          onClick={() => dismissJob(job.id)}
          className="text-muted-foreground hover:text-foreground p-1"
          aria-label="Dismiss"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

export function JobsBanner() {
  const { jobs, clearCompleted } = useJobs();
  const [open, setOpen] = useState(true);

  if (jobs.length === 0) return null;

  const running = jobs.filter((j) => j.status === "running" || j.status === "retrying" || j.status === "pending");
  const failed = jobs.filter((j) => j.status === "failed");
  const completed = jobs.filter((j) => j.status === "completed");

  return (
    <div className="fixed right-4 bottom-4 z-50 w-[360px] max-w-[calc(100vw-2rem)]">
      <div className="rounded-2xl border border-border/60 bg-background/95 backdrop-blur shadow-2xl overflow-hidden">
        <button
          onClick={() => setOpen((v) => !v)}
          className="w-full flex items-center justify-between gap-2 px-4 py-2.5 border-b border-border/50 hover:bg-muted/30"
        >
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-accent" />
            <span className="text-sm font-medium">
              Procesos
              <span className="ml-2 text-xs text-muted-foreground">
                {running.length} activo{running.length === 1 ? "" : "s"}
                {failed.length > 0 && ` · ${failed.length} con error`}
              </span>
            </span>
          </div>
          {open ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
        </button>
        {open && (
          <div className="max-h-[60vh] overflow-y-auto p-3 space-y-2">
            {[...running, ...failed, ...completed].map((j) => (
              <JobRow key={j.id} job={j} />
            ))}
            {completed.length > 0 && (
              <button
                onClick={clearCompleted}
                className="text-[11px] text-muted-foreground hover:text-foreground w-full text-center pt-1"
              >
                Limpiar completados
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
