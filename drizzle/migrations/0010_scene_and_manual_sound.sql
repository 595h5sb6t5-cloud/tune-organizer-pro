ALTER TABLE public.track_ai_classification
  ADD COLUMN IF NOT EXISTS scene text,
  ADD COLUMN IF NOT EXISTS scene_checked boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS manual_sound jsonb;
COMMENT ON COLUMN public.track_ai_classification.manual_sound IS 'User corrections (scene, instruments, texture, warmth, scale). Never written by AI; overrides AI values.';