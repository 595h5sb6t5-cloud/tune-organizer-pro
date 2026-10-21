// Builds ONE playlist from a vibe: AI recipe → strict local filter → AI review → coherence + sequence.
// Never fills with songs that failed a filter.
import { supabase } from "@/integrations/supabase/client";
import type { Lang, Mood, TrackProfile } from "./features";
import { compatibility, sequence, isDance, sameOrNeighborStyle, MOOD_NEIGHBORS, melodicKin, feelingScore, soundMatch } from "./organize";
import { ensureSeedFeeling, ensureSeedAudio } from "./ai";

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
  eights?: number;
  sevens?: number;
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
  return d;
}

const MIN_CANDIDATES = 10;

/** Relaxable rules, dropped in this order by Plan B. */
type Soft = "mood" | "era" | "tempo";
const RELAX_ORDER: Soft[] = ["mood", "era", "tempo"];

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
  const langFree = seeds.length > 0 && langChoice === "auto" && seeds.every((x) => x.lang === "instrumental" || isDance(x));
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
    langFree || t.lang === lang || (isDance(t) && seeds.some((x) => isDance(x) && sameOrNeighborStyle(x.style, t.style)));
  const inLang = hard.filter(langOk);

  // Artist as seed: its 3 songs span its sound, so a song only needs to fit one of them.
  const seedFit = (t: TrackProfile) => fitSeeds?.length ? Math.max(...fitSeeds.map((x) => compatibility(t, x))) : seeds.reduce((a, x) => a + compatibility(t, x), 0) / seeds.length;
  const rank = (list: TrackProfile[]) => seeds.length && seedRank
    ? list.map((t) => ({ t, c: seedRank(t) })).sort((a, b) => b.c - a.c).map((x) => x.t)
    : seeds.length
    ? list.map((t) => ({ t, c: seedFit(t) })).filter((x) => x.c >= MIN_SEED_COMPAT)
        .sort((a, b) => (b.c + preferenceBonus(b.t, spec)) - (a.c + preferenceBonus(a.t, spec))).map((x) => x.t)
    : list.map((t) => ({ t, d: distance(t, spec) })).sort((a, b) => a.d - b.d).map((x) => x.t);

  // Seeds: mood/era/tempo are preferences only. Without seeds they start as filters.
  const active = new Set<Soft>(seeds.length ? [] : RELAX_ORDER);
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
  return { lang, candidates: candidates.slice(0, seedRank ? MAX_CANDIDATES * 2 : MAX_CANDIDATES), relaxed };
}

const vibeKey = (v: string) => v.toLowerCase().replace(/\s+/g, " ").trim();

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
const LISTEN_BATCH = 4;
const LISTEN_PARALLEL = 10; // all 10 batches at once

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
});

/** Step 3: Gemini hears each candidate (15 s from the middle of the clip) against its feeling-matched seed's STORED analysis.
 *  Batches of 8, every request at once. Each (seed, context, candidate) score is cached. `onBatch` fires as each batch lands. */
