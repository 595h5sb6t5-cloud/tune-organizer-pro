
-- ============================================================
-- APP USERS (extended profile, separate from existing 'profiles')
-- ============================================================
CREATE TABLE public.app_users (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  spotify_user_id TEXT UNIQUE,
  display_name TEXT,
  email TEXT,
  profile_image_url TEXT,
  country TEXT,
  product_type TEXT,
  subscription_tier TEXT NOT NULL DEFAULT 'free',
  spotify_access_token_encrypted TEXT,
  spotify_refresh_token_encrypted TEXT,
  token_expires_at TIMESTAMPTZ,
  last_sync_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.app_users ENABLE ROW LEVEL SECURITY;
CREATE POLICY "app_users self select" ON public.app_users FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "app_users self insert" ON public.app_users FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "app_users self update" ON public.app_users FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "app_users self delete" ON public.app_users FOR DELETE USING (auth.uid() = user_id);

-- ============================================================
-- ARTISTS (global catalog)
-- ============================================================
CREATE TABLE public.artists (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  spotify_artist_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  genres TEXT[] NOT NULL DEFAULT '{}',
  popularity INTEGER,
  followers_count INTEGER,
  image_url TEXT,
  spotify_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.artists ENABLE ROW LEVEL SECURITY;
CREATE POLICY "artists read all auth" ON public.artists FOR SELECT TO authenticated USING (true);
CREATE POLICY "artists insert auth" ON public.artists FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "artists update auth" ON public.artists FOR UPDATE TO authenticated USING (true);

-- ============================================================
-- ALBUMS (global catalog)
-- ============================================================
CREATE TABLE public.albums (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  spotify_album_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  artist_names TEXT[] NOT NULL DEFAULT '{}',
  release_date TEXT,
  album_type TEXT,
  total_tracks INTEGER,
  image_url TEXT,
  spotify_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.albums ENABLE ROW LEVEL SECURITY;
CREATE POLICY "albums read all auth" ON public.albums FOR SELECT TO authenticated USING (true);
CREATE POLICY "albums insert auth" ON public.albums FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "albums update auth" ON public.albums FOR UPDATE TO authenticated USING (true);

-- ============================================================
-- TRACKS (global catalog)
-- ============================================================
CREATE TABLE public.tracks (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  spotify_track_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  artist_names TEXT[] NOT NULL DEFAULT '{}',
  album_name TEXT,
  album_id UUID REFERENCES public.albums(id) ON DELETE SET NULL,
  duration_ms INTEGER,
  explicit BOOLEAN NOT NULL DEFAULT false,
  popularity INTEGER,
  preview_url TEXT,
  spotify_url TEXT,
  release_date TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.tracks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tracks read all auth" ON public.tracks FOR SELECT TO authenticated USING (true);
CREATE POLICY "tracks insert auth" ON public.tracks FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "tracks update auth" ON public.tracks FOR UPDATE TO authenticated USING (true);
CREATE INDEX idx_tracks_album_id ON public.tracks(album_id);

-- ============================================================
-- USER SAVED TRACKS (liked songs join)
-- ============================================================
CREATE TABLE public.user_saved_tracks (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  track_id UUID NOT NULL REFERENCES public.tracks(id) ON DELETE CASCADE,
  added_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, track_id)
);
ALTER TABLE public.user_saved_tracks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ust select" ON public.user_saved_tracks FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "ust insert" ON public.user_saved_tracks FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "ust update" ON public.user_saved_tracks FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "ust delete" ON public.user_saved_tracks FOR DELETE USING (auth.uid() = user_id);
CREATE INDEX idx_ust_user ON public.user_saved_tracks(user_id);
CREATE INDEX idx_ust_track ON public.user_saved_tracks(track_id);

-- ============================================================
-- USER FOLLOWED ARTISTS
-- ============================================================
CREATE TABLE public.user_followed_artists (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  artist_id UUID NOT NULL REFERENCES public.artists(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, artist_id)
);
ALTER TABLE public.user_followed_artists ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ufa select" ON public.user_followed_artists FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "ufa insert" ON public.user_followed_artists FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "ufa delete" ON public.user_followed_artists FOR DELETE USING (auth.uid() = user_id);
CREATE INDEX idx_ufa_user ON public.user_followed_artists(user_id);

-- ============================================================
-- USER SAVED ALBUMS
-- ============================================================
CREATE TABLE public.user_saved_albums (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  album_id UUID NOT NULL REFERENCES public.albums(id) ON DELETE CASCADE,
  added_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, album_id)
);
ALTER TABLE public.user_saved_albums ENABLE ROW LEVEL SECURITY;
CREATE POLICY "usa select" ON public.user_saved_albums FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "usa insert" ON public.user_saved_albums FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "usa delete" ON public.user_saved_albums FOR DELETE USING (auth.uid() = user_id);
CREATE INDEX idx_usa_user ON public.user_saved_albums(user_id);

-- ============================================================
-- SPOTIFY PLAYLISTS (V2 — normalized)
-- ============================================================
CREATE TABLE public.spotify_playlists_v2 (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  spotify_playlist_id TEXT NOT NULL,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  owner_spotify_id TEXT,
  is_owner BOOLEAN NOT NULL DEFAULT false,
  is_collaborative BOOLEAN NOT NULL DEFAULT false,
  is_public BOOLEAN NOT NULL DEFAULT false,
  total_tracks INTEGER NOT NULL DEFAULT 0,
  image_url TEXT,
  spotify_url TEXT,
  snapshot_id TEXT,
  last_synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, spotify_playlist_id)
);
ALTER TABLE public.spotify_playlists_v2 ENABLE ROW LEVEL SECURITY;
CREATE POLICY "spv2 select" ON public.spotify_playlists_v2 FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "spv2 insert" ON public.spotify_playlists_v2 FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "spv2 update" ON public.spotify_playlists_v2 FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "spv2 delete" ON public.spotify_playlists_v2 FOR DELETE USING (auth.uid() = user_id);
CREATE INDEX idx_spv2_user ON public.spotify_playlists_v2(user_id);

-- ============================================================
-- PLAYLIST TRACKS
-- ============================================================
CREATE TABLE public.playlist_tracks (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  playlist_id UUID NOT NULL REFERENCES public.spotify_playlists_v2(id) ON DELETE CASCADE,
  track_id UUID NOT NULL REFERENCES public.tracks(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  added_at TIMESTAMPTZ,
  added_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(playlist_id, track_id, position)
);
ALTER TABLE public.playlist_tracks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pt select" ON public.playlist_tracks FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "pt insert" ON public.playlist_tracks FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "pt update" ON public.playlist_tracks FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "pt delete" ON public.playlist_tracks FOR DELETE USING (auth.uid() = user_id);
CREATE INDEX idx_pt_playlist ON public.playlist_tracks(playlist_id);
CREATE INDEX idx_pt_track ON public.playlist_tracks(track_id);

-- ============================================================
-- AI TRACK ANALYSIS
-- ============================================================
CREATE TABLE public.ai_track_analysis (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  track_id UUID NOT NULL REFERENCES public.tracks(id) ON DELETE CASCADE,
  primary_genre TEXT,
  secondary_genres TEXT[] NOT NULL DEFAULT '{}',
  language TEXT,
  moods TEXT[] NOT NULL DEFAULT '{}',
  energy_level TEXT,
  rhythm_type TEXT,
  vibe_tags TEXT[] NOT NULL DEFAULT '{}',
  best_contexts TEXT[] NOT NULL DEFAULT '{}',
  playlist_fit JSONB NOT NULL DEFAULT '{}'::jsonb,
  compatibility_notes TEXT,
  avoid_pairing_with TEXT[] NOT NULL DEFAULT '{}',
  confidence_score REAL,
  model_used TEXT,
  analysis_version TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, track_id)
);
ALTER TABLE public.ai_track_analysis ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ata select" ON public.ai_track_analysis FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "ata insert" ON public.ai_track_analysis FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "ata update" ON public.ai_track_analysis FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "ata delete" ON public.ai_track_analysis FOR DELETE USING (auth.uid() = user_id);
CREATE INDEX idx_ata_user ON public.ai_track_analysis(user_id);
CREATE INDEX idx_ata_track ON public.ai_track_analysis(track_id);

-- ============================================================
-- GENERATED PLAYLISTS
-- ============================================================
CREATE TABLE public.generated_playlists (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  spotify_playlist_id TEXT,
  name TEXT NOT NULL,
  description TEXT,
  concept TEXT,
  vibe TEXT,
  context TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  is_exported_to_spotify BOOLEAN NOT NULL DEFAULT false,
  spotify_url TEXT,
  cover_image_url TEXT,
  created_by_ai BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.generated_playlists ENABLE ROW LEVEL SECURITY;
CREATE POLICY "gp select" ON public.generated_playlists FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "gp insert" ON public.generated_playlists FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "gp update" ON public.generated_playlists FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "gp delete" ON public.generated_playlists FOR DELETE USING (auth.uid() = user_id);
CREATE INDEX idx_gp_user ON public.generated_playlists(user_id);

-- ============================================================
-- GENERATED PLAYLIST TRACKS
-- ============================================================
CREATE TABLE public.generated_playlist_tracks (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  generated_playlist_id UUID NOT NULL REFERENCES public.generated_playlists(id) ON DELETE CASCADE,
  track_id UUID NOT NULL REFERENCES public.tracks(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  reason_for_inclusion TEXT,
  fit_score REAL,
  added_by TEXT NOT NULL DEFAULT 'ai',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(generated_playlist_id, track_id)
);
ALTER TABLE public.generated_playlist_tracks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "gpt select" ON public.generated_playlist_tracks FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "gpt insert" ON public.generated_playlist_tracks FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "gpt update" ON public.generated_playlist_tracks FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "gpt delete" ON public.generated_playlist_tracks FOR DELETE USING (auth.uid() = user_id);
CREATE INDEX idx_gpt_playlist ON public.generated_playlist_tracks(generated_playlist_id);

-- ============================================================
-- RECOMMENDATIONS
-- ============================================================
CREATE TABLE public.recommendations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  track_id UUID NOT NULL REFERENCES public.tracks(id) ON DELETE CASCADE,
  based_on_playlist_id UUID REFERENCES public.spotify_playlists_v2(id) ON DELETE SET NULL,
  recommendation_reason TEXT,
  fit_score REAL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.recommendations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rec select" ON public.recommendations FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "rec insert" ON public.recommendations FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "rec update" ON public.recommendations FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "rec delete" ON public.recommendations FOR DELETE USING (auth.uid() = user_id);
CREATE INDEX idx_rec_user ON public.recommendations(user_id);

-- ============================================================
-- SYNC JOBS
-- ============================================================
CREATE TABLE public.sync_jobs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  job_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  error_message TEXT,
  items_processed INTEGER NOT NULL DEFAULT 0,
  total_items INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.sync_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sj select" ON public.sync_jobs FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "sj insert" ON public.sync_jobs FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "sj update" ON public.sync_jobs FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "sj delete" ON public.sync_jobs FOR DELETE USING (auth.uid() = user_id);
CREATE INDEX idx_sj_user ON public.sync_jobs(user_id);

-- ============================================================
-- USER SUBSCRIPTION
-- ============================================================
CREATE TABLE public.user_subscription (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  plan TEXT NOT NULL DEFAULT 'free',
  song_analysis_limit INTEGER NOT NULL DEFAULT 500,
  playlists_limit INTEGER NOT NULL DEFAULT 10,
  recommendations_limit INTEGER NOT NULL DEFAULT 50,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.user_subscription ENABLE ROW LEVEL SECURITY;
CREATE POLICY "us select" ON public.user_subscription FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "us insert" ON public.user_subscription FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "us update" ON public.user_subscription FOR UPDATE USING (auth.uid() = user_id);

-- ============================================================
-- TIMESTAMPS TRIGGERS
-- ============================================================
CREATE TRIGGER trg_app_users_updated BEFORE UPDATE ON public.app_users FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_artists_updated BEFORE UPDATE ON public.artists FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_albums_updated BEFORE UPDATE ON public.albums FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_tracks_updated BEFORE UPDATE ON public.tracks FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_spv2_updated BEFORE UPDATE ON public.spotify_playlists_v2 FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_ata_updated BEFORE UPDATE ON public.ai_track_analysis FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_gp_updated BEFORE UPDATE ON public.generated_playlists FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_rec_updated BEFORE UPDATE ON public.recommendations FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_sj_updated BEFORE UPDATE ON public.sync_jobs FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_us_updated BEFORE UPDATE ON public.user_subscription FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
