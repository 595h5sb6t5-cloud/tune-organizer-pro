// Saves "removed" feedback when the user takes a song out of a playlist.
import { supabase } from "@/integrations/supabase/client";
import type { TrackProfile } from "./features";
import { songIdentity } from "./identity";

export interface RemovalRule { spotify_track_id: string; seed_track_id: string | null; context: string | null }
export async function loadRemovalRules(userId: string): Promise<RemovalRule[]> {
  const { data, error } = await supabase.from("playlist_feedback").select("spotify_track_id,seed_track_id,context").eq("user_id", userId).eq("action", "removed");
  if (error) throw new Error("No se pudieron leer tus correcciones.");
  return data ?? [];
}
export function respectsRemovals(track: TrackProfile, group: TrackProfile[], rules: RemovalRule[], library: TrackProfile[]): boolean {
  return !rules.some((rule) => {
    const removed = library.find((t) => t.id === rule.spotify_track_id);
    if (rule.spotify_track_id !== track.id && (!removed || songIdentity(removed) !== songIdentity(track))) return false;
    // Seed-less historical X is authoritative; contextual peer IDs retain the sonic home, not an artist prohibition.
    if (!rule.seed_track_id) return true;
    const seed = library.find((t) => t.id === rule.seed_track_id);
    return group.some((t) => t.id === rule.seed_track_id || (seed && songIdentity(seed) === songIdentity(t)));
  });
}

export async function recordRemoval(trackId: string, opts: { seedId?: string | null; context?: string } = {}) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  await supabase.from("playlist_feedback").upsert({
    user_id: user.id, spotify_track_id: trackId, seed_track_id: opts.seedId ?? null,
    action: "removed", context: opts.context?.slice(0, 300) ?? null,
  }, { onConflict: "user_id,seed_track_id,spotify_track_id,action", ignoreDuplicates: true });
}
