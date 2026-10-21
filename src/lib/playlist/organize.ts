// The playlist engine.
// 1. Language is a hard rule: songs sung in different languages never share a playlist
//    (exceptions: instrumentals fit anywhere they match; electronic dance styles mix
//    languages as long as the style is the same or a neighbor).
// 2. Inside each language, songs are grouped by a compatibility score that mixes
//    genre family, energy, mood, valence, tempo, era and explicitness.
// 3. A song that doesn't fit anywhere well is NOT forced in: it goes to "unsorted",
//    because one wrong song is exactly what makes people skip.
// 4. Each playlist is then sequenced: smooth transitions, an energy arc
//    (warm up → peak → cool down) and no artist twice in a row.

import { type Mood, type TrackProfile } from "./features";
import { MOMENT_NAMES, MOMENT_DESC, MOMENT_CURVE } from "./moments";

export interface PlaylistDraft {
  key: string;
  name: string;
  description: string;
  lang: string;
  moment?: string | null; // the life moment this playlist soundtracks
  cohesion: number; // 0–1, average compatibility inside the playlist
  tracks: TrackProfile[];
}

export interface OrganizeOptions {
  minSize?: number;
  maxSize?: number;
  threshold?: number; // minimum average compatibility to join a playlist
}

export interface OrganizeResult {
  playlists: PlaylistDraft[];
  unsorted: TrackProfile[];
}

// ---------- Compatibility between two songs ----------

export const MOOD_NEIGHBORS: Record<Mood, Mood[]> = {
  chill: ["dreamy", "romantic", "melancholic"],
  melancholic: ["dreamy", "chill", "romantic"],
  romantic: ["chill", "melancholic", "dreamy"],
  upbeat: ["party", "empowering"],
  party: ["upbeat", "intense", "empowering"],
  intense: ["party", "empowering"],
  dreamy: ["chill", "melancholic"],
  empowering: ["upbeat", "intense", "party"],
};

// Styles that can share a playlist (curator judgement). Symmetric.
const STYLE_LINKS: [string, string[]][] = [
  ["melodic-house", ["afro-house", "deep-house", "indie-dance"]],
  ["afro-house", ["deep-house", "indie-dance"]],
  ["deep-house", ["indie-dance", "tech-house", "nu-disco"]],
  ["tech-house", ["techno"]],
  ["indie-dance", ["nu-disco", "synth-pop"]],
  ["nu-disco", ["classic-disco", "funk"]],
  ["classic-disco", ["funk"]],
  ["techno", ["trance"]],
  ["trance", ["edm-festival"]],
  ["edm-festival", ["drum-and-bass"]],
  ["ambient-electronic", ["lo-fi", "soundtrack"]],
  ["classic-soul", ["funk", "neo-soul", "blues"]],
  ["funk", ["neo-soul"]],
  ["neo-soul", ["alt-rnb", "modern-rnb", "jazz"]],
  ["alt-rnb", ["modern-rnb", "bedroom-pop"]],
  ["trap", ["pop-rap", "latin-trap"]],
  ["boom-bap", ["conscious-rap"]],
  ["conscious-rap", ["pop-rap"]],
  ["mainstream-pop", ["pop-rap", "synth-pop", "latin-pop", "k-pop"]],
  ["indie-pop", ["bedroom-pop", "synth-pop", "indie-rock"]],
  ["bedroom-pop", ["synth-pop", "lo-fi"]],
  ["indie-rock", ["alt-rock"]],
  ["alt-rock", ["classic-rock", "punk"]],
  ["classic-rock", ["blues"]],
  ["punk", ["metal"]],
  ["folk", ["country"]],
  ["jazz", ["blues"]],
  ["reggaeton", ["latin-trap"]],
  ["corridos", ["banda-norteno"]],
  ["salsa", ["bachata", "cumbia"]],
  ["bachata", ["cumbia"]],
  ["latin-pop", ["rock-en-espanol"]],
  ["k-pop", ["j-pop"]],
  ["classical", ["soundtrack"]],
];
const STYLE_NEIGHBORS = new Map<string, Set<string>>();
for (const [a, list] of STYLE_LINKS) for (const b of list) {
  if (!STYLE_NEIGHBORS.has(a)) STYLE_NEIGHBORS.set(a, new Set());
  if (!STYLE_NEIGHBORS.has(b)) STYLE_NEIGHBORS.set(b, new Set());
  STYLE_NEIGHBORS.get(a)!.add(b);
  STYLE_NEIGHBORS.get(b)!.add(a);
}

