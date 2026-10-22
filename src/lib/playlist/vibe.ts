// Builds ONE playlist from a vibe: AI recipe → strict local filter → AI review → coherence + sequence.
// Never fills with songs that failed a filter.
import { supabase } from "@/integrations/supabase/client";
import type { Lang, Mood, TrackProfile } from "./features";
import { compatibility, sequence, isDance, sameOrNeighborStyle, MOOD_NEIGHBORS, melodicKin, feelingScore, feelingNeighbors, soundMatch, FEELING_NAMES, isCleanName } from "./organize";
import { MOMENT_LABEL } from "./moments";
import { withinBudget } from "./priority";
import { checkFinalPlaylist, type QualityReport } from "./quality";
import { uniqueSongs, songIdentity } from "./identity";
import { loadRemovalRules, respectsRemovals } from "./feedback";

export interface VibeSpec {
  energy_min: number; energy_max: number;
  valence_min: number; valence_max: number;
  tempo_min: number; tempo_max: number;
  moods_allowed: Mood[]; moods_excluded: Mood[];
  preferred_families: string[]; excluded_families: string[];
  language: Lang | null;
  era_min: number | null; era_max: number | null;
  name: string;
  // Rich recipe (optional for cached specs from before these existed)
  vocals?: "none" | "sparse" | "soft" | "lead" | "any" | null;
  listening?: "background" | "focused" | "any" | null;
  moment?: "sunrise" | "day" | "golden-hour-sunset" | "night" | "late-night" | "any" | null;
  moment_story?: string;
  moments?: string[]; // up to 3 ranked life moments from the official 30-moment list
  instruments_preferred?: string[];
  instruments_excluded?: string[];
  warmth_min?: number | null; warmth_max?: number | null;
  texture_min?: number | null; texture_max?: number | null;
  percussive_drive_min?: number | null; percussive_drive_max?: number | null;
  melodic_focus_min?: number | null; melodic_focus_max?: number | null;
  feelings_allowed?: string[];
  clarify?: { question: string; options: string[] } | null;
}

export interface VibeResult {
  spec: VibeSpec;
  lang: Lang;
  reasons?: Record<string, string>;
  tracks: TrackProfile[];
  candidates: number;
  approved: number;
  eights?: number;
  sevens?: number;
  clarify?: { question: string; options: string[] } | null;
  funnel?: { total: number; hard: number; inLang: number; listened: number };
  quality?: QualityReport;
}

const E_TOL = 0.08;
const MIN_SEED_COMPAT = 0.6;
const MAX_CANDIDATES = 60; // best seed/recipe fits only, so the review stays fast
const MIN_SCORE = 8;
const FILL_SCORE = 7;
const FILL_TARGET = 20;
const MIN_COHESION = 0.55;
const MIN_SEED_COHESION = 0.5;
const MAX_TRACKS = 30;
const FEEL_EXTRA_STYLES = ["ambient-electronic", "indie-dance", "nu-disco", "synth-pop", "indie-pop", "lo-fi", "soundtrack", "classical"];
/** AI unsure how the song feels: it needs an 8 or more to get in. */
const lowConfidence = (t: TrackProfile) => t.confidence !== null && t.confidence !== undefined && t.confidence < 0.5;
const SELECT_BATCH = 20; // all batches run in parallel

const mid = (a: number, b: number) => (a + b) / 2;

/** Distance-to-recipe (lower is closer). */
function distance(t: TrackProfile, s: VibeSpec): number {
  let d = 0;
  if (t.energy !== null) d += Math.abs(t.energy - mid(s.energy_min, s.energy_max)) * 2;
  else d += 0.5;
  if (t.valence !== null) {
    if (t.valence < s.valence_min - 0.1 || t.valence > s.valence_max + 0.1) d += 0.4;
    d += Math.abs(t.valence - mid(s.valence_min, s.valence_max));
  }
  if (t.tempo !== null && (t.tempo < s.tempo_min || t.tempo > s.tempo_max)) {
    const half = t.tempo / 2, dbl = t.tempo * 2; // half/double time still feels right
    if (!(half >= s.tempo_min && half <= s.tempo_max) && !(dbl >= s.tempo_min && dbl <= s.tempo_max)) d += 0.3;
  }
  if (t.mood && s.moods_allowed.length) d += s.moods_allowed.includes(t.mood) ? -0.3 : 0.25;
  if (s.preferred_families.length) d += t.families.some((f) => s.preferred_families.includes(f)) ? -0.25 : 0.15;
  if (t.year && s.era_min && t.year < s.era_min) d += 0.4;
  if (t.year && s.era_max && t.year > s.era_max) d += 0.4;
  const rangeD = (v: number | null | undefined, lo: number | null | undefined, hi: number | null | undefined, w: number) => {
    if (v == null || (lo == null && hi == null)) return 0;
    const a = lo ?? 0, b = hi ?? 1;
    if (a <= 0 && b >= 1) return 0;
    return v < a ? (a - v) * w : v > b ? (v - b) * w : 0;
  };
  d += rangeD(t.warmth, s.warmth_min, s.warmth_max, 1.5);
  d += rangeD(t.texture, s.texture_min, s.texture_max, 1.5);
  d += rangeD(t.percussiveDrive, s.percussive_drive_min, s.percussive_drive_max, 1.5);
  d += rangeD(t.melodicFocus, s.melodic_focus_min, s.melodic_focus_max, 1.5);
  if (s.instruments_preferred?.length && t.instruments.length)
    d += t.instruments.some((i) => s.instruments_preferred!.includes(i)) ? -0.2 : 0.1;
  // Feelings rank candidates too (they never discard: only vocals, excluded instruments and language do).
  if (s.feelings_allowed?.length) {
    const own = [t.feeling, t.feeling2].filter(Boolean) as string[];
    if (own.length) d += own.some((f) => s.feelings_allowed!.includes(f)) ? -0.3
      : own.some((f) => s.feelings_allowed!.some((a) => feelingNeighbors(a, f))) ? -0.1 : 0.3;
  }
  // Life moments rank candidates too (they never discard).
  if (s.moments?.length && t.moments?.length) {
    const hit = t.moments.some((m) => s.moments!.includes(m.m) && m.s >= 0.5);
    d += hit ? -0.35 : 0.2;
  }
  return d;
}

