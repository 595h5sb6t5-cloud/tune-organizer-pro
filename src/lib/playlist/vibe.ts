// Builds ONE playlist from a vibe: AI recipe → strict local filter → AI review → coherence + sequence.
// Never fills with songs that failed a filter.
import { supabase } from "@/integrations/supabase/client";
import type { Lang, Mood, TrackProfile } from "./features";
import { compatibility, sequence, isDance, sameOrNeighborStyle, MOOD_NEIGHBORS } from "./organize";
import { askCurator } from "./curate";
import { ensureSeedFeeling } from "./ai";

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
const MAX_CANDIDATES = 120;
const MIN_SCORE = 8;
const FILL_SCORE = 7;
const FILL_TARGET = 20;
const MIN_COHESION = 0.55;
const MIN_SEED_COHESION = 0.5;
const MAX_TRACKS = 30;
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
  if (seedStyles.length && !seedStyles.some((st) => sameOrNeighborStyle(st, t.style))) return false;
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
export function filterCandidates(profiles: TrackProfile[], spec: VibeSpec, langChoice: string, seeds: TrackProfile[] = []) {
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

  const seedFit = (t: TrackProfile) => seeds.reduce((a, x) => a + compatibility(t, x), 0) / seeds.length;
  const rank = (list: TrackProfile[]) => seeds.length
    ? list.map((t) => ({ t, c: seedFit(t) })).filter((x) => x.c >= MIN_SEED_COMPAT)
        .sort((a, b) => (b.c + preferenceBonus(b.t, spec)) - (a.c + preferenceBonus(a.t, spec))).map((x) => x.t)
    : list.map((t) => ({ t, d: distance(t, spec) })).sort((a, b) => a.d - b.d).map((x) => x.t);

  // Seeds: mood/era/tempo are preferences only. Without seeds they start as filters.
  const active = new Set<Soft>(seeds.length ? [] : RELAX_ORDER);
  let candidates = rank(inLang.filter((t) => passesSoft(t, spec, active)));
  const relaxed: Soft[] = [];
  // Plan B: too few candidates but enough compatible songs → relax mood, then era, then tempo.
  const enough = seeds.length ? inLang.filter((t) => seedFit(t) >= MIN_SEED_COMPAT).length >= MIN_CANDIDATES : inLang.length >= MIN_CANDIDATES;
  for (const r of RELAX_ORDER) {
    if (candidates.length >= MIN_CANDIDATES || !enough) break;
    if (!active.has(r)) continue;
    active.delete(r); relaxed.push(r);
    candidates = rank(inLang.filter((t) => passesSoft(t, spec, active)));
  }
  return { lang, candidates: candidates.slice(0, MAX_CANDIDATES), relaxed };
}

const vibeKey = (v: string) => v.toLowerCase().replace(/\s+/g, " ").trim();

/** Step 3: AI review with per-(vibe, song) cache. */
const r2 = (x: number | null) => (x === null ? null : Math.round(x * 100) / 100);
const brief = (t: TrackProfile) => ({
  id: t.id, name: t.name, artists: t.artists, year: t.year, genres: t.genres.slice(0, 5),
  style: t.style ?? null, lang: t.lang, energy: r2(t.energy), mood: t.mood,
  instruments: t.instruments, texture: r2(t.texture), warmth: r2(t.warmth), scale: r2(t.scale), groove: t.groove, scene: t.scene, feeling: t.feeling, melodic_focus: r2(t.melodicFocus), arc: t.arc,
});
/** Full seed profile for the AI. */
export const seedProfile = (t: TrackProfile) => ({
  ...brief(t), families: t.families, valence: r2(t.valence), danceability: r2(t.danceability),
  tempo: t.tempo !== null ? Math.round(t.tempo) : null,
});

async function scoreCandidates(userId: string, vibe: string, cands: TrackProfile[], seeds: TrackProfile[], onProgress?: (d: number, t: number) => void) {
  const key = "v5|" + vibeKey(vibe) + (seeds.length ? ` |seed:${seeds.map((x) => `${x.id}~${x.feeling ?? ""}~${x.arc ?? ""}~${x.melodicFocus ?? ""}~${x.scene ?? ""}`).join(",")}` : "");
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
        seeds: seeds.map(seedProfile),
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

const seedFitOf = (t: TrackProfile, seeds: TrackProfile[]) =>
  seeds.reduce((a, x) => a + compatibility(t, x), 0) / seeds.length;

/** Step 4: pick 8+ (and 7s up to 20 when short), check coherence, cap, sequence. */
export function selectVibeTracks(cands: TrackProfile[], scores: Map<string, number>, seeds: TrackProfile[] = []) {
  const room = MAX_TRACKS - seeds.length;
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
    sevens = cands.filter((t) => sc(t) >= FILL_SCORE && sc(t) < MIN_SCORE && coheres(t))
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

export async function buildVibePlaylist(
  userId: string,
  vibe: string,
  profiles: TrackProfile[],
  langChoice: string,
  onStep: (label: string, done?: number, total?: number) => void,
  seeds: TrackProfile[] = [],
): Promise<VibeResult> {
  onStep("Reading your vibe");
  if (seeds.length) {
    const fresh = await ensureSeedFeeling(seeds);
    seeds = fresh;
    profiles = profiles.map((p) => fresh.find((x) => x.id === p.id) ?? p);
  }
  const seedBody = seeds.map((t) => ({
    name: t.name, artists: t.artists, year: t.year, genres: t.genres.slice(0, 6), lang: t.lang,
    energy: t.energy, valence: t.valence, danceability: t.danceability, tempo: t.tempo, mood: t.mood,
  }));
  const { data, error } = await supabase.functions.invoke("vibe-spec", { body: { vibe, seeds: seedBody } });
  if (error || data?.error) throw new Error(data?.error ?? error?.message ?? "Couldn't read the vibe.");
  const spec = normalizeSpec(data as VibeSpec, vibe, seeds.length > 0);

  onStep("Filtering your Liked Songs");
  const removed = await removedForSeeds(userId, seeds);
  const { lang, candidates } = filterCandidates(profiles.filter((t) => !removed.has(t.id)), spec, langChoice, seeds);
  if (!candidates.length) return { spec, lang, tracks: seeds.length ? sequence(seeds, seeds[0].id) : [], candidates: 0, approved: 0 };

  const scores = await scoreCandidates(userId, vibe, candidates, seeds, (d, t) => onStep("Listening to every candidate", d, t));
  const approved = candidates.filter((c) => (scores.get(c.id) ?? 0) >= MIN_SCORE);

  onStep("Ordering the playlist");
  const sel = selectVibeTracks(candidates, scores, seeds);
  const tracks = sel.tracks;
  if (tracks.length > seeds.length) {
    onStep("Naming the playlist");
    const verdict = await askCurator(tracks, { vibe, seeds, nameOnly: true });
    if (verdict?.name) spec.name = verdict.name;
  }
  return { spec, lang, tracks, candidates: candidates.length, approved: approved.length, eights: sel.eights, sevens: sel.sevens };
}