/** Electronic dance styles: here the sound matters more than the sung language. */
export const DANCE_STYLES = new Set(["melodic-house", "afro-house", "deep-house", "tech-house", "indie-dance", "nu-disco", "techno", "trance", "drum-and-bass", "edm-festival"]);
export const isDance = (t: TrackProfile) => !!t.style && DANCE_STYLES.has(t.style);
export const sameOrNeighborStyle = (a: string | null | undefined, b: string | null | undefined) =>
  !!a && !!b && (a === b || !!STYLE_NEIGHBORS.get(a)?.has(b));

export function styleMatch(a: TrackProfile, b: TrackProfile): number | null {
  if (!a.style || !b.style) return null;
  if (a.style === b.style) return 1;
  return STYLE_NEIGHBORS.get(a.style)?.has(b.style) ? 0.6 : 0;
}

/** A song needs a style or a genre family before it can join any playlist. */
export const isPlaceable = (t: TrackProfile) => !!t.style || t.families.length > 0;

function jaccard(a: string[], b: string[]): number {
  if (!a.length && !b.length) return 0.5; // nothing known → neutral
  const setB = new Set(b);
  const inter = a.filter((x) => setB.has(x)).length;
  const union = new Set([...a, ...b]).size;
  return union ? inter / union : 0;
}

function closeness(a: number | null, b: number | null, tolerance: number): number | null {
  if (a === null || b === null) return null;
  return Math.max(0, 1 - Math.abs(a - b) / tolerance);
}

function tempoCloseness(a: number | null, b: number | null): number | null {
  if (a === null || b === null) return null;
  // 70 BPM and 140 BPM feel compatible (half/double time).
  const diff = Math.min(Math.abs(a - b), Math.abs(2 * a - b), Math.abs(a - 2 * b));
  return Math.max(0, 1 - diff / (0.2 * Math.max(a, b)));
}

function languagesCompatible(a: TrackProfile, b: TrackProfile): boolean {
  if (a.lang === "instrumental" || b.lang === "instrumental") return true;
  // Dance styles: language is not a hard rule while the style is the same or a neighbor.
  if (isDance(a) && isDance(b) && sameOrNeighborStyle(a.style, b.style)) return true;
  if (a.lang === "unknown" || b.lang === "unknown") return true; // handled with stricter rules later
  return a.lang === b.lang;
}

export const SCENES = ["keinemusik-afro-organic", "afterlife-melodic-techno", "anjunadeep-emotional", "innervisions-deep", "diynamic-melodic", "organic-downtempo", "afro-house-south-african", "tech-house-club", "minimal-deep-tech", "jazzy-soulful-house", "nu-disco-french-touch", "indie-dance-vocal", "progressive-trance", "big-room-festival"];
const SCENE_PAIRS: [string, string][] = [
  ["keinemusik-afro-organic", "afro-house-south-african"], ["afro-house-south-african", "organic-downtempo"],
  ["keinemusik-afro-organic", "organic-downtempo"],
  ["afterlife-melodic-techno", "diynamic-melodic"],
  ["anjunadeep-emotional", "diynamic-melodic"], ["diynamic-melodic", "indie-dance-vocal"], ["anjunadeep-emotional", "indie-dance-vocal"],
  ["innervisions-deep", "minimal-deep-tech"],
  ["jazzy-soulful-house", "nu-disco-french-touch"],
];
export const SCENE_NEIGHBORS = new Map<string, Set<string>>();
for (const [x, y] of SCENE_PAIRS) {
  if (!SCENE_NEIGHBORS.has(x)) SCENE_NEIGHBORS.set(x, new Set());
  if (!SCENE_NEIGHBORS.has(y)) SCENE_NEIGHBORS.set(y, new Set());
  SCENE_NEIGHBORS.get(x)!.add(y); SCENE_NEIGHBORS.get(y)!.add(x);
}
/** Same scene 1, neighbor 0.5, other 0; null when either is unknown. */
export function sceneMatch(a: TrackProfile, b: TrackProfile): number | null {
  if (!a.scene || !b.scene) return null;
  if (a.scene === b.scene) return 1;
  return SCENE_NEIGHBORS.get(a.scene)?.has(b.scene) ? 0.5 : 0;
}

export const FEELINGS = ["inspirational", "euphoric", "nostalgic", "melancholic", "introspective", "peaceful", "sensual", "groovy-carefree", "hypnotic", "dark-tense"];
export const ARCS = ["steady-groove", "slow-build-climax", "peaks-and-drops", "floating-ambient"];
/** Feeling neighbor groups: every feeling in a group is a neighbor of the others. inspirational and euphoric are NOT neighbors. */
const FEELING_GROUPS: string[][] = [
  ["inspirational", "introspective", "peaceful", "nostalgic"],
  ["euphoric", "groovy-carefree"],
  ["melancholic", "nostalgic", "introspective"],
  ["sensual", "groovy-carefree"],
  ["hypnotic", "dark-tense"],
];
export const feelingNeighbors = (a: string, b: string) => a !== b && FEELING_GROUPS.some((g) => g.includes(a) && g.includes(b));

