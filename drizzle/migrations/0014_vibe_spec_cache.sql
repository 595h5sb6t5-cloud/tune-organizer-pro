CREATE TABLE public.vibe_spec_cache (
  user_id uuid NOT NULL,
  spec_key text NOT NULL,
  spec jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, spec_key)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vibe_spec_cache TO authenticated;
GRANT ALL ON public.vibe_spec_cache TO service_role;
ALTER TABLE public.vibe_spec_cache ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own vibe recipes" ON public.vibe_spec_cache FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);