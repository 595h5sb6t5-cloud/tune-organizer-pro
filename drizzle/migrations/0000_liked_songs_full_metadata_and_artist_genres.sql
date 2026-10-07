ALTER TABLE public.liked_songs
  ADD COLUMN IF NOT EXISTS explicit boolean,
  ADD COLUMN IF NOT EXISTS duration_ms integer,
  ADD COLUMN IF NOT EXISTS artists jsonb,
  ADD COLUMN IF NOT EXISTS album_id text,
  ADD COLUMN IF NOT EXISTS album_release_date text,
  ADD COLUMN IF NOT EXISTS isrc text;

CREATE TABLE IF NOT EXISTS public.artist_genres (
  artist_id text PRIMARY KEY,
  genres text[] NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.artist_genres TO authenticated;
GRANT ALL ON public.artist_genres TO service_role;
ALTER TABLE public.artist_genres ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Signed-in users can read artist genres" ON public.artist_genres FOR SELECT TO authenticated USING (true);

CREATE OR REPLACE FUNCTION public.reconcile_liked_songs(_user_id uuid, _sync_run_id uuid, _tracks jsonb, _full_reconcile boolean DEFAULT true)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  _now timestamptz := now();
  _received_count integer := 0; _created_count integer := 0; _updated_count integer := 0;
  _removed_count integer := 0; _valid_total integer := 0;
BEGIN
  CREATE TEMP TABLE _incoming_liked_songs ON COMMIT DROP AS
  SELECT DISTINCT ON (spotify_track_id)
    spotify_track_id,
    COALESCE(NULLIF(track_name, ''), 'Untitled') AS track_name,
    COALESCE(artist_name, '') AS artist_name,
    album_name, image_url, added_at, explicit, duration_ms, artists, album_id, album_release_date, isrc
  FROM jsonb_to_recordset(_tracks) AS x(
    spotify_track_id text, track_name text, artist_name text, album_name text, image_url text,
    added_at timestamptz, explicit boolean, duration_ms integer, artists jsonb, album_id text,
    album_release_date text, isrc text)
  WHERE spotify_track_id IS NOT NULL AND spotify_track_id <> ''
  ORDER BY spotify_track_id, added_at DESC NULLS LAST;

  SELECT count(*) INTO _received_count FROM _incoming_liked_songs;
  SELECT count(*) INTO _created_count FROM _incoming_liked_songs i
  WHERE NOT EXISTS (SELECT 1 FROM public.liked_songs l WHERE l.user_id = _user_id AND l.spotify_track_id = i.spotify_track_id);

  INSERT INTO public.liked_songs (user_id, spotify_track_id, track_name, artist_name, album_name, image_url, added_at,
    explicit, duration_ms, artists, album_id, album_release_date, isrc,
    is_active, is_available, last_seen_sync_run_id, deactivated_at)
  SELECT _user_id, spotify_track_id, track_name, artist_name, album_name, image_url, added_at,
    explicit, duration_ms, artists, album_id, album_release_date, isrc, true, true, _sync_run_id, NULL
  FROM _incoming_liked_songs
  ON CONFLICT (user_id, spotify_track_id) DO UPDATE SET
    track_name = EXCLUDED.track_name, artist_name = EXCLUDED.artist_name, album_name = EXCLUDED.album_name,
    image_url = EXCLUDED.image_url, added_at = EXCLUDED.added_at,
    explicit = COALESCE(EXCLUDED.explicit, liked_songs.explicit),
    duration_ms = COALESCE(EXCLUDED.duration_ms, liked_songs.duration_ms),
    artists = COALESCE(EXCLUDED.artists, liked_songs.artists),
    album_id = COALESCE(EXCLUDED.album_id, liked_songs.album_id),
    album_release_date = COALESCE(EXCLUDED.album_release_date, liked_songs.album_release_date),
    isrc = COALESCE(EXCLUDED.isrc, liked_songs.isrc),
    is_active = true, is_available = true, last_seen_sync_run_id = _sync_run_id, deactivated_at = NULL;
  GET DIAGNOSTICS _updated_count = ROW_COUNT;
  _updated_count := GREATEST(_updated_count - _created_count, 0);

  INSERT INTO public.imported_tracks (user_id, spotify_track_id, track_name, artist_name, album_name, image_url, added_at,
    is_active, is_available, last_seen_sync_run_id, deactivated_at)
  SELECT _user_id, spotify_track_id, track_name, artist_name, album_name, image_url, added_at, true, true, _sync_run_id, NULL
  FROM _incoming_liked_songs
  ON CONFLICT (user_id, spotify_track_id) DO UPDATE SET
    track_name = EXCLUDED.track_name, artist_name = EXCLUDED.artist_name, album_name = EXCLUDED.album_name,
    image_url = EXCLUDED.image_url, added_at = EXCLUDED.added_at, is_active = true, is_available = true,
    last_seen_sync_run_id = _sync_run_id, deactivated_at = NULL;

  IF _full_reconcile THEN
    UPDATE public.liked_songs l SET is_active = false, is_available = false, deactivated_at = _now
    WHERE l.user_id = _user_id AND l.is_active = true
      AND NOT EXISTS (SELECT 1 FROM _incoming_liked_songs i WHERE i.spotify_track_id = l.spotify_track_id);
    GET DIAGNOSTICS _removed_count = ROW_COUNT;
    UPDATE public.imported_tracks it SET is_active = false, is_available = false, deactivated_at = _now
    WHERE it.user_id = _user_id AND it.is_active = true
      AND NOT EXISTS (SELECT 1 FROM _incoming_liked_songs i WHERE i.spotify_track_id = it.spotify_track_id);
  END IF;

  SELECT count(DISTINCT spotify_track_id) INTO _valid_total FROM public.liked_songs
  WHERE user_id = _user_id AND is_active = true AND is_available = true;

  RETURN jsonb_build_object('received_distinct', _received_count, 'created', _created_count, 'updated', _updated_count,
    'removed_or_deactivated', _removed_count, 'valid_total', _valid_total);
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.reconcile_liked_songs(uuid, uuid, jsonb, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_liked_songs(uuid, uuid, jsonb, boolean) TO service_role;