const MIN_CANDIDATES = 10;

/** Relaxable rules, dropped in this order by Plan B. */
type Soft = "mood" | "feel" | "era" | "tempo";
const RELAX_ORDER: Soft[] = ["mood", "feel", "era", "tempo"];

const VOCAL_INSTRUMENTS = ["lead-vocals", "vocal-chops", "choir"];
/** vocals = none: no song with a sung voice (when we know the instruments). */
const hasVoice = (t: TrackProfile) => t.instruments.some((i) => VOCAL_INSTRUMENTS.includes(i));
/** Feeling gate: the song's main or secondary feeling is allowed (or a neighbor of an allowed one). */
const feelAllowed = (t: TrackProfile, s: VibeSpec) => {
  const allowed = s.feelings_allowed ?? [];
  if (!allowed.length) return true;
  const own = [t.feeling, t.feeling2].filter(Boolean) as string[];
  if (!own.length) return true; // unknown feeling passes
  return own.some((f) => allowed.includes(f) || allowed.some((a) => feelingNeighbors(a, f)));
};

function inTempo(t: TrackProfile, s: VibeSpec): boolean {
  if (t.tempo === null) return true;
  const ok = (x: number) => x >= s.tempo_min && x <= s.tempo_max;
  return ok(t.tempo) || ok(t.tempo / 2) || ok(t.tempo * 2);
}
const inEra = (t: TrackProfile, s: VibeSpec) =>
  !t.year || ((!s.era_min || t.year >= s.era_min) && (!s.era_max || t.year <= s.era_max));

/** Never relaxed: energy range, excluded families, style (same or neighbor of a seed). */
function passesHardRules(t: TrackProfile, s: VibeSpec, seeds: TrackProfile[]): boolean {
  if (t.energy === null) return false;
  if (t.energy < s.energy_min - E_TOL || t.energy > s.energy_max + E_TOL) return false;
  if (t.families.some((f) => s.excluded_families.includes(f))) return false;
  if (s.vocals === "none" && t.instruments.length && hasVoice(t)) return false;
  if (s.instruments_excluded?.length && t.instruments.some((i) => s.instruments_excluded!.includes(i))) return false;
  const seedStyles = seeds.map((x) => x.style).filter(Boolean);
  if (seedStyles.length && !seedStyles.some((st) => sameOrNeighborStyle(st, t.style))) {
    // Melodic seed: nearby styles may join when they feel the same and energy is within 0.25.
    const kin = !!t.style && FEEL_EXTRA_STYLES.includes(t.style) && seeds.some((x) => melodicKin(x, t));
    if (!kin) return false;
  }
  return true;
}

function passesSoft(t: TrackProfile, s: VibeSpec, active: Set<Soft>): boolean {
  if (active.has("mood") && t.mood && s.moods_excluded.includes(t.mood)) return false;
  if (active.has("feel") && !feelAllowed(t, s)) return false;
  if (active.has("era") && !inEra(t, s)) return false;
  if (active.has("tempo") && !inTempo(t, s)) return false;
  return true;
}

/** With seeds, mood/era/tempo only nudge the score. */
function preferenceBonus(t: TrackProfile, s: VibeSpec): number {
  let b = 0;
  if (t.mood) b += s.moods_allowed.includes(t.mood) ? 0.04 : s.moods_excluded.includes(t.mood) ? -0.04 : 0;
  if (t.year && (s.era_min || s.era_max)) b += inEra(t, s) ? 0.03 : -0.03;
  if (t.tempo !== null) b += inTempo(t, s) ? 0.02 : -0.02;
  return b;
}

const ERA_WORDS = /\b(1[89]|20)\d{2}s?\b|\b'?\d0s\b|\b(sixties|seventies|eighties|nineties|dosmil|ochentas?|noventas?|setentas?|sesentas?|oldies|old school|retro|vintage|throwback|classic|clasicos?|modern|new|nuevas?|recent|actual)\b|\ba[nñ]os\s?\d0/i;
/** Without seeds: era is a filter only if the keywords mention it; allowed moods include neighbors. */
export function normalizeSpec(spec: VibeSpec, keywords: string, hasSeeds: boolean): VibeSpec {
  const out = { ...spec };
  if (!hasSeeds && !ERA_WORDS.test(keywords)) { out.era_min = null; out.era_max = null; }
  if (!hasSeeds) {
    const allowed = new Set(out.moods_allowed);
    for (const m of spec.moods_allowed) for (const n of MOOD_NEIGHBORS[m] ?? []) allowed.add(n);
    out.moods_allowed = [...allowed];
    out.moods_excluded = out.moods_excluded.filter((m) => !allowed.has(m));
  }
  return out;
}