/** Main + secondary feeling: same main = 1; one's main is the other's secondary = 0.75; any neighbors = 0.5; nothing shared = 0. */
export function feelingScore(a: TrackProfile, b: TrackProfile): number | null {
  if (!a.feeling || !b.feeling) return null;
  if (a.feeling === b.feeling) return 1;
  if ((a.feeling2 && a.feeling2 === b.feeling) || (b.feeling2 && b.feeling2 === a.feeling)) return 0.75;
  const fa = [a.feeling, a.feeling2].filter(Boolean) as string[];
  const fb = [b.feeling, b.feeling2].filter(Boolean) as string[];
  if (fa.some((x) => fb.some((y) => x === y || feelingNeighbors(x, y)))) return 0.5;
  return 0;
}

/** Listener feeling 0–1: 50% feeling, 30% melodic focus (tol 0.3), 20% same arc. Null if unknown. */
export function feelMatch(a: TrackProfile, b: TrackProfile): number | null {
  const parts: [number | null, number][] = [
    [feelingScore(a, b), 0.5],
    [closeness(a.melodicFocus, b.melodicFocus, 0.3), 0.3],
    [a.arc && b.arc ? (a.arc === b.arc ? 1 : 0) : null, 0.2],
  ];
  let sum = 0, w = 0;
  for (const [v, k] of parts) if (v !== null) { sum += v * k; w += k; }
  return w ? sum / w : null;
}

/** The listener would stop feeling the same: melodic focus gap > 0.35 or no feeling in common (score 0). */
export function feelClash(a: TrackProfile, b: TrackProfile): boolean {
  if (a.melodicFocus !== null && b.melodicFocus !== null && Math.abs(a.melodicFocus - b.melodicFocus) > 0.35) return true;
  return feelingScore(a, b) === 0;
}

/** Sound palette match 0–1 (null if unknown): 50% instruments, 50% texture/warmth/scale. */
export function soundMatch(a: TrackProfile, b: TrackProfile): number | null {
  const inst = a.instruments.length && b.instruments.length ? jaccard(a.instruments, b.instruments) : null;
  const dims = [closeness(a.texture, b.texture, 0.35), closeness(a.warmth, b.warmth, 0.35), closeness(a.scale, b.scale, 0.35)]
    .filter((x): x is number => x !== null);
  const feel = dims.length ? dims.reduce((x, y) => x + y, 0) / dims.length : null;
  if (inst === null && feel === null) return null;
  if (inst === null) return feel;
  if (feel === null) return inst;
  return inst * 0.5 + feel * 0.5;
}

/** Hard sound clash: a texture/warmth/scale gap over 0.45 or a different groove. */
export function soundClash(a: TrackProfile, b: TrackProfile): boolean {
  const gap = (x: number | null, y: number | null) => x !== null && y !== null && Math.abs(x - y) > 0.45;
  return gap(a.texture, b.texture) || gap(a.warmth, b.warmth) || gap(a.scale, b.scale) ||
    (!!a.groove && !!b.groove && a.groove !== b.groove);
}

/** Hard rule: percussive drive differs more than 0.3. */
export const drumClash = (a: TrackProfile, b: TrackProfile) =>
  a.percussiveDrive != null && b.percussiveDrive != null && Math.abs(a.percussiveDrive - b.percussiveDrive) > 0.3;

/** Same (or neighbor) feeling, melodic focus within 0.2 and same arc: they feel the same. */
export function feelAligned(a: TrackProfile, b: TrackProfile): boolean {
  if (!a.feeling || !b.feeling || !a.arc || !b.arc || a.melodicFocus === null || b.melodicFocus === null) return false;
  return (feelingScore(a, b) ?? 0) >= 0.5 &&
    Math.abs(a.melodicFocus - b.melodicFocus) < 0.2 && a.arc === b.arc;
}

const COLD_SCENES = new Set(["afterlife-melodic-techno"]);
const isCold = (t: TrackProfile) => (!!t.scene && COLD_SCENES.has(t.scene)) || t.feeling === "dark-tense";
/** Never mix a warm song with a cold/dark one when warmth differs more than 0.4. */
export function warmColdClash(a: TrackProfile, b: TrackProfile): boolean {
  if (a.warmth === null || b.warmth === null || Math.abs(a.warmth - b.warmth) <= 0.4) return false;
  return isCold(a) !== isCold(b);
}

/** Melodic seed path: both melody-driven (≥0.7), feel the same and energy within 0.25. */
export function melodicKin(a: TrackProfile, b: TrackProfile): boolean {
  return feelAligned(a, b) && (a.melodicFocus ?? 0) >= 0.7 && (b.melodicFocus ?? 0) >= 0.7 &&
    a.energy !== null && b.energy !== null && Math.abs(a.energy - b.energy) < 0.25;
}

