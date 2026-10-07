// The playlist engine.
// 1. Language is a hard rule: songs sung in different languages never share a playlist
//    (instrumentals are the exception: they fit anywhere they match the vibe).
// 2. Inside each language, songs are grouped by a compatibility score that mixes
//    genre family, energy, mood, valence, tempo, era and explicitness.
// 3. A song that doesn't fit anywhere well is NOT forced in: it goes to "unsorted",
//    because one wrong song is exactly what makes people skip.
// 4. Each playlist is then sequenced: smooth transitions, an energy arc
//    (warm up → peak → cool down) and no artist twice in a row.

import { FAMILY_LABEL, type Mood, type TrackProfile } from "./features";

export interface PlaylistDraft {
  key: string;
  name: string;
  description: string;
  lang: string;
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

const MOOD_NEIGHBORS: Record<Mood, Mood[]> = {
  chill: ["dreamy", "romantic", "melancholic"],
  melancholic: ["dreamy", "chill", "romantic"],
  romantic: ["chill", "melancholic", "dreamy"],
  upbeat: ["party", "empowering"],
  party: ["upbeat", "intense", "empowering"],
  intense: ["party", "empowering"],
  dreamy: ["chill", "melancholic"],
  empowering: ["upbeat", "intense", "party"],
};

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
  if (a.lang === "unknown" || b.lang === "unknown") return true; // handled with stricter rules later
  return a.lang === b.lang;
}

