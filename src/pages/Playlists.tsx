import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  Sparkles, Loader2, Music, Plus, Wand2, ExternalLink, ArrowLeft, ArrowUp, ArrowDown,
  Trash2, Upload, Pencil, Check, X, ListMusic, AlertTriangle, Globe, Lock, RefreshCw, Settings as SettingsIcon, ShieldCheck,
} from "lucide-react";
import { Switch } from "@/components/ui/switch";
import AppLayout from "@/components/app/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/hooks/use-auth";
import { useGeneratedPlaylists, useGeneratedPlaylistDetail } from "@/hooks/use-generated-playlists";
import { supabase } from "@/integrations/supabase/client";
import { useJobs } from "@/hooks/use-jobs";
import { toast } from "sonner";
import ValidateContextButton from "@/components/app/ValidateContextButton";


// Old concept-first generator kept in code for reference; UI uses ClusterSampleTest.


const Playlists = () => {
  const { profile } = useAuth();
  const spotifyConnected = profile?.spotify_connected ?? false;
  const { playlists, loading, refresh } = useGeneratedPlaylists();
  const [selected, setSelected] = useState<string | null>(null);

  if (!spotifyConnected) {
    return (
      <AppLayout>
        <EmptyConnect />
      </AppLayout>
    );
  }

  if (selected) {
    return (
      <AppLayout>
        <PlaylistDetail
          playlistId={selected}
          onBack={() => { setSelected(null); void refresh(); }}
        />
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="max-w-6xl">
        <div className="flex items-start justify-between gap-4 mb-8">
          <div>
            <h1 className="font-heading text-3xl mb-1">AI Playlists</h1>
            <p className="text-muted-foreground">Conceptos curados a partir de tu DNA musical real.</p>
          </div>
        </div>

        <Phase1DiagnosticPanel />

        <div className="h-6" />

        <Phase2ReportPanel />

        <div className="h-6" />

        <ClusterSampleTest onPromoted={(id) => { void refresh(); setSelected(id); }} />

        <div className="mt-10">
          <h2 className="font-heading text-xl mb-4">Tus playlists generadas</h2>
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" />Cargando…</div>
          ) : playlists.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aún no has generado ninguna playlist. Empieza arriba.</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {playlists.map((p) => (
                <div
                  key={p.id}
                  className="relative rounded-2xl border border-border/50 bg-card/50 p-5 hover:border-accent/50 transition-colors"
                >
                  <button
                    type="button"
                    onClick={async (e) => {
                      e.stopPropagation();
                      if (!confirm(`¿Eliminar "${p.name}"? Esta acción no se puede deshacer.`)) return;
                      const { error } = await supabase.from("generated_playlists").delete().eq("id", p.id);
                      if (error) { toast.error("No se pudo eliminar", { description: error.message }); return; }
                      toast.success("Playlist eliminada");
                      void refresh();
                    }}
                    className="absolute top-3 right-3 p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors z-10"
                    aria-label="Eliminar playlist"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                  <ValidateContextButton playlistId={p.id} playlistName={p.name} />

                  <button
                    type="button"
                    onClick={() => setSelected(p.id)}
                    className="text-left w-full"
                  >
                    <div className="flex items-start justify-between gap-3 mb-2 pr-8">
                      <h3 className="font-heading text-lg leading-tight">{p.name}</h3>
                      {p.is_exported_to_spotify ? (
                        <Badge variant="outline" className="text-xs"><Check className="w-3 h-3 mr-1" />En Spotify</Badge>
                      ) : (
                        <Badge variant="secondary" className="text-xs">Draft</Badge>
                      )}
                    </div>
                    {p.concept && <p className="text-xs uppercase tracking-wider text-accent mb-2">{p.concept}</p>}
                    {p.description && <p className="text-sm text-muted-foreground line-clamp-2 mb-2">{p.description}</p>}
                    <p className="text-xs text-muted-foreground"><Music className="w-3 h-3 inline mr-1" />{p.track_count} canciones</p>
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  );
};

function EmptyConnect() {
  return (
    <div className="max-w-2xl mx-auto rounded-3xl bg-gradient-to-br from-accent/15 via-primary/10 to-background border border-border/50 p-12 text-center">
      <div className="w-14 h-14 rounded-2xl bg-accent/20 flex items-center justify-center mx-auto mb-5">
        <Sparkles className="w-7 h-7 text-accent" />
      </div>
      <h2 className="font-heading text-2xl mb-2">Conecta Spotify para generar playlists</h2>
      <p className="text-sm text-muted-foreground max-w-md mx-auto mb-6">
        Necesitamos tu biblioteca real para construir conceptos coherentes.
      </p>
      <Button variant="hero" asChild><Link to="/settings"><Sparkles className="w-4 h-4 mr-2" />Connect Spotify</Link></Button>
    </div>
  );
}

type ClusterReport = {
  id: string;
  language_group: string;
  size: number;
  avg_compat: number;
  min_compat: number;
  least_compatible: { name: string | null; artist: string | null; compat: number } | null;
  dominant_dimensions: { strong: { dim: string; value: number }[]; tempo?: string; beat?: string; texture?: string; mood?: string };
  tracks: { spotify_track_id: string; name: string | null; artist: string | null; compat: number }[];
};

function ClusterSampleTest({ onPromoted }: { onPromoted: (id: string) => void }) {
  const [running, setRunning] = useState(false);
  const [sampleSize, setSampleSize] = useState(200);
  const [report, setReport] = useState<null | {
    run_id: string; persisted: boolean; totals: any; thresholds: any;
    clusters: ClusterReport[]; unassigned: { spotify_track_id: string; name: string | null; artist: string | null; language: string | null }[];
  }>(null);
  const [promoting, setPromoting] = useState<string | null>(null);
  const jobsApi = useJobs();

  const run = async (persist: boolean) => {
    setRunning(true);
    const jobId = jobsApi.startJob({
      type: "playlist_generation",
      label: persist ? "Corriendo clustering sobre biblioteca completa" : `Prueba de clustering (${sampleSize} canciones)`,
      message: "Agrupando por compatibilidad sonora…",
      retry: () => { void run(persist); },
    });
    try {
      const { data, error } = await supabase.functions.invoke("cluster-library", {
        body: persist ? { persist: true } : { sample_size: sampleSize, persist: false },
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      setReport(data);
      jobsApi.completeJob(jobId, `${data.totals.clusters} clusters · ${data.totals.unassigned} sin asignar`);
    } catch (e: any) {
      jobsApi.failJob(jobId, e.message);
      toast.error("Clustering falló", { description: e.message });
    } finally {
      setRunning(false);
    }
  };

  const promote = async (clusterId: string) => {
    setPromoting(clusterId);
    try {
      const { data, error } = await supabase.functions.invoke("name-cluster", { body: { cluster_id: clusterId } });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      toast.success("Playlist creada", { description: `${data.name} · ${data.track_count} canciones` });
      onPromoted(data.playlist_id);
    } catch (e: any) {
      toast.error("No se pudo promover el cluster", { description: e.message });
    } finally {
      setPromoting(null);
    }
  };

  return (
    <div className="rounded-3xl border border-border/50 bg-gradient-to-br from-accent/10 via-primary/5 to-background p-6 md:p-8">
      <div className="flex items-center gap-2 mb-2">
        <ShieldCheck className="w-4 h-4 text-accent" />
        <p className="text-xs uppercase tracking-[0.2em] text-accent">Cluster-first pipeline · Sample test</p>
      </div>
      <h2 className="font-heading text-2xl mb-2">Agrupar primero, nombrar después.</h2>
      <p className="text-sm text-muted-foreground mb-5">
        El sistema mide compatibilidad sonora real entre canciones y sólo forma grupos que cumplen los mínimos.
        Corre una prueba con una muestra antes de aplicarlo a toda tu biblioteca.
      </p>

      <div className="flex flex-col md:flex-row gap-3 mb-4">
        <Input
          type="number"
          value={sampleSize}
          onChange={(e) => setSampleSize(Math.min(500, Math.max(50, Number(e.target.value) || 200)))}
          className="w-full md:w-32"
          disabled={running}
          min={50}
          max={500}
        />
        <Button variant="hero" onClick={() => run(false)} disabled={running}>
          {running ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Corriendo…</> : <><Wand2 className="w-4 h-4 mr-2" />Correr prueba</>}
        </Button>
        <Button variant="outline" onClick={() => run(true)} disabled={running || !report}>
          Correr sobre biblioteca completa (persistir)
        </Button>
      </div>

      {report && (
        <div className="mt-6 space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <Stat label="Analizadas" value={report.totals.analyzed} />
            <Stat label="Clusters válidos" value={report.totals.clusters} />
            <Stat label="Agrupadas" value={report.totals.clustered_tracks} />
            <Stat label="Sin asignar" value={report.totals.unassigned} />
          </div>

          {report.clusters.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Ningún grupo pasó los filtros con esta muestra. Sube el tamaño de muestra o corre más análisis profundo.
            </p>
          )}

          {report.clusters.map((c, i) => (
            <div key={c.id} className="rounded-2xl border border-border/50 bg-card/50 p-5">
              <div className="flex items-start justify-between gap-3 mb-3">
                <div>
                  <p className="text-xs uppercase tracking-wider text-accent mb-1">Cluster #{i + 1} · {c.language_group}</p>
                  <p className="text-sm">
                    <strong>{c.size}</strong> canciones · avg <strong>{c.avg_compat.toFixed(2)}</strong> · min <strong>{c.min_compat.toFixed(2)}</strong>
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="hero"
                  disabled={!report.persisted || promoting === c.id}
                  onClick={() => promote(c.id)}
                  title={!report.persisted ? "Primero corre sobre biblioteca completa para persistir" : ""}
                >
                  {promoting === c.id ? <><Loader2 className="w-4 h-4 mr-1.5 animate-spin" />Nombrando…</> : "Promover a playlist"}
                </Button>
              </div>

              <div className="flex flex-wrap gap-1.5 mb-3">
                {c.dominant_dimensions.strong.map((d) => (
                  <Badge key={d.dim} variant="secondary" className="text-xs">
                    {d.dim} · {d.value.toFixed(2)}
                  </Badge>
                ))}
                {c.dominant_dimensions.mood && <Badge variant="outline" className="text-xs">mood: {c.dominant_dimensions.mood}</Badge>}
                {c.dominant_dimensions.beat && <Badge variant="outline" className="text-xs">beat: {c.dominant_dimensions.beat}</Badge>}
                {c.dominant_dimensions.texture && <Badge variant="outline" className="text-xs">texture: {c.dominant_dimensions.texture}</Badge>}
              </div>

              {c.least_compatible && (
                <p className="text-xs text-muted-foreground mb-2">
                  Menos compatible: <strong>{c.least_compatible.name}</strong> — {c.least_compatible.artist} (compat {c.least_compatible.compat.toFixed(2)})
                </p>
              )}

              <details className="text-sm">
                <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">Ver todas las canciones ({c.tracks.length})</summary>
                <ul className="mt-2 space-y-1 max-h-64 overflow-y-auto pr-2">
                  {c.tracks.map((t) => (
                    <li key={t.spotify_track_id} className="flex justify-between gap-3 text-xs">
                      <span className="truncate">{t.name} — <span className="text-muted-foreground">{t.artist}</span></span>
                      <span className="text-muted-foreground shrink-0">{t.compat.toFixed(2)}</span>
                    </li>
                  ))}
                </ul>
              </details>
            </div>
          ))}

          {report.unassigned.length > 0 && (
            <div className="rounded-2xl border border-dashed border-border/50 p-5">
              <p className="text-sm font-medium mb-2">Sin asignar ({report.unassigned.length})</p>
              <p className="text-xs text-muted-foreground mb-3">
                Estas canciones no encontraron un grupo suficientemente compatible. Se guardarán como pendientes cuando corras el pipeline completo.
              </p>
              <details className="text-xs">
                <summary className="cursor-pointer text-muted-foreground">Ver lista</summary>
                <ul className="mt-2 space-y-1 max-h-48 overflow-y-auto pr-2">
                  {report.unassigned.slice(0, 100).map((u) => (
                    <li key={u.spotify_track_id} className="truncate">{u.name} — <span className="text-muted-foreground">{u.artist}</span></li>
                  ))}
                </ul>
              </details>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-xl border border-border/50 bg-background/40 p-3">
      <p className="text-xs uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="font-heading text-2xl">{value}</p>
    </div>
  );
}

const V3_PROMPT_VERSION = "v3.0-2026-family-subgenre";
const SAMPLE_ANALYSIS_BATCH_SIZE = 40;
const MAX_ATTEMPTS_PER_TRACK = 3;

type SampleState = {
  sample_id: string;
  label: string;
  size: number;
  library_size: number;
  spotify_track_ids: string[];
  reasons_summary: Record<string, number>;
  preview: { spotify_track_id: string; name: string | null; artist: string | null; reason: string }[];
};

async function countAnalyzedInSample(userId: string, ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const done = new Set<string>();
  const CHUNK = 200;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const slice = ids.slice(i, i + CHUNK);
    const { data } = await supabase
      .from("ai_track_analysis")
      .select("spotify_track_id")
      .eq("user_id", userId)
      .eq("analysis_version", "v3")
      .eq("prompt_version", V3_PROMPT_VERSION)
      .in("spotify_track_id", slice);
    for (const r of data ?? []) if (r.spotify_track_id) done.add(r.spotify_track_id);
  }
  return done;
}

function Phase1DiagnosticPanel() {
  const { user } = useAuth();
  const [buildingSample, setBuildingSample] = useState(false);
  const [loadingExisting, setLoadingExisting] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [sample, setSample] = useState<SampleState | null>(null);
  const [analyzedIds, setAnalyzedIds] = useState<Set<string>>(new Set());
  const [failedAttempts, setFailedAttempts] = useState<Record<string, number>>({});
  const [permanentlyFailed, setPermanentlyFailed] = useState<Set<string>>(new Set());
  const [currentBatch, setCurrentBatch] = useState<{ index: number; total: number } | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const jobsApi = useJobs();

  const sampleSize = sample?.size ?? 0;
  const processed = analyzedIds.size;
  const failed = permanentlyFailed.size;
  const pending = Math.max(0, sampleSize - processed - failed);
  const complete = sample != null && processed + failed >= sampleSize;

  // Load latest persisted sample on mount so refreshing the page doesn't lose progress.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!user) { setLoadingExisting(false); return; }
      const { data } = await supabase
        .from("diagnostic_samples")
        .select("id, label, size, spotify_track_ids, selection_reasons")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (cancelled) return;
      if (data) {
        const ids = (data.spotify_track_ids as string[]) ?? [];
        const reasons = (data.selection_reasons as Record<string, string>) ?? {};
        const summary: Record<string, number> = {};
        for (const r of Object.values(reasons)) {
          const key = String(r).split(":")[0];
          summary[key] = (summary[key] ?? 0) + 1;
        }
        setSample({
          sample_id: data.id,
          label: data.label,
          size: data.size,
          library_size: 0,
          spotify_track_ids: ids,
          reasons_summary: summary,
          preview: [],
        });
        const done = await countAnalyzedInSample(user.id, ids);
        if (!cancelled) setAnalyzedIds(done);
      }
      setLoadingExisting(false);
    })();
    return () => { cancelled = true; };
  }, [user?.id]);

  const buildSample = async () => {
    setBuildingSample(true);
    setLastError(null);
    setAnalyzedIds(new Set());
    setPermanentlyFailed(new Set());
    setFailedAttempts({});
    try {
      const { data, error } = await supabase.functions.invoke("select-diagnostic-sample", { body: { size: 150 } });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      setSample(data);
      if (user) {
        const done = await countAnalyzedInSample(user.id, data.spotify_track_ids ?? []);
        setAnalyzedIds(done);
      }
      toast.success("Muestra lista", { description: `${data.size} canciones de ${data.library_size}` });
    } catch (e: any) {
      toast.error("No se pudo armar la muestra", { description: e.message });
    } finally {
      setBuildingSample(false);
    }
  };

  const runAnalysisLoop = async () => {
    if (!sample || !user) return;
    setAnalyzing(true);
    setLastError(null);
    const jobId = jobsApi.startJob({
      type: "playlist_generation",
      label: `Analizando muestra Fase 1 (${sample.size} canciones)`,
      message: "Corriendo análisis v3.0 en lotes resumibles…",
      retry: () => { void runAnalysisLoop(); },
    });

    try {
      let currentAnalyzed = new Set(analyzedIds);
      let currentFailedAttempts = { ...failedAttempts };
      let currentPermanentFailed = new Set(permanentlyFailed);
      let safety = 0;

      while (safety++ < 20) {
        const remaining = sample.spotify_track_ids.filter(
          (id) => !currentAnalyzed.has(id) && !currentPermanentFailed.has(id),
        );
        if (remaining.length === 0) break;

        const batch = remaining.slice(0, SAMPLE_ANALYSIS_BATCH_SIZE);
        const batchIndex = Math.ceil((sample.size - remaining.length) / SAMPLE_ANALYSIS_BATCH_SIZE) + 1;
        const totalBatches = Math.ceil(sample.size / SAMPLE_ANALYSIS_BATCH_SIZE);
        setCurrentBatch({ index: batchIndex, total: totalBatches });

        const { data, error } = await supabase.functions.invoke("analyze-tracks-deep", {
          body: {
            spotify_track_ids: batch,
            batch_size: batch.length,
            concurrency: 8,
            diagnostic: true,
            force: false,
          },
        });
        if (error) throw new Error(error.message);
        if (data?.error) throw new Error(data.error);

        // Re-check DB (source of truth) — the function response can be misleading
        // because it reports library-wide counters.
        const doneNow = await countAnalyzedInSample(user.id, sample.spotify_track_ids);
        currentAnalyzed = doneNow;
        setAnalyzedIds(new Set(doneNow));

        // Any ID in the batch that still isn't analyzed → increment failure count
        for (const id of batch) {
          if (!doneNow.has(id)) {
            const next = (currentFailedAttempts[id] ?? 0) + 1;
            currentFailedAttempts[id] = next;
            if (next >= MAX_ATTEMPTS_PER_TRACK) {
              currentPermanentFailed.add(id);
              console.warn(`[phase1] permanently failed: ${id} (${next} attempts)`);
            }
          } else {
            delete currentFailedAttempts[id];
          }
        }
        setFailedAttempts({ ...currentFailedAttempts });
        setPermanentlyFailed(new Set(currentPermanentFailed));

        jobsApi.updateJob(jobId, {
          message: `Lote ${batchIndex}/${totalBatches} · ${doneNow.size}/${sample.size} analizadas · ${currentPermanentFailed.size} fallidas`,
        });
      }

      setCurrentBatch(null);
      const finalAnalyzed = currentAnalyzed.size;
      const finalFailed = currentPermanentFailed.size;
      jobsApi.completeJob(jobId, `${finalAnalyzed}/${sample.size} analizadas · ${finalFailed} fallidas`);
      if (finalAnalyzed >= sample.size) {
        toast.success("Muestra 150/150 completa", { description: "Fase 2 desbloqueada" });
      } else if (finalAnalyzed + finalFailed >= sample.size) {
        toast.warning(`${finalAnalyzed} analizadas, ${finalFailed} imposibles`, {
          description: "Revisa los IDs fallidos antes de aprobar Fase 2",
        });
      } else {
        toast.info(`Progreso: ${finalAnalyzed}/${sample.size}`, { description: "Vuelve a correr para continuar" });
      }
    } catch (e: any) {
      setLastError(e.message);
      jobsApi.failJob(jobId, e.message);
      toast.error("Análisis interrumpido", { description: e.message });
    } finally {
      setAnalyzing(false);
      setCurrentBatch(null);
    }
  };

  const percent = sampleSize ? Math.round((processed / sampleSize) * 100) : 0;

  return (
    <div className="rounded-3xl border border-accent/40 bg-accent/5 p-6 md:p-8 mb-2">
      <div className="flex items-center gap-2 mb-2">
        <ShieldCheck className="w-4 h-4 text-accent" />
        <p className="text-xs uppercase tracking-[0.2em] text-accent">Fase 1 · Diagnóstico</p>
      </div>
      <h2 className="font-heading text-2xl mb-2">Muestra de 150 canciones (v3.0 — familia + subgénero + house_profile)</h2>
      <p className="text-sm text-muted-foreground mb-4">
        Arma una muestra de 150 canciones y córrele el análisis v3.0 en lotes resumibles. Fase 2 solo se desbloquea cuando las 150 estén completas.
      </p>

      <div className="flex flex-wrap gap-2 mb-4">
        <Button variant="hero" onClick={buildSample} disabled={buildingSample || analyzing || loadingExisting}>
          {buildingSample ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Armando…</> : <>1. Armar muestra nueva (150)</>}
        </Button>
        <Button variant="outline" onClick={runAnalysisLoop} disabled={!sample || analyzing || loadingExisting || complete}>
          {analyzing
            ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Analizando lote {currentBatch?.index}/{currentBatch?.total}…</>
            : complete ? <>Muestra completa ✓</> : <>2. Correr / continuar análisis v3.0</>}
        </Button>
      </div>

      {sample && (
        <div className="rounded-2xl border border-border/50 bg-background/50 p-4 space-y-3">
          {/* Sample-scoped progress */}
          <div>
            <div className="flex justify-between text-xs mb-1">
              <span className="text-muted-foreground">Progreso de la muestra</span>
              <span className="font-mono">{processed} / {sampleSize} ({percent}%)</span>
            </div>
            <div className="h-2 rounded-full bg-background overflow-hidden">
              <div
                className={`h-full transition-all ${complete ? "bg-emerald-500" : "bg-accent"}`}
                style={{ width: `${percent}%` }}
              />
            </div>
            <div className="flex flex-wrap gap-2 text-xs mt-2">
              <Badge variant="secondary">sample_size: {sampleSize}</Badge>
              <Badge variant="secondary">sample_processed: {processed}</Badge>
              <Badge variant={pending > 0 ? "outline" : "secondary"}>sample_pending: {pending}</Badge>
              <Badge variant={failed > 0 ? "destructive" : "secondary"}>sample_failed: {failed}</Badge>
              {currentBatch && (
                <Badge variant="outline">current_batch: {currentBatch.index}/{currentBatch.total}</Badge>
              )}
              <Badge variant="outline">
                status: {complete ? "completed" : analyzing ? "running" : failed > 0 && pending === 0 ? "failed" : "idle"}
              </Badge>
            </div>
          </div>

          {Object.keys(sample.reasons_summary).length > 0 && (
            <div className="flex flex-wrap gap-1 text-xs pt-2 border-t border-border/40">
              <span className="text-muted-foreground mr-1">Cuotas:</span>
              {Object.entries(sample.reasons_summary).map(([k, v]) => (
                <Badge key={k} variant="outline" className="text-[10px]">{k}: {v}</Badge>
              ))}
            </div>
          )}

          {sample.preview.length > 0 && (
            <details>
              <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">Ver preview (30 canciones)</summary>
              <ul className="mt-2 space-y-1 max-h-56 overflow-y-auto pr-2 text-xs">
                {sample.preview.map((t) => (
                  <li key={t.spotify_track_id} className="flex justify-between gap-2">
                    <span className="truncate">{t.name} — <span className="text-muted-foreground">{t.artist}</span></span>
                    <span className="text-muted-foreground shrink-0">{t.reason}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}

          {permanentlyFailed.size > 0 && (
            <details>
              <summary className="cursor-pointer text-xs text-destructive hover:text-foreground">
                Ver {permanentlyFailed.size} IDs fallidos permanentemente
              </summary>
              <ul className="mt-2 space-y-1 max-h-40 overflow-y-auto pr-2 text-[10px] font-mono">
                {Array.from(permanentlyFailed).map((id) => (
                  <li key={id} className="text-muted-foreground">{id}</li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

      {lastError && (
        <div className="mt-3 rounded-xl border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
          {lastError}
        </div>
      )}

      {complete && (
        <div className="mt-4 rounded-2xl border border-emerald-500/40 bg-emerald-500/5 p-4 text-sm">
          <p>
            <strong>{processed}/{sampleSize}</strong> analizadas con <code>music_family</code>, <code>primary_subgenre</code>,{" "}
            <code>artist_context</code> y <code>house_profile</code> cuando aplique.
            {failed > 0 && <> · <strong>{failed}</strong> fallidas (revisar antes de aprobar Fase 2)</>}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Fase 2 (clustering endurecido) ya puede correr sobre esta muestra.
          </p>
        </div>
      )}

      <p className="text-[10px] text-muted-foreground mt-3">
        Nota: la biblioteca completa (fuera de la muestra) se analiza aparte con su propio contador; no se mezcla con este panel.
      </p>
    </div>
  );
}


type Phase2Row = {
  id: string;
  label: string;
  size: number;
  created_at: string;
  phase2_status: string;
  phase2_block_reason: string | null;
  phase2_started_at: string | null;
  phase2_finished_at: string | null;
  phase2_progress: any;
  phase2_report: any;
};

function Phase2ReportPanel() {
  const { user } = useAuth();
  const [row, setRow] = useState<Phase2Row | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [sampleAnalyzed, setSampleAnalyzed] = useState<number>(0);

  const fetchLatest = async () => {
    const { data } = await supabase
      .from("diagnostic_samples")
      .select("id, label, size, spotify_track_ids, created_at, phase2_status, phase2_block_reason, phase2_started_at, phase2_finished_at, phase2_progress, phase2_report")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    setRow((data as any) ?? null);
    if (data && user) {
      const done = await countAnalyzedInSample(user.id, (data.spotify_track_ids as string[]) ?? []);
      setSampleAnalyzed(done.size);
    }
    setLoading(false);
  };

  useEffect(() => {
    void fetchLatest();
    const iv = setInterval(fetchLatest, 6000);
    return () => clearInterval(iv);
  }, [user?.id]);

  const sampleComplete = row ? sampleAnalyzed >= row.size : false;

  const triggerGuard = async () => {
    if (!sampleComplete) {
      toast.error("Fase 2 bloqueada", {
        description: `La muestra aún no está completa (${sampleAnalyzed}/${row?.size}). Termina Fase 1 primero.`,
      });
      return;
    }
    setRunning(true);
    try {
      const { data, error } = await supabase.functions.invoke("phase2-guard", { body: {} });
      if (error) throw new Error(error.message);
      if (data?.blocked) {
        toast.error("Fase 2 bloqueada", { description: JSON.stringify(data.blocked).slice(0, 200) });
      } else if (data?.skipped) {
        toast.info("Sin cambios", { description: data.skipped });
      } else {
        toast.success("Fase 2 disparada");
      }
      await fetchLatest();
    } catch (e: any) {
      toast.error("No se pudo disparar Fase 2", { description: e.message });
    } finally {
      setRunning(false);
    }
  };

  if (loading) {
    return (
      <div className="rounded-3xl border border-border/40 bg-card/40 p-6 text-sm text-muted-foreground">
        <Loader2 className="inline w-4 h-4 mr-2 animate-spin" />Cargando estado de Fase 2…
      </div>
    );
  }
  if (!row) {
    return (
      <div className="rounded-3xl border border-border/40 bg-card/40 p-6 text-sm text-muted-foreground">
        Arma primero una muestra en el panel de Fase 1 para que Fase 2 pueda evaluarse.
      </div>
    );
  }

  const status = row.phase2_status;
  const report = row.phase2_report;

  const statusColor = {
    pending_analysis: "text-muted-foreground",
    blocked: "text-destructive",
    running: "text-amber-500",
    completed_awaiting_review: "text-emerald-500",
    approved_for_rollout: "text-emerald-600",
    failed: "text-destructive",
  }[status] ?? "text-muted-foreground";

  return (
    <div className="rounded-3xl border border-purple-500/40 bg-purple-500/5 p-6 md:p-8">
      <div className="flex items-center gap-2 mb-2">
        <Wand2 className="w-4 h-4 text-purple-400" />
        <p className="text-xs uppercase tracking-[0.2em] text-purple-400">Fase 2 · Clustering endurecido</p>
      </div>
      <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
        <div>
          <h2 className="font-heading text-2xl mb-1">Reporte sobre la muestra</h2>
          <p className="text-sm text-muted-foreground">
            Muestra <code>{row.label}</code> · {row.size} canciones · estado: <span className={statusColor}>{status}</span>
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => void fetchLatest()}>
            <RefreshCw className="w-3 h-3 mr-2" />Actualizar
          </Button>
          <Button variant="outline" size="sm" onClick={triggerGuard} disabled={running || status === "running"}>
            {running ? <Loader2 className="w-3 h-3 mr-2 animate-spin" /> : <Sparkles className="w-3 h-3 mr-2" />}
            Disparar Fase 2 ahora
          </Button>
        </div>
      </div>

      {status === "pending_analysis" && (
        <div className="rounded-2xl border border-border/40 bg-background/40 p-4 text-sm text-muted-foreground">
          Fase 2 se disparará sola cuando el análisis v3.0 termine sobre toda tu biblioteca. Si ya crees que terminó, pulsa <em>Disparar Fase 2 ahora</em>.
        </div>
      )}
      {status === "blocked" && (
        <div className="rounded-2xl border border-destructive/40 bg-destructive/5 p-4 text-sm">
          <p className="font-medium mb-1 text-destructive">Bloqueado — faltan datos v3</p>
          <pre className="whitespace-pre-wrap text-xs text-muted-foreground overflow-x-auto">{row.phase2_block_reason}</pre>
        </div>
      )}
      {status === "running" && (
        <div className="rounded-2xl border border-amber-500/40 bg-amber-500/5 p-4 text-sm">
          <Loader2 className="inline w-4 h-4 mr-2 animate-spin" />Corriendo clustering endurecido…
        </div>
      )}
      {status === "failed" && (
        <div className="rounded-2xl border border-destructive/40 bg-destructive/5 p-4 text-sm">
          <p className="font-medium mb-1 text-destructive">Falló</p>
          <pre className="whitespace-pre-wrap text-xs text-muted-foreground">{row.phase2_block_reason}</pre>
        </div>
      )}

      {report && (status === "completed_awaiting_review" || status === "approved_for_rollout") && (
        <Phase2ReportBody report={report} />
      )}
    </div>
  );
}

function Phase2ReportBody({ report }: { report: any }) {
  return (
    <div className="space-y-4 mt-2">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Clusters promovidos" value={report.clusters_promoted?.length ?? 0} />
        <Stat label="Clusters rechazados" value={report.clusters_rejected?.length ?? 0} />
        <Stat label="Sin asignar" value={report.unassigned?.length ?? 0} />
        <Stat label="Casos problemáticos" value={report.problem_cases?.length ?? 0} />
      </div>

      {report.diff_vs_previous && (
        <div className="rounded-2xl border border-border/40 bg-background/40 p-4 text-xs">
          <p className="uppercase tracking-[0.2em] text-muted-foreground mb-2">Diff v2 vs v3</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Stat label="Clusters antes" value={report.diff_vs_previous.previous_cluster_count} />
            <Stat label="Tamaño promedio antes" value={report.diff_vs_previous.previous_avg_size} />
            <Stat label="Clusters ahora" value={report.diff_vs_previous.new_cluster_count} />
            <Stat label="Fit promedio ahora" value={report.diff_vs_previous.new_avg_fit} />
          </div>
        </div>
      )}

      {report.problem_cases?.length > 0 && (
        <details open className="rounded-2xl border border-amber-500/40 bg-amber-500/5 p-4">
          <summary className="cursor-pointer text-sm font-medium text-amber-500">Casos problemáticos ({report.problem_cases.length})</summary>
          <ul className="mt-3 space-y-3 text-xs">
            {report.problem_cases.map((c: any, i: number) => (
              <li key={i} className="border-l-2 border-amber-500/50 pl-3">
                <p className="font-medium">{c.case}</p>
                <pre className="whitespace-pre-wrap text-muted-foreground">{JSON.stringify(c, null, 2)}</pre>
              </li>
            ))}
          </ul>
        </details>
      )}

      <details open className="rounded-2xl border border-border/40 bg-background/40 p-4">
        <summary className="cursor-pointer text-sm font-medium">Clusters promovidos ({report.clusters_promoted?.length ?? 0})</summary>
        <div className="mt-3 space-y-4">
          {report.clusters_promoted?.map((c: any, i: number) => (
            <div key={i} className="rounded-xl border border-border/40 p-3">
              <div className="flex flex-wrap items-center gap-2 mb-2">
                <p className="font-medium">{c.name}</p>
                <Badge variant="secondary">{c.size} canciones</Badge>
                <Badge variant="outline">bucket: {c.bucket}</Badge>
                <Badge variant="outline">avg fit {c.avg_final_fit}</Badge>
                <Badge variant="outline">min fit {c.min_final_fit}</Badge>
                {c.dominant_subgenre && <Badge variant="outline">{c.dominant_subgenre}</Badge>}
              </div>
              <ul className="text-xs space-y-1 max-h-64 overflow-y-auto pr-2">
                {c.tracks?.map((t: any, j: number) => (
                  <li key={j} className="flex justify-between gap-3">
                    <span className="truncate">{t.name} — <span className="text-muted-foreground">{t.artist}</span></span>
                    <span className="text-muted-foreground shrink-0 tabular-nums">
                      fit {t.final_fit} · sonic {t.sonic} · ctx {t.artist_context} · pen {t.artist_penalty}
                      {t.surprise ? " · ★surprise" : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </details>

      {report.clusters_rejected?.length > 0 && (
        <details className="rounded-2xl border border-border/40 bg-background/40 p-4">
          <summary className="cursor-pointer text-sm font-medium">Clusters rechazados ({report.clusters_rejected.length})</summary>
          <ul className="mt-3 space-y-2 text-xs">
            {report.clusters_rejected.map((c: any, i: number) => (
              <li key={i} className="flex justify-between gap-3 border-b border-border/30 pb-1">
                <span>{c.seed} <span className="text-muted-foreground">· bucket {c.bucket}</span></span>
                <span className="text-muted-foreground shrink-0">size {c.size} · {c.reason}</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      {report.unassigned?.length > 0 && (
        <details className="rounded-2xl border border-border/40 bg-background/40 p-4">
          <summary className="cursor-pointer text-sm font-medium">Canciones sin asignar ({report.unassigned.length})</summary>
          <ul className="mt-3 space-y-1 text-xs max-h-80 overflow-y-auto pr-2">
            {report.unassigned.map((u: any, i: number) => (
              <li key={i} className="flex justify-between gap-3">
                <span className="truncate">{u.name} — <span className="text-muted-foreground">{u.artist}</span></span>
                <span className="text-muted-foreground shrink-0">{u.reason}</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      <details className="rounded-2xl border border-border/40 bg-background/40 p-4">
        <summary className="cursor-pointer text-sm font-medium">Buckets iniciales</summary>
        <pre className="mt-2 text-xs text-muted-foreground overflow-x-auto">{JSON.stringify(report.buckets, null, 2)}</pre>
      </details>
    </div>
  );
}





function PlaylistDetail({ playlistId, onBack }: { playlistId: string; onBack: () => void }) {
  const { playlist, tracks, loading, removeTrack, move, updateMeta, refresh } = useGeneratedPlaylistDetail(playlistId);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [exporting, setExporting] = useState(false);
  const [isPublic, setIsPublic] = useState(false);
  const [exportError, setExportError] = useState<{ message: string; step?: string; needsReauth?: boolean } | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [review, setReview] = useState<any>(null);

  if (loading || !playlist) {
    return <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" />Cargando…</div>;
  }

  const startEdit = () => {
    setEditName(playlist.name);
    setEditDesc(playlist.description ?? "");
    setEditing(true);
  };

  const saveEdit = async () => {
    await updateMeta({ name: editName.trim() || playlist.name, description: editDesc.trim() || null });
    setEditing(false);
    toast.success("Cambios guardados");
  };

  const jobsApi = useJobs();

  const exportToSpotify = async () => {
    if (tracks.length === 0) { toast.error("La playlist está vacía"); return; }
    setExporting(true);
    setExportError(null);
    const jobId = jobsApi.startJob({
      type: "playlist_export",
      label: `Exportando "${playlist.name}" a Spotify`,
      message: "Verificando conexión con Spotify…",
      totalItems: tracks.length,
      retry: () => { void exportToSpotify(); },
    });
    try {
      jobsApi.updateJob(jobId, { message: `Guardando ${tracks.length} canciones en Spotify…` });
      const { data, error } = await supabase.functions.invoke("spotify-export-playlist", {
        body: {
          generated_playlist_id: playlistId,
          name: playlist.name,
          description: playlist.description ?? "",
          track_ids: tracks.map((t) => t.spotify_track_id),
          is_public: isPublic,
          spotify_playlist_id: playlist.spotify_playlist_id ?? undefined,
        },
      });
      if (error) throw new Error(error.message);
      if (data?.error) {
        setExportError({ message: data.error, step: data.step, needsReauth: data.needs_reauth });
        jobsApi.failJob(jobId, data.error, { step: data.step });
        throw new Error(data.error);
      }
      jobsApi.completeJob(jobId, data.is_update ? "Playlist actualizada en Spotify" : "Playlist exportada a Spotify");
      toast.success(data.is_update ? "Playlist actualizada en Spotify" : "Exportada a Spotify");
      await refresh();
    } catch (e: any) {
      if (!exportError) setExportError({ message: e.message });
      // failJob already called when API returned data.error
      toast.error("Export falló", { description: e.message });
    } finally {
      setExporting(false);
    }
  };

  const runReview = async (apply: boolean) => {
    setReviewing(true);
    const jobId = jobsApi.startJob({
      type: "playlist_review",
      label: apply ? `Aplicando revisión a "${playlist.name}"` : `Revisando "${playlist.name}" con IA`,
      message: "Analizando coherencia sonora…",
      retry: () => { void runReview(apply); },
    });
    try {
      const { data, error } = await supabase.functions.invoke("review-playlist", {
        body: { generated_playlist_id: playlistId, apply },
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      setReview(data.review);
      jobsApi.completeJob(jobId, apply ? "Revisión aplicada" : `Coherencia ${(data.review?.coherence_score ?? 0).toFixed(2)}`);
      if (apply) { await refresh(); toast.success("Revisión aplicada"); }
      else toast.success("Revisión lista");
    } catch (e: any) {
      jobsApi.failJob(jobId, e.message);
      toast.error("No se pudo revisar", { description: e.message });
    } finally {
      setReviewing(false);
    }
  };


  const status = playlist.status || (playlist.is_exported_to_spotify ? "exported" : "draft");

  const statusBadge =
    status === "exported" ? <Badge variant="outline" className="text-xs"><Check className="w-3 h-3 mr-1" />Exported</Badge>
    : status === "exporting" ? <Badge variant="secondary" className="text-xs"><Loader2 className="w-3 h-3 mr-1 animate-spin" />Exporting</Badge>
    : status === "failed" ? <Badge variant="destructive" className="text-xs"><AlertTriangle className="w-3 h-3 mr-1" />Failed</Badge>
    : status === "ready_to_export" ? <Badge className="text-xs">Ready to export</Badge>
    : <Badge variant="secondary" className="text-xs">Draft</Badge>;

  return (
    <div className="max-w-4xl">
      <Button variant="ghost" onClick={onBack} className="mb-6"><ArrowLeft className="w-4 h-4 mr-2" />Volver</Button>

      <div className="rounded-3xl border border-border/50 bg-card/50 p-6 md:p-8 mb-6">
        <div className="flex items-center gap-2 mb-2">
          {playlist.concept && <p className="text-xs uppercase tracking-[0.2em] text-accent">{playlist.concept}</p>}
          {statusBadge}
        </div>

        {editing ? (
          <div className="space-y-3">
            <Input value={editName} onChange={(e) => setEditName(e.target.value)} className="text-2xl h-12" />
            <Textarea value={editDesc} onChange={(e) => setEditDesc(e.target.value)} rows={3} placeholder="Descripción" />
            <div className="flex gap-2">
              <Button variant="hero" size="sm" onClick={saveEdit}><Check className="w-4 h-4 mr-1.5" />Guardar</Button>
              <Button variant="ghost" size="sm" onClick={() => setEditing(false)}><X className="w-4 h-4 mr-1.5" />Cancelar</Button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-start justify-between gap-3">
              <h1 className="font-heading text-3xl md:text-4xl mb-2">{playlist.name}</h1>
              <Button variant="ghost" size="sm" onClick={startEdit}><Pencil className="w-4 h-4" /></Button>
            </div>
            {playlist.description && <p className="text-muted-foreground mb-3">{playlist.description}</p>}
            <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
              {playlist.vibe && <span><strong className="text-foreground">Vibe:</strong> {playlist.vibe}</span>}
              {playlist.context && <span><strong className="text-foreground">Contexto:</strong> {playlist.context}</span>}
              <span><ListMusic className="w-3 h-3 inline mr-1" />{tracks.length} canciones</span>
            </div>

            {!playlist.is_exported_to_spotify && (
              <div className="flex items-center gap-3 mt-5 p-3 rounded-xl border border-border/50 bg-background/40">
                {isPublic ? <Globe className="w-4 h-4 text-accent" /> : <Lock className="w-4 h-4 text-muted-foreground" />}
                <div className="flex-1">
                  <p className="text-sm font-medium">{isPublic ? "Pública" : "Privada"}</p>
                  <p className="text-xs text-muted-foreground">
                    {isPublic ? "Cualquiera con el link podrá verla en Spotify." : "Solo tú podrás verla en tu cuenta de Spotify."}
                  </p>
                </div>
                <Switch checked={isPublic} onCheckedChange={setIsPublic} disabled={exporting} />
              </div>
            )}

            <div className="flex flex-wrap gap-2 mt-5">
              {playlist.is_exported_to_spotify && playlist.spotify_url ? (
                <>
                  <Button variant="hero" size="sm" asChild>
                    <a href={playlist.spotify_url} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="w-4 h-4 mr-1.5" />Abrir en Spotify
                    </a>
                  </Button>
                  <Button variant="outline" size="sm" onClick={exportToSpotify} disabled={exporting}>
                    {exporting ? <><Loader2 className="w-4 h-4 mr-1.5 animate-spin" />Sincronizando…</> : <><RefreshCw className="w-4 h-4 mr-1.5" />Sincronizar cambios</>}
                  </Button>
                </>
              ) : (
                <Button variant="hero" size="sm" onClick={exportToSpotify} disabled={exporting}>
                  {exporting ? <><Loader2 className="w-4 h-4 mr-1.5 animate-spin" />Exportando…</> : <><Upload className="w-4 h-4 mr-1.5" />Exportar a Spotify</>}
                </Button>
              )}
              <Button variant="outline" size="sm" onClick={() => runReview(false)} disabled={reviewing || tracks.length === 0}>
                {reviewing ? <><Loader2 className="w-4 h-4 mr-1.5 animate-spin" />Revisando…</> : <><ShieldCheck className="w-4 h-4 mr-1.5" />Revisar con IA</>}
              </Button>
            </div>

            {review && (
              <div className="mt-5 rounded-2xl border border-border/50 bg-background/40 p-4">
                <div className="flex items-center justify-between gap-3 mb-3">
                  <div className="flex items-center gap-2">
                    <ShieldCheck className={`w-4 h-4 ${review.approved ? "text-accent" : "text-destructive"}`} />
                    <p className="text-sm font-medium">
                      {review.approved ? "Playlist aprobada" : "Necesita ajustes"}
                    </p>
                  </div>
                  <div className="flex gap-3 text-xs text-muted-foreground tabular-nums">
                    <span>Coh. {Math.round((review.coherence_score ?? 0) * 100)}%</span>
                    <span>Nom. {Math.round((review.name_score ?? 0) * 100)}%</span>
                    <span>Ord. {Math.round((review.ordering_score ?? 0) * 100)}%</span>
                  </div>
                </div>
                {review.main_issue && review.main_issue !== "ninguno" && (
                  <p className="text-xs text-muted-foreground mb-3"><strong className="text-foreground">Problema:</strong> {review.main_issue}</p>
                )}
                {review.songs_to_remove?.length > 0 && (
                  <div className="mb-2">
                    <p className="text-xs font-medium mb-1">Sugiere eliminar {review.songs_to_remove.length}:</p>
                    <ul className="text-xs text-muted-foreground space-y-1">
                      {review.songs_to_remove.slice(0, 5).map((r: any, i: number) => (
                        <li key={i}>• {tracks.find(t => t.spotify_track_id === r.spotify_track_id)?.name ?? r.spotify_track_id}: {r.reason}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {review.songs_to_reorder?.length > 0 && (
                  <p className="text-xs text-muted-foreground mb-2">Sugiere reordenar {review.songs_to_reorder.length} canciones.</p>
                )}
                {review.should_split && (
                  <p className="text-xs text-muted-foreground mb-2"><strong className="text-foreground">Dividir:</strong> {review.split_reason}</p>
                )}
                <div className="flex flex-wrap gap-2 mt-3">
                  <Button variant="hero" size="sm" onClick={() => runReview(true)} disabled={reviewing}>
                    <Check className="w-3.5 h-3.5 mr-1.5" />Aplicar cambios
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setReview(null)}>
                    <X className="w-3.5 h-3.5 mr-1.5" />Descartar
                  </Button>
                </div>
              </div>
            )}
          </>
        )}


        {exportError && (
          <div className="mt-5 rounded-xl border border-destructive/40 bg-destructive/5 p-4">
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-destructive mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-destructive">No se pudo exportar a Spotify</p>
                <p className="text-xs text-muted-foreground mt-1">{exportError.message}</p>
                {exportError.step && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Paso fallido: <code className="text-foreground">{exportError.step}</code>
                  </p>
                )}
                <div className="flex flex-wrap gap-2 mt-3">
                  <Button variant="outline" size="sm" onClick={exportToSpotify} disabled={exporting}>
                    <RefreshCw className="w-3.5 h-3.5 mr-1.5" />Reintentar
                  </Button>
                  <Button variant="ghost" size="sm" asChild>
                    <Link to="/settings"><SettingsIcon className="w-3.5 h-3.5 mr-1.5" />Revisar conexión</Link>
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}

        {!exportError && playlist.last_export_error && status === "failed" && (
          <div className="mt-5 rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-xs text-muted-foreground">
            <p className="font-medium text-destructive flex items-center gap-1.5"><AlertTriangle className="w-3.5 h-3.5" />Último intento falló</p>
            <p className="mt-1">{playlist.last_export_error}</p>
            {playlist.last_export_step && <p className="mt-1">Paso: <code className="text-foreground">{playlist.last_export_step}</code></p>}
          </div>
        )}
      </div>

      <div className="space-y-2">
        {tracks.map((t, i) => (
          <div key={t.id} className="rounded-2xl border border-border/50 bg-card/40 p-3 flex items-center gap-3">
            <span className="w-6 text-center text-xs text-muted-foreground">{i + 1}</span>
            {t.image_url ? (
              <img src={t.image_url} alt="" className="w-12 h-12 rounded-md object-cover" />
            ) : (
              <div className="w-12 h-12 rounded-md bg-muted flex items-center justify-center"><Music className="w-4 h-4 text-muted-foreground" /></div>
            )}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{t.name}</p>
              <p className="text-xs text-muted-foreground truncate">{t.artist_names.join(", ")}</p>
              {t.reason_for_inclusion && (
                <p className="text-xs text-muted-foreground/80 italic mt-1 line-clamp-2">{t.reason_for_inclusion}</p>
              )}
            </div>
            {typeof t.fit_score === "number" && (
              <span className="text-xs text-muted-foreground tabular-nums">{Math.round(t.fit_score * 100)}%</span>
            )}
            <div className="flex gap-1">
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => move(t.id, -1)} disabled={i === 0}><ArrowUp className="w-3.5 h-3.5" /></Button>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => move(t.id, 1)} disabled={i === tracks.length - 1}><ArrowDown className="w-3.5 h-3.5" /></Button>
              <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => removeTrack(t.id)}><Trash2 className="w-3.5 h-3.5" /></Button>
            </div>
          </div>
        ))}
        {tracks.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-12">Esta playlist está vacía.</p>
        )}
      </div>
    </div>
  );
}

export default Playlists;
