CREATE TABLE IF NOT EXISTS public.artist_tracks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  artist_spotify_id text NOT NULL,
  track_spotify_id text NOT NULL,
  source text NOT NULL DEFAULT 'top_tracks',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, artist_spotify_id, track_spotify_id, source)
);

CREATE INDEX IF NOT EXISTS idx_artist_tracks_user_artist
  ON public.artist_tracks (user_id, artist_spotify_id);
CREATE INDEX IF NOT EXISTS idx_artist_tracks_user_track
  ON public.artist_tracks (user_id, track_spotify_id);

ALTER TABLE public.artist_tracks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "at select" ON public.artist_tracks
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "at insert" ON public.artist_tracks
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "at delete" ON public.artist_tracks
  FOR DELETE USING (auth.uid() = user_id);

ALTER TABLE public.spotify_followed_artists
  ADD COLUMN IF NOT EXISTS top_tracks_synced_at timestamptz,
  ADD COLUMN IF NOT EXISTS top_tracks_count integer NOT NULL DEFAULT 0;