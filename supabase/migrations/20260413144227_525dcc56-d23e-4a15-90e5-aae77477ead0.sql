
-- Spotify playlists
CREATE TABLE public.spotify_playlists (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  spotify_playlist_id text NOT NULL,
  name text NOT NULL,
  description text,
  image_url text,
  track_count integer NOT NULL DEFAULT 0,
  spotify_owner_id text,
  is_owned_by_user boolean NOT NULL DEFAULT false,
  snapshot_id text,
  last_synced_at timestamp with time zone NOT NULL DEFAULT now(),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (user_id, spotify_playlist_id)
);

ALTER TABLE public.spotify_playlists ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own playlists" ON public.spotify_playlists FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own playlists" ON public.spotify_playlists FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own playlists" ON public.spotify_playlists FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own playlists" ON public.spotify_playlists FOR DELETE USING (auth.uid() = user_id);

CREATE TRIGGER update_spotify_playlists_updated_at
  BEFORE UPDATE ON public.spotify_playlists
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Spotify playlist tracks
CREATE TABLE public.spotify_playlist_tracks (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  playlist_id uuid NOT NULL REFERENCES public.spotify_playlists(id) ON DELETE CASCADE,
  spotify_track_id text NOT NULL,
  track_name text NOT NULL,
  artist_name text NOT NULL,
  album_name text,
  image_url text,
  added_at timestamp with time zone,
  position integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (playlist_id, spotify_track_id)
);

ALTER TABLE public.spotify_playlist_tracks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own playlist tracks" ON public.spotify_playlist_tracks FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own playlist tracks" ON public.spotify_playlist_tracks FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own playlist tracks" ON public.spotify_playlist_tracks FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own playlist tracks" ON public.spotify_playlist_tracks FOR DELETE USING (auth.uid() = user_id);

-- Liked songs
CREATE TABLE public.liked_songs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  spotify_track_id text NOT NULL,
  track_name text NOT NULL,
  artist_name text NOT NULL,
  album_name text,
  image_url text,
  added_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (user_id, spotify_track_id)
);

ALTER TABLE public.liked_songs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own liked songs" ON public.liked_songs FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own liked songs" ON public.liked_songs FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own liked songs" ON public.liked_songs FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own liked songs" ON public.liked_songs FOR DELETE USING (auth.uid() = user_id);

-- Add unique constraint on imported_tracks if not exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'imported_tracks_user_id_spotify_track_id_key'
  ) THEN
    ALTER TABLE public.imported_tracks ADD CONSTRAINT imported_tracks_user_id_spotify_track_id_key UNIQUE (user_id, spotify_track_id);
  END IF;
END $$;

-- Create indexes for performance
CREATE INDEX idx_spotify_playlists_user ON public.spotify_playlists(user_id);
CREATE INDEX idx_spotify_playlist_tracks_playlist ON public.spotify_playlist_tracks(playlist_id);
CREATE INDEX idx_spotify_playlist_tracks_user ON public.spotify_playlist_tracks(user_id);
CREATE INDEX idx_liked_songs_user ON public.liked_songs(user_id);
CREATE INDEX idx_liked_songs_track ON public.liked_songs(user_id, spotify_track_id);
