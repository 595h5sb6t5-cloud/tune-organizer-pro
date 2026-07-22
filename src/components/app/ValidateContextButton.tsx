import { useState } from "react";
import { ShieldAlert, Loader2, ArrowRightLeft, XCircle, Eye, Sparkles } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type Finding = {
  gpt_id: string;
  position: number;
  track_name: string | null;
  artist_name: string | null;
  genre: string | null;
  sonic_fit: number;
  musical_context_fit: number;
  user_taste_fit: number;
  artist_context_penalty: number;
  final_fit_score: number;
  artist_surprise: boolean;
  action: "keep" | "review" | "move" | "unassign" | "surprise_ok";
  reason: string;
};

type Report = {
  playlist_id: string;
  name: string;
  dominant_genre: string | null;
  total: number;
  summary: { keep: number; review: number; move: number; unassign: number; surprise: number };
  findings: Finding[];
};

const actionMeta: Record<Finding["action"], { label: string; icon: any; className: string }> = {
  keep: { label: "OK", icon: Sparkles, className: "bg-emerald-500/10 text-emerald-500 border-emerald-500/30" },
  surprise_ok: { label: "Sorpresa validada", icon: Sparkles, className: "bg-accent/10 text-accent border-accent/30" },
  review: { label: "Revisar", icon: Eye, className: "bg-amber-500/10 text-amber-500 border-amber-500/30" },
  move: { label: "Mover", icon: ArrowRightLeft, className: "bg-orange-500/10 text-orange-500 border-orange-500/30" },
  unassign: { label: "Sacar de la playlist", icon: XCircle, className: "bg-destructive/10 text-destructive border-destructive/30" },
};

export default function ValidateContextButton({ playlistId, playlistName }: { playlistId: string; playlistName: string }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState<Report | null>(null);

  const run = async () => {
    setLoading(true);
    setReport(null);
    try {
      const { data, error } = await supabase.functions.invoke("validate-playlist-context", {
        body: { playlist_id: playlistId },
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      const first: Report | undefined = data.playlists?.[0];
      if (!first) throw new Error("Sin canciones para validar");
      setReport(first);
    } catch (e: any) {
      toast.error("Validación falló", { description: e.message });
    } finally {
      setLoading(false);
    }
  };

  const openAndRun = (e: React.MouseEvent) => {
    e.stopPropagation();
    setOpen(true);
    void run();
  };

  const flagged = report?.findings.filter((f) => f.action !== "keep" && f.action !== "surprise_ok") ?? [];
  const ok = report?.findings.filter((f) => f.action === "keep" || f.action === "surprise_ok") ?? [];

  return (
    <>
      <button
        type="button"
        onClick={openAndRun}
        className="absolute top-3 right-11 p-1.5 rounded-lg text-muted-foreground hover:text-accent hover:bg-accent/10 transition-colors z-10"
        aria-label="Validar contexto de artistas"
        title="Validar artistas y contexto"
      >
        <ShieldAlert className="w-4 h-4" />
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-heading">Validación de contexto · {playlistName}</DialogTitle>
            <DialogDescription>
              Segunda capa: revisa artistas, género y gusto sin cambiar los clusters. Ninguna canción se mueve automáticamente.
            </DialogDescription>
          </DialogHeader>

          {loading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
              <Loader2 className="w-4 h-4 animate-spin" /> Analizando contexto…
            </div>
          )}

          {report && (
            <div className="space-y-5">
              <div className="flex flex-wrap gap-2 text-xs">
                <Badge variant="outline">Total: {report.total}</Badge>
                {report.dominant_genre && <Badge variant="outline">Género dominante: {report.dominant_genre}</Badge>}
                <Badge variant="outline" className="border-emerald-500/30 text-emerald-600">OK: {report.summary.keep}</Badge>
                <Badge variant="outline" className="border-amber-500/30 text-amber-600">Revisar: {report.summary.review}</Badge>
                <Badge variant="outline" className="border-orange-500/30 text-orange-600">Mover: {report.summary.move}</Badge>
                <Badge variant="outline" className="border-destructive/30 text-destructive">Sacar: {report.summary.unassign}</Badge>
                {report.summary.surprise > 0 && (
                  <Badge variant="outline" className="border-accent/30 text-accent">Artist surprise: {report.summary.surprise}</Badge>
                )}
              </div>

              {flagged.length === 0 ? (
                <p className="text-sm text-muted-foreground rounded-xl border border-border/50 p-4">
                  Ninguna canción rompe la identidad del grupo. La playlist se siente coherente.
                </p>
              ) : (
                <div>
                  <h4 className="font-heading text-sm mb-2">Canciones a revisar</h4>
                  <div className="space-y-2">
                    {flagged.map((f) => {
                      const meta = actionMeta[f.action];
                      const Icon = meta.icon;
                      return (
                        <div key={f.gpt_id} className="rounded-xl border border-border/60 p-3">
                          <div className="flex items-start justify-between gap-3 mb-1">
                            <div className="min-w-0">
                              <p className="text-sm font-medium truncate">
                                {f.track_name ?? "Sin título"} <span className="text-muted-foreground font-normal">· {f.artist_name ?? "?"}</span>
                              </p>
                              {f.genre && <p className="text-xs text-muted-foreground">{f.genre}</p>}
                            </div>
                            <Badge variant="outline" className={`${meta.className} shrink-0`}>
                              <Icon className="w-3 h-3 mr-1" />{meta.label}
                            </Badge>
                          </div>
                          <p className="text-xs text-muted-foreground mb-2">{f.reason}</p>
                          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-[11px]">
                            <Metric label="Sonic" v={f.sonic_fit} />
                            <Metric label="Contexto" v={f.musical_context_fit} />
                            <Metric label="Gusto" v={f.user_taste_fit} />
                            <Metric label="Penalización" v={f.artist_context_penalty} invert />
                            <Metric label="Final" v={f.final_fit_score} strong />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {ok.length > 0 && (
                <details className="text-xs text-muted-foreground">
                  <summary className="cursor-pointer">Ver {ok.length} canciones que quedan como están</summary>
                  <ul className="mt-2 space-y-1 pl-2">
                    {ok.map((f) => (
                      <li key={f.gpt_id} className="truncate">
                        · {f.track_name} — {f.artist_name} <span className="opacity-60">({f.final_fit_score.toFixed(2)})</span>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function Metric({ label, v, invert, strong }: { label: string; v: number; invert?: boolean; strong?: boolean }) {
  const good = invert ? v <= 0.1 : v >= 0.75;
  const bad = invert ? v >= 0.2 : v < 0.6;
  const color = good ? "text-emerald-500" : bad ? "text-destructive" : "text-muted-foreground";
  return (
    <div className="rounded-lg bg-muted/40 px-2 py-1.5">
      <p className="opacity-60">{label}</p>
      <p className={`${color} ${strong ? "font-semibold" : ""}`}>{v.toFixed(2)}</p>
    </div>
  );
}
