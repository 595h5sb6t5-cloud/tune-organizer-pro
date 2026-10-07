CREATE TABLE public.vibe_select_cache (
  user_id uuid NOT NULL,
  vibe_key text NOT NULL,
  spotify_track_id text NOT NULL,
  score numeric NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, vibe_key, spotify_track_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vibe_select_cache TO authenticated;
GRANT ALL ON public.vibe_select_cache TO service_role;
ALTER TABLE public.vibe_select_cache ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own vibe cache" ON public.vibe_select_cache FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);