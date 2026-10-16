// Saves "removed" feedback when the user takes a song out of a playlist.
import { supabase } from "@/integrations/supabase/client";

export async function recordRemoval(trackId: string, opts: { seedId?: string | null; context?: string } = {}) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  await supabase.from("playlist_feedback").upsert({
    user_id: user.id, spotify_track_id: trackId, seed_track_id: opts.seedId ?? null,
    action: "removed", context: opts.context?.slice(0, 300) ?? null,
  }, { onConflict: "user_id,seed_track_id,spotify_track_id,action", ignoreDuplicates: true });
}
