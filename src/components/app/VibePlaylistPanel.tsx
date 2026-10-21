import { spotifyPausedMessage } from "@/lib/spotify-paused";
import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Check, X, ExternalLink, Sparkles } from "lucide-react";
import AnalysisNote from "@/components/app/AnalysisNote";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { buildProfiles, type TrackProfile } from "@/lib/playlist/features";
import { enrichWithAI } from "@/lib/playlist/ai";
import { sequence } from "@/lib/playlist/organize";
import { buildVibePlaylist, readVibeSpec, type VibeSpec, type SpecCorrection } from "@/lib/playlist/vibe";
import { acquireVibePriority, withinBudget } from "@/lib/playlist/priority";
import { MOMENT_LABEL as LIFE_MOMENT_LABEL, MOMENT_DESC } from "@/lib/playlist/moments";
import { recordRemoval } from "@/lib/playlist/feedback";
import EditSoundDialog from "@/components/app/EditSoundDialog";
import { loadLikedTracks, loadArtistGenres } from "@/components/app/OrganizeLibraryPanel";
import type { SpotifyTrack } from "@/lib/playlist/features";
import { warmVibeFunctions } from "@/lib/playlist/curate";
import { findSeedMatches, isUniqueFullTitle, leftoverKeywords, findArtistMatch, representativeSongs, norm, type SeedMatch } from "@/components/app/seedMatch";

const LANG_LABEL: Record<string, string> = {
  es: "Español", en: "English", pt: "Português", fr: "Français", it: "Italiano", de: "Deutsch",
  ko: "한국어", ja: "日本語", zh: "中文", instrumental: "Instrumental",
};

type Step = { label: string; done?: number; total?: number };

const QUICK_CHIPS = ["Sunset", "Late night", "Instrumental", "Background talk", "Inspirational", "Focus", "Pregame", "Rainy day"];
const VOCAL_LABEL: Record<string, string> = { none: "No vocals", sparse: "Few vocals", soft: "Soft vocals", lead: "Lead vocals", any: "Any vocals" };
const LISTEN_LABEL: Record<string, string> = { background: "Background", focused: "Focused", any: "Any listening" };
const MOMENT_LABEL: Record<string, string> = { sunrise: "Sunrise", day: "Day", "golden-hour-sunset": "Golden hour", night: "Night", "late-night": "Late night", any: "Any moment" };

const normPhrase = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

async function loadCorrections(userId: string): Promise<SpecCorrection[]> {
  const { data } = await supabase.from("vibe_spec_corrections").select("phrase, spec").eq("user_id", userId)
    .order("created_at", { ascending: false }).limit(20);
  return (data ?? []).map((r) => ({ phrase: r.phrase, spec: r.spec as Partial<VibeSpec> }));
}

/** Saves the user's edit to "Lo que entendí" so the next similar phrase is interpreted the same way. */
async function saveCorrection(userId: string, phrase: string, spec: VibeSpec) {
  const sub: Partial<VibeSpec> = {
    vocals: spec.vocals ?? "any", listening: spec.listening ?? "any", moment: spec.moment ?? "any",
    energy_min: spec.energy_min, energy_max: spec.energy_max,
    warmth_min: spec.warmth_min ?? 0, warmth_max: spec.warmth_max ?? 1,
    feelings_allowed: spec.feelings_allowed ?? [],
    instruments_preferred: spec.instruments_preferred ?? [],
    instruments_excluded: spec.instruments_excluded ?? [],
  };
  await supabase.from("vibe_spec_corrections").upsert({ user_id: userId, phrase: normPhrase(phrase), spec: sub as any }, { onConflict: "user_id,phrase" });
}

