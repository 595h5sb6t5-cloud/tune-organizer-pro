import { useState } from "react";
import { Loader2, Check, X, ChevronDown, ExternalLink, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { buildProfiles, type Lang, type Mood, type SpotifyTrack, type TrackProfile } from "@/lib/playlist/features";
import { enrichWithAI, isAiEnabled } from "@/lib/playlist/ai";
import { organizeLibrary, sequence, type PlaylistDraft } from "@/lib/playlist/organize";

type Step = { label: string; done: number; total: number };

const formatTime = (ms: number) => {
  const min = Math.round(ms / 60000);
  return min >= 60 ? `${Math.floor(min / 60)} h ${min % 60} min` : `${min} min`;
};

async function fetchAll<T>(build: (from: number, to: number) => any): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) return out;
  }
}

/** Liked Songs from the synced library, in the shape Spotify returns them. */
async function loadLikedTracks(userId: string): Promise<SpotifyTrack[]> {
  const rows = await fetchAll<any>((a, b) =>
    supabase.from("liked_songs")
      .select("spotify_track_id, track_name, artist_name, album_name, image_url, explicit, duration_ms, artists, album_id, album_release_date, isrc")
      .eq("user_id", userId).eq("is_active", true).eq("is_available", true)
      .order("added_at", { ascending: false }).range(a, b));
  return rows.map((r) => {
    const artists: { id: string; name: string }[] = Array.isArray(r.artists) && r.artists.length
      ? r.artists
      : String(r.artist_name ?? "").split(/,\s*/).filter(Boolean).map((name) => ({ id: name, name }));
    return {
      id: r.spotify_track_id,
      uri: `spotify:track:${r.spotify_track_id}`,
      name: r.track_name ?? "",
      explicit: !!r.explicit,
      duration_ms: r.duration_ms ?? 0,
      is_local: false,
      artists,
      album: {
        id: r.album_id ?? r.album_name ?? "",
        name: r.album_name ?? "",
        release_date: r.album_release_date ?? "",
        images: r.image_url ? [{ url: r.image_url }] : [],
      },
      external_ids: r.isrc ? { isrc: r.isrc } : undefined,
    };
  });
}

/** Runs the genre lookup in chunks until every artist is stored. */
async function loadArtistGenres(
  artistIds: string[],
  onProgress: (done: number, total: number) => void,
): Promise<Record<string, string[]>> {
  for (let guard = 0; guard < 40; guard++) {
    const { data, error } = await supabase.functions.invoke("spotify-artist-genres", { body: {} });
    if (error) throw new Error(error.message);
    if (data?.error) throw new Error(data.error);
    onProgress(data.done ?? 0, data.total ?? 0);
    if (!data.remaining) break;
    if (data.retry_after_ms) await new Promise((r) => setTimeout(r, Math.min(data.retry_after_ms, 60_000)));
  }
  const ids = [...new Set(artistIds)];
  const out: Record<string, string[]> = {};
  for (let i = 0; i < ids.length; i += 300) {
    const { data } = await supabase.from("artist_genres").select("artist_id, genres").in("artist_id", ids.slice(i, i + 300));
    for (const r of data ?? []) out[r.artist_id] = r.genres ?? [];
  }
  return out;
}

const LANG_MAP: Record<string, Lang> = {
  english: "en", spanish: "es", portuguese: "pt", french: "fr", italian: "it", german: "de",
  korean: "ko", japanese: "ja", chinese: "zh", instrumental: "instrumental",
};
const MOODS: Mood[] = ["chill", "melancholic", "romantic", "upbeat", "party", "intense", "dreamy", "empowering"];
const TEMPO_BPM: Record<string, number> = { slow: 75, mid: 105, driving: 122, fast: 140 };

/** Adds the Deep Analysis results already stored for each song (language, energy, mood). */
async function withStoredAnalysis(userId: string, profiles: TrackProfile[]): Promise<TrackProfile[]> {
  const rows = await fetchAll<any>((a, b) =>
    supabase.from("ai_track_analysis")
      .select("spotify_track_id, language, energy_score, dance_feel, main_mood, tempo_feel, darkness")
      .eq("user_id", userId).range(a, b));
  const map = new Map(rows.map((r) => [r.spotify_track_id, r]));
  return profiles.map((p) => {
    const an = map.get(p.id);
    if (!an) return p;
    const lang = an.language ? LANG_MAP[String(an.language).toLowerCase()] : undefined;
    const mood = MOODS.find((m) => String(an.main_mood ?? "").toLowerCase().includes(m)) ?? p.mood;
    return {
      ...p,
      lang: lang ?? p.lang,
      langConfidence: lang ? Math.max(p.langConfidence, 0.9) : p.langConfidence,
      energy: an.energy_score ?? p.energy,
      danceability: an.dance_feel ?? p.danceability,
      valence: an.darkness != null ? Math.max(0, Math.min(1, 1 - an.darkness)) : p.valence,
      tempo: an.tempo_feel ? TEMPO_BPM[an.tempo_feel] ?? p.tempo : p.tempo,
      mood,
    };
  });
}

