// Pre-built AI Playlists: runs the single engine (organize.ts) in the background
// whenever the analysis changed enough, and saves the result so the AI Playlists
// page can show it instantly.
import { supabase } from "@/integrations/supabase/client";
import { buildProfiles } from "./features";
import { enrichWithAI } from "./ai";
import { organizeLibrary, curateLibrary, type PlaylistDraft } from "./organize";
import { askCurator } from "./curate";
import { earCheckPlaylists } from "./earcheck";
import { loadLikedTracks, loadArtistGenres } from "@/components/app/OrganizeLibraryPanel";
import type { TrackProfile } from "./features";
import { deduplicateSet, uniqueSongs } from "./identity";
import { loadRemovalRules, respectsRemovals } from "./feedback";

export const readyForPlaylist = (p: TrackProfile) => !!p.style &&
  (p.audioSource === "deezer" || p.audioSource === "itunes") &&
  !!p.drumSound && !!p.mixCharacter && !!p.vocalSpace && !!p.moments?.length;

/** First set once the priority songs are analyzed; then rebuild on ≥5% change or when analysis finishes. */
export const FIRST_BUILD_SONGS = 200;
export const REBUILD_SHARE = 0.05;

export interface PrebuiltSet {
  playlists: PlaylistDraft[];
  unsorted: TrackProfile[];
  analyzing: TrackProfile[];
  built_at: string | null;
  seen_at: string | null;
  analyzed_count: number;
  status: string;
}

export function needsRebuild(o: { total: number; analyzed: number; builtCount: number; hasBuild: boolean; analysisDone: boolean }): boolean {
  const { total, analyzed, builtCount, hasBuild, analysisDone } = o;
  if (!total) return false;
  if (!hasBuild) return analyzed >= Math.min(FIRST_BUILD_SONGS, total);
  const diff = Math.abs(analyzed - builtCount);
  // Analysis finished: any change of 1% or more (small listener-evidence touch-ups don't rebuild every minute).
  if (analysisDone && diff >= Math.max(1, Math.round(total * 0.01))) return true;
  return diff >= Math.max(1, Math.round(total * REBUILD_SHARE));
}

export async function loadPrebuilt(userId: string): Promise<PrebuiltSet | null> {
  const { data } = await supabase.from("prebuilt_playlists").select("*").eq("user_id", userId).maybeSingle();
  if (!data) return null;
  return {
    ...deduplicateSet((data.playlists as unknown as PlaylistDraft[]) ?? [], (data.unsorted as unknown as TrackProfile[]) ?? [], (data.analyzing as unknown as TrackProfile[]) ?? []),
    built_at: data.built_at, seen_at: data.seen_at, analyzed_count: data.analyzed_count, status: data.status,
  };
}

/** Songs counted as analyzed: style known (+ feeling re-descriptions count as change). */
async function analysisCounts(userId: string) {
  const [{ count: total }, { count: styled }, { count: felt }, { data: enr }] = await Promise.all([
    supabase.from("liked_songs").select("spotify_track_id", { count: "exact", head: true }).eq("user_id", userId).eq("is_active", true).eq("is_available", true),
    supabase.from("track_ai_classification").select("spotify_track_id", { count: "exact", head: true }).eq("user_id", userId).not("style", "is", null),
    supabase.from("track_ai_classification").select("spotify_track_id", { count: "exact", head: true }).eq("user_id", userId).eq("feel_checked", true),
    supabase.from("library_enrichment").select("status").eq("user_id", userId).maybeSingle(),
  ]);
  return { total: total ?? 0, styled: styled ?? 0, signal: (styled ?? 0) + (felt ?? 0), done: enr?.status === "done" };
}

async function takeLease(userId: string): Promise<boolean> {
  await supabase.from("prebuilt_playlists").upsert({ user_id: userId }, { onConflict: "user_id", ignoreDuplicates: true });
  const now = new Date().toISOString();
  const { data } = await supabase.from("prebuilt_playlists")
    .update({ lease_until: new Date(Date.now() + 5 * 60_000).toISOString(), status: "building" })
    .eq("user_id", userId).or(`lease_until.is.null,lease_until.lt.${now}`).select("user_id");
  return !!data?.length;
}

