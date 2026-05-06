ALTER TABLE public.playlist_generation_jobs
DROP CONSTRAINT IF EXISTS playlist_generation_jobs_status_check;

ALTER TABLE public.playlist_generation_jobs
ADD CONSTRAINT playlist_generation_jobs_status_check
CHECK (status IN ('pending','running','completed','failed','cancelled','paused_waiting_for_next_chunk'));