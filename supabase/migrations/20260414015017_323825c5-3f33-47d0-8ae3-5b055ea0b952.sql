ALTER TABLE spotify_playlist_tracks ADD COLUMN IF NOT EXISTS duration_ms integer;
ALTER TABLE spotify_playlist_tracks ADD COLUMN IF NOT EXISTS preview_url text;