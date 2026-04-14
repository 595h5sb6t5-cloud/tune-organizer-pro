
CREATE TABLE public.playlist_generation_jobs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed', 'canceled')),
  phase text NOT NULL DEFAULT 'queued' CHECK (phase IN ('queued', 'tagging', 'defining_worlds', 'assigning', 'saving', 'validating', 'done', 'failed')),
  force_retag boolean NOT NULL DEFAULT false,
  total_songs integer NOT NULL DEFAULT 0,
  total_analyzed integer NOT NULL DEFAULT 0,
  assigned_count integer NOT NULL DEFAULT 0,
  worlds_count integer NOT NULL DEFAULT 0,
  saved_worlds integer NOT NULL DEFAULT 0,
  total_worlds integer NOT NULL DEFAULT 0,
  status_message text,
  error_message text,
  world_definitions jsonb NOT NULL DEFAULT '[]'::jsonb,
  started_at timestamp with time zone,
  completed_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.playlist_generation_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own jobs" ON public.playlist_generation_jobs FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own jobs" ON public.playlist_generation_jobs FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own jobs" ON public.playlist_generation_jobs FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own jobs" ON public.playlist_generation_jobs FOR DELETE USING (auth.uid() = user_id);

CREATE TRIGGER update_playlist_generation_jobs_updated_at
  BEFORE UPDATE ON public.playlist_generation_jobs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_playlist_generation_jobs_user_status
  ON public.playlist_generation_jobs(user_id, status, created_at DESC);

ALTER PUBLICATION supabase_realtime ADD TABLE public.playlist_generation_jobs;
