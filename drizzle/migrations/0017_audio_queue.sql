CREATE OR REPLACE FUNCTION public.audio_queue(_limit int, _ids text[] DEFAULT NULL)
RETURNS TABLE (spotify_track_id text, isrc text, track_name text, artist_name text, electronic boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT DISTINCT ON (q.spotify_track_id) q.spotify_track_id, q.isrc, q.track_name, q.artist_name, q.electronic FROM (
    SELECT l.spotify_track_id, l.isrc, l.track_name, l.artist_name,
      (g.family = 'electronic' OR g.scene IS NOT NULL) AS electronic, l.added_at
    FROM public.liked_songs l
    LEFT JOIN public.track_analysis_global g ON g.spotify_track_id = l.spotify_track_id
    LEFT JOIN public.track_audio_analysis a ON a.spotify_track_id = l.spotify_track_id
    WHERE l.is_active AND a.spotify_track_id IS NULL
      AND (_ids IS NULL OR l.spotify_track_id = ANY(_ids))
  ) q
  ORDER BY q.spotify_track_id
  LIMIT 100000
$$;
CREATE OR REPLACE FUNCTION public.audio_queue_next(_limit int)
RETURNS TABLE (spotify_track_id text, isrc text, track_name text, artist_name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT x.spotify_track_id, x.isrc, x.track_name, x.artist_name FROM public.audio_queue(100000) x
  ORDER BY x.electronic DESC NULLS LAST, x.spotify_track_id LIMIT _limit
$$;
CREATE OR REPLACE FUNCTION public.audio_queue_count()
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT count(*)::int FROM public.audio_queue(100000)
$$;
REVOKE ALL ON FUNCTION public.audio_queue(int, text[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.audio_queue_next(int) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.audio_queue_count() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.audio_queue(int, text[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.audio_queue_next(int) TO service_role;
GRANT EXECUTE ON FUNCTION public.audio_queue_count() TO service_role;