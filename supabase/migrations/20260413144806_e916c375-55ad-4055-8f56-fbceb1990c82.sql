
-- Liked song clusters
CREATE TABLE public.liked_song_clusters (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  name text NOT NULL,
  description text,
  vibe_description text,
  mood_tags text[] DEFAULT '{}',
  color_hex text DEFAULT '#6366f1',
  energy_level text,
  tempo_range text,
  era_range text,
  track_count integer NOT NULL DEFAULT 0,
  analysis_model text,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.liked_song_clusters ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own clusters" ON public.liked_song_clusters FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own clusters" ON public.liked_song_clusters FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own clusters" ON public.liked_song_clusters FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own clusters" ON public.liked_song_clusters FOR DELETE USING (auth.uid() = user_id);

CREATE TRIGGER update_liked_song_clusters_updated_at
  BEFORE UPDATE ON public.liked_song_clusters
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_liked_song_clusters_user ON public.liked_song_clusters(user_id);

-- Cluster track assignments
CREATE TABLE public.liked_song_cluster_tracks (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  cluster_id uuid NOT NULL REFERENCES public.liked_song_clusters(id) ON DELETE CASCADE,
  liked_song_id uuid NOT NULL REFERENCES public.liked_songs(id) ON DELETE CASCADE,
  spotify_track_id text NOT NULL,
  confidence_score real DEFAULT 0.8,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (cluster_id, liked_song_id)
);

ALTER TABLE public.liked_song_cluster_tracks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own cluster tracks" ON public.liked_song_cluster_tracks FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own cluster tracks" ON public.liked_song_cluster_tracks FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own cluster tracks" ON public.liked_song_cluster_tracks FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own cluster tracks" ON public.liked_song_cluster_tracks FOR DELETE USING (auth.uid() = user_id);

CREATE INDEX idx_liked_song_cluster_tracks_cluster ON public.liked_song_cluster_tracks(cluster_id);
CREATE INDEX idx_liked_song_cluster_tracks_user ON public.liked_song_cluster_tracks(user_id);

-- Add analysis columns to liked_songs
ALTER TABLE public.liked_songs
  ADD COLUMN IF NOT EXISTS genre_tags text[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS mood text,
  ADD COLUMN IF NOT EXISTS energy text,
  ADD COLUMN IF NOT EXISTS tempo_estimate text,
  ADD COLUMN IF NOT EXISTS era text,
  ADD COLUMN IF NOT EXISTS atmosphere text,
  ADD COLUMN IF NOT EXISTS production_style text,
  ADD COLUMN IF NOT EXISTS analyzed_at timestamp with time zone;