export default function OrganizeLibraryPanel({ onSaved }: { onSaved: () => void }) {
  const { user } = useAuth();
  const [step, setStep] = useState<Step | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [playlists, setPlaylists] = useState<PlaylistDraft[]>([]);
  const [unsorted, setUnsorted] = useState<TrackProfile[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [saved, setSaved] = useState<Record<string, string>>({});

  async function analyze() {
    if (!user) return;
    setError(null);
    setPlaylists([]);
    setUnsorted([]);
    setSaved({});
    try {
      setStep({ label: "Reading your Liked Songs", done: 0, total: 0 });
      const tracks = await loadLikedTracks(user.id);
      if (!tracks.length) {
        setError("Your Liked Songs list is empty. Sync your library first.");
        return;
      }

      const artistIds = tracks.flatMap((t) => t.artists.map((a) => a.id));
      setStep({ label: "Looking up artist genres", done: 0, total: 0 });
      const genres = await loadArtistGenres(artistIds, (done, total) =>
        setStep({ label: "Looking up artist genres", done, total }),
      );

      let profiles = buildProfiles(tracks, genres);
      profiles = await withStoredAnalysis(user.id, profiles);
      if (isAiEnabled()) {
        profiles = await enrichWithAI(profiles, (done, total) =>
          setStep({ label: "Listening for language, energy and mood", done, total }),
        );
      }

      setStep({ label: "Building your playlists", done: 0, total: 0 });
      await new Promise((r) => setTimeout(r, 50));
      const result = organizeLibrary(profiles);
      setPlaylists(result.playlists);
      setUnsorted(result.unsorted);
    } catch (e) {
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
    if (!user) return;
    setSaving(p.key);
    setError(null);
    try {
      const { data: gp, error: gpErr } = await supabase.from("generated_playlists").insert({
        user_id: user.id, name: p.name, description: p.description, status: "draft", created_by_ai: true,
        avg_compat: p.cohesion,
      }).select("id").single();
      if (gpErr) throw new Error(gpErr.message);
      // Exact order returned by organize.ts — never re-sorted.
      const { data, error } = await supabase.functions.invoke("spotify-export-playlist", {
        body: {
          generated_playlist_id: gp.id,
          name: p.name,
          description: p.description,
          track_ids: p.tracks.map((t) => t.id),
          is_public: false,
        },
      });
      if (error || data?.error) {
        await supabase.from("generated_playlists").delete().eq("id", gp.id);
        throw new Error(data?.error ?? error?.message ?? "The playlist couldn't be saved.");
      }
      setSaved((s) => ({ ...s, [p.key]: data?.spotify_url ?? data?.url ?? "https://open.spotify.com" }));
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "The playlist couldn't be saved.");
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className="space-y-8">
      <section className="rounded-3xl border border-border/50 bg-card/40 p-6 md:p-8 space-y-4">
        <h2 className="font-heading text-2xl">Organize your Liked Songs</h2>
        <p className="text-sm text-muted-foreground">
          Songs are grouped by language, sound and mood, then ordered so each playlist flows. Songs that don't fit
          anywhere stay out instead of being forced in.
        </p>
        <Button variant="hero" onClick={analyze} disabled={!!step}>
          {step ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Wand2 className="w-4 h-4 mr-2" />}
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

        {error && (
          <p role="alert" className="text-sm text-destructive border border-destructive/40 rounded-lg p-3">
            {error}
          </p>
        )}
      </section>

      {playlists.length > 0 && (
        <section className="space-y-3">
          <h2 className="font-heading text-xl">{playlists.length} playlists ready to review</h2>
          {playlists.map((p) => {
            const isOpen = open === p.key;
            const duration = p.tracks.reduce((s, t) => s + t.durationMs, 0);
            return (
              <article key={p.key} className="rounded-2xl border border-border/50 bg-card/50">
                <div className="flex flex-wrap items-center gap-3 p-4">
                  <Input
                    value={p.name}
                    onChange={(e) => rename(p.key, e.target.value)}
                    className="flex-1 min-w-[12rem] font-medium"
                    aria-label="Playlist name"
                    disabled={!!saved[p.key]}
                  />
                  <span className="text-sm text-muted-foreground whitespace-nowrap">
                    {p.tracks.length} songs{duration ? `, ${formatTime(duration)}` : ""}
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
                  <ol className="border-t border-border/50 divide-y divide-border/40">
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
                          <Button variant="ghost" size="icon" onClick={() => removeTrack(p.key, t.id)} aria-label={`Remove ${t.name}`}>
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
              <li key={t.id} className="truncate py-0.5">{t.name} · {t.artists[0]}</li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
