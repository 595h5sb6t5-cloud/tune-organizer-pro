-- recommendation_history: remove anonymous access, scope to owner
DROP POLICY IF EXISTS "Allow anonymous insert recommendation history" ON public.recommendation_history;
DROP POLICY IF EXISTS "Allow anonymous read recommendation history" ON public.recommendation_history;
DROP POLICY IF EXISTS "Allow anonymous update recommendation history" ON public.recommendation_history;
DROP POLICY IF EXISTS "Users can insert own recommendation history" ON public.recommendation_history;
DROP POLICY IF EXISTS "Users can update own recommendation history" ON public.recommendation_history;
DROP POLICY IF EXISTS "Users can view own recommendation history" ON public.recommendation_history;

CREATE POLICY "Users can view own recommendation history"
ON public.recommendation_history FOR SELECT TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own recommendation history"
ON public.recommendation_history FOR INSERT TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own recommendation history"
ON public.recommendation_history FOR UPDATE TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- recommendation_feedback: remove NULL user bypass
DROP POLICY IF EXISTS "Users can insert own feedback" ON public.recommendation_feedback;
DROP POLICY IF EXISTS "Users can view own feedback" ON public.recommendation_feedback;

CREATE POLICY "Users can view own feedback"
ON public.recommendation_feedback FOR SELECT TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own feedback"
ON public.recommendation_feedback FOR INSERT TO authenticated
WITH CHECK (auth.uid() = user_id);

-- user_taste_profile: remove NULL user bypass
DROP POLICY IF EXISTS "Users can update own taste profile" ON public.user_taste_profile;
DROP POLICY IF EXISTS "Users can upsert own taste profile" ON public.user_taste_profile;
DROP POLICY IF EXISTS "Users can view own taste profile" ON public.user_taste_profile;

CREATE POLICY "Users can view own taste profile"
ON public.user_taste_profile FOR SELECT TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Users can upsert own taste profile"
ON public.user_taste_profile FOR INSERT TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own taste profile"
ON public.user_taste_profile FOR UPDATE TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- Remove anon access grants on these tables (all policies are auth.uid() scoped)
REVOKE ALL ON public.recommendation_history FROM anon;
REVOKE ALL ON public.recommendation_feedback FROM anon;
REVOKE ALL ON public.user_taste_profile FROM anon;
GRANT SELECT, INSERT, UPDATE ON public.recommendation_history TO authenticated;
GRANT SELECT, INSERT ON public.recommendation_feedback TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.user_taste_profile TO authenticated;
GRANT ALL ON public.recommendation_history TO service_role;
GRANT ALL ON public.recommendation_feedback TO service_role;
GRANT ALL ON public.user_taste_profile TO service_role;

-- SECURITY DEFINER functions must not be callable from the Data API
REVOKE ALL ON FUNCTION public.reconcile_liked_songs(uuid, uuid, jsonb, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_liked_songs(uuid, uuid, jsonb, boolean) TO service_role;

REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.handle_new_user_subscription() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sync_subscription_tier() FROM PUBLIC, anon, authenticated;