// Builds ONE playlist from a vibe: AI recipe → strict local filter → AI review → coherence + sequence.
// Never fills with songs that failed a filter.
import { supabase } from "@/integrations/supabase/client";
import type { Lang, Mood, TrackProfile } from "./features";
import { compatibility, sequence } from "./organize";

export interface VibeSpec {
  energy_min: number; energy_max: number;
  valence_min: number; valence_max: number;
  tempo_min: number; tempo_max: number;
  moods_allowed: Mood[]; moods_excluded: Mood[];
  preferred_families: string[]; excluded_families: string[];
  language: Lang | null;
  era_min: number | null; era_max: number | null;
  name: string;
}

export interface VibeResult {
  spec: VibeSpec;
  lang: Lang;
  tracks: TrackProfile[];
  candidates: number;
  approved: number;
}

const E_TOL = 0.08;
const MIN_SEED_COMPAT = 0.6;
const MAX_CANDIDATES = 120;
const MIN_SCORE = 8;
const MIN_COHESION = 0.55;
const MAX_TRACKS = 40;
const SELECT_BATCH = 40;

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
  return d;
}

function passesHardRules(t: TrackProfile, s: VibeSpec): boolean {
  if (t.energy === null) return false;
  if (t.energy < s.energy_min - E_TOL || t.energy > s.energy_max + E_TOL) return false;
  if (t.mood && s.moods_excluded.includes(t.mood)) return false;
  if (t.families.some((f) => s.excluded_families.includes(f))) return false;
  return true;
}

/** Step 2: local filter. `langChoice` = "auto" or a language code. */
export function filterCandidates(profiles: TrackProfile[], spec: VibeSpec, langChoice: string, seeds: TrackProfile[] = []) {
  const seedIds = new Set(seeds.map((x) => x.id));
  const passing = profiles.filter((t) => !seedIds.has(t.id) && passesHardRules(t, spec));
  const seedLang = seeds.find((x) => x.lang !== "instrumental" && x.lang !== "unknown" && x.lang !== "other")?.lang;
  let lang: Lang;
  if (langChoice !== "auto") lang = langChoice as Lang;
  else if (seedLang) lang = seedLang;
  else if (seeds.length) {
    const counts = new Map<Lang, number>();
    for (const t of passing) if (t.lang !== "unknown" && t.lang !== "other") counts.set(t.lang, (counts.get(t.lang) ?? 0) + 1);
    lang = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "instrumental";
  }
  else if (spec.language) lang = spec.language;
  else {
    const counts = new Map<Lang, number>();
    for (const t of passing) if (t.lang !== "unknown" && t.lang !== "other") counts.set(t.lang, (counts.get(t.lang) ?? 0) + 1);
    lang = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "en";
  }
  // One language only (instrumentals only when the vibe itself is instrumental).
  const inLang = passing.filter((t) => t.lang === lang);
  if (seeds.length) {
    const seedFit = (t: TrackProfile) => seeds.reduce((a, x) => a + compatibility(t, x), 0) / seeds.length;
    const candidates = inLang
      .map((t) => ({ t, c: seedFit(t) }))
      .filter((x) => x.c >= MIN_SEED_COMPAT)
      .sort((a, b) => b.c - a.c)
      .slice(0, MAX_CANDIDATES)
      .map((x) => x.t);
    return { lang, candidates };
  }
  const candidates = inLang
    .map((t) => ({ t, d: distance(t, spec) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, MAX_CANDIDATES)
    .map((x) => x.t);
  return { lang, candidates };
}

const vibeKey = (v: string) => v.toLowerCase().replace(/\s+/g, " ").trim();

/** Step 3: AI review with per-(vibe, song) cache. */
const brief = (t: TrackProfile) => ({
  id: t.id, name: t.name, artists: t.artists, year: t.year, genres: t.genres.slice(0, 5),
  energy: t.energy !== null ? Math.round(t.energy * 100) / 100 : null, mood: t.mood,
});

async function scoreCandidates(userId: string, vibe: string, cands: TrackProfile[], seeds: TrackProfile[], onProgress?: (d: number, t: number) => void) {
  const key = vibeKey(vibe) + (seeds.length ? ` |seed:${seeds.map((x) => x.id).join(",")}` : "");
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
  for (let i = 0; i < todo.length; i += SELECT_BATCH) {
    const batch = todo.slice(i, i + SELECT_BATCH);
    const { data, error } = await supabase.functions.invoke("vibe-select", {
      body: {
        vibe,
        tracks: batch.map(brief),
        seeds: seeds.map(brief),
      },
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
  }
  return scores;
}

/** Step 4: drop songs that don't cohere with the rest, cap, sequence. */
function cohere(tracks: TrackProfile[], scores: Map<string, number>, seeds: TrackProfile[] = []): TrackProfile[] {
  let pool = [...tracks];
  // Iteratively remove the weakest song until everyone averages >= MIN_COHESION.
  while (pool.length > 1) {
    const avgs = pool.map((t) => {
      let s = 0;
      for (const o of pool) if (o !== t) s += compatibility(t, o);
      return s / (pool.length - 1);
    });
    let worst = 0;
    for (let i = 1; i < avgs.length; i++) if (avgs[i] < avgs[worst]) worst = i;
    if (avgs[worst] >= MIN_COHESION) break;
    pool.splice(worst, 1);
  }
  pool = pool.sort((a, b) => (scores.get(b.id) ?? 0) - (scores.get(a.id) ?? 0)).slice(0, MAX_TRACKS - seeds.length);
  if (!seeds.length) return sequence(pool);
  // First seed opens; other seeds are placed wherever they flow best.
  return sequence([...seeds, ...pool], seeds[0].id);
}

export async function buildVibePlaylist(
  userId: string,
  vibe: string,
  profiles: TrackProfile[],
  langChoice: string,
  onStep: (label: string, done?: number, total?: number) => void,
  seeds: TrackProfile[] = [],
): Promise<VibeResult> {
  onStep("Reading your vibe");
  const seedBody = seeds.map((t) => ({
    name: t.name, artists: t.artists, year: t.year, genres: t.genres.slice(0, 6), lang: t.lang,
    energy: t.energy, valence: t.valence, danceability: t.danceability, tempo: t.tempo, mood: t.mood,
  }));
  const { data, error } = await supabase.functions.invoke("vibe-spec", { body: { vibe, seeds: seedBody } });
  if (error || data?.error) throw new Error(data?.error ?? error?.message ?? "Couldn't read the vibe.");
  const spec = data as VibeSpec;

  onStep("Filtering your Liked Songs");
  const { lang, candidates } = filterCandidates(profiles, spec, langChoice, seeds);
  if (!candidates.length) return { spec, lang, tracks: seeds.length ? sequence(seeds, seeds[0].id) : [], candidates: 0, approved: 0 };

  const scores = await scoreCandidates(userId, vibe, candidates, seeds, (d, t) => onStep("Listening to every candidate", d, t));
  const approved = candidates.filter((c) => (scores.get(c.id) ?? 0) >= MIN_SCORE);

  onStep("Ordering the playlist");
  const tracks = cohere(approved, scores, seeds);
  return { spec, lang, tracks, candidates: candidates.length, approved: approved.length };
}
