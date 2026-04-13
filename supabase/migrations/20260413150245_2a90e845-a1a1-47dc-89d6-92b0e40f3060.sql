ALTER TABLE public.playlist_vibe_analysis
  ADD COLUMN IF NOT EXISTS emotional_arc jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS sonic_dna jsonb DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS track_highlights jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS energy_curve jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS genre_blend jsonb DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS sonic_palette text[] DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS emotional_keywords text[] DEFAULT '{}'::text[];