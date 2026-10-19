CREATE TABLE public.track_analysis_global (
  spotify_track_id text PRIMARY KEY,
  lang text, energy real, valence real, danceability real, tempo real, mood text,
  original_year integer, year_checked boolean NOT NULL DEFAULT false,
  family text, family_checked boolean NOT NULL DEFAULT false,
  style text, style_checked boolean NOT NULL DEFAULT false,
  instruments text[], texture real, warmth real, scale real, groove text, sound_checked boolean NOT NULL DEFAULT false,
  scene text, scene_checked boolean NOT NULL DEFAULT false,
  feeling text, melodic_focus real, arc text, confidence real, feel_checked boolean NOT NULL DEFAULT false,
  tags jsonb, tag_source text, lastfm_checked boolean NOT NULL DEFAULT false,
  youtube_summary text, youtube_checked boolean NOT NULL DEFAULT false, evidence_applied boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.track_analysis_global TO authenticated;
GRANT ALL ON public.track_analysis_global TO service_role;
ALTER TABLE public.track_analysis_global ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Signed-in users read shared analysis" ON public.track_analysis_global FOR SELECT TO authenticated USING (true);

-- Mirror per-user AI analysis into the shared table (manual_sound is never copied).
CREATE OR REPLACE FUNCTION public.mirror_classification_to_global() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.track_analysis_global AS g (spotify_track_id, lang, energy, valence, danceability, tempo, mood,
    original_year, year_checked, family, family_checked, style, style_checked, instruments, texture, warmth, scale, groove,
    sound_checked, scene, scene_checked, feeling, melodic_focus, arc, confidence, feel_checked, updated_at)
  VALUES (NEW.spotify_track_id, NEW.lang, NEW.energy, NEW.valence, NEW.danceability, NEW.tempo, NEW.mood,
    NEW.original_year, NEW.year_checked, NEW.family, NEW.family_checked, NEW.style, NEW.style_checked, NEW.instruments,
    NEW.texture, NEW.warmth, NEW.scale, NEW.groove, NEW.sound_checked, NEW.scene, NEW.scene_checked, NEW.feeling,
    NEW.melodic_focus, NEW.arc, NEW.confidence, NEW.feel_checked, now())
  ON CONFLICT (spotify_track_id) DO UPDATE SET
    lang = COALESCE(EXCLUDED.lang, g.lang), energy = COALESCE(EXCLUDED.energy, g.energy),
    valence = COALESCE(EXCLUDED.valence, g.valence), danceability = COALESCE(EXCLUDED.danceability, g.danceability),
    tempo = COALESCE(EXCLUDED.tempo, g.tempo), mood = COALESCE(EXCLUDED.mood, g.mood),
    original_year = COALESCE(EXCLUDED.original_year, g.original_year), year_checked = g.year_checked OR EXCLUDED.year_checked,
    family = COALESCE(EXCLUDED.family, g.family), family_checked = g.family_checked OR EXCLUDED.family_checked,
    style = COALESCE(EXCLUDED.style, g.style), style_checked = g.style_checked OR EXCLUDED.style_checked,
    instruments = COALESCE(EXCLUDED.instruments, g.instruments), texture = COALESCE(EXCLUDED.texture, g.texture),
    warmth = COALESCE(EXCLUDED.warmth, g.warmth), scale = COALESCE(EXCLUDED.scale, g.scale),
    groove = COALESCE(EXCLUDED.groove, g.groove), sound_checked = g.sound_checked OR EXCLUDED.sound_checked,
    scene = COALESCE(EXCLUDED.scene, g.scene), scene_checked = g.scene_checked OR EXCLUDED.scene_checked,
    feeling = COALESCE(EXCLUDED.feeling, g.feeling), melodic_focus = COALESCE(EXCLUDED.melodic_focus, g.melodic_focus),
    arc = COALESCE(EXCLUDED.arc, g.arc), confidence = COALESCE(EXCLUDED.confidence, g.confidence),
    feel_checked = g.feel_checked OR EXCLUDED.feel_checked, updated_at = now();
  RETURN NEW;
END $$;
CREATE TRIGGER trg_mirror_classification AFTER INSERT OR UPDATE ON public.track_ai_classification
  FOR EACH ROW EXECUTE FUNCTION public.mirror_classification_to_global();

CREATE OR REPLACE FUNCTION public.mirror_evidence_to_global() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.track_analysis_global AS g (spotify_track_id, tags, tag_source, lastfm_checked, youtube_summary, youtube_checked, evidence_applied, updated_at)
  VALUES (NEW.spotify_track_id, NEW.tags, NEW.tag_source, NEW.lastfm_checked, NEW.youtube_summary, NEW.youtube_checked, NEW.evidence_applied, now())
  ON CONFLICT (spotify_track_id) DO UPDATE SET
    tags = COALESCE(EXCLUDED.tags, g.tags), tag_source = COALESCE(EXCLUDED.tag_source, g.tag_source),
    lastfm_checked = g.lastfm_checked OR EXCLUDED.lastfm_checked,
    youtube_summary = COALESCE(EXCLUDED.youtube_summary, g.youtube_summary),
    youtube_checked = g.youtube_checked OR EXCLUDED.youtube_checked,
    evidence_applied = g.evidence_applied OR EXCLUDED.evidence_applied, updated_at = now();
  RETURN NEW;
END $$;
CREATE TRIGGER trg_mirror_evidence AFTER INSERT OR UPDATE ON public.listener_evidence
  FOR EACH ROW EXECUTE FUNCTION public.mirror_evidence_to_global();

-- Copy shared analysis into a user's rows so analyzers skip songs anyone already analyzed.
CREATE OR REPLACE FUNCTION public.hydrate_track_analysis(_user_id uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n integer := 0; m integer := 0;
BEGIN
  INSERT INTO public.track_ai_classification (user_id, spotify_track_id, lang, energy, valence, danceability, tempo, mood,
    original_year, year_checked, family, family_checked, style, style_checked, instruments, texture, warmth, scale, groove,
    sound_checked, scene, scene_checked, feeling, melodic_focus, arc, confidence, feel_checked)
  SELECT _user_id, g.spotify_track_id, g.lang, g.energy, g.valence, g.danceability, g.tempo, g.mood,
    g.original_year, g.year_checked, g.family, g.family_checked, g.style, g.style_checked, g.instruments, g.texture, g.warmth,
    g.scale, g.groove, g.sound_checked, g.scene, g.scene_checked, g.feeling, g.melodic_focus, g.arc, g.confidence, g.feel_checked
  FROM public.liked_songs l JOIN public.track_analysis_global g ON g.spotify_track_id = l.spotify_track_id
  WHERE l.user_id = _user_id AND l.is_active AND g.lang IS NOT NULL AND g.energy IS NOT NULL AND g.mood IS NOT NULL
    AND g.valence IS NOT NULL AND g.danceability IS NOT NULL AND g.tempo IS NOT NULL
  ON CONFLICT (user_id, spotify_track_id) DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;

  UPDATE public.track_ai_classification c SET
    original_year = COALESCE(g.original_year, c.original_year), year_checked = true,
    family = COALESCE(g.family, c.family), family_checked = true, style = COALESCE(g.style, c.style), style_checked = true,
    instruments = COALESCE(g.instruments, c.instruments), texture = COALESCE(g.texture, c.texture), warmth = COALESCE(g.warmth, c.warmth),
    scale = COALESCE(g.scale, c.scale), groove = COALESCE(g.groove, c.groove), sound_checked = true,
    scene = CASE WHEN g.scene_checked THEN g.scene ELSE c.scene END, scene_checked = c.scene_checked OR g.scene_checked,
    feeling = CASE WHEN g.feel_checked THEN g.feeling ELSE c.feeling END,
    melodic_focus = CASE WHEN g.feel_checked THEN g.melodic_focus ELSE c.melodic_focus END,
    arc = CASE WHEN g.feel_checked THEN g.arc ELSE c.arc END,
    confidence = CASE WHEN g.feel_checked THEN g.confidence ELSE c.confidence END,
    feel_checked = c.feel_checked OR g.feel_checked
  FROM public.track_analysis_global g
  WHERE c.user_id = _user_id AND g.spotify_track_id = c.spotify_track_id
    AND ((NOT c.style_checked AND g.style_checked) OR (NOT c.sound_checked AND g.sound_checked)
      OR (NOT c.year_checked AND g.year_checked) OR (NOT c.family_checked AND g.family_checked)
      OR (NOT c.feel_checked AND g.feel_checked));
  GET DIAGNOSTICS m = ROW_COUNT;

  INSERT INTO public.listener_evidence (user_id, spotify_track_id, tags, tag_source, lastfm_checked, youtube_summary, youtube_checked, evidence_applied)
  SELECT _user_id, g.spotify_track_id, g.tags, g.tag_source, g.lastfm_checked, g.youtube_summary, g.youtube_checked, g.evidence_applied
  FROM public.liked_songs l JOIN public.track_analysis_global g ON g.spotify_track_id = l.spotify_track_id
  WHERE l.user_id = _user_id AND l.is_active AND g.lastfm_checked
  ON CONFLICT (user_id, spotify_track_id) DO UPDATE SET
    tags = COALESCE(listener_evidence.tags, EXCLUDED.tags), tag_source = COALESCE(listener_evidence.tag_source, EXCLUDED.tag_source),
    lastfm_checked = true,
    youtube_summary = COALESCE(listener_evidence.youtube_summary, EXCLUDED.youtube_summary),
    youtube_checked = listener_evidence.youtube_checked OR EXCLUDED.youtube_checked,
    evidence_applied = listener_evidence.evidence_applied OR EXCLUDED.evidence_applied
  WHERE NOT listener_evidence.lastfm_checked OR (EXCLUDED.youtube_checked AND NOT listener_evidence.youtube_checked)
    OR (EXCLUDED.evidence_applied AND NOT listener_evidence.evidence_applied);
  RETURN n + m;
END $$;
REVOKE ALL ON FUNCTION public.hydrate_track_analysis(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hydrate_track_analysis(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.mirror_classification_to_global() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mirror_evidence_to_global() FROM PUBLIC, anon, authenticated;

-- Backfill from existing per-user analysis.
INSERT INTO public.track_analysis_global (spotify_track_id, lang, energy, valence, danceability, tempo, mood,
  original_year, year_checked, family, family_checked, style, style_checked, instruments, texture, warmth, scale, groove,
  sound_checked, scene, scene_checked, feeling, melodic_focus, arc, confidence, feel_checked)
SELECT DISTINCT ON (spotify_track_id) spotify_track_id, lang, energy, valence, danceability, tempo, mood,
  original_year, year_checked, family, family_checked, style, style_checked, instruments, texture, warmth, scale, groove,
  sound_checked, scene, scene_checked, feeling, melodic_focus, arc, confidence, feel_checked
FROM public.track_ai_classification
ORDER BY spotify_track_id, feel_checked DESC, sound_checked DESC, created_at DESC
ON CONFLICT (spotify_track_id) DO NOTHING;

INSERT INTO public.track_analysis_global AS g (spotify_track_id, tags, tag_source, lastfm_checked, youtube_summary, youtube_checked, evidence_applied)
SELECT DISTINCT ON (spotify_track_id) spotify_track_id, tags, tag_source, lastfm_checked, youtube_summary, youtube_checked, evidence_applied
FROM public.listener_evidence ORDER BY spotify_track_id, evidence_applied DESC, youtube_checked DESC
ON CONFLICT (spotify_track_id) DO UPDATE SET tags = EXCLUDED.tags, tag_source = EXCLUDED.tag_source,
  lastfm_checked = EXCLUDED.lastfm_checked, youtube_summary = EXCLUDED.youtube_summary,
  youtube_checked = EXCLUDED.youtube_checked, evidence_applied = EXCLUDED.evidence_applied;

-- Pre-built AI Playlists (one saved set per user).
CREATE TABLE public.prebuilt_playlists (
  user_id uuid PRIMARY KEY,
  playlists jsonb NOT NULL DEFAULT '[]'::jsonb,
  unsorted jsonb NOT NULL DEFAULT '[]'::jsonb,
  analyzed_count integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'idle',
  lease_until timestamptz,
  built_at timestamptz,
  seen_at timestamptz,
  error text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.prebuilt_playlists TO authenticated;
GRANT ALL ON public.prebuilt_playlists TO service_role;
ALTER TABLE public.prebuilt_playlists ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own prebuilt" ON public.prebuilt_playlists FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users insert own prebuilt" ON public.prebuilt_playlists FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own prebuilt" ON public.prebuilt_playlists FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users delete own prebuilt" ON public.prebuilt_playlists FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- Per-step timings of each vibe run.
CREATE TABLE public.vibe_timings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  vibe text NOT NULL,
  steps jsonb NOT NULL DEFAULT '{}'::jsonb,
  total_ms integer NOT NULL DEFAULT 0,
  tracks integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.vibe_timings TO authenticated;
GRANT ALL ON public.vibe_timings TO service_role;
ALTER TABLE public.vibe_timings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own timings" ON public.vibe_timings FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users insert own timings" ON public.vibe_timings FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);