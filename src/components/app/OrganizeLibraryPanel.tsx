import { useState } from "react";
import { Loader2, Wand2, Save, Music } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "sonner";
import { genreFamilies, detectLanguage, type Lang, type Mood, type TrackProfile } from "@/lib/playlist/features";
import { organizeLibrary, type OrganizeResult, type PlaylistDraft } from "@/lib/playlist/organize";

const LANG_MAP: Record<string, Lang> = {
  english: "en", spanish: "es", portuguese: "pt", french: "fr", italian: "it", german: "de",
  korean: "ko", japanese: "ja", chinese: "zh", instrumental: "instrumental", other: "other",
};
const LANG_LABEL: Record<string, string> = {
  en: "Inglés", es: "Español", pt: "Portugués", fr: "Francés", it: "Italiano", de: "Alemán",
  ko: "Coreano", ja: "Japonés", zh: "Chino", instrumental: "Instrumental", other: "Otro", unknown: "Desconocido",
};
const TEMPO_BPM: Record<string, number> = { slow: 75, mid: 105, driving: 122, fast: 140 };

function toMood(raw: string | null): Mood | null {
  if (!raw) return null;
  const m = raw.toLowerCase();
  const rules: [RegExp, Mood][] = [
    [/party|euphor|festive/, "party"], [/intense|aggress|rebel|defian|dramatic|brooding/, "intense"],
    [/empower|confident|heroic|resilien|inspir|triumph/, "empowering"], [/upbeat|joy|happy|playful|bright/, "upbeat"],
    [/romantic|sensual|passion|love/, "romantic"], [/melanchol|sad|longing|nostalg|haunting|reflect/, "melancholic"],
    [/dream|ethereal|transcend|cryptic/, "dreamy"], [/chill|calm|mellow|intimate|soulful|sophist|opulent/, "chill"],
  ];
  for (const [re, mood] of rules) if (re.test(m)) return mood;
  return null;
}

async function fetchAll<T>(build: (from: number, to: number) => any): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) return out;
  }
}

async function loadProfiles(userId: string): Promise<TrackProfile[]> {
  const liked = await fetchAll<any>((a, b) =>
    supabase.from("liked_songs")
      .select("spotify_track_id, track_name, artist_name, album_name, image_url, genre_tags, release_date:added_at")
      .eq("user_id", userId).eq("is_active", true).eq("is_available", true).range(a, b));
  const analysis = await fetchAll<any>((a, b) =>
    supabase.from("ai_track_analysis")
      .select("spotify_track_id, language, energy_score, dance_feel, main_mood, tempo_feel, softness, darkness")
      .eq("user_id", userId).range(a, b));
  const aMap = new Map(analysis.map((r) => [r.spotify_track_id, r]));

  return liked.map((l) => {
    const an = aMap.get(l.spotify_track_id);
    const genres: string[] = l.genre_tags ?? [];
    const families = genreFamilies(genres);
    const aiLang = an?.language ? LANG_MAP[String(an.language).toLowerCase()] : undefined;
    const det = aiLang ? { lang: aiLang, confidence: 0.95 } : detectLanguage(l.track_name ?? "", l.album_name ?? "", families, genres);
    const valence = an && an.darkness != null ? Math.max(0, Math.min(1, 1 - an.darkness)) : null;
    return {
      id: l.spotify_track_id,
      uri: `spotify:track:${l.spotify_track_id}`,
      name: l.track_name ?? "",
      artists: (l.artist_name ?? "").split(/,\s*/).filter(Boolean),
      artistIds: (l.artist_name ?? "").split(/,\s*/).filter(Boolean),
      album: l.album_name ?? "",
      albumId: l.album_name ?? "",
      image: l.image_url ?? null,
      year: null,
      explicit: false,
      durationMs: 0,
      genres,
      families,
      lang: det.lang,
      langConfidence: det.confidence,
      energy: an?.energy_score ?? null,
      valence,
      danceability: an?.dance_feel ?? null,
      tempo: an?.tempo_feel ? TEMPO_BPM[an.tempo_feel] ?? null : null,
      mood: toMood(an?.main_mood ?? null),
    } as TrackProfile;
  });
}

