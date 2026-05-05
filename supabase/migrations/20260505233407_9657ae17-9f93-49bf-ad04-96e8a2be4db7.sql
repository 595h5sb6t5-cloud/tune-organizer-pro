ALTER TABLE public.recommendations
  ADD COLUMN IF NOT EXISTS spotify_track_id text,
  ADD COLUMN IF NOT EXISTS track_name text,
  ADD COLUMN IF NOT EXISTS artist_name text,
  ADD COLUMN IF NOT EXISTS album_name text,
  ADD COLUMN IF NOT EXISTS image_url text,
  ADD COLUMN IF NOT EXISTS preview_url text;

ALTER TABLE public.recommendations ALTER COLUMN track_id DROP NOT NULL;

CREATE INDEX IF NOT EXISTS recommendations_user_playlist_idx
  ON public.recommendations(user_id, based_on_playlist_id, status);

CREATE INDEX IF NOT EXISTS recommendations_user_spotify_idx
  ON public.recommendations(user_id, spotify_track_id);