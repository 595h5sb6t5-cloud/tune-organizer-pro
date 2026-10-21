ALTER TABLE public.track_audio_analysis ADD COLUMN IF NOT EXISTS drum_sound text, ADD COLUMN IF NOT EXISTS mix_character text, ADD COLUMN IF NOT EXISTS vocal_space text;
CREATE TABLE public.vibe_priority_leases (user_id uuid NOT NULL, run_id uuid NOT NULL, expires_at timestamptz NOT NULL DEFAULT (now() + interval '30 seconds'), PRIMARY KEY (user_id, run_id));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vibe_priority_leases TO authenticated;
GRANT ALL ON public.vibe_priority_leases TO service_role;
ALTER TABLE public.vibe_priority_leases ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own vibe priority" ON public.vibe_priority_leases FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE OR REPLACE FUNCTION public.audio_queue(_limit integer, _ids text[] DEFAULT NULL::text[])
RETURNS TABLE(spotify_track_id text, isrc text, track_name text, artist_name text, electronic boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
 SELECT DISTINCT ON (l.spotify_track_id) l.spotify_track_id, l.isrc, l.track_name, l.artist_name, (g.family = 'electronic' OR g.scene IS NOT NULL) AS electronic
 FROM public.liked_songs l LEFT JOIN public.track_analysis_global g USING (spotify_track_id) LEFT JOIN public.track_audio_analysis a USING (spotify_track_id)
 WHERE l.is_active AND l.is_available AND (a.spotify_track_id IS NULL OR a.production_era IS NULL OR a.drum_sound IS NULL OR a.mix_character IS NULL OR a.vocal_space IS NULL)
 AND (_ids IS NULL OR l.spotify_track_id = ANY(_ids)) ORDER BY l.spotify_track_id LIMIT greatest(1, least(_limit, 100000))
$$;
REVOKE ALL ON FUNCTION public.audio_queue(integer,text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.audio_queue(integer,text[]) TO service_role;