/** How the production SOUNDS (heard), oldest → newest. Non-adjacent eras clash hard. */
export const PRODUCTION_ERAS = ["50s-60s-analog", "70s-warm-analog", "80s-glossy", "90s", "2000s", "modern"];
const eraIndex = (t: TrackProfile) => t.productionEra ? PRODUCTION_ERAS.indexOf(t.productionEra) : -1;
/** Production eras known and more than one step apart (60s analog vs. 80s glossy, 70s vs. 2000s…). */
export const eraClash = (a: TrackProfile, b: TrackProfile) => {
  const x = eraIndex(a), y = eraIndex(b);
  return x >= 0 && y >= 0 && Math.abs(x - y) >= 2;
};

export function compatibility(a: TrackProfile, b: TrackProfile): number {
  if (!languagesCompatible(a, b)) return 0;
  if (warmColdClash(a, b)) return 0;

  const aligned = feelAligned(a, b);
  let style = styleMatch(a, b);
  if (style === 0 && melodicKin(a, b)) style = 0.5; // feeling outranks style for melodic songs
  let scene = sceneMatch(a, b);
  if (scene === 0 && aligned) scene = 0.5; // feeling outranks scene: count as neighbor
  // life-moment affinity — the human "when" of the song
  const momentMatch = (() => {
    if (!a.moments?.length || !b.moments?.length) return null;
    let best = 0;
    for (const ma of a.moments) for (const mb of b.moments) {
      if (ma.m === mb.m) best = Math.max(best, Math.min(ma.s, mb.s));
    }
    return best;
  })();
  const parts: [number | null, number][] = [
    [style, 0.35],
    [soundMatch(a, b), 0.35],
    [scene, 0.3],
    [feelMatch(a, b), 0.35],
    [momentMatch, 0.3],
    [jaccard(a.families, b.families) * 0.75 + jaccard(a.genres, b.genres) * 0.25, 0.32],
    [closeness(a.energy, b.energy, 0.45), 0.12],
    [a.mood && b.mood ? (a.mood === b.mood ? 1 : MOOD_NEIGHBORS[a.mood].includes(b.mood) ? 0.6 : 0) : null, 0.08],
    [closeness(a.valence, b.valence, 0.5), 0.1],
    [tempoCloseness(a.tempo, b.tempo), 0.08],
    [closeness(a.danceability, b.danceability, 0.5), 0.05],
    [a.year && b.year ? Math.max(0, 1 - Math.abs(a.year - b.year) / 15) : null, 0.18],
    [a.vocalStyle && b.vocalStyle ? (a.vocalStyle === b.vocalStyle ? 1 : 0.4) : null, 0.06],
    [a.lyricTheme && b.lyricTheme ? (a.lyricTheme === b.lyricTheme ? 1 : 0.5) : null, 0.05],
    [a.explicit === b.explicit ? 1 : 0.6, 0.03],
  ];

  let sum = 0;
  let weight = 0;
  for (const [value, w] of parts) {
    if (value === null) continue;
    sum += value * w;
    weight += w;
  }
  let score = weight ? sum / weight : 0;

  // A strong clash in energy is a skip, no matter how similar the genre is.
  if (a.energy !== null && b.energy !== null && Math.abs(a.energy - b.energy) > 0.55) score *= 0.5;
  if (a.year && b.year && Math.abs(a.year - b.year) > 25) score *= 0.6;
  if (style === 0) score *= 0.3; // different sound worlds
  if (eraClash(a, b)) score *= 0.4; // 60s analog production vs. 80s glossy, etc. (heard)
  if (feelClash(a, b)) score *= 0.3; // listener would feel something else
  if (scene === 0) score *= 0.4; // different, non-neighbor scenes
  if (soundClash(a, b)) score *= 0.5; // different instrument palette / groove
  if (drumClash(a, b)) score *= 0.3; // drum-driven vs. barely any drums (heard)
  if (a.artistIds.some((id) => b.artistIds.includes(id))) score = Math.min(1, score + 0.08);
  return score;
}

// ---------- Grouping ----------

function bucketOf(t: TrackProfile): string {
  if (isDance(t)) return "dance";
  return t.lang === "instrumental" || t.lang === "unknown" ? t.lang : `lang:${t.lang}`;
}

