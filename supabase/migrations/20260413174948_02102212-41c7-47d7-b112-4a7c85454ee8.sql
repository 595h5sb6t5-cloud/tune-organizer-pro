
-- Add spotify export tracking to Tempo-generated playlists
ALTER TABLE public.liked_song_clusters
  ADD COLUMN IF NOT EXISTS spotify_playlist_id text,
  ADD COLUMN IF NOT EXISTS spotify_exported_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS spotify_playlist_url text;
