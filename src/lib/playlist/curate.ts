// Client wrapper around the curate-playlist function (rules live in organize.ts).
import { supabase } from "@/integrations/supabase/client";
import type { CuratorVerdict } from "./organize";
import type { TrackProfile } from "./features";

export async function askCurator(
  tracks: TrackProfile[],
  extra: { vibe?: string; seeds?: TrackProfile[]; nameOnly?: boolean } = {},
): Promise<CuratorVerdict | null> {
  const { data, error } = await supabase.functions.invoke("curate-playlist", {
    body: {
      tracks: tracks.map((t) => ({
        id: t.id, name: t.name, artists: t.artists, year: t.year, style: t.style, lang: t.lang,
        energy: t.energy === null ? null : Math.round(t.energy * 10) / 10, mood: t.mood,
        instruments: t.instruments, texture: t.texture, warmth: t.warmth, scale: t.scale, groove: t.groove, scene: t.scene, feeling: t.feeling, melodic_focus: t.melodicFocus, arc: t.arc,
      })),
      vibe: extra.vibe,
      seeds: extra.seeds?.map((s) => ({
        name: s.name, artists: s.artists, year: s.year, style: s.style ?? null, lang: s.lang,
        families: s.families, genres: s.genres.slice(0, 5), mood: s.mood,
        energy: s.energy === null ? null : Math.round(s.energy * 100) / 100,
        valence: s.valence === null ? null : Math.round(s.valence * 100) / 100,
        tempo: s.tempo === null ? null : Math.round(s.tempo),
        instruments: s.instruments, texture: s.texture, warmth: s.warmth, scale: s.scale, groove: s.groove, scene: s.scene, feeling: s.feeling, melodic_focus: s.melodicFocus, arc: s.arc,
      })),
      nameOnly: !!extra.nameOnly,
    },
  });
  if (error || data?.error) return null;
  return { remove: data.remove ?? [], name: data.name ?? "" };
}
