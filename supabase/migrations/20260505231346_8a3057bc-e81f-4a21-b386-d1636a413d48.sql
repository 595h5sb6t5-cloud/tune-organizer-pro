
CREATE TABLE public.user_top_tracks (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  track_id UUID NOT NULL REFERENCES public.tracks(id) ON DELETE CASCADE,
  time_range TEXT NOT NULL,
  rank INTEGER NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, time_range, track_id)
);
ALTER TABLE public.user_top_tracks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "utt sel" ON public.user_top_tracks FOR SELECT USING (auth.uid()=user_id);
CREATE POLICY "utt ins" ON public.user_top_tracks FOR INSERT WITH CHECK (auth.uid()=user_id);
CREATE POLICY "utt del" ON public.user_top_tracks FOR DELETE USING (auth.uid()=user_id);

CREATE TABLE public.user_top_artists (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  artist_id UUID NOT NULL REFERENCES public.artists(id) ON DELETE CASCADE,
  time_range TEXT NOT NULL,
  rank INTEGER NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, time_range, artist_id)
);
ALTER TABLE public.user_top_artists ENABLE ROW LEVEL SECURITY;
CREATE POLICY "uta sel" ON public.user_top_artists FOR SELECT USING (auth.uid()=user_id);
CREATE POLICY "uta ins" ON public.user_top_artists FOR INSERT WITH CHECK (auth.uid()=user_id);
CREATE POLICY "uta del" ON public.user_top_artists FOR DELETE USING (auth.uid()=user_id);

CREATE TABLE public.user_recent_plays (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  track_id UUID NOT NULL REFERENCES public.tracks(id) ON DELETE CASCADE,
  played_at TIMESTAMPTZ NOT NULL,
  context_uri TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, track_id, played_at)
);
ALTER TABLE public.user_recent_plays ENABLE ROW LEVEL SECURITY;
CREATE POLICY "urp sel" ON public.user_recent_plays FOR SELECT USING (auth.uid()=user_id);
CREATE POLICY "urp ins" ON public.user_recent_plays FOR INSERT WITH CHECK (auth.uid()=user_id);
CREATE POLICY "urp del" ON public.user_recent_plays FOR DELETE USING (auth.uid()=user_id);

CREATE INDEX idx_urp_user_played ON public.user_recent_plays(user_id, played_at DESC);
