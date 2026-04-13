
-- Spotify connections table
CREATE TABLE public.spotify_connections (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL UNIQUE,
  spotify_user_id TEXT,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.spotify_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own spotify connection" ON public.spotify_connections FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own spotify connection" ON public.spotify_connections FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own spotify connection" ON public.spotify_connections FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own spotify connection" ON public.spotify_connections FOR DELETE USING (auth.uid() = user_id);

CREATE TRIGGER update_spotify_connections_updated_at
  BEFORE UPDATE ON public.spotify_connections
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Imported tracks table
CREATE TABLE public.imported_tracks (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  spotify_track_id TEXT NOT NULL,
  track_name TEXT NOT NULL,
  artist_name TEXT NOT NULL,
  album_name TEXT,
  image_url TEXT,
  release_date TEXT,
  added_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(user_id, spotify_track_id)
);

ALTER TABLE public.imported_tracks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own imported tracks" ON public.imported_tracks FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own imported tracks" ON public.imported_tracks FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own imported tracks" ON public.imported_tracks FOR DELETE USING (auth.uid() = user_id);
