create or replace function public.moment_queue_next(_limit integer default 250)
returns table (
  spotify_track_id text, track_name text, artist_name text, year integer,
  style text, scene text, instruments text[], feeling text, feeling_2 text,
  energy real, arc text, melodic_focus real, youtube_summary text, tags jsonb
)
language sql
security definer
set search_path to 'public'
as $$
  select distinct on (l.spotify_track_id)
    l.spotify_track_id, l.track_name, l.artist_name,
    g.original_year, g.style, g.scene, g.instruments, g.feeling, g.feeling_2,
    g.energy, g.arc, g.melodic_focus, g.youtube_summary, g.tags
  from public.liked_songs l
  join public.track_analysis_global g on g.spotify_track_id = l.spotify_track_id
  where l.is_active and not g.moments_checked
    and (g.style is not null or g.feel_checked)
  limit _limit;
$$;

revoke all on function public.moment_queue_next(integer) from public, anon, authenticated;
grant execute on function public.moment_queue_next(integer) to service_role;