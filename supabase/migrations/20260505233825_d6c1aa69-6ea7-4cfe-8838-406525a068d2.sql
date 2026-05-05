-- Backfill any existing users without a subscription as Free
INSERT INTO public.user_subscription (user_id, plan, song_analysis_limit, playlists_limit, recommendations_limit, is_active)
SELECT p.user_id, 'free', 100, 3, 20, true
FROM public.profiles p
WHERE NOT EXISTS (SELECT 1 FROM public.user_subscription us WHERE us.user_id = p.user_id);

-- Update column defaults to match Free plan
ALTER TABLE public.user_subscription
  ALTER COLUMN song_analysis_limit SET DEFAULT 100,
  ALTER COLUMN playlists_limit SET DEFAULT 3,
  ALTER COLUMN recommendations_limit SET DEFAULT 20;

ALTER TABLE public.user_subscription
  ADD COLUMN IF NOT EXISTS current_period_started_at timestamptz NOT NULL DEFAULT date_trunc('month', now()),
  ADD COLUMN IF NOT EXISTS export_limit integer NOT NULL DEFAULT 3;

-- Trigger: when a new profile is created, also create a Free subscription if missing
CREATE OR REPLACE FUNCTION public.handle_new_user_subscription()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.user_subscription (user_id, plan, song_analysis_limit, playlists_limit, recommendations_limit, export_limit, is_active)
  VALUES (NEW.user_id, 'free', 100, 3, 20, 3, true)
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_profile_created_subscription ON public.profiles;
CREATE TRIGGER on_profile_created_subscription
AFTER INSERT ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user_subscription();

-- Trigger: sync plan changes to app_users.subscription_tier
CREATE OR REPLACE FUNCTION public.sync_subscription_tier()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.app_users SET subscription_tier = NEW.plan, updated_at = now()
  WHERE user_id = NEW.user_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_subscription_changed ON public.user_subscription;
CREATE TRIGGER on_subscription_changed
AFTER INSERT OR UPDATE OF plan ON public.user_subscription
FOR EACH ROW EXECUTE FUNCTION public.sync_subscription_tier();

-- Make sure a Free user has explicit limits even if older row had defaults
UPDATE public.user_subscription
SET song_analysis_limit = 100, playlists_limit = 3, recommendations_limit = 20, export_limit = 3
WHERE plan = 'free'
  AND (song_analysis_limit IS NULL OR song_analysis_limit > 100);

-- Make sure timestamps trigger exists
DROP TRIGGER IF EXISTS update_user_subscription_updated_at ON public.user_subscription;
CREATE TRIGGER update_user_subscription_updated_at
BEFORE UPDATE ON public.user_subscription
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();