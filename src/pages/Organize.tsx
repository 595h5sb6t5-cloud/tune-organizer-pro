import { useState } from "react";
import { Link } from "react-router-dom";
import { Music2, Loader2, Check, X, ChevronDown, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { disconnectSpotify, isSpotifyConnected, loginWithSpotify } from "@/lib/spotify/auth";
import {
  addTracksToPlaylist,
  createPlaylist,
  getAllLikedTracks,
  getArtistGenres,
  SpotifyAuthError,
} from "@/lib/spotify/api";
import { buildProfiles, type TrackProfile } from "@/lib/playlist/features";
import { enrichWithAI, isAiEnabled } from "@/lib/playlist/ai";
import { organizeLibrary, sequence, type PlaylistDraft } from "@/lib/playlist/organize";

type Step = { label: string; done: number; total: number };

const formatTime = (ms: number) => {
  const min = Math.round(ms / 60000);
  return min >= 60 ? `${Math.floor(min / 60)} h ${min % 60} min` : `${min} min`;
};

const Organize = () => {
  const [connected, setConnected] = useState(isSpotifyConnected());
  const [step, setStep] = useState<Step | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [playlists, setPlaylists] = useState<PlaylistDraft[]>([]);
  const [unsorted, setUnsorted] = useState<TrackProfile[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [saved, setSaved] = useState<Record<string, string>>({});

  async function analyze() {
    setError(null);
    setPlaylists([]);
    setUnsorted([]);
    try {
      setStep({ label: "Reading your Liked Songs", done: 0, total: 0 });
      const tracks = await getAllLikedTracks((done, total) =>
        setStep({ label: "Reading your Liked Songs", done, total }),
      );
      if (!tracks.length) {
        setError("Your Liked Songs list is empty. Like a few songs on Spotify and try again.");
        setStep(null);
        return;
      }

      const artistIds = tracks.flatMap((t) => t.artists.map((a) => a.id));
      const genres = await getArtistGenres(artistIds, (done, total) =>
        setStep({ label: "Looking up artist genres", done, total }),
      );

      let profiles = buildProfiles(tracks, genres);
      if (isAiEnabled()) {
        profiles = await enrichWithAI(profiles, (done, total) =>
          setStep({ label: "Listening for language, energy and mood", done, total }),
        );
      }

      setStep({ label: "Building your playlists", done: 0, total: 0 });
      await new Promise((r) => setTimeout(r, 50)); // let the UI paint before the heavy work
      const result = organizeLibrary(profiles);
      setPlaylists(result.playlists);
      setUnsorted(result.unsorted);
    } catch (e) {
      if (e instanceof SpotifyAuthError) {
        disconnectSpotify();
        setConnected(false);
      }
      setError(e instanceof Error ? e.message : "Something went wrong while reading your library.");
    } finally {
      setStep(null);
    }
  }

  function rename(key: string, name: string) {
    setPlaylists((all) => all.map((p) => (p.key === key ? { ...p, name } : p)));
  }

  function removeTrack(key: string, id: string) {
    setPlaylists((all) =>
      all.map((p) => {
        if (p.key !== key) return p;
        const removed = p.tracks.find((t) => t.id === id);
        if (removed) setUnsorted((u) => [...u, removed]);
        return { ...p, tracks: sequence(p.tracks.filter((t) => t.id !== id)) };
      }),
    );
  }

  async function save(p: PlaylistDraft) {
    setSaving(p.key);
    setError(null);
    try {
      const created = await createPlaylist(p.name, p.description, false);
      await addTracksToPlaylist(created.id, p.tracks.map((t) => t.uri));
      setSaved((s) => ({ ...s, [p.key]: created.external_urls.spotify }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "The playlist couldn't be saved.");
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className="min-h-screen">
      <nav className="sticky top-0 z-50 bg-background/80 backdrop-blur-xl border-b border-border/50">
        <div className="container flex items-center justify-between h-16">
          <Link to="/" className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
              <Music2 className="w-4 h-4 text-primary-foreground" />
            </div>
            <span className="font-heading text-xl tracking-tight">Tempo</span>
          </Link>
          {connected && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                disconnectSpotify();
                setConnected(false);
                setPlaylists([]);
                setUnsorted([]);
              }}
            >
              Disconnect Spotify
            </Button>
          )}
        </div>
      </nav>

      <main className="container max-w-3xl py-12 space-y-10">
        {!connected ? (
          <section className="text-center space-y-5 pt-16">
            <h1 className="font-heading text-4xl md:text-5xl tracking-tight">Connect your Spotify</h1>
            <p className="text-muted-foreground max-w-md mx-auto">
              Tempo reads your Liked Songs and suggests playlists. Nothing is saved to your account until you
              choose to save a playlist.
            </p>
            <Button variant="hero" size="lg" className="rounded-xl px-8 h-12" onClick={() => loginWithSpotify()}>
              Connect Spotify
            </Button>
          </section>
        ) : (
          <section className="space-y-4">
            <h1 className="font-heading text-4xl tracking-tight">Organize your Liked Songs</h1>
            <p className="text-muted-foreground">
              Songs are grouped by language, sound and mood, then ordered so each playlist flows. Songs that
              don't fit anywhere stay out instead of being forced in.
            </p>
            <Button variant="hero" onClick={analyze} disabled={!!step}>
              {step ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              {playlists.length ? "Analyze again" : "Analyze my Liked Songs"}
            </Button>

            {step && (
              <div className="space-y-2 pt-2" aria-live="polite">
                <p className="text-sm text-muted-foreground">
                  {step.label}
                  {step.total ? ` · ${step.done} of ${step.total}` : "…"}
                </p>
                <Progress value={step.total ? (step.done / step.total) * 100 : undefined} />
              </div>
            )}
          </section>
        )}

        {error && (
          <p role="alert" className="text-sm text-destructive border border-destructive/40 rounded-lg p-3">
            {error}
          </p>
        )}

        {playlists.length > 0 && (
          <section className="space-y-3">
            <h2 className="font-heading text-2xl">{playlists.length} playlists ready to review</h2>
            {playlists.map((p) => {
              const isOpen = open === p.key;
              const duration = p.tracks.reduce((s, t) => s + t.durationMs, 0);
              return (
                <article key={p.key} className="border border-border rounded-xl">
                  <div className="flex flex-wrap items-center gap-3 p-4">
                    <Input
                      value={p.name}
                      onChange={(e) => rename(p.key, e.target.value)}
                      className="flex-1 min-w-[12rem] font-medium"
                      aria-label="Playlist name"
                    />
                    <span className="text-sm text-muted-foreground whitespace-nowrap">
                      {p.tracks.length} songs, {formatTime(duration)}
                    </span>
                    {saved[p.key] ? (
                      <Button variant="outline" size="sm" asChild>
                        <a href={saved[p.key]} target="_blank" rel="noreferrer">
                          <Check className="w-4 h-4 mr-1" /> Open in Spotify <ExternalLink className="w-3 h-3 ml-1" />
                        </a>
                      </Button>
                    ) : (
                      <Button size="sm" onClick={() => save(p)} disabled={saving !== null}>
                        {saving === p.key ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : null}
                        Save to Spotify
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setOpen(isOpen ? null : p.key)}
                      aria-expanded={isOpen}
                      aria-label={isOpen ? "Hide songs" : "Show songs"}
                    >
                      <ChevronDown className={`w-4 h-4 transition-transform ${isOpen ? "rotate-180" : ""}`} />
                    </Button>
                  </div>

                  {isOpen && (
                    <ol className="border-t border-border divide-y divide-border/60">
                      {p.tracks.map((t, i) => (
                        <li key={t.id} className="flex items-center gap-3 px-4 py-2 text-sm">
                          <span className="w-6 text-right text-muted-foreground tabular-nums">{i + 1}</span>
                          {t.image && <img src={t.image} alt="" className="w-9 h-9 rounded" loading="lazy" />}
                          <div className="flex-1 min-w-0">
                            <p className="truncate">{t.name}</p>
                            <p className="truncate text-muted-foreground">{t.artists.join(", ")}</p>
                          </div>
                          {t.energy !== null && (
                            <span className="text-xs text-muted-foreground w-20 text-right" title="Estimated energy">
                              energy {Math.round(t.energy * 10)}/10
                            </span>
                          )}
                          {!saved[p.key] && (
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => removeTrack(p.key, t.id)}
                              aria-label={`Remove ${t.name}`}
                            >
                              <X className="w-4 h-4" />
                            </Button>
                          )}
                        </li>
                      ))}
                    </ol>
                  )}
                </article>
              );
            })}
          </section>
        )}

        {unsorted.length > 0 && (
          <section className="space-y-2">
            <h2 className="font-heading text-xl">Not placed ({unsorted.length})</h2>
            <p className="text-sm text-muted-foreground">
              These songs didn't match any playlist well enough. Leaving them out keeps the others skip-free.
            </p>
            <ul className="text-sm text-muted-foreground columns-1 sm:columns-2 gap-6">
              {unsorted.map((t) => (
                <li key={t.id} className="truncate py-0.5">
                  {t.name} · {t.artists[0]}
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </div>
  );
};

export default Organize;
