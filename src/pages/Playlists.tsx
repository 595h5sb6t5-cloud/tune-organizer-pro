import { useState } from "react";
import { Link } from "react-router-dom";
import {
  Sparkles, Loader2, Music, Plus, Wand2, ExternalLink, ArrowLeft, ArrowUp, ArrowDown,
  Trash2, Upload, Pencil, Check, X, ListMusic, AlertTriangle, Globe, Lock, RefreshCw, Settings as SettingsIcon,
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

const SUGGESTED_CONCEPTS = [
  "Late Night Drive", "Tropical Sunset", "Soft Indie Mood", "Poolside Grooves",
  "Old School Soul", "Dance Clean Energy", "Main Character Walk", "Sunday Morning Calm",
  "Beach Club Chill", "Golden Hour Grooves", "Elegant Indie Funk", "Warm Electronic Sunset",
  "Pre-Game Energy", "Chill but Expensive", "Romantic but not Cheesy",
];

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

        <Generator onCreated={(id) => { void refresh(); setSelected(id); }} />

        <div className="mt-10">
          <h2 className="font-heading text-xl mb-4">Tus playlists generadas</h2>
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" />Cargando…</div>
          ) : playlists.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aún no has generado ninguna playlist. Empieza arriba.</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {playlists.map((p) => (
                <button
                  key={p.id}
                  onClick={() => setSelected(p.id)}
                  className="text-left rounded-2xl border border-border/50 bg-card/50 p-5 hover:border-accent/50 transition-colors"
                >
                  <div className="flex items-start justify-between gap-3 mb-2">
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

function Generator({ onCreated }: { onCreated: (id: string) => void }) {
  const [concept, setConcept] = useState("");
  const [size, setSize] = useState(25);
  const [running, setRunning] = useState(false);
  const jobsApi = useJobs();

  const generate = async (conceptOverride?: string) => {
    const c = (conceptOverride ?? concept).trim();
    setRunning(true);
    const jobId = jobsApi.startJob({
      type: "playlist_generation",
      label: c ? `Generando "${c}"` : "Generando playlist con IA",
      message: "Analizando tu biblioteca…",
      retry: () => { void generate(c); },
    });
    try {
      jobsApi.updateJob(jobId, { message: "Pidiendo curaduría a la IA…" });
      const { data, error } = await supabase.functions.invoke("generate-ai-playlist", {
        body: { concept: c || undefined, target_size: size },
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      jobsApi.completeJob(jobId, `${data.name} · ${data.track_count} canciones`);
      toast.success("Playlist generada", { description: `${data.name} · ${data.track_count} canciones` });
      onCreated(data.playlist_id);
      setConcept("");
    } catch (e: any) {
      jobsApi.failJob(jobId, e.message, { step: "generate", technical: e?.stack });
      toast.error("No se pudo generar", { description: e.message });
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="rounded-3xl border border-border/50 bg-gradient-to-br from-accent/10 via-primary/5 to-background p-6 md:p-8">
      <div className="flex items-center gap-2 mb-2">
        <Wand2 className="w-4 h-4 text-accent" />
        <p className="text-xs uppercase tracking-[0.2em] text-accent">Generator</p>
      </div>
      <h2 className="font-heading text-2xl mb-4">Construye una playlist con un concepto.</h2>

      <div className="flex flex-col md:flex-row gap-3 mb-4">
        <Input
          value={concept}
          onChange={(e) => setConcept(e.target.value)}
          placeholder="Ej: Late Night Drive, Golden Hour Grooves, Chill but Expensive…"
          className="flex-1"
          disabled={running}
        />
        <Input
          type="number"
          value={size}
          onChange={(e) => setSize(Math.min(40, Math.max(12, Number(e.target.value) || 25)))}
          className="w-full md:w-28"
          disabled={running}
          min={12}
          max={40}
        />
        <Button variant="hero" onClick={() => generate()} disabled={running}>
          {running ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Generando…</> : <><Plus className="w-4 h-4 mr-2" />Generar</>}
        </Button>
      </div>

      <div className="flex flex-wrap gap-2">
        {SUGGESTED_CONCEPTS.map((c) => (
          <button
            key={c}
            disabled={running}
            onClick={() => { setConcept(c); void generate(c); }}
            className="text-xs px-3 py-1.5 rounded-full border border-border/50 bg-card/50 hover:border-accent/50 transition-colors disabled:opacity-50"
          >
            {c}
          </button>
        ))}
      </div>

      <p className="text-xs text-muted-foreground mt-4">
        Si dejas el concepto vacío, la IA elegirá uno coherente con tu biblioteca. La playlist queda como borrador antes de exportarse a Spotify.
      </p>
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

  const exportToSpotify = async () => {
    if (tracks.length === 0) { toast.error("La playlist está vacía"); return; }
    setExporting(true);
    setExportError(null);
    try {
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
        throw new Error(data.error);
      }
      toast.success(data.is_update ? "Playlist actualizada en Spotify" : "Exportada a Spotify");
      await refresh();
    } catch (e: any) {
      if (!exportError) setExportError({ message: e.message });
      toast.error("Export falló", { description: e.message });
    } finally {
      setExporting(false);
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
            </div>
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