/** Step 2: local filter. `langChoice` = "auto" or a language code. */
export function filterCandidates(profiles: TrackProfile[], spec: VibeSpec, langChoice: string, seeds: TrackProfile[] = [], fitSeeds?: TrackProfile[], seedRank?: (t: TrackProfile) => number) {
  const seedIds = new Set(seeds.map((x) => x.id));
  const hard = profiles.filter((t) => !seedIds.has(t.id) && passesHardRules(t, spec, seeds));
  // Instrumental or dance-style seed: language is not a hard rule (style already is).
  const langFree = spec.vocals === "none" || (seeds.length > 0 && langChoice === "auto" && seeds.every((x) => x.lang === "instrumental" || isDance(x)));
  const seedLang = seeds.find((x) => x.lang !== "instrumental" && x.lang !== "unknown" && x.lang !== "other")?.lang;
  const topLang = (list: TrackProfile[], fallback: Lang) => {
    const counts = new Map<Lang, number>();
    for (const t of list) if (t.lang !== "unknown" && t.lang !== "other") counts.set(t.lang, (counts.get(t.lang) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? fallback;
  };
  let lang: Lang;
  if (langChoice !== "auto") lang = langChoice as Lang;
  else if (seedLang) lang = seedLang;
  else if (seeds.length) lang = topLang(hard, "instrumental");
  else if (spec.language) lang = spec.language;
  else lang = topLang(hard, "en");
  const langOk = (t: TrackProfile) =>
    langFree || t.lang === lang || t.lang === "instrumental" || // instrumentals join any language
    (isDance(t) && seeds.some((x) => isDance(x) && sameOrNeighborStyle(x.style, t.style)));
  const inLang = hard.filter(langOk);

  // Artist as seed: its 3 songs span its sound, so a song only needs to fit one of them.
  const seedFit = (t: TrackProfile) => fitSeeds?.length ? Math.max(...fitSeeds.map((x) => compatibility(t, x))) : seeds.reduce((a, x) => a + compatibility(t, x), 0) / seeds.length;
  const rank = (list: TrackProfile[]) => seeds.length && seedRank
    ? list.map((t) => ({ t, c: seedRank(t) })).sort((a, b) => b.c - a.c).map((x) => x.t)
    : seeds.length
    ? list.map((t) => ({ t, c: seedFit(t) })).filter((x) => x.c >= MIN_SEED_COMPAT)
        .sort((a, b) => (b.c + preferenceBonus(b.t, spec)) - (a.c + preferenceBonus(a.t, spec))).map((x) => x.t)
    : list.map((t) => ({ t, d: distance(t, spec) })).sort((a, b) => a.d - b.d).map((x) => x.t);

  // Only the clear rules discard (vocals = none, excluded instruments, language — all in
  // passesHardRules). Mood, feeling, era and tempo only RANK the candidates (distance()).
  const active = new Set<Soft>();
  let candidates = rank(inLang.filter((t) => passesSoft(t, spec, active)));
  const relaxed: Soft[] = [];
  // Plan B: too few candidates but enough compatible songs → relax mood, then era, then tempo.
  const enough = seedRank ? inLang.length >= MIN_CANDIDATES : seeds.length ? inLang.filter((t) => seedFit(t) >= MIN_SEED_COMPAT).length >= MIN_CANDIDATES : inLang.length >= MIN_CANDIDATES;
  for (const r of RELAX_ORDER) {
    if (candidates.length >= MIN_CANDIDATES || !enough) break;
    if (!active.has(r)) continue;
    active.delete(r); relaxed.push(r);
    candidates = rank(inLang.filter((t) => passesSoft(t, spec, active)));
  }
  return { lang, candidates: candidates.slice(0, seedRank ? MAX_CANDIDATES * 2 : MAX_CANDIDATES), relaxed,
    funnel: { total: profiles.length, hard: hard.length, inLang: inLang.length } };
}

const vibeKey = (v: string) => v.toLowerCase().replace(/\s+/g, " ").trim();

/** A past user correction to the interpretation of a phrase. */
export interface SpecCorrection { phrase: string; spec: Partial<VibeSpec> }

const seedBodyOf = (seeds: TrackProfile[]) => seeds.map((t) => ({
  name: t.name, artists: t.artists, year: t.year, genres: t.genres.slice(0, 6), lang: t.lang,
  energy: t.energy, valence: t.valence, danceability: t.danceability, tempo: t.tempo, mood: t.mood,
  style: t.style ?? null, scene: t.scene ?? null, instruments: t.instruments ?? [], feeling: t.feeling ?? null, feeling_2: t.feeling2 ?? null, arc: t.arc ?? null, melodic_focus: t.melodicFocus ?? null,
  moments: t.moments ?? null, moment_story: t.momentStory ?? null,
}));

/** Reads the vibe into a recipe: cache first, then vibe-spec (with the user's past corrections). An exact-phrase correction wins. */
export async function readVibeSpec(userId: string, vibe: string, seeds: TrackProfile[], corrections: SpecCorrection[] = []): Promise<VibeSpec> {
  const specKey = "s3-moments|" + vibeKey(vibe) + "|" + seeds.map((x) => `${x.id}~${x.feeling ?? ""}~${x.feeling2 ?? ""}~${x.arc ?? ""}~${x.scene ?? ""}`).join(",");
  const { data: cached } = await supabase.from("vibe_spec_cache").select("spec").eq("user_id", userId).eq("spec_key", specKey).maybeSingle();
  let raw = cached?.spec as unknown as VibeSpec | undefined;
  if (!raw) {
    const call = () => supabase.functions.invoke("vibe-spec", { body: { vibe, seeds: seedBodyOf(seeds), corrections: corrections.slice(0, 10) } });
    let { data, error } = await call();
    if (error || data?.error) ({ data, error } = await call());
    if (error || data?.error) throw new Error(data?.error ?? error?.message ?? "Couldn't read the vibe.");
    raw = data as VibeSpec;
    supabase.from("vibe_spec_cache").upsert({ user_id: userId, spec_key: specKey, spec: raw as any }, { onConflict: "user_id,spec_key" }).then(() => {});
  }
  const normalized = normalizeSpec({ ...raw }, vibe, seeds.length > 0);
  if (!isCleanName(normalized.name)) normalized.name = ""; // breaks naming rules → local naming
  const exact = corrections.find((c) => vibeKey(c.phrase) === vibeKey(vibe));
  return exact ? { ...normalized, ...exact.spec, name: normalized.name, clarify: null } : normalized;
}

/** Step 3: AI review with per-(vibe, song) cache. */
const r2 = (x: number | null) => (x === null ? null : Math.round(x * 100) / 100);
const brief = (t: TrackProfile) => ({
  id: t.id, name: t.name, artists: t.artists, year: t.year, genres: t.genres.slice(0, 5),
  style: t.style ?? null, lang: t.lang, energy: r2(t.energy), mood: t.mood,
  instruments: t.instruments, texture: r2(t.texture), warmth: r2(t.warmth), scale: r2(t.scale), groove: t.groove, scene: t.scene, feeling: t.feeling, feeling_2: t.feeling2 ?? null, melodic_focus: r2(t.melodicFocus), arc: t.arc,
});
/** Full seed profile for the AI. */
export const seedProfile = (t: TrackProfile) => ({
  ...brief(t), families: t.families, valence: r2(t.valence), danceability: r2(t.danceability),
  tempo: t.tempo !== null ? Math.round(t.tempo) : null,
});

async function scoreCandidates(userId: string, vibe: string, cands: TrackProfile[], seeds: TrackProfile[], onProgress?: (d: number, t: number) => void) {
  const key = "v6|" + vibeKey(vibe) + (seeds.length ? ` |seed:${seeds.map((x) => `${x.id}~${x.feeling ?? ""}~${x.feeling2 ?? ""}~${x.arc ?? ""}~${x.melodicFocus ?? ""}~${x.scene ?? ""}`).join(",")}` : "");
  const scores = new Map<string, number>();
  const ids = cands.map((c) => c.id);
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await supabase.from("vibe_select_cache").select("spotify_track_id, score")
      .eq("user_id", userId).eq("vibe_key", key).in("spotify_track_id", ids.slice(i, i + 200));
    for (const r of data ?? []) scores.set(r.spotify_track_id, Number(r.score));
  }
  const todo = cands.filter((c) => !scores.has(c.id));
  let done = 0;
  onProgress?.(0, todo.length);
  const batches: TrackProfile[][] = [];
  for (let i = 0; i < todo.length; i += SELECT_BATCH) batches.push(todo.slice(i, i + SELECT_BATCH));
  await Promise.all(batches.map(async (batch) => {
    const { data, error } = await supabase.functions.invoke("vibe-select", {
      body: { vibe, tracks: batch.map(brief), seeds: seeds.map(seedProfile) },
    });
    if (error || data?.error) throw new Error(data?.error ?? error?.message ?? "The AI review failed.");
    const rows = [];
    for (const r of data.results ?? []) {
      scores.set(r.id, r.score);
      rows.push({ user_id: userId, vibe_key: key, spotify_track_id: r.id, score: r.score });
    }
    if (rows.length) await supabase.from("vibe_select_cache").upsert(rows, { onConflict: "user_id,vibe_key,spotify_track_id" });
    done += batch.length;
    onProgress?.(done, todo.length);
  }));
  return scores;
}

const LISTEN_TOP = 40;
const LISTEN_TOP_NOSEED = 80; // wide net for text-only vibes: 10 batches of 8, all at once
const LISTEN_BATCH = 8;

const near = (x: number | null | undefined, y: number | null | undefined, tol = 0.35) =>
  x == null || y == null ? null : Math.max(0, 1 - Math.abs(x - y) / tol);
/** Stored-sound similarity only (instruments, drive, texture, melodic focus, warmth, scale, groove). No feeling. */
export function soundSimilarity(a: TrackProfile, b: TrackProfile): number {
  const parts: [number | null, number][] = [
    [soundMatch(a, b), 0.45],
    [near(a.percussiveDrive, b.percussiveDrive, 0.3), 0.2],
    [near(a.melodicFocus, b.melodicFocus, 0.3), 0.2],
    [a.groove && b.groove ? (a.groove === b.groove ? 1 : 0) : null, 0.15],
  ];
  const known = parts.filter(([v]) => v !== null) as [number, number][];
  const w = known.reduce((x, [, k]) => x + k, 0);
  return w ? known.reduce((x, [v, k]) => x + v * k, 0) / w : 0;
}

/** Most similar seed for a candidate in stored sound. */
export const nearestSeed = (t: TrackProfile, seeds: TrackProfile[]) =>
  seeds.reduce((best, x) => (soundSimilarity(t, x) > soundSimilarity(t, best) ? x : best), seeds[0]);
/** The seed the candidate is judged against: the one whose feeling matches it (strong, then neighbor), else nearest in sound. */
export const feelSeed = (t: TrackProfile, seeds: TrackProfile[]) =>
  seeds.find((x) => strongFeelPair(t, x)) ?? seeds.find((x) => (feelingScore(t, x) ?? 0) >= 0.5) ?? nearestSeed(t, seeds);

const r2n = (x: number | null | undefined) => (x == null ? null : Math.round(x * 100) / 100);
const earSeed = (t: TrackProfile) => ({
  name: t.name, artists: t.artists, instruments: t.instruments, piano: (t as any).piano ?? null,
  melodic_focus: r2n(t.melodicFocus), percussive_drive: r2n(t.percussiveDrive), texture: r2n(t.texture), warmth: r2n(t.warmth),
  scale: r2n(t.scale), groove: t.groove, energy: r2n(t.energy), style: t.style ?? null, feeling: t.feeling, feeling_2: t.feeling2 ?? null, arc: t.arc,
  moments: t.moments?.map((m) => m.m), moment_story: t.momentStory ?? undefined,
  production_era: t.productionEra, drum_sound: t.drumSound, mix_character: t.mixCharacter,
  vocal_space: t.vocalSpace, vocal_style: t.vocalStyle,
});

/** Human-readable interpretation of the recipe, sent to the ear so it judges with the full picture. */
export function specContext(s: VibeSpec, vibe: string): string {
  const parts: string[] = [];
  if (vibe.trim()) parts.push(`"${vibe.trim()}"`);
  if (s.vocals === "none") parts.push("no vocals, purely instrumental");
  else if (s.vocals === "sparse") parts.push("very few vocals");
  else if (s.vocals === "soft") parts.push("soft, non-protagonist vocals");
  else if (s.vocals === "lead") parts.push("lead vocals up front");
  if (s.listening === "background") parts.push("background music: steady energy, no drops or sudden changes, nothing that distracts from conversation");
  else if (s.listening === "focused") parts.push("for attentive listening");
  if (s.moment_story) parts.push(s.moment_story);
  if (s.moments?.length) parts.push(`moments: ${s.moments.map((m) => MOMENT_LABEL[m] ?? m).join(", ")}`);
  if (s.moment && s.moment !== "any") parts.push(`moment: ${s.moment}`);
  if (s.feelings_allowed?.length) parts.push(`feelings: ${s.feelings_allowed.join(", ")}`);
  if (s.instruments_preferred?.length) parts.push(`instruments: ${s.instruments_preferred.join(", ")}`);
  if (s.instruments_excluded?.length) parts.push(`without: ${s.instruments_excluded.join(", ")}`);
  const eMid = (s.energy_min + s.energy_max) / 2;
  parts.push(eMid < 0.35 ? "low energy" : eMid < 0.65 ? "mid energy" : "high energy");
  const wMid = ((s.warmth_min ?? 0) + (s.warmth_max ?? 1)) / 2;
  if ((s.warmth_min ?? 0) > 0 || (s.warmth_max ?? 1) < 1) parts.push(wMid >= 0.5 ? "warm" : "cold/dark");
  return parts.join(", ").slice(0, 1200);
}

/** Step 3: Gemini hears each candidate (15 s from the middle of the clip) against its feeling-matched seed's STORED analysis.
 *  Batches of 8, every request at once. Each (seed, context, candidate) score is cached. `onBatch` fires as each batch lands.
 *  Without seeds, `description` mode: each song is judged against the vibe description itself. */
export const hasSavedAudio = (t: TrackProfile) => t.audioSource === "deezer" || t.audioSource === "itunes";

/** Preserve rank within both groups: the best eight stored-audio candidates lead. */
export function audioFirst(candidates: TrackProfile[], limit: number): TrackProfile[] {
  return [...candidates.filter(hasSavedAudio), ...candidates.filter((t) => !hasSavedAudio(t))].slice(0, limit);
}

/** Background music belongs to one recording/instrument/voice world, not merely one mood. */
export function sameBackgroundWorld(a: TrackProfile, b: TrackProfile): boolean {
  if (!sameOrNeighborStyle(a.style, b.style)) return false;
  for (const key of ["drumSound", "mixCharacter", "vocalStyle", "vocalSpace"] as const) {
    if (a[key] && b[key] && a[key] !== b[key]) return false;
  }
  return soundMatch(a, b) >= 0.7;
}

async function listenCandidates(userId: string, cands: TrackProfile[], seeds: TrackProfile[], context: string,
  onProgress?: (d: number, t: number) => void, onBatch?: (scores: Map<string, number>) => void, description?: string, deadline = performance.now() + 19500) {
  const scores = new Map<string, number>();
  const reasons: Record<string, string> = {};
  const unheard = new Set<string>();
  const ctx = vibeKey(context);
  const keyOf = (seed: string) => "production2|" + seed + "|" + ctx;
  let closed = false;
  const jobs: { seed: string; ids: string[] }[] = [];
  // The first wave is exactly the top eight, even when several seeds are used.
  for (let i = 0; i < cands.length; i += LISTEN_BATCH) {
    const wave = cands.slice(i, i + LISTEN_BATCH);
    const groups = new Map<string, string[]>();
    for (const c of wave) {
      const seed = seeds.length ? feelSeed(c, seeds)?.id ?? "" : "";
      groups.set(seed, [...(groups.get(seed) ?? []), c.id]);
    }
    for (const [seed, ids] of groups) jobs.push({ seed, ids });
  }
  let done = 0;
  onProgress?.(0, cands.length);
  const run = async (j: { seed: string; ids: string[] }) => {
    if (closed || performance.now() >= deadline) return;
    const cache = await withinBudget(supabase.from("vibe_select_cache").select("spotify_track_id, score")
      .eq("user_id", userId).eq("vibe_key", keyOf(j.seed)).in("spotify_track_id", j.ids)
      .then(({ data }) => data), deadline, null);
    if (closed) return;
    for (const r of cache ?? []) scores.set(r.spotify_track_id, Number(r.score));
    if (scores.size) onBatch?.(scores);
    const ids = j.ids.filter((id) => !scores.has(id));
    if (!ids.length) return;
    const seed = seeds.find((x) => x.id === j.seed);
    const body = seed ? { seed: earSeed(seed), ids, context } : { description: description ?? context, ids, context };
    const call = () => supabase.functions.invoke("vibe-listen", { body });
    let { data, error } = await withinBudget(call(), deadline, { data: null, error: new Error("Listening timed out") });
    if ((error || data?.error) && performance.now() < deadline && !closed) {
      const wait = Math.max(0, Number(data?.retry_after_ms) || 0);
      if (performance.now() + wait < deadline) {
        if (wait) await withinBudget(new Promise((r) => setTimeout(r, wait)), deadline, undefined);
        ({ data, error } = await withinBudget(call(), deadline, { data: null, error: new Error("Listening timed out") }));
      }
    }
    if (closed) return;
    if (error || data?.error) { ids.forEach((id) => unheard.add(id)); return; }
    for (const id of data.unheard ?? []) unheard.add(id);
    const rows = (data.results ?? []).map((r: any) => {
      if (!ids.includes(r.id) || !Number.isFinite(r.score)) return null;
      scores.set(r.id, r.score);
      if (r.why) reasons[r.id] = r.why;
      return { user_id: userId, vibe_key: keyOf(j.seed), spotify_track_id: r.id, score: r.score };
    }).filter(Boolean);
    if (rows.length) void supabase.from("vibe_select_cache").upsert(rows, { onConflict: "user_id,vibe_key,spotify_track_id" }).then(() => {});
    done += (data.results ?? []).length;
    onProgress?.(done, cands.length);
    onBatch?.(scores);
  };
  // Launch top-eight jobs before the rest; one sonic reference is retained for description mode.
  const firstIds = new Set(cands.slice(0, 8).map((t) => t.id));
  const first = jobs.filter((j) => j.ids.some((id) => firstIds.has(id)));
  const later = jobs.filter((j) => !j.ids.some((id) => firstIds.has(id)));
  const all = (async () => {
    await Promise.all(first.map(run));
    await Promise.all(later.map(run));
  })();
  await withinBudget(all, deadline, undefined);
  closed = true;
  for (const t of cands) if (!scores.has(t.id)) unheard.add(t.id);
  return { scores, reasons, unheard };
}

/** Wide net: shares at least one feeling or a neighbor with some seed (unknown feeling passes). */
const feelsLikeSeed = (t: TrackProfile, seeds: TrackProfile[]) =>
  seeds.some((x) => { const f = feelingScore(t, x); return f === null || f >= 0.5; });
/** Strong: any shared feeling, main or secondary of either song. */
export const strongFeelPair = (t: TrackProfile, x: TrackProfile) => {
  const a = [t.feeling, t.feeling2].filter(Boolean), b = [x.feeling, x.feeling2].filter(Boolean);
  return a.some((f) => b.includes(f));
};
/** Strict ear: 8+ with a strong feeling match, or 9+ when only neighbors match. */
export const earAdmits = (ear: number, strong: boolean, neighbor: boolean) => (strong && ear >= 8) || (neighbor && ear >= 9);

let fitPool: TrackProfile[] = [];
/** Ear rescued a text 6 → treat it as a 7 for picking. */
export const rescuedScore = (text: number, ear: number | undefined, strong: boolean) => (text >= 7 ? text : ear !== undefined && ear >= 8 && strong ? 7 : text);

const seedFitOf = (t: TrackProfile, seeds: TrackProfile[]) => fitPool.length
  ? Math.max(...fitPool.map((x) => compatibility(t, x)))
  : seeds.reduce((a, x) => a + compatibility(t, x), 0) / seeds.length;

/** Step 4: pick 8+ (and 7s up to 20 when short), check coherence, cap, sequence. */
export function selectVibeTracks(cands: TrackProfile[], scores: Map<string, number>, seeds: TrackProfile[] = [], capArtist?: string, heard: Set<string> = new Set()) {
  const room = MAX_TRACKS - seeds.length;
  // Artist as seed: the artist's own songs (seeds included) stay at most 20% of the playlist.
  if (capArtist) {
    const own = (t: TrackProfile) => t.artists.some((a) => a.toLowerCase() === capArtist.toLowerCase());
    const others = cands.filter((t) => !own(t));
    const total = Math.min(MAX_TRACKS, seeds.length + others.filter((t) => (scores.get(t.id) ?? 0) >= FILL_SCORE).length);
    const extra = Math.max(0, Math.floor(total * 0.2) - seeds.filter(own).length);
    cands = [...others, ...cands.filter(own).sort((a, b) => (scores.get(b.id) ?? 0) - (scores.get(a.id) ?? 0)).slice(0, extra)];
  }
  const sc = (t: TrackProfile) => scores.get(t.id) ?? 0;
  // Coherence: songs the ear already approved skip it; for text-only songs, against the seed (or the group without seeds).
  const coheres = (t: TrackProfile) => !seeds.length || heard.has(t.id) || seedFitOf(t, seeds) >= MIN_SEED_COHESION;
  const fit = (t: TrackProfile) => (seeds.length ? seedFitOf(t, seeds) : 0);
  const top = cands.filter((t) => sc(t) >= MIN_SCORE && coheres(t))
    .sort((a, b) => sc(b) - sc(a) || fit(b) - fit(a));
  let picked = top.slice(0, room);
  let sevens: TrackProfile[] = [];
  const target = Math.min(FILL_TARGET, MAX_TRACKS) - seeds.length;
  if (picked.length < target && seeds.length) { // 7-fill only for seeded vibes; text vibes stay strict (8+)
    const base = picked;
    const rank = (t: TrackProfile) => seeds.length ? seedFitOf(t, seeds)
      : base.length ? base.reduce((a, o) => a + compatibility(t, o), 0) / base.length : 0;
    sevens = cands.filter((t) => sc(t) >= FILL_SCORE && sc(t) < MIN_SCORE && coheres(t) && !lowConfidence(t))
      .map((t) => ({ t, c: rank(t) })).sort((a, b) => b.c - a.c)
      .slice(0, target - picked.length).map((x) => x.t);
    picked = [...picked, ...sevens];
  }
  if (!seeds.length) {
    // No seed: group cohesion only for text-only songs — the ear's 8+ is final for songs Gemini heard.
    while (picked.length > 1) {
      if (!picked.some((t) => !heard.has(t.id))) break;
      const avgs = picked.map((t) => picked.reduce((a, o) => a + (o === t ? 0 : compatibility(t, o)), 0) / (picked.length - 1));
      let worst = -1;
      for (let i = 0; i < avgs.length; i++) if (!heard.has(picked[i].id) && (worst < 0 || avgs[i] < avgs[worst])) worst = i;
      if (worst < 0 || avgs[worst] >= MIN_COHESION) break;
      picked.splice(worst, 1);
    }
  }
  const keep = new Set(picked.map((t) => t.id));
  const eights = top.filter((t) => keep.has(t.id)).length;
  const sevenCount = sevens.filter((t) => keep.has(t.id)).length;
  const tracks = seeds.length ? sequence([...seeds, ...picked], seeds[0].id) : sequence(picked);
  return { tracks, eights, sevens: sevenCount };
}

/** Songs the user removed from playlists built on these seeds (playlist_feedback). */
async function removedForSeeds(userId: string, seeds: TrackProfile[]): Promise<Set<string>> {
  if (!seeds.length) return new Set();
  const { data } = await supabase.from("playlist_feedback").select("spotify_track_id")
    .eq("user_id", userId).eq("action", "removed").in("seed_track_id", seeds.map((s) => s.id));
  return new Set((data ?? []).map((r) => r.spotify_track_id));
}

export type VibeTimings = Record<"seed" | "recipe" | "filter" | "select" | "listen" | "order" | "name" | "first" | "total", number>;

/** Local name when there are no keywords (no recipe is asked for): evocative, never the genre. */
export const seedName = (seeds: TrackProfile[]) => {
  const f = seeds[0]?.feeling;
  const pool = f ? FEELING_NAMES[f] : null;
  return pool?.[0] ?? "New Sounds";
};

/** Seeds only: the listening net needs no recipe — energy around the seeds, nothing else. */
function seedSpec(seeds: TrackProfile[], wide: boolean): VibeSpec {
  const es = seeds.map((x) => x.energy).filter((e): e is number => e !== null);
  const pad = wide ? 0.35 : 0.15;
  return {
    energy_min: es.length ? Math.max(0, Math.min(...es) - pad) : 0, energy_max: es.length ? Math.min(1, Math.max(...es) + pad) : 1,
    valence_min: 0, valence_max: 1, tempo_min: 0, tempo_max: 400, moods_allowed: [], moods_excluded: [],
    preferred_families: [], excluded_families: [], language: null, era_min: null, era_max: null, name: seedName(seeds),
  };
}

export async function buildVibePlaylist(
  userId: string,
  vibe: string,
  profiles: TrackProfile[],
  langChoice: string,
  onStep: (label: string, done?: number, total?: number) => void,
  seeds: TrackProfile[] = [],
  capArtist?: string,
  onPartial?: (tracks: TrackProfile[]) => void,
  opts: { presetSpec?: VibeSpec; corrections?: SpecCorrection[]; startedAt?: number } = {},
): Promise<VibeResult & { timings: VibeTimings }> {
  const t0 = opts.startedAt ?? performance.now();
  profiles = uniqueSongs(profiles); seeds = uniqueSongs(seeds);
  const deadline = t0 + 19_500; // a vibe never takes more than 20 seconds
  const timings: VibeTimings = { seed: 0, recipe: 0, filter: 0, select: 0, listen: 0, order: 0, name: 0, first: 0, total: 0 };
  let mark = t0;
  const lap = (k: keyof VibeTimings) => { const now = performance.now(); timings[k] = Math.round(now - mark); mark = now; };
  const finish = async <T extends VibeResult>(r: T) => {
    if (r.tracks.length && !r.clarify) {
      onStep("Checking the complete playlist");
      const checked = await checkFinalPlaylist(r.tracks, specContext(r.spec, vibe), { deadline, startId: seeds[0]?.id });
      r = { ...r, tracks: checked.tracks, quality: checked.report, reasons: { ...r.reasons, ...checked.report.reasons } };
      if (checked.pending.length) void supabase.functions.invoke("audio-analyze", { body: { queue_ids: checked.pending.map((t) => t.id) } }).catch(() => {});
      console.info(`[vibe] quality ${JSON.stringify(checked.report)}`);
      if (checked.report.errors.length) throw new Error("No terminó la comprobación completa de oído; no se guardó ninguna playlist sin verificar.");
    }
    timings.total = Math.round(performance.now() - t0);
    console.info(`[vibe] timings (ms) ${JSON.stringify(timings)}`);
    console.info(`[vibe] funnel ${JSON.stringify((r as VibeResult).funnel ?? null)} approved=${(r as VibeResult).approved} tracks=${r.tracks.length}`);
    supabase.from("vibe_timings").insert({ user_id: userId, vibe, steps: timings as any, total_ms: timings.total, tracks: r.tracks.length }).then(() => {});
    return { ...r, timings };
  };

  onStep("Reading the vibe");
  // The foreground only reads stored seed analysis; incomplete seeds join the background queue.
  const pendingSeeds = seeds.filter((t) => !hasSavedAudio(t));
  if (pendingSeeds.length) void supabase.functions.invoke("audio-analyze", { body: { queue_ids: pendingSeeds.map((t) => t.id) } }).catch(() => {});
  lap("seed");
  const removedP = loadRemovalRules(userId).then((rules) => new Set(profiles.filter((t) => !respectsRemovals(t, seeds, rules, profiles)).map((t) => t.id)));
  // Recipe (and name) cached per vibe text + seed profile. With seeds it only names the playlist and runs
  // in parallel with listening; with seeds and no keywords it isn't asked for at all.
  const readRecipe = () => readVibeSpec(userId, vibe, seeds, opts.corrections ?? []);

  if (!seeds.length) {
    const spec0 = opts.presetSpec ?? await withinBudget(readRecipe(), deadline, null);
    if (!spec0) throw new Error("No se pudo interpretar el vibe dentro de 20 segundos.");
    const spec = { ...spec0, name: spec0.name || "New Sounds" };
    lap("recipe");
    if (spec.clarify) return finish({ spec, lang: "en", tracks: [], candidates: 0, approved: 0, clarify: spec.clarify });
    onStep("Finding songs that feel the same");
    fitPool = [];
    const removed = await withinBudget(removedP, deadline, null);
    if (!removed) throw new Error("No se pudieron leer tus correcciones a tiempo.");
    const { lang, candidates, funnel } = filterCandidates(profiles.filter((t) => !removed.has(t.id)), spec, langChoice, []);
    lap("filter");
    if (!candidates.length) return finish({ spec, lang, tracks: [], candidates: 0, approved: 0, funnel: { ...funnel, listened: 0 } });
    // The ear judges against the full interpretation; songs without a clip keep the text review.
    const ctx = specContext(spec, vibe);
    const ordered = audioFirst(candidates, LISTEN_TOP_NOSEED);
    const reference = ordered.find(hasSavedAudio);
    const top = spec.listening === "background" && reference
      ? ordered.filter((t) => t.id === reference.id || sameBackgroundWorld(t, reference)) : ordered;
    const withClip = top.filter(hasSavedAudio);
    const noClip = top.filter((t) => !hasSavedAudio(t));
    onStep("Listening to the songs");
    const live = (ear: Map<string, number>) => {
      const ok = withClip.filter((t) => (ear.get(t.id) ?? 0) >= MIN_SCORE).sort((a, b) => (ear.get(b.id) ?? 0) - (ear.get(a.id) ?? 0));
      if (!ok.length) return;
      if (!timings.first) timings.first = Math.round(performance.now() - t0);
      onPartial?.(ok.slice(0, MAX_TRACKS));
    };
    const listenP = top.length
      ? listenCandidates(userId, top, spec.listening === "background" && reference ? [reference] : [], ctx,
        (d, t) => onStep("Listening to the songs", d, t), live, ctx, deadline)
      : Promise.resolve({ scores: new Map<string, number>(), unheard: new Set<string>(), reasons: {} as Record<string, string> });
    const textP = Promise.resolve(new Map<string, number>());
    // Hard budget: text scoring that outlives the deadline is abandoned — its songs are
    // omitted (never rejected), and the ear's verdicts still land.
    const text = await Promise.race([
      textP,
      new Promise<Map<string, number>>((r) => setTimeout(() => r(new Map()), Math.max(0, deadline - performance.now()))),
    ]);
    const { scores: ear, unheard, reasons } = await listenP; // self-bounded by the same deadline
    const late = top.filter((t) => !ear.has(t.id) && !text.has(t.id) && unheard.has(t.id));
    // Unheard songs are omitted and queued, never rescued by a text score after a failed listen.
    const text2 = new Map<string, number>();
    const scores = new Map([...text, ...text2, ...ear]);
    // Strict ear: only 8 or more gets in (no 7-fill without a seed).
    const pool = top.filter((t) => (scores.get(t.id) ?? 0) >= MIN_SCORE);
    const approved = pool.length;
    lap("listen");
    onStep("Putting them in order");
    const sel = selectVibeTracks(pool, scores, [], undefined, new Set(ear.keys()));
    lap("order");
    if (noClip.length || unheard.size) void supabase.functions.invoke("audio-analyze", { body: { queue_ids: [...new Set([...noClip.map((t) => t.id), ...unheard])] } }).catch(() => {});
    return finish({ spec, lang, tracks: sel.tracks, candidates: candidates.length, approved, eights: sel.eights, sevens: sel.sevens,
      reasons, funnel: { ...funnel, listened: ear.size } });
  }

  // With seeds — "wide net, strict ear".
  const local = seedSpec(seeds, !!capArtist);
  const recipeP = opts.presetSpec
    ? Promise.resolve(opts.presetSpec)
    : vibe.trim()
    ? readRecipe().then((s) => { timings.recipe = Math.round(performance.now() - t0); return s; }).catch(() => local)
    : Promise.resolve(local);
  onStep("Finding songs that feel the same");
  const removed = await withinBudget(removedP, deadline, null);
  if (!removed) throw new Error("No se pudieron leer tus correcciones a tiempo; no se creó el vibe.");
  fitPool = [];
  const soundRank = (t: TrackProfile) => Math.max(...seeds.map((x) => soundSimilarity(t, x)));
  const seedKeys = new Set(seeds.map(songIdentity));
  const { lang, candidates: raw0 } = filterCandidates(profiles.filter((t) => !removed.has(t.id) && !seedKeys.has(songIdentity(t))), local, langChoice, seeds, fitPool, soundRank);
  const candidates = raw0.filter((t) => feelsLikeSeed(t, seeds));
  lap("filter");
  if (!candidates.length) {
    const spec = await withinBudget(recipeP, deadline, local);
    return finish({ spec, lang, tracks: sequence(seeds, seeds[0].id), candidates: 0, approved: 0 });
  }

  // Admission: judged against the seed whose feeling matches the song.
  const admits = (t: TrackProfile, sc: number) => {
    const s = feelSeed(t, seeds);
    const strong = !t.feeling || !s.feeling || strongFeelPair(t, s);
    const neighbor = (feelingScore(t, s) ?? 0) >= 0.5;
    return earAdmits(sc, strong, neighbor);
  };
  const top = audioFirst(candidates, LISTEN_TOP);
  const withClip = top.filter(hasSavedAudio);
  const noClip = top.filter((t) => !hasSavedAudio(t));
  onStep("Listening to the songs");
  const live = (ear: Map<string, number>) => {
    const ok = withClip.filter((t) => ear.has(t.id) && admits(t, ear.get(t.id) ?? 0)).sort((a, b) => (ear.get(b.id) ?? 0) - (ear.get(a.id) ?? 0));
    if (!ok.length) return;
    if (!timings.first) timings.first = Math.round(performance.now() - t0);
    onPartial?.([...seeds, ...ok.slice(0, MAX_TRACKS - seeds.length)]);
  };
  const listenP = listenCandidates(userId, top, seeds, specContext(opts.presetSpec ?? local, vibe), (d, t) => onStep("Listening to the songs", d, t), live, undefined, deadline);
  const textP = Promise.resolve(new Map<string, number>());
  // Hard budget: text scoring that outlives the deadline is abandoned — its songs are
  // omitted (never rejected), and the ear's verdicts still land.
  const text = await Promise.race([
    textP,
    new Promise<Map<string, number>>((r) => setTimeout(() => r(new Map()), Math.max(0, deadline - performance.now()))),
  ]);
  const { scores: ear, unheard, reasons } = await listenP; // self-bounded by the same deadline
  const late = top.filter((t) => !ear.has(t.id) && !text.has(t.id) && unheard.has(t.id));
  const text2 = new Map<string, number>();
  const scores = new Map([...text, ...text2, ...ear]);
  const pool = top.filter((t) => admits(t, scores.get(t.id) ?? 0));
  lap("listen");

  onStep("Putting them in order");
  const sel = selectVibeTracks(pool, scores, seeds, capArtist, new Set(ear.keys()));
  lap("order");
  const spec = await withinBudget(recipeP, deadline, local);
  lap("name");
  if (noClip.length || unheard.size) void supabase.functions.invoke("audio-analyze", { body: { queue_ids: [...new Set([...noClip.map((t) => t.id), ...unheard])] } }).catch(() => {});
  return finish({ spec: { ...spec, name: spec.name || local.name }, lang, tracks: sel.tracks, candidates: candidates.length, approved: pool.length, eights: sel.eights, sevens: sel.sevens, funnel: { total: profiles.length, hard: 0, inLang: 0, listened: ear.size }, reasons });
}
