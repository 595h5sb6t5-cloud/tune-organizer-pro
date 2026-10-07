// Finds Liked Songs mentioned in the vibe text (title, optionally artist).
import type { SpotifyTrack } from "@/lib/playlist/features";

export const norm = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();

export const cleanTitle = (t: string) =>
  norm(t.replace(/\(.*?\)|\[.*?\]/g, " ").split(" - ")[0]);

function lev(a: string, b: string): number {
  const d = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = d[0]; d[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = d[j];
      d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return d[b.length];
}

const has = (text: string, phrase: string) => !!phrase && ` ${text} `.includes(` ${phrase} `);

/** Returns the matched span of `title` inside `text`, or null. */
function findTitle(text: string, title: string): string | null {
  if (!title) return null;
  if (has(text, title)) return title;
  if (title.replace(/\s/g, "").length <= 5) return null;
  const words = text.split(" ");
  const n = title.split(" ").length;
  const tol = title.length > 10 ? 2 : 1;
  for (let i = 0; i + n <= words.length; i++) {
    const win = words.slice(i, i + n).join(" ");
    if (Math.abs(win.length - title.length) <= tol && lev(win, title) <= tol) return win;
  }
  return null;
}

export interface SeedMatch { track: SpotifyTrack; span: string; artistHit: string[]; score: number }

export function findSeedMatches(text: string, liked: SpotifyTrack[], limit = 5): SeedMatch[] {
  const t = norm(text);
  if (t.length < 3) return [];
  const out: SeedMatch[] = [];
  const words = t.split(" ");
  for (const track of liked) {
    const title = cleanTitle(track.name);
    const span = findTitle(t, title);
    if (!span) continue;
    const artistNames = track.artists.map((a) => norm(a.name)).filter((a) => a.length >= 2);
    const artistHit = artistNames.filter((a) => has(t, a));
    if (title.split(" ").length < 2) {
      // One-word titles only count when the rest of the text is just this song's artist(s).
      const artistWords = new Set(artistNames.join(" ").split(" "));
      const rest = ` ${t} `.replace(` ${span} `, " ").trim().split(" ").filter(Boolean);
      if (rest.some((w) => !artistWords.has(w))) continue;
    }
    const exact = span === title ? 1 : 0;
    out.push({ track, span, artistHit, score: artistHit.length * 10 + span.split(" ").length * 2 + exact + span.length / words.join(" ").length });
  }
  return out
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/** Vibe keywords left once the seed titles/artists are removed. */
export function leftoverKeywords(text: string, seeds: SeedMatch[]): string {
  let t = ` ${norm(text)} `;
  for (const s of seeds) {
    for (const p of [s.span, ...s.artistHit]) t = t.replace(` ${p} `, " ");
  }
  return t.replace(/\s+/g, " ").trim();
}