/** Builds and saves the set. Only analyzed songs take part, so early sets are already coherent. */
export async function buildAndSave(userId: string, signal: number, onProgress?: (label: string, done?: number, total?: number) => void): Promise<PrebuiltSet> {
  const t0 = performance.now();
  const tracks = await loadLikedTracks(userId);
  const genres = await loadArtistGenres(tracks.flatMap((t) => t.artists.map((a) => a.id)), () => {});
  const all = uniqueSongs(await enrichWithAI(buildProfiles(tracks, genres)));
  const corrections = await loadRemovalRules(userId);
  // Songs whose analysis hasn't finished yet are not "Not placed" — they're "Analyzing…"
  // and the background enrichment keeps working on them.
  let analyzing = all.filter((p) => !readyForPlaylist(p));
  const profiles = all.filter(readyForPlaylist);
  if (analyzing.length) void supabase.functions.invoke("audio-analyze", { body: { queue_ids: analyzing.map((p) => p.id) } }).catch(() => {});
  const curated = await curateLibrary(organizeLibrary(profiles), (t) => askCurator(t), () => {});
  // The ear: Gemini hears every playlist against its anchors; only 8+ stays.
  onProgress?.("Listening to the playlists", 0, 0);
  const blocked: TrackProfile[] = [];
  const respect = (drafts: PlaylistDraft[]) => drafts.map((p) => ({ ...p, tracks: p.tracks.filter((t) => {
    if (respectsRemovals(t, p.tracks, corrections, all)) return true;
    blocked.push(t); return false;
  }) }));
  const heard = await earCheckPlaylists(userId, respect(curated.playlists), (d, t) => onProgress?.("Listening to the playlists", d, t));
  analyzing.push(...heard.pending);
  const reports = [...heard.reports];
  let playlists = heard.playlists;
  let unsorted = [...curated.unsorted, ...heard.rejected];
  let listened = heard.listened;
  // Regroup "Not placed" with the same rules and the same ear, up to 3 passes total.
  for (let pass = 2; pass <= 3 && unsorted.length >= 8; pass++) {
    onProgress?.(`Regrouping Not placed (pass ${pass}/3)`);
    const retry = organizeLibrary(unsorted);
    if (!retry.playlists.length) break;
    const retryHeard = await earCheckPlaylists(userId, respect(retry.playlists), (d, t) => onProgress?.(`Listening (pass ${pass}/3)`, d, t));
    analyzing.push(...retryHeard.pending); reports.push(...retryHeard.reports);
    listened += retryHeard.listened;
    playlists = [...playlists, ...retryHeard.playlists];
    unsorted = [...retry.unsorted, ...retryHeard.rejected];
    console.info(`[prebuild] pass ${pass}: +${retryHeard.playlists.length} playlists, ${unsorted.length} still not placed`);
  }
  playlists.forEach((p, i) => { p.key = `set-${i}`; });
  const result = deduplicateSet(playlists, [...unsorted, ...blocked], analyzing);
  analyzing = result.analyzing;
  console.info(`[prebuild] quality ${JSON.stringify({ reports, intruders: reports.flatMap((r) => r.removed).filter((r) => r.kind === "intruder").length })}`);
  console.info(`[prebuild] ${result.playlists.length} playlists, ${result.unsorted.length} not placed, ${analyzing.length} analyzing, ear listened to ${listened} songs in ${Math.round(performance.now() - t0)}ms`);
  const row = {
    playlists: result.playlists as any, unsorted: result.unsorted as any, analyzing: analyzing as any, analyzed_count: signal,
    status: "ready", lease_until: null, built_at: new Date().toISOString(), error: null, updated_at: new Date().toISOString(),
  };
  const { error } = await supabase.from("prebuilt_playlists").update(row).eq("user_id", userId);
  if (error) throw new Error(error.message);
  return { playlists: result.playlists, unsorted: result.unsorted, analyzing, built_at: row.built_at, seen_at: null, analyzed_count: signal, status: "ready" };
}

/** Checks whether a rebuild is due and runs it. Safe to call often: a DB lease keeps it single-flight. */
export async function maybePrebuild(userId: string, force = false): Promise<boolean> {
  // Verification hold: only an explicit rebuild may run while the master report is pending.
  if (!force) return false;
  const [counts, current] = await Promise.all([analysisCounts(userId), loadPrebuilt(userId)]);
  const due = force || needsRebuild({
    total: counts.total, analyzed: counts.signal, builtCount: current?.analyzed_count ?? 0,
    hasBuild: !!current?.built_at, analysisDone: counts.done,
  });
  if (!due || (counts.styled < Math.min(FIRST_BUILD_SONGS, counts.total) && !force)) return false;
  if (!(await takeLease(userId))) return false;
  try {
    await buildAndSave(userId, counts.signal);
    return true;
  } catch (e) {
    await supabase.from("prebuilt_playlists").update({ status: "error", lease_until: null, error: e instanceof Error ? e.message : "Build failed" }).eq("user_id", userId);
    return false;
  }
}

export async function markPrebuiltSeen(userId: string) {
  await supabase.from("prebuilt_playlists").update({ seen_at: new Date().toISOString() }).eq("user_id", userId);
}