export default function OrganizeLibraryPanel({ onSaved }: { onSaved: () => void }) {
  const { user } = useAuth();
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<OrganizeResult | null>(null);
  const [total, setTotal] = useState(0);
  const [saving, setSaving] = useState<string | null>(null);

  const run = async () => {
    if (!user) return;
    setRunning(true);
    try {
      const profiles = await loadProfiles(user.id);
      setTotal(profiles.length);
      setResult(organizeLibrary(profiles));
    } catch (e: any) {
      toast.error("No se pudo organizar", { description: e.message });
    } finally {
      setRunning(false);
    }
  };

  const save = async (d: PlaylistDraft) => {
    if (!user) return;
    setSaving(d.key);
    try {
      const sids = d.tracks.map((t) => t.id);
      const { data: rows, error: tErr } = await supabase.from("tracks").select("id, spotify_track_id").in("spotify_track_id", sids);
      if (tErr) throw new Error(tErr.message);
      const idMap = new Map((rows ?? []).map((r) => [r.spotify_track_id, r.id]));
      const { data: pl, error } = await supabase.from("generated_playlists").insert({
        user_id: user.id, name: d.name, description: d.description, status: "draft",
        created_by_ai: true, avg_compat: d.cohesion, concept: LANG_LABEL[d.lang] ?? d.lang,
      }).select("id").single();
      if (error) throw new Error(error.message);
      const items = d.tracks.filter((t) => idMap.has(t.id)).map((t, i) => ({
        generated_playlist_id: pl.id, user_id: user.id, track_id: idMap.get(t.id)!, position: i + 1, added_by: "organizer",
      }));
      if (items.length) {
        const { error: iErr } = await supabase.from("generated_playlist_tracks").insert(items);
        if (iErr) throw new Error(iErr.message);
      }
      toast.success("Playlist guardada", { description: `${d.name} · ${items.length} canciones` });
      setResult((r) => r && { ...r, playlists: r.playlists.filter((p) => p.key !== d.key) });
      onSaved();
    } catch (e: any) {
      toast.error("No se pudo guardar", { description: e.message });
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className="rounded-3xl border border-border/50 bg-gradient-to-br from-accent/10 via-primary/5 to-background p-6 md:p-8">
      <h2 className="font-heading text-2xl mb-2">Organiza tus Liked Songs</h2>
      <p className="text-sm text-muted-foreground mb-5">
        Cada idioma va en su propia playlist (las instrumentales pueden entrar donde combinen). Las canciones que no encajan se quedan sin ordenar.
      </p>
      <Button variant="hero" onClick={run} disabled={running}>
        {running ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Organizando…</> : <><Wand2 className="w-4 h-4 mr-2" />Organizar biblioteca</>}
      </Button>

      {result && (
        <div className="mt-6 space-y-4">
          <p className="text-sm text-muted-foreground">
            {total} canciones · {result.playlists.length} playlists · {result.unsorted.length} sin ordenar
          </p>
          {result.playlists.map((d) => (
            <div key={d.key} className="rounded-2xl border border-border/50 bg-card/50 p-5">
              <div className="flex items-start justify-between gap-3 mb-2">
                <div>
                  <h3 className="font-heading text-lg">{d.name}</h3>
                  <p className="text-sm text-muted-foreground">{d.description}</p>
                </div>
                <Button size="sm" variant="hero" onClick={() => save(d)} disabled={saving === d.key}>
                  {saving === d.key ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Save className="w-4 h-4 mr-1.5" />Guardar</>}
                </Button>
              </div>
              <div className="flex gap-2 mb-3">
                <Badge variant="secondary" className="text-xs">{LANG_LABEL[d.lang] ?? d.lang}</Badge>
                <Badge variant="outline" className="text-xs">Cohesión {Math.round(d.cohesion * 100)}%</Badge>
                <Badge variant="outline" className="text-xs"><Music className="w-3 h-3 mr-1" />{d.tracks.length}</Badge>
              </div>
              <details className="text-xs">
                <summary className="cursor-pointer text-muted-foreground">Ver canciones en orden</summary>
                <ol className="mt-2 space-y-1 max-h-64 overflow-y-auto pr-2 list-decimal list-inside">
                  {d.tracks.map((t) => <li key={t.id} className="truncate">{t.name} — <span className="text-muted-foreground">{t.artists.join(", ")}</span></li>)}
                </ol>
              </details>
            </div>
          ))}
          {result.unsorted.length > 0 && (
            <details className="rounded-2xl border border-dashed border-border/50 p-5 text-xs">
              <summary className="cursor-pointer text-sm">Sin ordenar ({result.unsorted.length})</summary>
              <ul className="mt-2 space-y-1 max-h-48 overflow-y-auto">
                {result.unsorted.slice(0, 200).map((t) => <li key={t.id} className="truncate">{t.name} — <span className="text-muted-foreground">{t.artists.join(", ")}</span></li>)}
              </ul>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
