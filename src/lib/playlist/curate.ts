// Client wrapper around the curate-playlist function (rules live in organize.ts).
import { supabase } from "@/integrations/supabase/client";
import type { CuratorVerdict } from "./organize";
import type { TrackProfile } from "./features";

export async function askCurator(
  tracks: TrackProfile[],
  extra: { vibe?: string; seeds?: TrackProfile[] } = {},
): Promise<CuratorVerdict | null> {
  const { data, error } = await supabase.functions.invoke("curate-playlist", {
    body: {
      tracks: tracks.map((t) => ({
        id: t.id, name: t.name, artists: t.artists, year: t.year, style: t.style,
        energy: t.energy === null ? null : Math.round(t.energy * 10) / 10, mood: t.mood,
      })),
      vibe: extra.vibe,
      seeds: extra.seeds?.map((s) => `${s.name} – ${s.artists.join(", ")}`),
    },
  });
  if (error || data?.error) return null;
  return { remove: data.remove ?? [], name: data.name ?? "" };
}
