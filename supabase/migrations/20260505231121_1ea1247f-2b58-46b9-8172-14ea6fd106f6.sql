
-- Tracks
DROP POLICY IF EXISTS "tracks insert auth" ON public.tracks;
DROP POLICY IF EXISTS "tracks update auth" ON public.tracks;
CREATE POLICY "tracks insert auth" ON public.tracks FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "tracks update auth" ON public.tracks FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

-- Artists
DROP POLICY IF EXISTS "artists insert auth" ON public.artists;
DROP POLICY IF EXISTS "artists update auth" ON public.artists;
CREATE POLICY "artists insert auth" ON public.artists FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "artists update auth" ON public.artists FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

-- Albums
DROP POLICY IF EXISTS "albums insert auth" ON public.albums;
DROP POLICY IF EXISTS "albums update auth" ON public.albums;
CREATE POLICY "albums insert auth" ON public.albums FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "albums update auth" ON public.albums FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
