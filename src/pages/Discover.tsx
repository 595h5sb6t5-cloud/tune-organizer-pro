import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  Compass, Sparkles, Loader2, Check, X, Plus, Music, ExternalLink, Play, Pause, RefreshCw, AlertTriangle,
} from "lucide-react";
import AppLayout from "@/components/app/AppLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/hooks/use-auth";
import { useGeneratedPlaylists } from "@/hooks/use-generated-playlists";
import { supabase } from "@/integrations/supabase/client";
import { useJobs } from "@/hooks/use-jobs";
import { toast } from "sonner";

interface Recommendation {
  id: string;
  spotify_track_id: string | null;
  track_name: string | null;
  artist_name: string | null;
  album_name: string | null;
  image_url: string | null;
  preview_url: string | null;
  fit_score: number | null;
  recommendation_reason: string | null;
  status: string;
  based_on_playlist_id: string | null;
}

const Discover = () => {
  const { profile } = useAuth();
  const spotifyConnected = profile?.spotify_connected ?? false;
  const { playlists, loading: loadingPl } = useGeneratedPlaylists();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [recs, setRecs] = useState<Recommendation[]>([]);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState<string | null>(null);
  const [audio, setAudio] = useState<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (!selectedId && playlists.length && !loadingPl) setSelectedId(playlists[0].id);
  }, [playlists, loadingPl, selectedId]);

  const loadRecs = useCallback(async (playlistId: string) => {
    setLoading(true);
    const { data } = await supabase
      .from("recommendations")
      .select("*")
      .eq("based_on_playlist_id", playlistId)
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(50);
    setRecs((data ?? []) as Recommendation[]);
    setLoading(false);
  }, []);

  useEffect(() => { if (selectedId) void loadRecs(selectedId); }, [selectedId, loadRecs]);

  const jobsApi = useJobs();

  const generate = async () => {
    if (!selectedId) return;
    setGenerating(true);
    setError(null);
    const jobId = jobsApi.startJob({
      type: "recommendations",
      label: "Buscando recomendaciones",
      message: "Analizando tu playlist…",
      retry: () => { void generate(); },
    });
    try {
      jobsApi.updateJob(jobId, { message: "Pidiendo sugerencias a la IA…" });
      const { data, error } = await supabase.functions.invoke("recommend-for-playlist", {
        body: { generated_playlist_id: selectedId, count: 12 },
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      jobsApi.completeJob(jobId, `${data.count} recomendaciones nuevas`);
      toast.success(`Encontramos ${data.count} recomendaciones`);
      await loadRecs(selectedId);
    } catch (e: any) {
      setError(e.message);
      jobsApi.failJob(jobId, e.message, { step: "recommend", technical: e?.stack });
      toast.error("No se pudo generar recomendaciones", { description: e.message });
    } finally {
      setGenerating(false);
    }
  };

  const act = async (rec: Recommendation, action: "accept" | "reject" | "add_to_playlist") => {
    setRecs((prev) => prev.filter((r) => r.id !== rec.id));
    try {
      const { data, error } = await supabase.functions.invoke("recommendation-action", {
        body: { recommendation_id: rec.id, action },
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      if (action === "reject") toast("Marcada como no encaja", { description: "Mejoraremos próximas sugerencias" });
      else if (action === "accept") toast.success("Guardada en aceptadas");
      else toast.success(data.pushed_to_spotify ? "Añadida a la playlist y a Spotify" : "Añadida a la playlist");
    } catch (e: any) {
      toast.error("Acción falló", { description: e.message });
      if (selectedId) void loadRecs(selectedId);
    }
  };

  const togglePreview = (rec: Recommendation) => {
    if (!rec.preview_url) return;
    if (previewing === rec.id) {
      audio?.pause();
      setPreviewing(null);
      return;
    }
    audio?.pause();
    const a = new Audio(rec.preview_url);
    a.volume = 0.7;
    a.play().catch(() => {});
    a.onended = () => setPreviewing(null);
    setAudio(a);
    setPreviewing(rec.id);
  };

  if (!spotifyConnected) {
    return (
      <AppLayout>
        <EmptyState
          title="Conecta Spotify para descubrir música"
          desc="Necesitamos tu biblioteca real para recomendar canciones que encajen con tu DNA."
          cta={<Button variant="hero" asChild><Link to="/settings"><Sparkles className="w-4 h-4 mr-2" />Connect Spotify</Link></Button>}
        />
      </AppLayout>
    );
  }

  if (!loadingPl && playlists.length === 0) {
    return (
      <AppLayout>
        <EmptyState
          title="Genera primero una playlist"
          desc="Discover encuentra canciones nuevas que encajan con tus playlists generadas. Crea una para empezar."
          cta={<Button variant="hero" asChild><Link to="/playlists"><Sparkles className="w-4 h-4 mr-2" />Ir a AI Playlists</Link></Button>}
        />
      </AppLayout>
    );
  }

  const selected = playlists.find((p) => p.id === selectedId);

  return (
    <AppLayout>
      <div className="max-w-6xl">
        <div className="mb-8">
          <h1 className="font-heading text-3xl mb-1">Discover</h1>
          <p className="text-muted-foreground">Música nueva afinada a la vibra de tus playlists generadas.</p>
        </div>

        <div className="rounded-3xl border border-border/50 bg-card/40 p-5 mb-6">
          <p className="text-xs uppercase tracking-[0.2em] text-accent mb-3">Recomendar para</p>
          <div className="flex flex-wrap gap-2 mb-4">
            {playlists.map((p) => (
              <button
                key={p.id}
                onClick={() => setSelectedId(p.id)}
                className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                  selectedId === p.id
                    ? "border-accent bg-accent/15 text-accent"
                    : "border-border/50 bg-background/40 hover:border-accent/40"
                }`}
              >
                {p.name}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button variant="hero" size="sm" onClick={generate} disabled={generating || !selectedId}>
              {generating ? <><Loader2 className="w-4 h-4 mr-1.5 animate-spin" />Buscando…</> : <><Sparkles className="w-4 h-4 mr-1.5" />Generar recomendaciones</>}
            </Button>
            {selected && (
              <p className="text-xs text-muted-foreground">
                Concepto: <span className="text-foreground">{selected.concept ?? selected.name}</span>
              </p>
            )}
          </div>

          {error && (
            <div className="mt-4 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-xs">
              <p className="text-destructive flex items-center gap-1.5"><AlertTriangle className="w-3.5 h-3.5" />{error}</p>
            </div>
          )}
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" />Cargando…</div>
        ) : recs.length === 0 ? (
          <div className="rounded-3xl border border-border/50 bg-surface-elevated p-12 text-center">
            <div className="w-12 h-12 rounded-2xl bg-accent/15 flex items-center justify-center mx-auto mb-4">
              <Compass className="w-6 h-6 text-accent" />
            </div>
            <h3 className="font-heading text-xl mb-1">Aún no hay sugerencias</h3>
            <p className="text-sm text-muted-foreground">Pulsa “Generar recomendaciones” para que la IA explore canciones nuevas que encajen.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {recs.map((rec) => (
              <div key={rec.id} className="rounded-2xl border border-border/50 bg-card/50 p-4 flex gap-4">
                <div className="relative w-20 h-20 shrink-0">
                  {rec.image_url ? (
                    <img src={rec.image_url} alt="" className="w-20 h-20 rounded-lg object-cover" />
                  ) : (
                    <div className="w-20 h-20 rounded-lg bg-muted flex items-center justify-center"><Music className="w-5 h-5 text-muted-foreground" /></div>
                  )}
                  {rec.preview_url && (
                    <button
                      onClick={() => togglePreview(rec)}
                      className="absolute inset-0 rounded-lg flex items-center justify-center bg-black/40 opacity-0 hover:opacity-100 transition-opacity"
                    >
                      {previewing === rec.id ? <Pause className="w-5 h-5 text-white" /> : <Play className="w-5 h-5 text-white" />}
                    </button>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <div className="min-w-0">
                      <p className="font-medium truncate">{rec.track_name}</p>
                      <p className="text-sm text-muted-foreground truncate">{rec.artist_name}</p>
                    </div>
                    {typeof rec.fit_score === "number" && (
                      <Badge variant="outline" className="text-xs shrink-0">{Math.round(rec.fit_score * 100)}% fit</Badge>
                    )}
                  </div>
                  {rec.recommendation_reason && (
                    <p className="text-xs text-muted-foreground italic line-clamp-2 mb-3">{rec.recommendation_reason}</p>
                  )}
                  <div className="flex flex-wrap gap-1.5">
                    <Button size="sm" variant="hero" onClick={() => act(rec, "add_to_playlist")}>
                      <Plus className="w-3.5 h-3.5 mr-1" />Añadir a playlist
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => act(rec, "accept")}>
                      <Check className="w-3.5 h-3.5 mr-1" />Aceptar
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => act(rec, "reject")}>
                      <X className="w-3.5 h-3.5 mr-1" />Descartar
                    </Button>
                    {rec.spotify_track_id && (
                      <Button size="sm" variant="ghost" asChild>
                        <a href={`https://open.spotify.com/track/${rec.spotify_track_id}`} target="_blank" rel="noopener noreferrer">
                          <ExternalLink className="w-3.5 h-3.5" />
                        </a>
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {recs.length > 0 && (
          <div className="mt-6 flex justify-center">
            <Button variant="outline" size="sm" onClick={generate} disabled={generating}>
              {generating ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-1.5" />}
              Generar más
            </Button>
          </div>
        )}
      </div>
    </AppLayout>
  );
};

function EmptyState({ title, desc, cta }: { title: string; desc: string; cta: React.ReactNode }) {
  return (
    <div className="max-w-3xl">
      <div className="mb-8">
        <h1 className="font-heading text-3xl mb-1">Discover</h1>
        <p className="text-muted-foreground">Música nueva, afinada a tu vibra.</p>
      </div>
      <div className="rounded-3xl bg-surface-elevated border border-border/50 p-12 text-center">
        <div className="w-14 h-14 rounded-2xl bg-accent/15 flex items-center justify-center mx-auto mb-5">
          <Compass className="w-7 h-7 text-accent" />
        </div>
        <h2 className="font-heading text-2xl mb-2">{title}</h2>
        <p className="text-sm text-muted-foreground max-w-md mx-auto mb-6">{desc}</p>
        {cta}
      </div>
    </div>
  );
}

export default Discover;
