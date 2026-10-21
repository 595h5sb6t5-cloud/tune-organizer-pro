CREATE TABLE public.vibe_spec_corrections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  phrase TEXT NOT NULL,
  spec JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, phrase)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vibe_spec_corrections TO authenticated;
GRANT ALL ON public.vibe_spec_corrections TO service_role;
ALTER TABLE public.vibe_spec_corrections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage their own vibe corrections"
ON public.vibe_spec_corrections
FOR ALL
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);