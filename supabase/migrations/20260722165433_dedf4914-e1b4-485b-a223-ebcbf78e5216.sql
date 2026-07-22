
CREATE TABLE public.cluster_candidates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'candidate',
  centroid JSONB,
  avg_compat REAL,
  min_compat REAL,
  size INTEGER NOT NULL DEFAULT 0,
  dominant_dimensions JSONB,
  sonic_summary TEXT,
  language_group TEXT,
  rejection_reason TEXT,
  promoted_playlist_id UUID,
  run_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cluster_candidates TO authenticated;
GRANT ALL ON public.cluster_candidates TO service_role;
ALTER TABLE public.cluster_candidates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own cluster_candidates" ON public.cluster_candidates FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER cluster_candidates_updated BEFORE UPDATE ON public.cluster_candidates FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE INDEX idx_cluster_candidates_user_status ON public.cluster_candidates(user_id, status);

CREATE TABLE public.cluster_candidate_tracks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cluster_id UUID NOT NULL REFERENCES public.cluster_candidates(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  spotify_track_id TEXT NOT NULL,
  compat_to_centroid REAL,
  position INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cluster_candidate_tracks TO authenticated;
GRANT ALL ON public.cluster_candidate_tracks TO service_role;
ALTER TABLE public.cluster_candidate_tracks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own cluster_candidate_tracks" ON public.cluster_candidate_tracks FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX idx_cluster_tracks_cluster ON public.cluster_candidate_tracks(cluster_id);
CREATE INDEX idx_cluster_tracks_user ON public.cluster_candidate_tracks(user_id);

CREATE TABLE public.unassigned_tracks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  spotify_track_id TEXT NOT NULL,
  last_run_id UUID,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, spotify_track_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.unassigned_tracks TO authenticated;
GRANT ALL ON public.unassigned_tracks TO service_role;
ALTER TABLE public.unassigned_tracks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own unassigned_tracks" ON public.unassigned_tracks FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER unassigned_tracks_updated BEFORE UPDATE ON public.unassigned_tracks FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.generated_playlists
  ADD COLUMN IF NOT EXISTS avg_compat REAL,
  ADD COLUMN IF NOT EXISTS min_compat REAL,
  ADD COLUMN IF NOT EXISTS dimensions_summary JSONB,
  ADD COLUMN IF NOT EXISTS source_cluster_id UUID;
