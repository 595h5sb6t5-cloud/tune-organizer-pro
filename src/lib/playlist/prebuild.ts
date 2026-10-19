// Pre-built AI Playlists: runs the single engine (organize.ts) in the background
// whenever the analysis changed enough, and saves the result so the AI Playlists
// page can show it instantly.
import { supabase } from "@/integrations/supabase/client";
import { buildProfiles } from "./features";
import { enrichWithAI } from "./ai";
import { organizeLibrary, curateLibrary, type PlaylistDraft } from "./organize";
import { askCurator } from "./curate";
import { loadLikedTracks, loadArtistGenres } from "@/components/app/OrganizeLibraryPanel";
import type { TrackProfile } from "./features";

/** First set once the priority songs are analyzed; then rebuild on ≥5% change or when analysis finishes. */
export const FIRST_BUILD_SONGS = 200;
export const REBUILD_SHARE = 0.05;

export interface PrebuiltSet {
  playlists: PlaylistDraft[];
  unsorted: TrackProfile[];
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
    playlists: (data.playlists as any) ?? [], unsorted: (data.unsorted as any) ?? [],
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
export async function buildAndSave(userId: string, signal: number): Promise<PrebuiltSet> {
  const tracks = await loadLikedTracks(userId);
  const genres = await loadArtistGenres(tracks.flatMap((t) => t.artists.map((a) => a.id)), () => {});
  const profiles = (await enrichWithAI(buildProfiles(tracks, genres))).filter((p) => !!p.style);
  const result = await curateLibrary(organizeLibrary(profiles), (t) => askCurator(t), () => {});
  const row = {
    playlists: result.playlists as any, unsorted: result.unsorted as any, analyzed_count: signal,
    status: "ready", lease_until: null, built_at: new Date().toISOString(), error: null, updated_at: new Date().toISOString(),
  };
  const { error } = await supabase.from("prebuilt_playlists").update(row).eq("user_id", userId);
  if (error) throw new Error(error.message);
  return { playlists: result.playlists, unsorted: result.unsorted, built_at: row.built_at, seen_at: null, analyzed_count: signal, status: "ready" };
}

/** Checks whether a rebuild is due and runs it. Safe to call often: a DB lease keeps it single-flight. */
export async function maybePrebuild(userId: string, force = false): Promise<boolean> {
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
