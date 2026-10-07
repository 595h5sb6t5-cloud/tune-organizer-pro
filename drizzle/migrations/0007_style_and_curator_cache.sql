ALTER TABLE public.track_ai_classification ADD COLUMN IF NOT EXISTS style text, ADD COLUMN IF NOT EXISTS style_checked boolean NOT NULL DEFAULT false;
CREATE TABLE IF NOT EXISTS public.curator_cache (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  cache_key text NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, cache_key)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.curator_cache TO authenticated;
GRANT ALL ON public.curator_cache TO service_role;
ALTER TABLE public.curator_cache ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own curator cache" ON public.curator_cache FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);