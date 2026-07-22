ALTER TABLE public.liked_songs
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS is_available boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS last_seen_sync_run_id uuid,
  ADD COLUMN IF NOT EXISTS deactivated_at timestamp with time zone;

ALTER TABLE public.imported_tracks
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS is_available boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS last_seen_sync_run_id uuid,
  ADD COLUMN IF NOT EXISTS deactivated_at timestamp with time zone;

CREATE INDEX IF NOT EXISTS idx_liked_songs_user_active_available
  ON public.liked_songs (user_id, is_active, is_available, added_at DESC);

CREATE INDEX IF NOT EXISTS idx_imported_tracks_user_active_available
  ON public.imported_tracks (user_id, is_active, is_available, added_at DESC);

CREATE TABLE IF NOT EXISTS public.sync_runs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  run_type text NOT NULL CHECK (run_type IN ('quick', 'full')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'waiting_rate_limit', 'completed', 'completed_with_restrictions', 'failed', 'canceled')),
  active_stage text,
  started_at timestamp with time zone NOT NULL DEFAULT now(),
  completed_at timestamp with time zone,
  locked_until timestamp with time zone,
  error_message text,
  retry_count integer NOT NULL DEFAULT 0,
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.sync_runs TO authenticated;
GRANT ALL ON public.sync_runs TO service_role;

ALTER TABLE public.sync_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own sync runs" ON public.sync_runs;
DROP POLICY IF EXISTS "Users can create own sync runs" ON public.sync_runs;
DROP POLICY IF EXISTS "Users can update own sync runs" ON public.sync_runs;
DROP POLICY IF EXISTS "Users can delete own sync runs" ON public.sync_runs;

