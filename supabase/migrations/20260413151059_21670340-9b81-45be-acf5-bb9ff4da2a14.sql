ALTER TABLE public.liked_song_clusters ADD COLUMN IF NOT EXISTS ai_explanation text;
ALTER TABLE public.liked_song_clusters ADD COLUMN IF NOT EXISTS cover_tracks jsonb DEFAULT '[]'::jsonb;