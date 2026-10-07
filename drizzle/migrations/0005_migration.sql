-- lovable-cron-fallback-reviewed: armed only while a library analysis is paused/unfinished, unscheduled by the sweep once nothing is pending
create extension if not exists pg_cron;
create extension if not exists pg_net;
create or replace function public.enrich_resume_arm(_on boolean)
returns void language plpgsql security definer set search_path = public, cron as $$
begin
  if _on then
    if not exists (select 1 from cron.job where jobname = 'library-enrich-resume') then
      perform cron.schedule('library-enrich-resume', '*/5 * * * *',
        $c$select net.http_post(url:='https://uftegpmdzjybstjncnkc.supabase.co/functions/v1/library-enrich',headers:='{"Content-Type":"application/json","apikey":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVmdGVncG1kemp5YnN0am5jbmtjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYwMjcwNjYsImV4cCI6MjA5MTYwMzA2Nn0.udb1ElCfqAKsezxWtQXXNMOODYCo2K7D5bhnVEEJF7c"}'::jsonb,body:='{"sweep":true}'::jsonb);$c$);
    end if;
  else
    if exists (select 1 from cron.job where jobname = 'library-enrich-resume') then
      perform cron.unschedule('library-enrich-resume');
    end if;
  end if;
end $$;
revoke all on function public.enrich_resume_arm(boolean) from public, anon, authenticated;
grant execute on function public.enrich_resume_arm(boolean) to service_role;