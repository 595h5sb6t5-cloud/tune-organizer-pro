-- Sound heard from public 30 s previews (Deezer / iTunes) by Gemini. Shared per Spotify id.
-- The audio itself is never stored, only these results.
CREATE TABLE public.track_audio_analysis (
  spotify_track_id text PRIMARY KEY,
  source text NOT NULL CHECK (source IN ('deezer','itunes','none')),
  instruments text[],
  piano boolean,
  melodic_focus real,
  percussive_drive real,
  texture real,
  warmth real,
  scale real,
  groove text,
  confidence real,
  section text,
  model text,
  analyzed_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.track_audio_analysis TO authenticated;
GRANT ALL ON public.track_audio_analysis TO service_role;
ALTER TABLE public.track_audio_analysis ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Signed-in users read shared audio analysis" ON public.track_audio_analysis FOR SELECT TO authenticated USING (true);

CREATE TABLE public.audio_analysis_state (
  id int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  status text NOT NULL DEFAULT 'idle',
  lease_until timestamptz,
  paused_until timestamptz,
  last_error text,
  analyzed int NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.audio_analysis_state TO authenticated;
GRANT ALL ON public.audio_analysis_state TO service_role;
ALTER TABLE public.audio_analysis_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Signed-in users read audio analysis status" ON public.audio_analysis_state FOR SELECT TO authenticated USING (true);
INSERT INTO public.audio_analysis_state (id) VALUES (1);