export function compatibility(a: TrackProfile, b: TrackProfile): number {
  if (!languagesCompatible(a, b)) return 0;

  const parts: [number | null, number][] = [
    [jaccard(a.families, b.families) * 0.75 + jaccard(a.genres, b.genres) * 0.25, 0.32],
    [closeness(a.energy, b.energy, 0.45), 0.2],
    [a.mood && b.mood ? (a.mood === b.mood ? 1 : MOOD_NEIGHBORS[a.mood].includes(b.mood) ? 0.6 : 0) : null, 0.12],
    [closeness(a.valence, b.valence, 0.5), 0.1],
    [tempoCloseness(a.tempo, b.tempo), 0.08],
    [closeness(a.danceability, b.danceability, 0.5), 0.05],
    [a.year && b.year ? Math.max(0, 1 - Math.abs(a.year - b.year) / 15) : null, 0.18],
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
  if (a.artistIds.some((id) => b.artistIds.includes(id))) score = Math.min(1, score + 0.08);
  return score;
}

// ---------- Grouping ----------

function bucketOf(t: TrackProfile): string {
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

function averageFit(track: TrackProfile, group: TrackProfile[]): number {
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

/** Warm up → peak around 65% → cool down a little at the end. */
function energyTarget(position: number, lo: number, hi: number) {
  const curve = position <= 0.65 ? position / 0.65 : 1 - ((position - 0.65) / 0.35) * 0.45;
  return lo + (hi - lo) * curve;
}

export function sequence(tracks: TrackProfile[]): TrackProfile[] {
  if (tracks.length <= 2) return tracks;

  const energies = tracks.map((t) => t.energy).filter((e): e is number => e !== null);
  const hasEnergy = energies.length >= tracks.length * 0.6;
  const lo = hasEnergy ? percentile(energies, 0.2) : 0;
  const hi = hasEnergy ? percentile(energies, 0.9) : 1;

  const remaining = [...tracks];
  const ordered: TrackProfile[] = [];

  const stepCost = (candidate: TrackProfile) => {
    const position = ordered.length / (tracks.length - 1);
    const prev = ordered.at(-1);
    const prev2 = ordered.at(-2);
    let cost = prev ? 1 - compatibility(prev, candidate) : 0;

    if (hasEnergy && candidate.energy !== null) {
      cost += 0.8 * Math.abs(candidate.energy - energyTarget(position, lo, hi));
    }
    if (prev && prev.artistIds.some((id) => candidate.artistIds.includes(id))) cost += 1;
    if (prev2 && prev2.artistIds.some((id) => candidate.artistIds.includes(id))) cost += 0.35;
    if (prev && prev.albumId === candidate.albumId) cost += 0.2;
    if (!prev) cost -= 0.3 * averageFit(candidate, tracks); // open with a representative song
    return cost;
  };

  while (remaining.length) {
    let bestIndex = 0;
    let bestCost = Infinity;
    remaining.forEach((t, i) => {
      const c = stepCost(t);
      if (c < bestCost) {
        bestCost = c;
        bestIndex = i;
      }
    });
    ordered.push(remaining.splice(bestIndex, 1)[0]);
  }
  return ordered;
}

// ---------- Naming ----------

const MOOD_LABEL: Record<Mood, string> = {
  chill: "Chill",
  melancholic: "Late Night Feelings",
  romantic: "Romantic",
  upbeat: "Good Mood",
  party: "Party",
  intense: "High Energy",
  dreamy: "Dreamy",
  empowering: "Main Character",
};

const LANG_LABEL: Record<string, string> = {
  es: "en español", en: "in English", pt: "em português", fr: "en français",
  it: "in italiano", de: "auf Deutsch", ko: "K", ja: "J", zh: "C",
};

function mostCommon<T>(items: T[]): T | null {
  const counts = new Map<T, number>();
  for (const item of items) counts.set(item, (counts.get(item) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

function nameFor(tracks: TrackProfile[], lang: string, used: Set<string>): string {
  const family = mostCommon(tracks.flatMap((t) => t.families));
  const mood = mostCommon(tracks.map((t) => t.mood).filter((m): m is Mood => m !== null));
  const years = tracks.map((t) => t.year).filter((y): y is number => y !== null);
  const decade = years.length ? Math.floor(percentile(years, 0.5) / 10) * 10 : null;

  const base = family ? FAMILY_LABEL[family] : lang === "instrumental" ? "Instrumental" : "Mix";
  let name = mood ? `${base} · ${MOOD_LABEL[mood]}` : base;
  if ((!family || used.has(name)) && LANG_LABEL[lang]) name = `${name} ${LANG_LABEL[lang]}`;
  const decadeCounts = new Map<number, number>();
  for (const y of years) { const d = Math.floor(y / 10) * 10; decadeCounts.set(d, (decadeCounts.get(d) ?? 0) + 1); }
  const top = [...decadeCounts.entries()].sort((x, y) => y[1] - x[1])[0];
  const strongDecade = top && top[1] / tracks.length >= 0.7 ? top[0] : null;
  if (strongDecade !== null) name = `${name} · ${strongDecade}s`;
  else if (used.has(name) && decade) name = `${name} · ${String(decade).slice(2)}s`;
  let unique = name;
  for (let i = 2; used.has(unique); i++) unique = `${name} ${i}`;
  used.add(unique);
  return unique;
}

// ---------- Main entry ----------

export function organizeLibrary(all: TrackProfile[], options: OrganizeOptions = {}): OrganizeResult {
  const { minSize = 8, maxSize = 60, threshold = 0.55 } = options;

  const buckets = new Map<string, TrackProfile[]>();
  for (const t of all) {
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
    const { groups: g, leftovers: l } = clusterBucket(tracks, minSize, maxSize, threshold);
    const lang = key.replace("lang:", "");
    g.forEach((tracksInGroup) => groups.push({ lang, tracks: tracksInGroup }));
    leftovers.push(...l);
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
  const playlists: PlaylistDraft[] = groups
    .sort((a, b) => b.tracks.length - a.tracks.length)
    .map((g, i) => {
      const ordered = sequence(g.tracks);
      const name = nameFor(ordered, g.lang, used);
      return {
        key: `${g.lang}-${i}`,
        name,
        description: `Organized by Tempo from your Liked Songs · ${ordered.length} songs`,
        lang: g.lang,
        cohesion: cohesionOf(ordered),
        tracks: ordered,
      };
    });

  return { playlists, unsorted: leftovers };
}