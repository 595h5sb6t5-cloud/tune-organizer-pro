CREATE TABLE public.track_ai_classification (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  spotify_track_id text NOT NULL,
  lang text NOT NULL,
  energy real NOT NULL,
  valence real NOT NULL,
  danceability real NOT NULL,
  tempo real NOT NULL,
  mood text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, spotify_track_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.track_ai_classification TO authenticated;
GRANT ALL ON public.track_ai_classification TO service_role;
ALTER TABLE public.track_ai_classification ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own classifications" ON public.track_ai_classification FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users insert own classifications" ON public.track_ai_classification FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own classifications" ON public.track_ai_classification FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users delete own classifications" ON public.track_ai_classification FOR DELETE TO authenticated USING (auth.uid() = user_id);