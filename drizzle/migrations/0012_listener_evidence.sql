CREATE TABLE public.listener_evidence (
  user_id uuid NOT NULL,
  spotify_track_id text NOT NULL,
  tags jsonb,
  tag_source text,
  lastfm_checked boolean NOT NULL DEFAULT false,
  youtube_summary text,
  youtube_checked boolean NOT NULL DEFAULT false,
  evidence_applied boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, spotify_track_id)
);
GRANT SELECT ON public.listener_evidence TO authenticated;
GRANT ALL ON public.listener_evidence TO service_role;
ALTER TABLE public.listener_evidence ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own listener evidence" ON public.listener_evidence FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE TABLE public.listener_evidence_state (
  user_id uuid PRIMARY KEY,
  status text NOT NULL DEFAULT 'idle',
  lease_until timestamptz,
  youtube_day date,
  youtube_searches_today integer NOT NULL DEFAULT 0,
  youtube_paused_until timestamptz,
  error text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.listener_evidence_state TO authenticated;
GRANT ALL ON public.listener_evidence_state TO service_role;
ALTER TABLE public.listener_evidence_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own listener state" ON public.listener_evidence_state FOR SELECT TO authenticated USING (auth.uid() = user_id);