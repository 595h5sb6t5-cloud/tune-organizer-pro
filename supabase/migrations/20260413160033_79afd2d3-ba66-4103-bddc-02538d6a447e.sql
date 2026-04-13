
-- Create spotify_followed_artists table
CREATE TABLE public.spotify_followed_artists (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  spotify_artist_id text NOT NULL,
  artist_name text NOT NULL,
  image_url text,
  genres text[] DEFAULT '{}'::text[],
  follower_count integer,
  popularity integer,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (user_id, spotify_artist_id)
);

ALTER TABLE public.spotify_followed_artists ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own followed artists" ON public.spotify_followed_artists FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own followed artists" ON public.spotify_followed_artists FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own followed artists" ON public.spotify_followed_artists FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own followed artists" ON public.spotify_followed_artists FOR DELETE USING (auth.uid() = user_id);

CREATE TRIGGER update_spotify_followed_artists_updated_at
  BEFORE UPDATE ON public.spotify_followed_artists
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Add sync metadata columns to spotify_connections
ALTER TABLE public.spotify_connections
  ADD COLUMN IF NOT EXISTS last_full_sync_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS last_incremental_sync_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS sync_status text DEFAULT 'idle';
