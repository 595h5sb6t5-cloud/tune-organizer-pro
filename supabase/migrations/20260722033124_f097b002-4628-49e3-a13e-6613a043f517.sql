-- Extend sync_jobs to track deep-analysis progress in a way the UI can subscribe to.
ALTER TABLE public.sync_jobs
  ADD COLUMN IF NOT EXISTS stage text,
  ADD COLUMN IF NOT EXISTS meta jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Enable Realtime so the client hydrates progress live.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'sync_jobs'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.sync_jobs';
  END IF;
END$$;

-- Ensure UPDATEs carry full row payloads in realtime.
ALTER TABLE public.sync_jobs REPLICA IDENTITY FULL;

-- Index to quickly find the latest analysis job for a user.
CREATE INDEX IF NOT EXISTS idx_sj_user_type_created
  ON public.sync_jobs (user_id, job_type, created_at DESC);