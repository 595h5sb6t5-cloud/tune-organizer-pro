ALTER TABLE public.generated_playlists
  ADD COLUMN IF NOT EXISTS intent_profile jsonb;

ALTER TABLE public.recommendations
  ADD COLUMN IF NOT EXISTS matched_moods text[] DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS matched_contexts text[] DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS matched_audio_features text[] DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS possible_issue text,
  ADD COLUMN IF NOT EXISTS final_decision text;