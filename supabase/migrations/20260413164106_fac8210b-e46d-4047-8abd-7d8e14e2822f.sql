ALTER TABLE public.liked_songs
  ADD COLUMN IF NOT EXISTS groove_feel text,
  ADD COLUMN IF NOT EXISTS vocal_style text,
  ADD COLUMN IF NOT EXISTS sonic_brightness text,
  ADD COLUMN IF NOT EXISTS spatial_quality text,
  ADD COLUMN IF NOT EXISTS rhythmic_identity text,
  ADD COLUMN IF NOT EXISTS listening_context text,
  ADD COLUMN IF NOT EXISTS sonic_texture text,
  ADD COLUMN IF NOT EXISTS intimacy_scale text,
  ADD COLUMN IF NOT EXISTS tension_level text;