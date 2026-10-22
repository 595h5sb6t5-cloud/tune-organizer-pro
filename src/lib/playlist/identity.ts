import type { TrackProfile } from "./features";

const normalize = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
  .replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const version = /\b(remaster(?:ed)?|remix|mix|version|edit|live|acoustic|instrumental|sped up|slowed|extended|radio|original)\b/i;
export function songIdentity(t: TrackProfile): string {
  const title = t.name.replace(/\s*[([]([^\])]+)[)\]]/g, (whole, inner: string) => version.test(inner) ? "" : whole)
    .replace(/\s+-\s+(.+)$/, (whole, suffix: string) => version.test(suffix) ? "" : whole);
  return `${normalize(title)}|${normalize(t.artists[0] ?? "")}`;
}

/** Collapse source IDs and alternate versions without changing the synced library. */
export function uniqueSongs(tracks: TrackProfile[]): TrackProfile[] {
  const ids = new Set<string>(), songs = new Set<string>(), isrcs = new Set<string>();
  return tracks.filter((t) => {
    const key = songIdentity(t), isrc = t.isrc?.toUpperCase();
    if (ids.has(t.id) || songs.has(key) || (isrc && isrcs.has(isrc))) return false;
    ids.add(t.id); songs.add(key); if (isrc) isrcs.add(isrc);
    return true;
  });
}

export function deduplicateSet<T extends { tracks: TrackProfile[] }>(playlists: T[], unsorted: TrackProfile[], analyzing: TrackProfile[]) {
  const all = uniqueSongs([...playlists.flatMap((p) => p.tracks), ...unsorted, ...analyzing]);
  const remaining = new Set(all.map((t) => t.id));
  const take = (tracks: TrackProfile[]) => tracks.filter((t) => remaining.delete(t.id));
  return { playlists: playlists.map((p) => ({ ...p, tracks: take(p.tracks) })), unsorted: take(unsorted), analyzing: take(analyzing) };
}