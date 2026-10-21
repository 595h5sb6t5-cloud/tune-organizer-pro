// The ear for AI Playlists: after the engine groups the library, Gemini hears every
// playlist's songs (15 s mid-clips, batches of 8, a few requests at a time) against the
// playlist's two most representative songs ("anchors"). Only songs the ear scores 8+
// stay; the rest move to a playlist where the ear accepts them, or to "Not placed".
// Scores are cached per (anchor, playlist contents), so unchanged playlists are never re-heard.
import { supabase } from "@/integrations/supabase/client";
import type { TrackProfile } from "./features";
import { averageFit, compatibility, sequence, type PlaylistDraft } from "./organize";

const MIN_EAR = 8;
const BATCH = 8;
const CONCURRENCY = 6; // simultaneous vibe-listen requests
const MIN_SIZE = 8;

/** The 2 songs most compatible with the rest of the playlist. */
export function pickAnchors(tracks: TrackProfile[]): TrackProfile[] {
  const scored = tracks.map((t) => ({ t, fit: averageFit(t, tracks.filter((x) => x.id !== t.id)) }));
  scored.sort((a, b) => b.fit - a.fit);
  const first = scored[0]?.t;
  if (!first) return [];
  // Second anchor: strong fit but not a twin of the first (covers the playlist's range).
  const second = scored.find((s) => s.t.id !== first.id && compatibility(s.t, first) < 0.9)?.t ?? scored[1]?.t;
  return [first, ...(second ? [second] : [])];
}

const r2n = (x: number | null | undefined) => (x == null ? null : Math.round(x * 100) / 100);
const earSeed = (t: TrackProfile) => ({
  name: t.name, artists: t.artists, instruments: t.instruments, piano: null,
  melodic_focus: r2n(t.melodicFocus), percussive_drive: r2n(t.percussiveDrive), texture: r2n(t.texture), warmth: r2n(t.warmth),
  scale: r2n(t.scale), groove: t.groove, energy: r2n(t.energy), style: t.style ?? null, feeling: t.feeling, feeling_2: t.feeling2 ?? null, arc: t.arc,
});

/** Stable content hash: the cache key changes exactly when the playlist's songs change. */
function contentHash(ids: string[]): string {
  let h = 0;
  for (const id of [...ids].sort()) for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

interface ListenJob { key: string; seed: TrackProfile; ids: string[] }

/** Runs jobs through vibe-listen with a small concurrency pool; fills `scores` and `unheard`. */
async function runJobs(userId: string, jobs: ListenJob[], scores: Map<string, number>, unheard: Set<string>) {
  let next = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const j = jobs[next++];
      const call = () => supabase.functions.invoke("vibe-listen", { body: { seed: earSeed(j.seed), ids: j.ids } });
      let { data, error } = await call();
      if (error || data?.error) ({ data, error } = await call()); // one retry for a busy moment
      if (error || data?.error) { for (const id of j.ids) unheard.add(id); continue; }
      for (const id of data.unheard ?? []) unheard.add(id);
      const rows = (data.results ?? []).map((r: any) => {
        scores.set(`${j.key}|${r.id}`, r.score);
        return { user_id: userId, vibe_key: j.key, spotify_track_id: r.id, score: r.score };
      });
      if (rows.length) void supabase.from("vibe_select_cache").upsert(rows, { onConflict: "user_id,vibe_key,spotify_track_id" }).then(() => {});
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, worker));
}

/** Loads cached ear scores for a set of (key, song) pairs. */
async function loadCache(userId: string, keys: string[], ids: string[]): Promise<Map<string, number>> {
  const scores = new Map<string, number>();
  for (const key of keys) {
    for (let i = 0; i < ids.length; i += 200) {
      const { data } = await supabase.from("vibe_select_cache").select("spotify_track_id, score")
        .eq("user_id", userId).eq("vibe_key", key).in("spotify_track_id", ids.slice(i, i + 200));
      for (const r of data ?? []) scores.set(`${key}|${r.spotify_track_id}`, Number(r.score));
    }
  }
  return scores;
}

/**
 * Ear pass over the whole set. Returns new playlists (re-sequenced) and the songs the ear
 * rejected everywhere. Playlists whose contents didn't change hit the cache and cost nothing.
 */
