
ALTER TABLE public.ai_track_analysis
  ADD COLUMN IF NOT EXISTS music_family text,
  ADD COLUMN IF NOT EXISTS primary_subgenre text,
  ADD COLUMN IF NOT EXISTS secondary_subgenres text[] DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS subgenre_confidence real,
  ADD COLUMN IF NOT EXISTS house_profile jsonb,
  ADD COLUMN IF NOT EXISTS artist_context jsonb,
  ADD COLUMN IF NOT EXISTS is_house_related boolean DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_ai_track_analysis_music_family ON public.ai_track_analysis(user_id, music_family);
CREATE INDEX IF NOT EXISTS idx_ai_track_analysis_primary_subgenre ON public.ai_track_analysis(user_id, primary_subgenre);
CREATE INDEX IF NOT EXISTS idx_ai_track_analysis_is_house ON public.ai_track_analysis(user_id, is_house_related) WHERE is_house_related = true;

CREATE TABLE IF NOT EXISTS public.diagnostic_samples (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  label text NOT NULL,
  spotify_track_ids text[] NOT NULL,
  size integer NOT NULL,
  selection_reasons jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.diagnostic_samples TO authenticated;
GRANT ALL ON public.diagnostic_samples TO service_role;

ALTER TABLE public.diagnostic_samples ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own diagnostic samples"
  ON public.diagnostic_samples FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER update_diagnostic_samples_updated_at
  BEFORE UPDATE ON public.diagnostic_samples
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
