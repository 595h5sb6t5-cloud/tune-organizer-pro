// Shared final ear audit for AI Playlists. Failures remain unresolved, never rejected.
import type { TrackProfile } from "./features";
import type { PlaylistDraft } from "./organize";
import { checkFinalPlaylist, type QualityReport } from "./quality";
export { pickAnchors } from "./quality";

export async function earCheckPlaylists(userId: string, playlists: PlaylistDraft[], onProgress?: (done: number, total: number) => void): Promise<{
  playlists: PlaylistDraft[]; rejected: TrackProfile[]; pending: TrackProfile[]; listened: number; reports: QualityReport[];
}> {
  const final: PlaylistDraft[] = [], rejected: TrackProfile[] = [], pending: TrackProfile[] = [], reports: QualityReport[] = [];
  let done = 0, listened = 0;
  onProgress?.(0, playlists.length);
  // One playlist at a time bounds the audio/gateway load; each overlapping group is parallel.
  for (const p of playlists) {
    const result = await checkFinalPlaylist(p.tracks, `${p.moment ?? ""}: ${p.description}`, { runId: crypto.randomUUID() });
    listened += result.report.checked; reports.push(result.report);
    rejected.push(...result.rejected); pending.push(...result.pending);
    if (result.tracks.length >= 8) final.push({ ...p, tracks: result.tracks });
    else rejected.push(...result.tracks);
    onProgress?.(++done, playlists.length);
  }
  return { playlists: final, rejected, pending, listened, reports };
}
