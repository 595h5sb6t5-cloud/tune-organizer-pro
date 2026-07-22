
ALTER TABLE public.diagnostic_samples
  ADD COLUMN IF NOT EXISTS phase2_status text NOT NULL DEFAULT 'pending_analysis',
  ADD COLUMN IF NOT EXISTS phase2_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS phase2_finished_at timestamptz,
  ADD COLUMN IF NOT EXISTS phase2_progress jsonb,
  ADD COLUMN IF NOT EXISTS phase2_report jsonb,
  ADD COLUMN IF NOT EXISTS phase2_block_reason text;

CREATE INDEX IF NOT EXISTS idx_diagnostic_samples_phase2_status
  ON public.diagnostic_samples(user_id, phase2_status);

ALTER TABLE public.cluster_candidates
  ADD COLUMN IF NOT EXISTS phase text NOT NULL DEFAULT 'v2',
  ADD COLUMN IF NOT EXISTS sample_id uuid REFERENCES public.diagnostic_samples(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS name text,
  ADD COLUMN IF NOT EXISTS music_family text,
  ADD COLUMN IF NOT EXISTS dominant_subgenre text,
  ADD COLUMN IF NOT EXISTS avg_final_fit real,
  ADD COLUMN IF NOT EXISTS min_final_fit real;

CREATE INDEX IF NOT EXISTS idx_cluster_candidates_sample
  ON public.cluster_candidates(sample_id, phase);

ALTER TABLE public.cluster_candidate_tracks
  ADD COLUMN IF NOT EXISTS sonic_fit real,
  ADD COLUMN IF NOT EXISTS subgenre_fit real,
  ADD COLUMN IF NOT EXISTS artist_context_fit real,
  ADD COLUMN IF NOT EXISTS scene_distance real,
  ADD COLUMN IF NOT EXISTS skip_risk real,
  ADD COLUMN IF NOT EXISTS transition_fit real,
  ADD COLUMN IF NOT EXISTS artist_context_penalty real,
  ADD COLUMN IF NOT EXISTS final_fit real,
  ADD COLUMN IF NOT EXISTS is_artist_surprise boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS gate_flags jsonb;

ALTER TABLE public.unassigned_tracks
  ADD COLUMN IF NOT EXISTS sample_id uuid REFERENCES public.diagnostic_samples(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS phase text,
  ADD COLUMN IF NOT EXISTS details jsonb;
