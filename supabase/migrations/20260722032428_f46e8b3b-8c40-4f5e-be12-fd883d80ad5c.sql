
-- Versioning columns on ai_track_analysis
ALTER TABLE public.ai_track_analysis
  ADD COLUMN IF NOT EXISTS prompt_version TEXT,
  ADD COLUMN IF NOT EXISTS schema_version TEXT,
  ADD COLUMN IF NOT EXISTS reasoning_mode TEXT,
  ADD COLUMN IF NOT EXISTS analysis_stage TEXT DEFAULT 'deep',
  ADD COLUMN IF NOT EXISTS retry_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_error TEXT;

-- Backfill existing v1 rows to a known prompt/schema version so cache lookups work
UPDATE public.ai_track_analysis
   SET prompt_version = COALESCE(prompt_version, 'v1-legacy'),
       schema_version = COALESCE(schema_version, 'v1-legacy')
 WHERE prompt_version IS NULL OR schema_version IS NULL;

-- Cache lookup index: quickly find "already analyzed with same prompt+schema+model"
CREATE INDEX IF NOT EXISTS ai_track_analysis_cache_idx
  ON public.ai_track_analysis (user_id, spotify_track_id, analysis_version, prompt_version, schema_version, model_used);

CREATE INDEX IF NOT EXISTS ai_track_analysis_stage_idx
  ON public.ai_track_analysis (user_id, analysis_stage);

-- Benchmarks table (before/after profiling)
CREATE TABLE IF NOT EXISTS public.analysis_benchmarks (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  label TEXT NOT NULL,                       -- 'baseline', 'optimized', 'test-run', etc.
  model_used TEXT NOT NULL,
  prompt_version TEXT,
  schema_version TEXT,
  sample_size INT NOT NULL,
  concurrency INT,
  total_ms INT NOT NULL,
  avg_ms_per_track NUMERIC,
  openai_calls INT NOT NULL DEFAULT 0,
  cache_hits INT NOT NULL DEFAULT 0,
  cache_hit_pct NUMERIC,
  json_errors INT NOT NULL DEFAULT 0,
  retries INT NOT NULL DEFAULT 0,
  total_prompt_tokens INT NOT NULL DEFAULT 0,
  total_completion_tokens INT NOT NULL DEFAULT 0,
  total_reasoning_tokens INT NOT NULL DEFAULT 0,
  cached_prompt_tokens INT NOT NULL DEFAULT 0,
  per_stage_ms JSONB,        -- { t_db_read, t_prompt_build, t_openai, t_validate, t_db_write }
  per_track_ms JSONB,        -- array of per-track ms
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.analysis_benchmarks TO authenticated;
GRANT ALL ON public.analysis_benchmarks TO service_role;
ALTER TABLE public.analysis_benchmarks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own benchmarks"
  ON public.analysis_benchmarks FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users insert own benchmarks"
  ON public.analysis_benchmarks FOR INSERT
  WITH CHECK (auth.uid() = user_id);