CREATE POLICY "Users can view own sync runs"
ON public.sync_runs FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Users can create own sync runs"
ON public.sync_runs FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own sync runs"
ON public.sync_runs FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own sync runs"
ON public.sync_runs FOR DELETE
TO authenticated
USING (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS public.sync_run_stages (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  sync_run_id uuid NOT NULL REFERENCES public.sync_runs(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  stage_key text NOT NULL,
  label text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed', 'skipped')),
  started_at timestamp with time zone,
  completed_at timestamp with time zone,
  items_found integer NOT NULL DEFAULT 0,
  items_processed integer NOT NULL DEFAULT 0,
  items_created integer NOT NULL DEFAULT 0,
  items_updated integer NOT NULL DEFAULT 0,
  items_removed_or_deactivated integer NOT NULL DEFAULT 0,
  error_message text,
  retry_count integer NOT NULL DEFAULT 0,
  cursor_value text,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  order_index integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (sync_run_id, stage_key)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.sync_run_stages TO authenticated;
GRANT ALL ON public.sync_run_stages TO service_role;

ALTER TABLE public.sync_run_stages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own sync stages" ON public.sync_run_stages;
DROP POLICY IF EXISTS "Users can create own sync stages" ON public.sync_run_stages;
DROP POLICY IF EXISTS "Users can update own sync stages" ON public.sync_run_stages;
DROP POLICY IF EXISTS "Users can delete own sync stages" ON public.sync_run_stages;

CREATE POLICY "Users can view own sync stages"
ON public.sync_run_stages FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Users can create own sync stages"
ON public.sync_run_stages FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own sync stages"
ON public.sync_run_stages FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own sync stages"
ON public.sync_run_stages FOR DELETE
TO authenticated
USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_sync_runs_user_status_created
  ON public.sync_runs (user_id, status, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_full_sync_per_user
  ON public.sync_runs (user_id)
  WHERE run_type = 'full' AND status IN ('pending', 'running', 'waiting_rate_limit');

CREATE INDEX IF NOT EXISTS idx_sync_run_stages_run_order
  ON public.sync_run_stages (sync_run_id, order_index);

CREATE INDEX IF NOT EXISTS idx_sync_run_stages_user_status
  ON public.sync_run_stages (user_id, status, created_at DESC);

CREATE TRIGGER trg_sync_runs_updated
BEFORE UPDATE ON public.sync_runs
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER trg_sync_run_stages_updated
BEFORE UPDATE ON public.sync_run_stages
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.reconcile_liked_songs(
  _user_id uuid,
  _sync_run_id uuid,
  _tracks jsonb,
  _full_reconcile boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _now timestamp with time zone := now();
  _received_count integer := 0;
  _created_count integer := 0;
  _updated_count integer := 0;
  _removed_count integer := 0;
  _valid_total integer := 0;
BEGIN
  CREATE TEMP TABLE _incoming_liked_songs (
    user_id uuid NOT NULL,
    spotify_track_id text NOT NULL,
    track_name text NOT NULL,
    artist_name text NOT NULL,
    album_name text,
    image_url text,
    added_at timestamp with time zone,
    is_active boolean NOT NULL DEFAULT true,
    is_available boolean NOT NULL DEFAULT true,
    last_seen_sync_run_id uuid
  ) ON COMMIT DROP;

  INSERT INTO _incoming_liked_songs (
    user_id,
    spotify_track_id,
    track_name,
    artist_name,
    album_name,
    image_url,
    added_at,
    is_active,
    is_available,
    last_seen_sync_run_id
  )
  SELECT DISTINCT ON (spotify_track_id)
    _user_id,
    spotify_track_id,
    COALESCE(NULLIF(track_name, ''), 'Untitled'),
    COALESCE(artist_name, ''),
    album_name,
    image_url,
    added_at,
    true,
    true,
    _sync_run_id
  FROM jsonb_to_recordset(_tracks) AS x(
    spotify_track_id text,
    track_name text,
    artist_name text,
    album_name text,
    image_url text,
    added_at timestamp with time zone
  )
  WHERE spotify_track_id IS NOT NULL AND spotify_track_id <> ''
  ORDER BY spotify_track_id, added_at DESC NULLS LAST;

  GET DIAGNOSTICS _received_count = ROW_COUNT;

  SELECT count(*) INTO _created_count
  FROM _incoming_liked_songs i
  WHERE NOT EXISTS (
    SELECT 1 FROM public.liked_songs l
    WHERE l.user_id = _user_id AND l.spotify_track_id = i.spotify_track_id
  );

  INSERT INTO public.liked_songs (
    user_id,
    spotify_track_id,
    track_name,
    artist_name,
    album_name,
    image_url,
    added_at,
    is_active,
    is_available,
    last_seen_sync_run_id,
    deactivated_at
  )
  SELECT
    user_id,
    spotify_track_id,
    track_name,
    artist_name,
    album_name,
    image_url,
    added_at,
    true,
    true,
    _sync_run_id,
    NULL
  FROM _incoming_liked_songs
  ON CONFLICT (user_id, spotify_track_id) DO UPDATE SET
    track_name = EXCLUDED.track_name,
    artist_name = EXCLUDED.artist_name,
    album_name = EXCLUDED.album_name,
    image_url = EXCLUDED.image_url,
    added_at = EXCLUDED.added_at,
    is_active = true,
    is_available = true,
    last_seen_sync_run_id = _sync_run_id,
    deactivated_at = NULL;

  GET DIAGNOSTICS _updated_count = ROW_COUNT;
  _updated_count := GREATEST(_updated_count - _created_count, 0);

  INSERT INTO public.imported_tracks (
    user_id,
    spotify_track_id,
    track_name,
    artist_name,
    album_name,
    image_url,
    added_at,
    is_active,
    is_available,
    last_seen_sync_run_id,
    deactivated_at
  )
  SELECT
    user_id,
    spotify_track_id,
    track_name,
    artist_name,
    album_name,
    image_url,
    added_at,
    true,
    true,
    _sync_run_id,
    NULL
  FROM _incoming_liked_songs
  ON CONFLICT (user_id, spotify_track_id) DO UPDATE SET
    track_name = EXCLUDED.track_name,
    artist_name = EXCLUDED.artist_name,
    album_name = EXCLUDED.album_name,
    image_url = EXCLUDED.image_url,
    added_at = EXCLUDED.added_at,
    is_active = true,
    is_available = true,
    last_seen_sync_run_id = _sync_run_id,
    deactivated_at = NULL;

  IF _full_reconcile THEN
    UPDATE public.liked_songs l
    SET is_active = false,
        is_available = false,
        deactivated_at = _now
    WHERE l.user_id = _user_id
      AND l.is_active = true
      AND NOT EXISTS (
        SELECT 1 FROM _incoming_liked_songs i
        WHERE i.spotify_track_id = l.spotify_track_id
      );

    GET DIAGNOSTICS _removed_count = ROW_COUNT;

    UPDATE public.imported_tracks it
    SET is_active = false,
        is_available = false,
        deactivated_at = _now
    WHERE it.user_id = _user_id
      AND it.is_active = true
      AND NOT EXISTS (
        SELECT 1 FROM _incoming_liked_songs i
        WHERE i.spotify_track_id = it.spotify_track_id
      );
  END IF;

  SELECT count(DISTINCT spotify_track_id)
  INTO _valid_total
  FROM public.liked_songs
  WHERE user_id = _user_id
    AND is_active = true
    AND is_available = true;

  RETURN jsonb_build_object(
    'received_distinct', _received_count,
    'created', _created_count,
    'updated', _updated_count,
    'removed_or_deactivated', _removed_count,
    'valid_total', _valid_total
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.reconcile_liked_songs(uuid, uuid, jsonb, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_liked_songs(uuid, uuid, jsonb, boolean) TO service_role;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'sync_runs'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.sync_runs';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'sync_run_stages'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.sync_run_stages';
  END IF;
END$$;

ALTER TABLE public.sync_runs REPLICA IDENTITY FULL;
ALTER TABLE public.sync_run_stages REPLICA IDENTITY FULL;