async function listenCandidates(userId: string, cands: TrackProfile[], seeds: TrackProfile[], context: string,
  onProgress?: (d: number, t: number) => void, onBatch?: (scores: Map<string, number>) => void) {
  const scores = new Map<string, number>();
  const unheard = new Set<string>();
  const bySeed = new Map<string, string[]>();
  for (const c of cands) { const s = feelSeed(c, seeds).id; bySeed.set(s, [...(bySeed.get(s) ?? []), c.id]); }
  const ctx = vibeKey(context);
  const keyOf = (seed: string) => "ear4|" + seed + "|" + ctx;
  const jobs: { seed: string; ids: string[] }[] = [];
  await Promise.all([...bySeed.entries()].map(async ([seed, ids]) => {
    const { data } = await supabase.from("vibe_select_cache").select("spotify_track_id, score")
      .eq("user_id", userId).eq("vibe_key", keyOf(seed)).in("spotify_track_id", ids);
    for (const r of data ?? []) scores.set(r.spotify_track_id, Number(r.score));
    const todo = ids.filter((id) => !scores.has(id));
    for (let i = 0; i < todo.length; i += LISTEN_BATCH) jobs.push({ seed, ids: todo.slice(i, i + LISTEN_BATCH) });
  }));
  const total = jobs.reduce((a, j) => a + j.ids.length, 0);
  let done = 0;
  onProgress?.(0, total);
  if (scores.size) onBatch?.(scores);
  await Promise.all(jobs.map(async (j) => {
    const seed = seeds.find((x) => x.id === j.seed)!;
    const call = () => supabase.functions.invoke("vibe-listen", { body: { seed: earSeed(seed), ids: j.ids, context: ctx } });
    let { data, error } = await call();
    if (error || data?.error) ({ data, error } = await call()); // one retry for a busy moment
    if (error || data?.error) { for (const id of j.ids) unheard.add(id); return; } // falls back to the text review
    for (const id of data.unheard ?? []) unheard.add(id);
    const rows = (data.results ?? []).map((r: any) => { scores.set(r.id, r.score); return { user_id: userId, vibe_key: keyOf(j.seed), spotify_track_id: r.id, score: r.score }; });
    if (rows.length) supabase.from("vibe_select_cache").upsert(rows, { onConflict: "user_id,vibe_key,spotify_track_id" }).then(() => {});
    done += j.ids.length; onProgress?.(done, total);
    onBatch?.(scores);
  }));
  return { scores, unheard };
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
export function selectVibeTracks(cands: TrackProfile[], scores: Map<string, number>, seeds: TrackProfile[] = [], capArtist?: string) {
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
  // Coherence: with seeds, against the seed only; otherwise against the group.
  const coheres = (t: TrackProfile) => !seeds.length || seedFitOf(t, seeds) >= MIN_SEED_COHESION;
  const fit = (t: TrackProfile) => (seeds.length ? seedFitOf(t, seeds) : 0);
  const top = cands.filter((t) => sc(t) >= MIN_SCORE && coheres(t))
    .sort((a, b) => sc(b) - sc(a) || fit(b) - fit(a));
  let picked = top.slice(0, room);
  let sevens: TrackProfile[] = [];
  const target = Math.min(FILL_TARGET, MAX_TRACKS) - seeds.length;
  if (picked.length < target) {
    const base = picked;
    const rank = (t: TrackProfile) => seeds.length ? seedFitOf(t, seeds)
      : base.length ? base.reduce((a, o) => a + compatibility(t, o), 0) / base.length : 0;
    sevens = cands.filter((t) => sc(t) >= FILL_SCORE && sc(t) < MIN_SCORE && coheres(t) && !lowConfidence(t))
      .map((t) => ({ t, c: rank(t) })).sort((a, b) => b.c - a.c)
      .slice(0, target - picked.length).map((x) => x.t);
    picked = [...picked, ...sevens];
  }
  if (!seeds.length) {
    // No seed: keep the old group cohesion check.
    while (picked.length > 1) {
      const avgs = picked.map((t) => picked.reduce((a, o) => a + (o === t ? 0 : compatibility(t, o)), 0) / (picked.length - 1));
      let worst = 0;
      for (let i = 1; i < avgs.length; i++) if (avgs[i] < avgs[worst]) worst = i;
      if (avgs[worst] >= MIN_COHESION) break;
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

export type VibeTimings = Record<"seed" | "recipe" | "filter" | "select" | "listen" | "order" | "name" | "total", number>;

export async function buildVibePlaylist(
  userId: string,
  vibe: string,
  profiles: TrackProfile[],
  langChoice: string,
  onStep: (label: string, done?: number, total?: number) => void,
  seeds: TrackProfile[] = [],
  capArtist?: string,
): Promise<VibeResult & { timings: VibeTimings }> {
  const t0 = performance.now();
  const timings: VibeTimings = { seed: 0, recipe: 0, filter: 0, select: 0, listen: 0, order: 0, name: 0, total: 0 };
  let mark = t0;
  const lap = (k: keyof VibeTimings) => { const now = performance.now(); timings[k] = Math.round(now - mark); mark = now; };
  const finish = async <T extends VibeResult>(r: T) => {
    timings.total = Math.round(performance.now() - t0);
    console.info(`[vibe] timings (ms) ${JSON.stringify(timings)}`);
    // Query builders only run when awaited/then'd.
    supabase.from("vibe_timings").insert({ user_id: userId, vibe, steps: timings as any, total_ms: timings.total, tracks: r.tracks.length }).then(() => {});
    return { ...r, timings };
  };

  onStep("Reading the vibe");
  if (seeds.length) {
    const [felt, heard] = await Promise.all([ensureSeedFeeling(seeds), ensureSeedAudio(seeds)]);
    const fresh = felt.map((s) => { const h = heard.find((x) => x.id === s.id)!; return { ...s, audioSource: h.audioSource, percussiveDrive: h.percussiveDrive, instruments: h.instruments, texture: h.texture, warmth: h.warmth, scale: h.scale, groove: h.groove, melodicFocus: h.audioSource && !s.soundEdited ? h.melodicFocus : s.melodicFocus }; });
    seeds = fresh;
    profiles = profiles.map((p) => fresh.find((x) => x.id === p.id) ?? p);
  }
  lap("seed");
  const seedBody = seeds.map((t) => ({
    name: t.name, artists: t.artists, year: t.year, genres: t.genres.slice(0, 6), lang: t.lang,
    energy: t.energy, valence: t.valence, danceability: t.danceability, tempo: t.tempo, mood: t.mood,
    style: t.style ?? null, scene: t.scene ?? null, instruments: t.instruments ?? [], feeling: t.feeling ?? null, feeling_2: t.feeling2 ?? null, arc: t.arc ?? null, melodic_focus: t.melodicFocus ?? null,
  }));
  const removedP = removedForSeeds(userId, seeds);
  // Recipe (and name) cached per vibe text + seed profile.
  const specKey = "s1|" + vibeKey(vibe) + "|" + seeds.map((x) => `${x.id}~${x.feeling ?? ""}~${x.feeling2 ?? ""}~${x.arc ?? ""}~${x.scene ?? ""}`).join(",");
  const { data: cached } = await supabase.from("vibe_spec_cache").select("spec").eq("user_id", userId).eq("spec_key", specKey).maybeSingle();
  let raw = cached?.spec as unknown as VibeSpec | undefined;
  if (!raw) {
    const { data, error } = await supabase.functions.invoke("vibe-spec", { body: { vibe, seeds: seedBody } });
    if (error || data?.error) throw new Error(data?.error ?? error?.message ?? "Couldn't read the vibe.");
    raw = data as VibeSpec;
    supabase.from("vibe_spec_cache").upsert({ user_id: userId, spec_key: specKey, spec: raw as any }, { onConflict: "user_id,spec_key" }).then(() => {});
  }
  const spec = normalizeSpec({ ...raw }, vibe, seeds.length > 0);
  // Artist as seed: the artist's world spans its songs' energies (wider than one song's ±0.15).
  if (capArtist && seeds.length) {
    const es = seeds.map((x) => x.energy).filter((e): e is number => e !== null);
    if (es.length) { spec.energy_min = Math.max(0, Math.min(...es) - 0.35); spec.energy_max = Math.min(1, Math.max(...es) + 0.35); }
  }
  lap("recipe");

  onStep("Finding songs that feel the same");
  const removed = await removedP;
  // Artist as seed: a song fits the artist's world if it fits any of the artist's songs (the 3 seeds lead).
  fitPool = capArtist ? [...seeds, ...profiles.filter((t) => !seeds.some((x) => x.id === t.id) && t.artists.some((a) => a.toLowerCase() === capArtist.toLowerCase()))] : [];
  const soundRank = (t: TrackProfile) => Math.max(...seeds.map((x) => soundSimilarity(t, x)));
  const { lang, candidates: raw0 } = filterCandidates(profiles.filter((t) => !removed.has(t.id)), spec, langChoice, seeds, fitPool, seeds.length ? soundRank : undefined);
  const candidates = seeds.length ? raw0.filter((t) => feelsLikeSeed(t, seeds)) : raw0;
  lap("filter");
  if (!candidates.length) return finish({ spec, lang, tracks: seeds.length ? sequence(seeds, seeds[0].id) : [], candidates: 0, approved: 0 });

  // With seeds — "wide net, strict ear": the 40 heard are the closest in STORED sound (no feeling penalty,
  // only songs sharing no feeling or neighbor are skipped). Gemini's ear decides; the text review is only for songs without a clip.
  let scores = new Map<string, number>();
  let pool = candidates;
  let approved = 0;
  if (seeds.length) {
    lap("select");
    const top = candidates.slice(0, LISTEN_TOP);
    const withClip = top.filter((t) => t.audioSource !== "none");
    onStep("Listening to the songs");
    const listenP = listenCandidates(userId, withClip, seeds, vibe, (d, t) => onStep("Listening to the songs", d, t));
    const noClip = top.filter((t) => t.audioSource === "none");
    const textP = noClip.length ? scoreCandidates(userId, vibe, noClip, seeds) : Promise.resolve(new Map<string, number>());
    const [{ scores: ear, unheard }, text] = await Promise.all([listenP, textP]);
    const late = top.filter((t) => !ear.has(t.id) && !text.has(t.id) && unheard.has(t.id));
    const text2 = late.length ? await scoreCandidates(userId, vibe, late, seeds) : new Map<string, number>();
    scores = new Map([...text, ...text2, ...ear]);
    pool = top.filter((t) => {
      const sc = scores.get(t.id) ?? 0;
      const strong = seeds.some((x) => !t.feeling || !x.feeling || strongFeelPair(t, x));
      const neighbor = seeds.some((x) => (feelingScore(t, x) ?? 0) >= 0.5);
      return earAdmits(sc, strong, neighbor);
    });
    approved = pool.length;
  } else {
    scores = await scoreCandidates(userId, vibe, candidates, seeds, (d, t) => onStep("Finding songs that feel the same", d, t));
    approved = candidates.filter((c) => (scores.get(c.id) ?? 0) >= MIN_SCORE).length;
    lap("select");
  }
  lap("listen");

  onStep("Putting them in order");
  const sel = selectVibeTracks(pool, scores, seeds, capArtist);
  const tracks = sel.tracks;
  lap("order");
  // The name comes with the recipe (vibe-spec); no separate naming call.
  lap("name");
  return finish({ spec, lang, tracks, candidates: candidates.length, approved, eights: sel.eights, sevens: sel.sevens });
}