function clusterBucket(tracks: TrackProfile[], minSize: number, maxSize: number, threshold: number) {
  const n = tracks.length;
  const sim = new Float32Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const s = compatibility(tracks[i], tracks[j]);
      sim[i * n + j] = s;
      sim[j * n + i] = s;
    }
  }

  const free = new Set(tracks.map((_, i) => i));
  const failedSeeds = new Set<number>();
  const groups: number[][] = [];

  while (free.size >= minSize) {
    // Seed = the free song with the most good neighbors (the "center" of a vibe).
    let seed = -1;
    let bestNeighbors = -1;
    for (const i of free) {
      if (failedSeeds.has(i)) continue;
      let count = 0;
      for (const j of free) if (i !== j && sim[i * n + j] >= threshold) count++;
      if (count > bestNeighbors) {
        bestNeighbors = count;
        seed = i;
      }
    }
    if (seed === -1 || bestNeighbors < minSize - 1) break;

    const group = [seed];
    const sumSim = new Map<number, number>();
    const minSim = new Map<number, number>();
    for (const j of free) {
      if (j === seed) continue;
      sumSim.set(j, sim[seed * n + j]);
      minSim.set(j, sim[seed * n + j]);
    }

    while (group.length < maxSize) {
      let best = -1;
      let bestAvg = -1;
      for (const [j, s] of sumSim) {
        const avg = s / group.length;
        // Must fit the group on average AND not clash hard with any member.
        if (avg >= threshold && minSim.get(j)! >= threshold - 0.22 && avg > bestAvg) {
          bestAvg = avg;
          best = j;
        }
      }
      if (best === -1) break;
      group.push(best);
      sumSim.delete(best);
      minSim.delete(best);
      for (const [j, s] of sumSim) {
        const v = sim[best * n + j];
        sumSim.set(j, s + v);
        minSim.set(j, Math.min(minSim.get(j)!, v));
      }
    }

    if (group.length >= minSize) {
      groups.push(group);
      group.forEach((i) => free.delete(i));
    } else {
      failedSeeds.add(seed);
    }
  }

  return { groups: groups.map((g) => g.map((i) => tracks[i])), leftovers: [...free].map((i) => tracks[i]) };
}

export function averageFit(track: TrackProfile, group: TrackProfile[]): number {
  if (!group.length) return 0;
  let s = 0;
  for (const t of group) s += compatibility(track, t);
  return s / group.length;
}

function cohesionOf(tracks: TrackProfile[]): number {
  if (tracks.length < 2) return 1;
  let sum = 0;
  let pairs = 0;
  const step = Math.max(1, Math.floor(tracks.length / 40)); // sample big playlists
  for (let i = 0; i < tracks.length; i += step) {
    for (let j = i + 1; j < tracks.length; j += step) {
      sum += compatibility(tracks[i], tracks[j]);
      pairs++;
    }
  }
  return pairs ? sum / pairs : 1;
}

// ---------- Sequencing (the "no skip" part) ----------

function percentile(values: number[], p: number) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
}

/** Energy arc over the playlist: "peak" warms up → peaks at 65% → cools a little;
 *  "rise" builds all the way up; "fall" starts strong and winds down. */
function energyTarget(position: number, lo: number, hi: number, curve: "rise" | "fall" | "peak" = "peak") {
  const c = curve === "rise" ? position
    : curve === "fall" ? 1 - position * 0.7
    : position <= 0.65 ? position / 0.65 : 1 - ((position - 0.65) / 0.35) * 0.45;
  return lo + (hi - lo) * c;
}

export function sequence(tracks: TrackProfile[], startId?: string, curve?: "rise" | "fall" | "peak"): TrackProfile[] {
  if (tracks.length <= 2) {
    const first = tracks.find((t) => t.id === startId);
    return first ? [first, ...tracks.filter((t) => t !== first)] : tracks;
  }

  const energies = tracks.map((t) => t.energy).filter((e): e is number => e !== null);
  const hasEnergy = energies.length >= tracks.length * 0.6;
  const lo = hasEnergy ? percentile(energies, 0.2) : 0;
  const hi = hasEnergy ? percentile(energies, 0.9) : 1;

  const remaining = [...tracks];
  const ordered: TrackProfile[] = [];
  const startIndex = startId ? remaining.findIndex((t) => t.id === startId) : -1;
  if (startIndex >= 0) ordered.push(remaining.splice(startIndex, 1)[0]);

  const stepCost = (candidate: TrackProfile) => {
    const position = ordered.length / (tracks.length - 1);
    const prev = ordered.at(-1);
    const prev2 = ordered.at(-2);
    let cost = prev ? 1 - compatibility(prev, candidate) : 0;
    // Gradual sound changes: penalize jumps in palette, texture, warmth and scale.
    if (prev) {
      const sm = soundMatch(prev, candidate);
      if (sm !== null) cost += 0.5 * (1 - sm);
    }

    if (hasEnergy && candidate.energy !== null) {
      cost += 0.8 * Math.abs(candidate.energy - energyTarget(position, lo, hi, curve));
    }
    if (prev && prev.artistIds.some((id) => candidate.artistIds.includes(id))) cost += 1;
    if (prev2 && prev2.artistIds.some((id) => candidate.artistIds.includes(id))) cost += 0.35;
    if (prev && prev.albumId === candidate.albumId) cost += 0.2;
    if (!prev) cost -= 0.3 * averageFit(candidate, tracks); // open with a representative song
    return cost;
  };

  // With a seed, positions 2 and 3 go to the strongest feeling matches (same main, or main = seed's secondary).
  const seed = startIndex >= 0 ? ordered[0] : undefined;
  const strongFeel = (t: TrackProfile) =>
    !!seed?.feeling && !!t.feeling && (t.feeling === seed.feeling || (!!seed.feeling2 && t.feeling === seed.feeling2));

  while (remaining.length) {
    const restrict = seed && ordered.length < 3 && remaining.some(strongFeel);
    let bestIndex = -1;
    let bestCost = Infinity;
    remaining.forEach((t, i) => {
      if (restrict && !strongFeel(t)) return;
      const c = stepCost(t);
      if (c < bestCost) {
        bestCost = c;
        bestIndex = i;
      }
    });
    if (bestIndex < 0) bestIndex = remaining.findIndex((t) => !restrict || strongFeel(t));
    ordered.push(remaining.splice(bestIndex, 1)[0]);
  }
  return ordered;
}

