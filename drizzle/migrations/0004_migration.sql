create table public.library_enrichment (
  user_id uuid primary key,
  status text not null default 'idle',
  artists_total int not null default 0,
  artists_done int not null default 0,
  tracks_total int not null default 0,
  tracks_done int not null default 0,
  paused_until timestamptz,
  pause_reason text,
  last_spotify_status int,
  last_retry_after int,
  lease_until timestamptz,
  error text,
  updated_at timestamptz not null default now()
);
alter table public.library_enrichment enable row level security;
create policy "Users read own enrichment" on public.library_enrichment for select to authenticated using (auth.uid() = user_id);
grant select on public.library_enrichment to authenticated;
grant all on public.library_enrichment to service_role;
alter publication supabase_realtime add table public.library_enrichment;