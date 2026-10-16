ALTER TABLE public.track_ai_classification
  ADD COLUMN IF NOT EXISTS feeling text,
  ADD COLUMN IF NOT EXISTS melodic_focus real,
  ADD COLUMN IF NOT EXISTS arc text,
  ADD COLUMN IF NOT EXISTS confidence real,
  ADD COLUMN IF NOT EXISTS feel_checked boolean NOT NULL DEFAULT false;