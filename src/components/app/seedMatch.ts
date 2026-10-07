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

export interface SeedMatch { track: SpotifyTrack; span: string; artistHit: string[] }

export function findSeedMatches(text: string, liked: SpotifyTrack[], limit = 5): SeedMatch[] {
  const t = norm(text);
  if (t.length < 3) return [];
  const out: SeedMatch[] = [];
  for (const track of liked) {
    const span = findTitle(t, cleanTitle(track.name));
    if (!span) continue;
    const artistHit = track.artists.map((a) => norm(a.name)).filter((a) => a.length >= 2 && has(t, a));
    out.push({ track, span, artistHit });
  }
  return out
    .sort((a, b) => b.artistHit.length - a.artistHit.length || b.span.length - a.span.length)
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