export default function VibePlaylistPanel() {
  const { user } = useAuth();
  const [vibe, setVibe] = useState("");
  const [lang, setLang] = useState("auto");
  const [langs, setLangs] = useState<string[]>([]);
  const [profiles, setProfiles] = useState<TrackProfile[] | null>(null);
  const [step, setStep] = useState<Step | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [tracks, setTracks] = useState<TrackProfile[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedUrl, setSavedUrl] = useState<string | null>(null);
  const [liked, setLiked] = useState<SpotifyTrack[] | null>(null);
  const [seeds, setSeeds] = useState<SeedMatch[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [artistSeed, setArtistSeed] = useState<{ name: string; tracks: SpotifyTrack[] } | null>(null);
  const [understood, setUnderstood] = useState<{ phrase: string; spec: VibeSpec } | null>(null);
  const [clarify, setClarify] = useState<{ question: string; options: string[] } | null>(null);
  const runRef = useRef(0);

  useEffect(() => {
    if (user) loadLikedTracks(user.id).then(setLiked).catch(() => setLiked([]));
    if (user) { // ready before the first click, without showing a loading state
      warmVibeFunctions();
      loadLikedTracks(user.id).then(async (l) => {
        if (!l.length) return;
        const g = await loadArtistGenres(l.flatMap((t) => t.artists.map((a) => a.id)), () => {});
        const p = await enrichWithAI(buildProfiles(l, g));
        setProfiles((cur) => cur ?? p);
      }).catch(() => null);
    }
  }, [user]);

  const matches = useMemo(() => {
    if (!liked || seeds.length >= 3) return [];
    const chosen = new Set(seeds.map((s) => s.track.id));
    return findSeedMatches(vibe, liked).filter((m) => !chosen.has(m.track.id));
  }, [vibe, liked, seeds]);

  // Auto-pick a single clear match (title + artist).
  useEffect(() => {
    let clear = matches.filter((m) => m.artistHit.length);
    if (!clear.length && liked) {
      // Several full titles in the text ("forms of love, late night drive"): the longest title wins; ties pick none.
      const full = matches.filter((m) => isUniqueFullTitle(m, liked)).sort((a, b) => b.span.split(" ").length - a.span.split(" ").length);
      clear = full.length > 1 && full[0].span.split(" ").length === full[1].span.split(" ").length ? [] : full.slice(0, 1);
    }
    // Only ONE automatic seed; other matching titles stay as suggestions for the user to pick.
    if (clear.length === 1 && !dismissed.has(clear[0].track.id) && seeds.length === 0) {
      setSeeds((s) => [...s, clear[0]]);
    }
  }, [matches, dismissed, seeds.length, liked]);

  // Artist as seed ("marvin gaye"): only when no song matched — a song always wins.
  useEffect(() => {
    if (!liked || !profiles || seeds.length || matches.length) return;
    const a = findArtistMatch(vibe, liked);
    if (!a || dismissed.has(`artist:${norm(a.name)}`)) return;
    const prof = a.tracks.map((t) => profiles.find((p) => p.id === t.id)).filter((x): x is TrackProfile => !!x);
    const picks = representativeSongs(prof);
    if (!picks.length) return;
    setArtistSeed(a);
    setSeeds(picks.map((p) => ({ track: a.tracks.find((t) => t.id === p.id)!, span: norm(a.name), artistHit: [norm(a.name)], score: 0 })));
  }, [vibe, liked, profiles, seeds.length, matches.length, dismissed]);
  useEffect(() => { if (!seeds.length) setArtistSeed(null); }, [seeds.length]);

  const keywords = leftoverKeywords(vibe, seeds, liked ?? []);
  const canCreate = !!vibe.trim() || seeds.length > 0;

  // Languages present in the library (from stored AI data).
  useEffect(() => {
    if (!user) return;
    (async () => {
      const counts = new Map<string, number>();
      for (const table of ["ai_track_analysis", "track_ai_classification"] as const) {
        const col = table === "ai_track_analysis" ? "language" : "lang";
        const { data } = await (supabase.from(table) as any).select(col).eq("user_id", user.id).limit(5000);
        for (const r of data ?? []) {
          const l = String(r[col] ?? "").toLowerCase();
          if (LANG_LABEL[l]) counts.set(l, (counts.get(l) ?? 0) + 1);
        }
      }
      setLangs([...counts.entries()].sort((a, b) => b[1] - a[1]).map(([l]) => l));
    })();
  }, [user]);

  async function getProfiles(): Promise<TrackProfile[]> {
    if (profiles) return profiles;
    setStep({ label: "Reading your Liked Songs" });
    const liked = await loadLikedTracks(user!.id);
    setLiked(liked);
    if (!liked.length) throw new Error("Your Liked Songs list is empty. Sync your library first.");
    const genres = await loadArtistGenres(liked.flatMap((t) => t.artists.map((a) => a.id)), (done, total) =>
      setStep({ label: "Reading artist genres", done, total }));
    const p = await enrichWithAI(buildProfiles(liked, genres), (done, total) =>
      setStep({ label: "Reading language, energy and mood", done, total }));
    setProfiles(p);
    return p;
  }

  function updateProfile(t: TrackProfile) {
    setProfiles((all) => all ? all.map((x) => x.id === t.id ? t : x) : all);
    setTracks((all) => all ? all.map((x) => x.id === t.id ? t : x) : all);
  }

  function SeedSound({ id }: { id: string }) {
    const [p, setP] = useState<TrackProfile | null>(profiles?.find((x) => x.id === id) ?? null);
    if (!p) return (
      <button type="button" className="ml-1 text-xs text-muted-foreground hover:text-foreground underline"
        onClick={async () => setP((await getProfiles()).find((x) => x.id === id) ?? null)}>Edit sound</button>
    );
    return (
      <>
        <EditSoundDialog compact track={p} onSaved={(t) => { setP(t); updateProfile(t); }} />
        {!p.soundEdited && p.confidence !== null && p.confidence < 0.5 && (
          <span className="basis-full text-xs text-muted-foreground">We're not sure how this song sounds. Edit sound for better results.</span>
        )}
      </>
    );
  }

  async function create(opts: { spec?: VibeSpec; text?: string; answered?: boolean } = {}) {
    if (!user || !canCreate) return;
    const run = ++runRef.current;
    const startedAt = performance.now();
    const deadline = startedAt + 19_500;
    let release: (() => Promise<void>) | undefined;
    setError(null); setTracks(null); setSavedUrl(null); setClarify(null);
    try {
      release = await withinBudget(acquireVibePriority(user.id, deadline), deadline, undefined);
      if (!release) throw new Error("No se pudo dar prioridad al vibe a tiempo.");
      const p = await withinBudget(getProfiles(), deadline, null);
      if (!p) throw new Error("El vibe no alcanzó a leer la biblioteca en 20 segundos. Intenta otra vez.");
      if (runRef.current !== run) return;
      const seedProfiles = seeds.map((s) => p.find((x) => x.id === s.track.id)).filter((x): x is TrackProfile => !!x);
      const words = opts.text ?? (seeds.length ? keywords : vibe.trim());
      let preset = opts.spec;
      let corrections: SpecCorrection[] = [];
      if (words && !preset) {
        setStep({ label: "Reading the vibe" });
        corrections = await withinBudget(loadCorrections(user.id), deadline, []);
        const spec = await withinBudget(readVibeSpec(user.id, words, seedProfiles, corrections), deadline, null);
        if (!spec) throw new Error("No se pudo interpretar el vibe en 20 segundos. Intenta otra vez.");
        if (runRef.current !== run) return;
        // Ambiguous description without a seed: ask ONE quick question instead of guessing.
        // Once the user answered (opts.answered), never ask again — build with the answer.
        if (spec.clarify && !seedProfiles.length && !opts.answered) { setClarify(spec.clarify); setStep(null); return; }
        setUnderstood({ phrase: words, spec });
        preset = { ...spec, clarify: null };
      }
      const res = await buildVibePlaylist(user.id, words, p, lang,
        (label, done, total) => { if (runRef.current === run) setStep({ label, done, total }); },
        seedProfiles, artistSeed?.name,
        (live) => { if (runRef.current === run) setTracks(live); },
        { presetSpec: preset, corrections, startedAt });
      if (runRef.current !== run) return;
      setName(res.spec.name);
      setTracks(res.tracks);
      if (res.clarify) setClarify(res.clarify);
    } catch (e) {
      if (runRef.current === run) setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      if (runRef.current === run) setStep(null);
      if (release) void release();
    }
  }

  /** Edit or remove a chip from "Lo que entendí": saves the correction and rebuilds with the new recipe. */
  function editSpec(key: string, value: string | null) {
    if (!understood || !user) return;
    const s = { ...understood.spec };
    if (key.startsWith("moment-")) s.moments = (s.moments ?? []).filter((x) => x !== key.slice(7));
    else if (key === "vocals") s.vocals = (value as VibeSpec["vocals"]) ?? "any";
    else if (key === "listening") s.listening = (value as VibeSpec["listening"]) ?? "any";
    else if (key === "moment") s.moment = (value as VibeSpec["moment"]) ?? "any";
    else if (key === "energy") { s.energy_min = 0; s.energy_max = 1; }
    else if (key === "warmth") { s.warmth_min = 0; s.warmth_max = 1; }
    else if (key === "feelings") s.feelings_allowed = [];
    else if (key === "instruments_preferred") s.instruments_preferred = [];
    else if (key === "instruments_excluded") s.instruments_excluded = [];
    setUnderstood({ phrase: understood.phrase, spec: s });
    void saveCorrection(user.id, understood.phrase, s);
    void create({ spec: s });
  }

  function understoodChips(spec: VibeSpec) {
    const eMid = (spec.energy_min + spec.energy_max) / 2;
    const wMid = ((spec.warmth_min ?? 0) + (spec.warmth_max ?? 1)) / 2;
    const chipSelect = (key: string, value: string, labels: Record<string, string>) => (
      <select key={key} value={value} onChange={(e) => editSpec(key, e.target.value)} aria-label={key}
        className="h-7 rounded-full border border-border/60 bg-muted/40 px-2 text-xs">
        {Object.entries(labels).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    );
    const chipX = (key: string, label: string) => (
      <span key={key} className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-muted/40 px-2.5 py-1 text-xs">
        {label}
        <button type="button" aria-label={`Remove ${label}`} onClick={() => editSpec(key, null)} className="text-muted-foreground hover:text-foreground">
          <X className="w-3 h-3" />
        </button>
      </span>
    );
    return [
      // The human moment comes first — it's what the user asked for.
      ...(spec.moments ?? []).map((m) => chipX(`moment-${m}`, LIFE_MOMENT_LABEL[m] ?? m)),
      spec.vocals && spec.vocals !== "any" ? chipSelect("vocals", spec.vocals, VOCAL_LABEL) : null,
      spec.listening && spec.listening !== "any" ? chipSelect("listening", spec.listening, LISTEN_LABEL) : null,
      spec.moment && spec.moment !== "any" ? chipSelect("moment", spec.moment, MOMENT_LABEL) : null,
      spec.energy_min > 0.05 || spec.energy_max < 0.95
        ? chipX("energy", eMid < 0.35 ? "Low energy" : eMid < 0.65 ? "Mid energy" : "High energy") : null,
      (spec.warmth_min ?? 0) > 0.05 || (spec.warmth_max ?? 1) < 0.95
        ? chipX("warmth", wMid >= 0.5 ? "Warm" : "Cold / dark") : null,
      spec.feelings_allowed?.length ? chipX("feelings", `Feels: ${spec.feelings_allowed.join(", ")}`) : null,
      spec.instruments_preferred?.length ? chipX("instruments_preferred", `With: ${spec.instruments_preferred.join(", ")}`) : null,
      spec.instruments_excluded?.length ? chipX("instruments_excluded", `Without: ${spec.instruments_excluded.join(", ")}`) : null,
    ];
  }

  async function save() {
    if (!user || !tracks?.length) return;
    setSaving(true); setError(null);
    // A human moment description when we have one; otherwise the vibe text.
    const firstMoment = understood?.spec.moments?.[0];
    const description = (firstMoment && MOMENT_DESC[firstMoment]) || `Vibe: ${vibe}`;
    try {
      const { data: gp, error: gpErr } = await supabase.from("generated_playlists").insert({
        user_id: user.id, name, description, status: "draft", created_by_ai: true, track_ids: tracks.map((t) => t.id),
      }).select("id").single();
      if (gpErr) throw new Error(gpErr.message);
      const { data, error } = await supabase.functions.invoke("spotify-export-playlist", {
        body: { generated_playlist_id: gp.id, name, description, track_ids: tracks.map((t) => t.id), is_public: false },
      });
      const paused = spotifyPausedMessage(data);
      if (paused) throw new Error(`${paused} Your playlist is saved in Playlists so you can send it then.`);
      if (error || data?.error) {
        await supabase.from("generated_playlists").delete().eq("id", gp.id);
        throw new Error(data?.error ?? error?.message ?? "The playlist couldn't be saved.");
      }
      setSavedUrl(data?.spotify_playlist_url ?? "https://open.spotify.com");
    } catch (e) {
      setError(e instanceof Error ? e.message : "The playlist couldn't be saved.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Create a playlist from a vibe</p>
        <h2 className="font-heading text-4xl md:text-5xl">Describe a moment. We'll find its soundtrack.</h2>
      </div>

      <div className="rounded-3xl border border-border/50 bg-card/40 p-6 space-y-4">
        <Input
          value={vibe}
          onChange={(e) => { setVibe(e.target.value.slice(0, 300)); setUnderstood(null); setClarify(null); }}
          placeholder="chill platica buena, full instrumental sunset, late night drive…"
          aria-label="Vibe keywords"
          onKeyDown={(e) => e.key === "Enter" && !step && create()}
        />
        <div className="flex flex-wrap gap-2">
          {QUICK_CHIPS.map((c) => (
            <button key={c} type="button"
              onClick={() => { setVibe((v) => (v.trim() ? `${v.trim()}, ${c.toLowerCase()}` : c.toLowerCase()).slice(0, 300)); setUnderstood(null); setClarify(null); }}
              className="rounded-full border border-border/60 bg-muted/30 px-3 py-1 text-xs text-muted-foreground hover:text-foreground hover:border-border">
              {c}
            </button>
          ))}
        </div>
        {clarify && (
          <div className="rounded-xl border border-border/60 bg-muted/30 p-4 space-y-3">
            <p className="text-sm font-medium">{clarify.question}</p>
            <div className="flex flex-wrap gap-2">
              {clarify.options.map((o) => (
                <Button key={o} variant="outline" size="sm"
                  onClick={() => { const text = `${vibe.trim()} ${o}`.slice(0, 300); setVibe(text); setClarify(null); void create({ text, answered: true }); }}>
                  {o}
                </Button>
              ))}
            </div>
          </div>
        )}
        {understood && !clarify && (
          <div className="space-y-2">
            <p className="text-xs uppercase tracking-[0.15em] text-muted-foreground">Lo que entendí</p>
            <div className="flex flex-wrap items-center gap-2">{understoodChips(understood.spec)}</div>
          </div>
        )}
        {matches.length > 0 && (
          <ul className="rounded-xl border border-border/50 divide-y divide-border/40" aria-label="Songs from your Liked Songs">
            {matches.map((m) => (
              <li key={m.track.id}>
                <button type="button" className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-muted/40"
                  onClick={() => setSeeds((s) => [...s, m].slice(0, 3))}>
                  {m.track.album.images[0]?.url && <img src={m.track.album.images[0].url} alt="" className="w-8 h-8 rounded" />}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{m.track.name}</span>
                    <span className="block truncate text-muted-foreground">{m.track.artists.map((a) => a.name).join(", ")}</span>
                  </span>
                  <span className="text-xs text-muted-foreground">Use as base</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {artistSeed && seeds.length > 0 && (
          <div className="rounded-xl border border-border/60 bg-muted/30 p-3 space-y-2">
            <div className="flex items-center gap-2 text-sm">
              <span className="font-medium">Based on: {artistSeed.name}</span>
              <button type="button" aria-label={`Stop using ${artistSeed.name}`} className="text-muted-foreground hover:text-foreground"
                onClick={() => { setDismissed((d) => new Set(d).add(`artist:${norm(artistSeed.name)}`)); setSeeds([]); }}>
                <X className="w-3 h-3" />
              </button>
            </div>
            <ul className="space-y-1">
              {seeds.map((s) => (
                <li key={s.track.id} className="flex flex-wrap items-center gap-2 text-sm">
                  <select value={s.track.id} aria-label="Change song" className="h-8 max-w-[16rem] rounded-md border border-input bg-background px-2 text-sm"
                    onChange={(e) => {
                      const t = artistSeed.tracks.find((x) => x.id === e.target.value);
                      if (t) setSeeds((all) => all.map((x) => x.track.id === s.track.id ? { ...x, track: t } : x));
                    }}>
                    {artistSeed.tracks.filter((t) => t.id === s.track.id || !seeds.some((x) => x.track.id === t.id)).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                  <button type="button" aria-label={`Remove ${s.track.name}`} className="text-muted-foreground hover:text-foreground"
                    onClick={() => setSeeds((all) => all.filter((x) => x.track.id !== s.track.id))}>
                    <X className="w-3 h-3" />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {!artistSeed && seeds.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {seeds.map((s) => (
              <span key={s.track.id} className="inline-flex flex-wrap items-center gap-1 rounded-full border border-border/60 bg-muted/40 px-3 py-1 text-sm">
                Based on: {s.track.name} · {s.track.artists.map((a) => a.name).join(", ")}
                <SeedSound id={s.track.id} />
                <button type="button" aria-label={`Remove ${s.track.name}`} className="ml-1 text-muted-foreground hover:text-foreground"
                  onClick={() => { setSeeds((all) => all.filter((x) => x.track.id !== s.track.id)); setDismissed((d) => new Set(d).add(s.track.id)); }}>
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <select
            value={lang}
            onChange={(e) => setLang(e.target.value)}
            aria-label="Language"
            className="h-10 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="auto">Auto</option>
            {langs.map((l) => <option key={l} value={l}>{LANG_LABEL[l]}</option>)}
          </select>
          <Button variant="hero" onClick={() => create()} disabled={!!step || !canCreate}>
            {step ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Sparkles className="w-4 h-4 mr-2" />}
            Create playlist
          </Button>
        </div>
        {step && (
          <div className="space-y-2" aria-live="polite">
            <p className="text-sm text-muted-foreground">{step.label}{step.total ? ` · ${step.done} of ${step.total}` : "…"}</p>
            <Progress value={step.total ? ((step.done ?? 0) / step.total) * 100 : undefined} />
          </div>
        )}
        <AnalysisNote />
        {error && <p role="alert" className="text-sm text-destructive border border-destructive/40 rounded-lg p-3">{error}</p>}
      </div>

      {tracks && (
        <article className="rounded-2xl border border-border/50 bg-card/50">
          {tracks.length < 10 && (
            <p className="px-4 pt-4 text-sm text-muted-foreground">Only {tracks.length} songs in your library fit this vibe.</p>
          )}
          {tracks.length > 0 && (
            <>
              <div className="flex flex-wrap items-center gap-3 p-4">
                <Input value={name} onChange={(e) => setName(e.target.value)} className="flex-1 min-w-[12rem] font-medium" aria-label="Playlist name" disabled={!!savedUrl} />
                <span className="text-sm text-muted-foreground">{tracks.length} songs</span>
                {savedUrl ? (
                  <Button variant="outline" size="sm" asChild>
                    <a href={savedUrl} target="_blank" rel="noreferrer"><Check className="w-4 h-4 mr-1" /> Open in Spotify <ExternalLink className="w-3 h-3 ml-1" /></a>
                  </Button>
                ) : (
                  <Button size="sm" onClick={save} disabled={saving || !!step}>
                    {saving && <Loader2 className="w-4 h-4 mr-1 animate-spin" />} Save to Spotify
                  </Button>
                )}
              </div>
              <ol className="border-t border-border/50 divide-y divide-border/40">
                {tracks.map((t, i) => (
                  <li key={t.id} className="flex items-center gap-3 px-4 py-2 text-sm">
                    <span className="w-6 text-right text-muted-foreground tabular-nums">{i + 1}</span>
                    {t.image && <img src={t.image} alt="" className="w-9 h-9 rounded" loading="lazy" />}
                    <div className="flex-1 min-w-0">
                      <p className="truncate">{t.name}</p>
                      <p className="truncate text-muted-foreground">{t.artists.join(", ")}</p>
                      {t.album && <p className="truncate text-xs text-muted-foreground/70">{t.album}</p>}
                    </div>
                    <EditSoundDialog track={t} onSaved={updateProfile} />
                    {!savedUrl && (
                      <Button variant="ghost" size="icon" aria-label={`Remove ${t.name}`}
                        onClick={() => { if (!seeds.some((s) => s.track.id === t.id)) void recordRemoval(t.id, { seedId: seeds[0]?.track.id ?? null, context: `vibe: ${vibe}` }); setTracks((all) => {
                          const rest = (all ?? []).filter((x) => x.id !== t.id);
                          const first = seeds.find((s) => rest.some((x) => x.id === s.track.id))?.track.id;
                          return sequence(rest, first);
                        }); }}>
                        <X className="w-4 h-4" />
                      </Button>
                    )}
                  </li>
                ))}
              </ol>
            </>
          )}
        </article>
      )}
    </div>
  );
}
