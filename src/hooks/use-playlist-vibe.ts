import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./use-auth";
import { toast } from "sonner";

export interface EmotionalArcSegment {
  segment: string;
  energy: number;
  mood: string;
  description: string;
}

export interface SonicDna {
  key_instruments: string[];
  vocal_character: string;
  production_school: string;
  spatial_quality: string;
  rhythmic_identity: string;
}

export interface TrackHighlight {
  track_name: string;
  artist_name: string;
  role: string;
  why: string;
}

export interface PlaylistVibeAnalysis {
  id: string;
  playlist_id: string;
  primary_vibe: string;
  secondary_vibes: string[];
  mood_summary: string | null;
  energy_summary: string | null;
  tempo_summary: string | null;
  production_summary: string | null;
  era_summary: string | null;
  language_summary: string | null;
  listening_context: string | null;
  structural_flow: string | null;
  user_intent: string | null;
  ai_explanation: string | null;
  cohesion_description: string | null;
  what_belongs: string | null;
  what_breaks_it: string | null;
  vibe_color_hex: string | null;
  sonic_palette: string[];
  emotional_keywords: string[];
  emotional_arc: EmotionalArcSegment[];
  sonic_dna: SonicDna | null;
  track_highlights: TrackHighlight[];
  genre_blend: Record<string, number>;
  updated_at: string;
}

export function usePlaylistVibe(playlistId: string | undefined) {
  const { user } = useAuth();
  const [vibe, setVibe] = useState<PlaylistVibeAnalysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);

  const loadVibe = useCallback(async () => {
    if (!user || !playlistId) return;
    setLoading(true);
    const { data } = await supabase
      .from("playlist_vibe_analysis")
      .select("*")
      .eq("user_id", user.id)
      .eq("playlist_id", playlistId)
      .maybeSingle();
    
    if (data) {
      setVibe({
        ...data,
        secondary_vibes: (data.secondary_vibes as string[]) || [],
        sonic_palette: (data as any).sonic_palette || [],
        emotional_keywords: (data as any).emotional_keywords || [],
        emotional_arc: (data as any).emotional_arc || [],
        sonic_dna: (data as any).sonic_dna || null,
        track_highlights: (data as any).track_highlights || [],
        genre_blend: (data as any).genre_blend || {},
      } as PlaylistVibeAnalysis);
    } else {
      setVibe(null);
    }
    setLoading(false);
  }, [user, playlistId]);

  useEffect(() => {
    void loadVibe();
  }, [loadVibe]);

  const analyze = useCallback(async (playlistName: string, tracks: { track_name: string; artist_name: string; album_name?: string }[]) => {
    if (!user || !playlistId || tracks.length === 0) return;
    setAnalyzing(true);
    try {
      const { data, error } = await supabase.functions.invoke("analyze-playlist-vibe", {
        body: { playlistId, playlistName, tracks },
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      await loadVibe();
      toast.success("Playlist identity analysis complete!");
    } catch (err: any) {
      console.error("Vibe analysis error:", err);
      toast.error("Failed to analyze playlist", { description: err.message });
    } finally {
      setAnalyzing(false);
    }
  }, [user, playlistId, loadVibe]);

  return { vibe, loading, analyzing, analyze, refresh: loadVibe };
}