// ---------- Naming ----------
// Simple, elegant names: 2–3 words that evoke a feeling or a moment — never the genre,
// never a year, never "Vibes"/"Flow"/"Grooves"/"Mix" or middle dots.

const BANNED_NAME = /\b(vibes?|flow|grooves?|mix|mixtape|luminous|timeless|reflections?|moods?|echoes|layers?|pulse|bliss)\b|[·•]|\b(19|20)\d0s?\b|\b\d{2}s\b/i;
const GENRE_WORDS = /\b(house|techno|trance|disco|rock|pop|rap|trap|hip[\s-]?hop|rnb|r&b|soul|jazz|blues|metal|punk|folk|country|reggaeton|salsa|bachata|cumbia|bossa|samba|ambient|lo[\s-]?fi|classical|soundtrack|indie|dance|electronic|afro|melodic|deep|tech|minimal|progressive|boom[\s-]?bap|corrido|banda|norteno|grupero|k[\s-]?pop|j[\s-]?pop|funk|gospel|blues|swing|dubstep|garage|drum|bass|edm|ballads?|anthems?|classics?|mainstream|conscious|dreamscape|french touch|keinemusik|afterlife|anjunadeep|innervisions|diynamic)\b/i;
/** A curator/AI name passes only if it's clean: no banned words, genres, scenes or years. */
export const isCleanName = (name: string) => {
  const n = name.trim();
  return n.length >= 3 && n.length <= 40 && !BANNED_NAME.test(n) && !GENRE_WORDS.test(n);
};

