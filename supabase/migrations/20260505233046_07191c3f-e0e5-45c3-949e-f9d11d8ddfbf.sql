ALTER TABLE public.generated_playlists
  ADD COLUMN IF NOT EXISTS snapshot_id text,
  ADD COLUMN IF NOT EXISTS is_public boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS last_export_error text,
  ADD COLUMN IF NOT EXISTS last_export_step text,
  ADD COLUMN IF NOT EXISTS exported_at timestamptz;