ALTER TABLE public.track_ai_classification ADD COLUMN IF NOT EXISTS feeling_2 text;
ALTER TABLE public.track_analysis_global ADD COLUMN IF NOT EXISTS feeling_2 text;

CREATE OR REPLACE FUNCTION public.mirror_classification_to_global() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE reset_feel boolean := TG_OP = 'UPDATE' AND OLD.feel_checked AND NOT NEW.feel_checked;
BEGIN
  INSERT INTO public.track_analysis_global AS g (spotify_track_id, lang, energy, valence, danceability, tempo, mood,
    original_year, year_checked, family, family_checked, style, style_checked, instruments, texture, warmth, scale, groove,
    sound_checked, scene, scene_checked, feeling, feeling_2, melodic_focus, arc, confidence, feel_checked, updated_at)
  VALUES (NEW.spotify_track_id, NEW.lang, NEW.energy, NEW.valence, NEW.danceability, NEW.tempo, NEW.mood,
    NEW.original_year, NEW.year_checked, NEW.family, NEW.family_checked, NEW.style, NEW.style_checked, NEW.instruments,
    NEW.texture, NEW.warmth, NEW.scale, NEW.groove, NEW.sound_checked, NEW.scene, NEW.scene_checked, NEW.feeling, NEW.feeling_2,
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
    feeling = COALESCE(EXCLUDED.feeling, g.feeling),
    feeling_2 = CASE WHEN EXCLUDED.feeling IS NOT NULL THEN EXCLUDED.feeling_2 ELSE g.feeling_2 END,
    melodic_focus = COALESCE(EXCLUDED.melodic_focus, g.melodic_focus),
    arc = COALESCE(EXCLUDED.arc, g.arc), confidence = COALESCE(EXCLUDED.confidence, g.confidence),
    feel_checked = CASE WHEN reset_feel THEN false ELSE g.feel_checked OR EXCLUDED.feel_checked END, updated_at = now();
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.hydrate_track_analysis(_user_id uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n integer := 0; m integer := 0;
BEGIN
  INSERT INTO public.track_ai_classification (user_id, spotify_track_id, lang, energy, valence, danceability, tempo, mood,
    original_year, year_checked, family, family_checked, style, style_checked, instruments, texture, warmth, scale, groove,
    sound_checked, scene, scene_checked, feeling, feeling_2, melodic_focus, arc, confidence, feel_checked)
  SELECT _user_id, g.spotify_track_id, g.lang, g.energy, g.valence, g.danceability, g.tempo, g.mood,
    g.original_year, g.year_checked, g.family, g.family_checked, g.style, g.style_checked, g.instruments, g.texture, g.warmth,
    g.scale, g.groove, g.sound_checked, g.scene, g.scene_checked, g.feeling, g.feeling_2, g.melodic_focus, g.arc, g.confidence, g.feel_checked
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
    feeling_2 = CASE WHEN g.feel_checked THEN g.feeling_2 ELSE c.feeling_2 END,
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