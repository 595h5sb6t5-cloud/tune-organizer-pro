
-- Extend ai_track_analysis with v2 sonic profile fields (keeps v1 rows intact)

ALTER TABLE public.ai_track_analysis
  ADD COLUMN IF NOT EXISTS liked_song_id UUID REFERENCES public.liked_songs(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS spotify_track_id TEXT,
  ADD COLUMN IF NOT EXISTS track_name TEXT,
  ADD COLUMN IF NOT EXISTS artist_name TEXT,
  ADD COLUMN IF NOT EXISTS main_genre TEXT,
  ADD COLUMN IF NOT EXISTS secondary_genres_v2 TEXT[],
  ADD COLUMN IF NOT EXISTS tempo_feel TEXT,
  ADD COLUMN IF NOT EXISTS beat_style TEXT,
  ADD COLUMN IF NOT EXISTS energy_score REAL,
  ADD COLUMN IF NOT EXISTS melody_level REAL,
  ADD COLUMN IF NOT EXISTS bass_level REAL,
  ADD COLUMN IF NOT EXISTS drum_intensity REAL,
  ADD COLUMN IF NOT EXISTS vocal_intensity REAL,
  ADD COLUMN IF NOT EXISTS aggressiveness REAL,
  ADD COLUMN IF NOT EXISTS softness REAL,
  ADD COLUMN IF NOT EXISTS darkness REAL,
  ADD COLUMN IF NOT EXISTS nostalgia REAL,
  ADD COLUMN IF NOT EXISTS dance_feel REAL,
  ADD COLUMN IF NOT EXISTS emotional_intensity REAL,
  ADD COLUMN IF NOT EXISTS song_variation REAL,
  ADD COLUMN IF NOT EXISTS main_mood TEXT,
  ADD COLUMN IF NOT EXISTS secondary_moods_v2 TEXT[],
  ADD COLUMN IF NOT EXISTS sound_texture TEXT,
  ADD COLUMN IF NOT EXISTS instrumentation_summary TEXT,
  ADD COLUMN IF NOT EXISTS best_contexts_v2 TEXT[],
  ADD COLUMN IF NOT EXISTS compatible_playlist_types TEXT[],
  ADD COLUMN IF NOT EXISTS transition_in TEXT,
  ADD COLUMN IF NOT EXISTS transition_out TEXT,
  ADD COLUMN IF NOT EXISTS analysis_confidence REAL,
  ADD COLUMN IF NOT EXISTS full_analysis JSONB;

-- Backfill schema_version on existing rows (v1) then set default for future
UPDATE public.ai_track_analysis
  SET analysis_version = COALESCE(analysis_version, 'v1')
  WHERE analysis_version IS NULL;

ALTER TABLE public.ai_track_analysis
  ALTER COLUMN analysis_version SET DEFAULT 'v2';

-- Unique key so v1 and v2 rows can coexist per liked song
CREATE UNIQUE INDEX IF NOT EXISTS ai_track_analysis_user_liked_version_uidx
  ON public.ai_track_analysis (user_id, liked_song_id, analysis_version)
  WHERE liked_song_id IS NOT NULL;

-- Clustering indexes (numeric dimensions)
CREATE INDEX IF NOT EXISTS ai_track_analysis_energy_idx        ON public.ai_track_analysis (energy_score)        WHERE analysis_version = 'v2';
CREATE INDEX IF NOT EXISTS ai_track_analysis_darkness_idx      ON public.ai_track_analysis (darkness)             WHERE analysis_version = 'v2';
CREATE INDEX IF NOT EXISTS ai_track_analysis_dance_idx         ON public.ai_track_analysis (dance_feel)           WHERE analysis_version = 'v2';
CREATE INDEX IF NOT EXISTS ai_track_analysis_softness_idx      ON public.ai_track_analysis (softness)             WHERE analysis_version = 'v2';
CREATE INDEX IF NOT EXISTS ai_track_analysis_aggressive_idx    ON public.ai_track_analysis (aggressiveness)       WHERE analysis_version = 'v2';
CREATE INDEX IF NOT EXISTS ai_track_analysis_nostalgia_idx     ON public.ai_track_analysis (nostalgia)            WHERE analysis_version = 'v2';
CREATE INDEX IF NOT EXISTS ai_track_analysis_emotion_idx       ON public.ai_track_analysis (emotional_intensity)  WHERE analysis_version = 'v2';
CREATE INDEX IF NOT EXISTS ai_track_analysis_bass_idx          ON public.ai_track_analysis (bass_level)           WHERE analysis_version = 'v2';
CREATE INDEX IF NOT EXISTS ai_track_analysis_drums_idx         ON public.ai_track_analysis (drum_intensity)       WHERE analysis_version = 'v2';
CREATE INDEX IF NOT EXISTS ai_track_analysis_melody_idx        ON public.ai_track_analysis (melody_level)         WHERE analysis_version = 'v2';
CREATE INDEX IF NOT EXISTS ai_track_analysis_version_idx       ON public.ai_track_analysis (user_id, analysis_version);

-- Full-JSON GIN index for flexible querying
CREATE INDEX IF NOT EXISTS ai_track_analysis_full_gin_idx
  ON public.ai_track_analysis USING GIN (full_analysis);

-- Trigger to keep updated_at fresh
DROP TRIGGER IF EXISTS ai_track_analysis_updated_at ON public.ai_track_analysis;
CREATE TRIGGER ai_track_analysis_updated_at
  BEFORE UPDATE ON public.ai_track_analysis
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
