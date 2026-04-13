
CREATE TABLE public.playlist_vibe_analysis (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  playlist_id uuid NOT NULL REFERENCES public.spotify_playlists(id) ON DELETE CASCADE,
  primary_vibe text NOT NULL,
  secondary_vibes text[] DEFAULT '{}',
  mood_summary text,
  energy_summary text,
  tempo_summary text,
  production_summary text,
  era_summary text,
  language_summary text,
  listening_context text,
  structural_flow text,
  user_intent text,
  ai_explanation text,
  cohesion_description text,
  what_belongs text,
  what_breaks_it text,
  vibe_color_hex text DEFAULT '#6366f1',
  analysis_model text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (user_id, playlist_id)
);

ALTER TABLE public.playlist_vibe_analysis ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own vibe analysis" ON public.playlist_vibe_analysis FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own vibe analysis" ON public.playlist_vibe_analysis FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own vibe analysis" ON public.playlist_vibe_analysis FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own vibe analysis" ON public.playlist_vibe_analysis FOR DELETE USING (auth.uid() = user_id);

CREATE TRIGGER update_playlist_vibe_analysis_updated_at
  BEFORE UPDATE ON public.playlist_vibe_analysis
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_playlist_vibe_analysis_user ON public.playlist_vibe_analysis(user_id);
CREATE INDEX idx_playlist_vibe_analysis_playlist ON public.playlist_vibe_analysis(playlist_id);
