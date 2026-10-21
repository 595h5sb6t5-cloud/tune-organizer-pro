ALTER TABLE public.track_audio_analysis
  ADD COLUMN IF NOT EXISTS production_era text,
  ADD COLUMN IF NOT EXISTS vocal_style text,
  ADD COLUMN IF NOT EXISTS lyric_theme text;

CREATE OR REPLACE FUNCTION public.audio_queue(_limit integer, _ids text[] DEFAULT NULL::text[])
RETURNS TABLE(spotify_track_id text, isrc text, track_name text, artist_name text, electronic boolean)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT DISTINCT ON (q.spotify_track_id) q.spotify_track_id, q.isrc, q.track_name, q.artist_name, q.electronic FROM (
    SELECT l.spotify_track_id, l.isrc, l.track_name, l.artist_name,
      (g.family = 'electronic' OR g.scene IS NOT NULL) AS electronic, l.added_at
    FROM public.liked_songs l
    LEFT JOIN public.track_analysis_global g ON g.spotify_track_id = l.spotify_track_id
    LEFT JOIN public.track_audio_analysis a ON a.spotify_track_id = l.spotify_track_id
    WHERE l.is_active AND (a.spotify_track_id IS NULL OR a.production_era IS NULL)
      AND (_ids IS NULL OR l.spotify_track_id = ANY(_ids))
  ) q
  ORDER BY q.spotify_track_id
  LIMIT 100000
$function$;