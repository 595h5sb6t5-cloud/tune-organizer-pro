ALTER TABLE public.track_ai_classification
  ADD COLUMN IF NOT EXISTS instruments text[],
  ADD COLUMN IF NOT EXISTS texture real,
  ADD COLUMN IF NOT EXISTS warmth real,
  ADD COLUMN IF NOT EXISTS scale real,
  ADD COLUMN IF NOT EXISTS groove text,
  ADD COLUMN IF NOT EXISTS sound_checked boolean NOT NULL DEFAULT false;

CREATE TABLE public.playlist_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  seed_track_id text,
  spotify_track_id text NOT NULL,
  action text NOT NULL DEFAULT 'removed',
  context text,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, seed_track_id, spotify_track_id, action)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.playlist_feedback TO authenticated;
GRANT ALL ON public.playlist_feedback TO service_role;
ALTER TABLE public.playlist_feedback ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own feedback select" ON public.playlist_feedback FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Own feedback insert" ON public.playlist_feedback FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Own feedback update" ON public.playlist_feedback FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Own feedback delete" ON public.playlist_feedback FOR DELETE TO authenticated USING (auth.uid() = user_id);