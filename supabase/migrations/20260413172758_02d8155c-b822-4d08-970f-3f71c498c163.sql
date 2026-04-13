
-- Create saved albums table
CREATE TABLE public.spotify_saved_albums (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  spotify_album_id text NOT NULL,
  album_name text NOT NULL,
  artist_name text NOT NULL,
  image_url text,
  release_date text,
  total_tracks integer DEFAULT 0,
  album_type text,
  genres text[] DEFAULT '{}'::text[],
  label text,
  popularity integer,
  added_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, spotify_album_id)
);

-- Enable RLS
ALTER TABLE public.spotify_saved_albums ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Users can view own saved albums" ON public.spotify_saved_albums FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own saved albums" ON public.spotify_saved_albums FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own saved albums" ON public.spotify_saved_albums FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own saved albums" ON public.spotify_saved_albums FOR DELETE USING (auth.uid() = user_id);

-- Create album tracks table (tracks within saved albums)
CREATE TABLE public.spotify_album_tracks (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  album_id uuid NOT NULL,
  spotify_track_id text NOT NULL,
  track_name text NOT NULL,
  artist_name text NOT NULL,
  track_number integer DEFAULT 1,
  disc_number integer DEFAULT 1,
  duration_ms integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(album_id, spotify_track_id)
);

ALTER TABLE public.spotify_album_tracks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own album tracks" ON public.spotify_album_tracks FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own album tracks" ON public.spotify_album_tracks FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own album tracks" ON public.spotify_album_tracks FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own album tracks" ON public.spotify_album_tracks FOR DELETE USING (auth.uid() = user_id);

-- Add album sync timestamp to spotify_connections
ALTER TABLE public.spotify_connections ADD COLUMN IF NOT EXISTS last_album_sync_at timestamptz;
