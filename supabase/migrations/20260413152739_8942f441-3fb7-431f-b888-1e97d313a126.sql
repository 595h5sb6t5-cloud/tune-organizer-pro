ALTER TABLE public.spotify_playlists ADD COLUMN IF NOT EXISTS is_collaborative boolean NOT NULL DEFAULT false;
ALTER TABLE public.spotify_playlists ADD COLUMN IF NOT EXISTS owner_display_name text;