export async function earCheckPlaylists(
  userId: string,
  playlists: PlaylistDraft[],
  onProgress?: (done: number, total: number) => void,
): Promise<{ playlists: PlaylistDraft[]; rejected: TrackProfile[]; listened: number }> {
  // 1. Anchors and cache keys per playlist.
  const plans = playlists.map((p) => {
    const anchors = pickAnchors(p.tracks);
    const anchorIds = new Set(anchors.map((a) => a.id));
    const rest = p.tracks.filter((t) => !anchorIds.has(t.id));
    // Each song is judged against its closer anchor.
    const near = (t: TrackProfile) => anchors.length < 2 ? anchors[0]
      : compatibility(t, anchors[0]) >= compatibility(t, anchors[1]) ? anchors[0] : anchors[1];
    const key = (a: TrackProfile) => `pl1|${a.id}|${contentHash(p.tracks.map((t) => t.id))}`;
    return { p, anchors, rest, near, key };
  });

  const allIds = plans.flatMap((x) => x.rest.map((t) => t.id));
  const allKeys = [...new Set(plans.flatMap((x) => x.anchors.map((a) => x.key(a))))];
  const scores = await loadCache(userId, allKeys, allIds);

  // 2. Listen to what the cache doesn't know.
  const unheard = new Set<string>();
  const jobs: ListenJob[] = [];
  for (const x of plans) {
    const byAnchor = new Map<string, string[]>();
    for (const t of x.rest) {
      const a = x.near(t);
      const k = x.key(a);
      if (scores.has(`${k}|${t.id}`)) continue;
      byAnchor.set(k, [...(byAnchor.get(k) ?? []), t.id]);
    }
    for (const [k, ids] of byAnchor) {
      const seed = x.anchors.find((a) => k.startsWith(`pl1|${a.id}|`))!;
      for (let i = 0; i < ids.length; i += BATCH) jobs.push({ key: k, seed, ids: ids.slice(i, i + BATCH) });
    }
  }
  const total = jobs.reduce((a, j) => a + j.ids.length, 0);
  const listened = total;
  let done = 0;
  onProgress?.(0, total);
  // Wrap runJobs to report progress per finished job.
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, async () => {
    while (next < jobs.length) {
      const j = jobs[next++];
      await runJobs(userId, [j], scores, unheard);
      done += j.ids.length;
      onProgress?.(done, total);
    }
  }));

  // 3. Keep 8+; the rest tries other playlists (cached/known scores first, then one listen).
  const kept: PlaylistDraft[] = [];
  const rejected: TrackProfile[] = [];
  for (const x of plans) {
    const stay = x.rest.filter((t) => {
      const k = x.key(x.near(t));
      const s = scores.get(`${k}|${t.id}`);
      return s !== undefined && s >= MIN_EAR; // unheard songs (no clip) stay out of the ear's way: they keep their place
    });
    const noScore = x.rest.filter((t) => scores.get(`${x.key(x.near(t))}|${t.id}`) === undefined && unheard.has(t.id));
    const out = x.rest.filter((t) => {
      const s = scores.get(`${x.key(x.near(t))}|${t.id}`);
      return s !== undefined && s < MIN_EAR;
    });
    rejected.push(...out);
    kept.push({ ...x.p, tracks: [...x.anchors, ...stay, ...noScore] });
  }

  // 4. Re-home rejected songs: the playlist where the ear gives them 8+ against an anchor.
  const stillOut: TrackProfile[] = [];
  const rehomeJobs: ListenJob[] = [];
  const rehomeTarget = new Map<string, { t: TrackProfile; playlist: PlaylistDraft; anchor: TrackProfile; key: string }>();
  for (const t of rejected) {
    // Candidate homes by compatibility fit (top 2), excluding where it failed.
    const options = kept
      .filter((p) => !plans.find((x) => x.p.key === p.key)?.rest.some((r) => r.id === t.id))
      .map((p) => ({ p, fit: averageFit(t, p.tracks) }))
      .filter((x) => x.fit >= 0.55)
      .sort((a, b) => b.fit - a.fit)
      .slice(0, 2);
    let placed = false;
    for (const { p } of options) {
      const plan = plans.find((x) => x.p.key === p.key)!;
      const a = plan.near(t);
      const k = plan.key(a);
      const s = scores.get(`${k}|${t.id}`);
      if (s !== undefined && s >= MIN_EAR) { p.tracks.push(t); placed = true; break; }
      if (s === undefined && !unheard.has(t.id)) {
        const jobId = `${k}|${t.id}`;
        rehomeTarget.set(jobId, { t, playlist: p, anchor: a, key: k });
        rehomeJobs.push({ key: k, seed: a, ids: [t.id] });
        placed = true; // decided when the job lands
        break;
      }
    }
    if (!placed) stillOut.push(t);
  }
  if (rehomeJobs.length) {
    const before = new Set(unheard);
    await runJobs(userId, rehomeJobs, scores, unheard);
    for (const [jobId, target] of rehomeTarget) {
      const s = scores.get(jobId);
      if (s !== undefined && s >= MIN_EAR && !unheard.has(target.t.id)) target.playlist.tracks.push(target.t);
      else stillOut.push(target.t);
    }
    for (const id of before) unheard.delete(id); // rehome listens resolved
  }

  // 5. Re-sequence; playlists under the minimum dissolve into "Not placed".
  const final: PlaylistDraft[] = [];
  const dissolved: TrackProfile[] = [];
  for (const p of kept) {
    if (p.tracks.length < MIN_SIZE) { dissolved.push(...p.tracks); continue; }
    final.push({ ...p, tracks: sequence(p.tracks) });
  }
  return { playlists: final, rejected: [...stillOut, ...dissolved], listened };
}
