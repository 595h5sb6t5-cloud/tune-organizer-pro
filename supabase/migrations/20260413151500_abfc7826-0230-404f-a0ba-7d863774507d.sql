ALTER TABLE public.liked_songs
  ADD COLUMN IF NOT EXISTS audio_tempo real,
  ADD COLUMN IF NOT EXISTS audio_energy real,
  ADD COLUMN IF NOT EXISTS audio_valence real,
  ADD COLUMN IF NOT EXISTS audio_danceability real,
  ADD COLUMN IF NOT EXISTS audio_acousticness real,
  ADD COLUMN IF NOT EXISTS audio_instrumentalness real,
  ADD COLUMN IF NOT EXISTS audio_speechiness real,
  ADD COLUMN IF NOT EXISTS audio_loudness real,
  ADD COLUMN IF NOT EXISTS audio_liveness real,
  ADD COLUMN IF NOT EXISTS audio_key integer,
  ADD COLUMN IF NOT EXISTS audio_mode integer,
  ADD COLUMN IF NOT EXISTS audio_time_signature integer,
  ADD COLUMN IF NOT EXISTS audio_features_fetched_at timestamptz;