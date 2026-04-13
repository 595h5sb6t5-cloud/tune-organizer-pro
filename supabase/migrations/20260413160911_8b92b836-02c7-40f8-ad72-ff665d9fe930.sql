
-- Add granular sync metadata columns to spotify_connections
ALTER TABLE public.spotify_connections
  ADD COLUMN IF NOT EXISTS last_library_sync_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_playlist_sync_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_artist_sync_at timestamptz,
  ADD COLUMN IF NOT EXISTS sync_error text;
