ALTER TABLE public.spotify_playlists
  ADD COLUMN IF NOT EXISTS spotify_total_tracks integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tracks_import_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS tracks_import_error text,
  ADD COLUMN IF NOT EXISTS spotify_url text,
  ADD COLUMN IF NOT EXISTS is_public boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_spt_playlist_position
  ON public.spotify_playlist_tracks (playlist_id, position);
