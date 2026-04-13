
-- Recommendation history: every recommendation shown
CREATE TABLE public.recommendation_history (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  playlist_id TEXT,
  playlist_name TEXT,
  track_title TEXT NOT NULL,
  track_artist TEXT NOT NULL,
  track_album TEXT,
  track_year INT,
  track_genre TEXT,
  track_mood TEXT,
  track_tempo REAL,
  track_energy REAL,
  track_valence REAL,
  compatibility_score INT,
  popularity_tier TEXT,
  reason TEXT,
  mood_tags TEXT[],
  compatibility_breakdown JSONB,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'dismissed', 'saved')),
  discovery_mode TEXT DEFAULT 'balanced',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.recommendation_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own recommendation history"
  ON public.recommendation_history FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own recommendation history"
  ON public.recommendation_history FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own recommendation history"
  ON public.recommendation_history FOR UPDATE
  USING (auth.uid() = user_id);

-- Also allow anonymous/unauthenticated access for demo mode
CREATE POLICY "Allow anonymous read recommendation history"
  ON public.recommendation_history FOR SELECT
  USING (user_id IS NULL);

CREATE POLICY "Allow anonymous insert recommendation history"
  ON public.recommendation_history FOR INSERT
  WITH CHECK (user_id IS NULL);

CREATE POLICY "Allow anonymous update recommendation history"
  ON public.recommendation_history FOR UPDATE
  USING (user_id IS NULL);

-- User taste profile: aggregated preferences
CREATE TABLE public.user_taste_profile (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  favorite_genres TEXT[] DEFAULT '{}',
  favorite_moods TEXT[] DEFAULT '{}',
  favorite_artists TEXT[] DEFAULT '{}',
  preferred_tempo_min REAL DEFAULT 60,
  preferred_tempo_max REAL DEFAULT 140,
  preferred_energy_min REAL DEFAULT 0.2,
  preferred_energy_max REAL DEFAULT 0.8,
  preferred_eras TEXT[] DEFAULT '{}',
  discovery_preference TEXT DEFAULT 'balanced',
  accepted_count INT DEFAULT 0,
  dismissed_count INT DEFAULT 0,
  taste_clusters JSONB DEFAULT '[]',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id)
);

ALTER TABLE public.user_taste_profile ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own taste profile"
  ON public.user_taste_profile FOR SELECT
  USING (auth.uid() = user_id OR user_id IS NULL);

CREATE POLICY "Users can upsert own taste profile"
  ON public.user_taste_profile FOR INSERT
  WITH CHECK (auth.uid() = user_id OR user_id IS NULL);

CREATE POLICY "Users can update own taste profile"
  ON public.user_taste_profile FOR UPDATE
  USING (auth.uid() = user_id OR user_id IS NULL);

-- Recommendation feedback log
CREATE TABLE public.recommendation_feedback (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  recommendation_id UUID REFERENCES public.recommendation_history(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK (action IN ('accepted', 'dismissed', 'saved')),
  track_title TEXT NOT NULL,
  track_artist TEXT NOT NULL,
  track_genre TEXT,
  track_mood TEXT,
  playlist_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.recommendation_feedback ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own feedback"
  ON public.recommendation_feedback FOR SELECT
  USING (auth.uid() = user_id OR user_id IS NULL);

CREATE POLICY "Users can insert own feedback"
  ON public.recommendation_feedback FOR INSERT
  WITH CHECK (auth.uid() = user_id OR user_id IS NULL);

-- Indexes for performance
CREATE INDEX idx_rec_history_user ON public.recommendation_history(user_id);
CREATE INDEX idx_rec_history_playlist ON public.recommendation_history(playlist_id);
CREATE INDEX idx_rec_history_status ON public.recommendation_history(status);
CREATE INDEX idx_rec_feedback_user ON public.recommendation_feedback(user_id);
