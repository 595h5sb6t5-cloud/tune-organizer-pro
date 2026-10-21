alter table public.track_analysis_global
  add column if not exists moments jsonb,
  add column if not exists moment_story text,
  add column if not exists moments_checked boolean not null default false;

alter table public.track_ai_classification
  add column if not exists moments jsonb,
  add column if not exists moment_story text;

alter table public.prebuilt_playlists
  add column if not exists analyzing jsonb not null default '[]'::jsonb;

create table if not exists public.moment_tags_state (
  id smallint primary key default 1,
  status text not null default 'idle',
  lease_until timestamptz,
  paused_until timestamptz,
  last_error text,
  done integer not null default 0,
  updated_at timestamptz not null default now()
);
insert into public.moment_tags_state (id) values (1) on conflict (id) do nothing;
grant all on public.moment_tags_state to service_role;
alter table public.moment_tags_state enable row level security;

create or replace function public.hydrate_track_analysis(_user_id uuid)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
DECLARE n integer := 0; m integer := 0;
BEGIN
  INSERT INTO public.track_ai_classification (user_id, spotify_track_id, lang, energy, valence, danceability, tempo, mood,
    original_year, year_checked, family, family_checked, style, style_checked, instruments, texture, warmth, scale, groove,
    sound_checked, scene, scene_checked, feeling, feeling_2, melodic_focus, arc, confidence, feel_checked, moments, moment_story)
  SELECT _user_id, g.spotify_track_id, g.lang, g.energy, g.valence, g.danceability, g.tempo, g.mood,
    g.original_year, g.year_checked, g.family, g.family_checked, g.style, g.style_checked, g.instruments, g.texture, g.warmth,
    g.scale, g.groove, g.sound_checked, g.scene, g.scene_checked, g.feeling, g.feeling_2, g.melodic_focus, g.arc, g.confidence, g.feel_checked,
    g.moments, g.moment_story
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
    feel_checked = c.feel_checked OR g.feel_checked,
    moments = CASE WHEN g.moments_checked THEN g.moments ELSE c.moments END,
    moment_story = CASE WHEN g.moments_checked THEN g.moment_story ELSE c.moment_story END
  FROM public.track_analysis_global g
  WHERE c.user_id = _user_id AND g.spotify_track_id = c.spotify_track_id
    AND ((NOT c.style_checked AND g.style_checked) OR (NOT c.sound_checked AND g.sound_checked)
      OR (NOT c.year_checked AND g.year_checked) OR (NOT c.family_checked AND g.family_checked)
      OR (NOT c.feel_checked AND g.feel_checked) OR (g.moments_checked AND c.moments IS NULL));
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
END $function$;