function mostCommon<T>(items: T[]): T | null {
  const counts = new Map<T, number>();
  for (const item of items) counts.set(item, (counts.get(item) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

/** Evocative name pools by dominant listener feeling. */
export const FEELING_NAMES: Record<string, string[]> = {
  inspirational: ["Golden Hour", "Open Roads", "Morning Light", "New Horizons", "Higher Ground"],
  peaceful: ["Slow Sundays", "Quiet Hours", "Soft Focus", "Still Water", "Gentle Tide"],
  nostalgic: ["Sepia Tones", "Old Photographs", "Yesterday's Radio", "Faded Postcards"],
  melancholic: ["Midnight Blue", "Rainy Windows", "Blue Hour", "Empty Rooms"],
  introspective: ["Late Thoughts", "Low Light", "Inner Voice", "Quiet Mind"],
  euphoric: ["Full Bloom", "Bright Lights", "Sky High", "Electric Heart"],
  "groovy-carefree": ["Sun Drenched", "Easy Days", "Barefoot", "Warm Breeze"],
  sensual: ["Velvet Nights", "After Dark", "Candlelight", "Slow Dance"],
  hypnotic: ["Night Drive", "Deep Current", "Silver Moon", "Endless Corridor"],
  "dark-tense": ["Black Coffee", "Shadow Play", "Storm Warning", "Cold Fire"],
};
const MOOD_NAMES: Record<Mood, string[]> = {
  chill: ["Lazy Afternoon", "Soft Landing", "Drift Away"],
  melancholic: ["Blue Hour", "Rainy Windows", "Empty Rooms"],
  romantic: ["Sunday Soul", "Slow Dance", "Sweet Nothings"],
  upbeat: ["Good Company", "Sunshine State", "Bright Side"],
  party: ["Late Checkout", "House Lights", "Last Dance"],
  intense: ["Full Throttle", "Red Line", "High Voltage"],
  dreamy: ["Daydream", "Cloud Nine", "Weightless"],
  empowering: ["Main Character", "Unstoppable", "Own Lane"],
};
const FALLBACK_NAMES = ["Quiet Corners", "Hidden Gems", "Second Wind", "Far Places", "Home Bound"];

/** The dominant life moment of a group of songs (highest total score). */
export function dominantMoment(tracks: TrackProfile[]): string | null {
  const tally = new Map<string, number>();
  for (const t of tracks) for (const m of t.moments ?? []) {
    tally.set(m.m, (tally.get(m.m) ?? 0) + m.s);
  }
  let best: string | null = null;
  let bestScore = 0;
  for (const [m, s] of tally) if (s > bestScore) { best = m; bestScore = s; }
  return bestScore > 0 ? best : null;
}

const NAME_ARTICLES = new Set(["a", "an", "the", "of", "and", "at", "in", "on", "de", "la", "el", "los", "las", "con", "en", "y", "un", "una"]);
const nameWords = (name: string) => name.toLowerCase().split(/[^a-záéíóúñü]+/i).filter((w) => w && !NAME_ARTICLES.has(w));

function nameFor(tracks: TrackProfile[], _lang: string, used: Set<string>, usedWords: Set<string>): string {
  const moment = dominantMoment(tracks);
  const feeling = mostCommon(tracks.map((t) => t.feeling).filter((f): f is string => !!f));
  const mood = mostCommon(tracks.map((t) => t.mood).filter((m): m is Mood => m !== null));
  const pool = [
    ...(moment ? MOMENT_NAMES[moment] ?? [] : []),
    ...(feeling ? FEELING_NAMES[feeling] ?? [] : []),
    ...(mood ? MOOD_NAMES[mood] ?? [] : []),
    ...FALLBACK_NAMES,
  ].filter(isCleanName);
  // Vary the starting point by contents so similar playlists get different names.
  const start = tracks.reduce((a, t) => a + t.id.charCodeAt(0), 0) % pool.length;
  const claim = (name: string) => {
    used.add(name);
    nameWords(name).forEach((w) => usedWords.add(w));
    return name;
  };
  // First pass: a fresh name whose words haven't been used in another playlist.
  for (let i = 0; i < pool.length; i++) {
    const name = pool[(start + i) % pool.length];
    if (!used.has(name) && !nameWords(name).some((w) => usedWords.has(w))) return claim(name);
  }
  // Second pass: any unused name.
  for (let i = 0; i < pool.length; i++) {
    const name = pool[(start + i) % pool.length];
    if (!used.has(name)) return claim(name);
  }
  let unique = pool[start];
  for (let i = 2; used.has(unique); i++) unique = `${pool[start]} ${i}`;
  return claim(unique);
}

// ---------- Main entry ----------

export function organizeLibrary(all: TrackProfile[], options: OrganizeOptions = {}): OrganizeResult {
  const { minSize = 8, maxSize = 40, threshold = 0.55 } = options;

  const buckets = new Map<string, TrackProfile[]>();
  const notReady: TrackProfile[] = [];
  for (const t of all) {
    if (!isPlaceable(t)) { notReady.push(t); continue; }
    const key = bucketOf(t);
    buckets.set(key, [...(buckets.get(key) ?? []), t]);
  }

  const groups: { lang: string; tracks: TrackProfile[] }[] = [];
  let leftovers: TrackProfile[] = [];

  for (const [key, tracks] of buckets) {
    if (key === "unknown") {
      leftovers.push(...tracks);
      continue;
    }
    // Moments first: split the language bucket by each song's main life moment,
    // then cluster by sound inside each moment pool.
    const pools = new Map<string, TrackProfile[]>();
    for (const t of tracks) {
      const m = t.moments?.[0];
      const mk = m && m.s >= 0.5 ? m.m : "_";
      pools.set(mk, [...(pools.get(mk) ?? []), t]);
    }
    const lang = key.replace("lang:", "");
    for (const pool of pools.values()) {
      if (pool.length < minSize) { leftovers.push(...pool); continue; }
      const { groups: g, leftovers: l } = clusterBucket(pool, minSize, maxSize, threshold);
      g.forEach((tracksInGroup) => groups.push({ lang, tracks: tracksInGroup }));
      leftovers.push(...l);
    }
  }

  // Second chance: place leftovers in the playlist they fit best, only if they truly fit.
  const stillLeft: TrackProfile[] = [];
  for (const t of leftovers) {
    let best: (typeof groups)[number] | null = null;
    let bestFit = 0;
    for (const g of groups) {
      if (g.tracks.length >= maxSize) continue;
      const langOk =
        g.lang === t.lang ||
        (g.lang === "dance" && isDance(t)) ||
        t.lang === "instrumental" || // instrumentals can join any vibe they match
        (t.lang === "unknown" && g.lang !== "instrumental");
      if (!langOk) continue;
      // Unknown language songs need a stronger match and a shared genre family.
      if (t.lang === "unknown" && !g.tracks.some((x) => x.families.some((f) => t.families.includes(f)))) continue;
      const fit = averageFit(t, g.tracks);
      const required = t.lang === "unknown" ? threshold + 0.05 : threshold - 0.03;
      if (fit >= required && fit > bestFit) {
        bestFit = fit;
        best = g;
      }
    }
    if (best) best.tracks.push(t);
    else stillLeft.push(t);
  }
  leftovers = stillLeft;

  const used = new Set<string>();
  const usedWords = new Set<string>();
  const playlists: PlaylistDraft[] = groups
    .sort((a, b) => b.tracks.length - a.tracks.length)
    .map((g, i) => {
      const moment = dominantMoment(g.tracks);
      const curve = moment ? MOMENT_CURVE[moment] : undefined;
      const ordered = sequence(g.tracks, undefined, curve);
      const name = nameFor(ordered, g.lang, used, usedWords);
      return {
        key: `${g.lang}-${i}`,
        name,
        description: (moment && MOMENT_DESC[moment]) ||
          `Organized by Tempo from your Liked Songs · ${ordered.length} songs`,
        lang: g.lang,
        moment,
        cohesion: cohesionOf(ordered),
        tracks: ordered,
      };
    });

  return { playlists, unsorted: [...leftovers, ...notReady] };
}
// ---------- Final AI curator (skip test) ----------

export interface CuratorVerdict { remove: { id: string; reason: string }[]; name: string }
export type Curator = (tracks: TrackProfile[]) => Promise<CuratorVerdict | null>;

/**
 * Runs the curator on every playlist: removed songs move to another playlist where they
 * fit (≥ 0.6) or to unsorted; playlists under minSize are dissolved; the rest is re-sequenced.
 */
export async function curateLibrary(
  result: OrganizeResult,
  curator: Curator,
  onProgress?: (done: number, total: number) => void,
  minSize = 8,
  maxSize = 40,
): Promise<OrganizeResult & { reasons: Record<string, string> }> {
  const reasons: Record<string, string> = {};
  const kept: PlaylistDraft[] = [];
  const removed: TrackProfile[] = [];
  let done = 0;
  // Up to 5 curator calls at once; results are applied in the original playlist order.
  const verdicts: (Awaited<ReturnType<Curator>> | null)[] = new Array(result.playlists.length).fill(null);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(5, result.playlists.length) }, async () => {
    while (next < result.playlists.length) {
      const i = next++;
      verdicts[i] = await curator(result.playlists[i].tracks).catch(() => null);
      onProgress?.(++done, result.playlists.length);
    }
  }));
  result.playlists.forEach((p, i) => {
    const verdict = verdicts[i];
    const drop = new Set(verdict?.remove.map((r) => r.id) ?? []);
    verdict?.remove.forEach((r) => (reasons[r.id] = r.reason));
    const tracks = p.tracks.filter((t) => !drop.has(t.id));
    removed.push(...p.tracks.filter((t) => drop.has(t.id)));
    const name = verdict?.name || p.name;
    kept.push({ ...p, name, tracks });
  });

  const unsorted = [...result.unsorted];
  for (const t of removed) {
    let best: PlaylistDraft | null = null;
    let bestFit = 0.6;
    for (const p of kept) {
      if (p.tracks.length >= maxSize || p.tracks.length < minSize) continue;
      if (!(p.lang === t.lang || t.lang === "instrumental" || (p.lang === "dance" && isDance(t)))) continue;
      const fit = averageFit(t, p.tracks);
      if (fit >= bestFit) { bestFit = fit; best = p; }
    }
    if (best) best.tracks.push(t);
    else unsorted.push(t);
  }

  const used = new Set<string>();
  const playlists: PlaylistDraft[] = [];
  for (const p of kept) {
    if (p.tracks.length < minSize) { unsorted.push(...p.tracks); continue; }
    const moment = p.moment ?? dominantMoment(p.tracks);
    const curve = moment ? MOMENT_CURVE[moment] : undefined;
    const ordered = sequence(p.tracks, undefined, curve);
    let name = isCleanName(p.name) ? p.name : nameFor(ordered, p.lang, used, new Set());
    for (let i = 2; used.has(name); i++) name = `${p.name} ${i}`;
    used.add(name);
    playlists.push({
      ...p, name, moment, tracks: ordered, cohesion: cohesionOf(ordered),
      description: (moment && MOMENT_DESC[moment]) ||
        `Organized by Tempo from your Liked Songs · ${ordered.length} songs`,
    });
  }
  return { playlists, unsorted, reasons };
}
