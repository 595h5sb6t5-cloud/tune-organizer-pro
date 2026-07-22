REVOKE ALL ON FUNCTION public.reconcile_liked_songs(uuid, uuid, jsonb, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reconcile_liked_songs(uuid, uuid, jsonb, boolean) FROM anon;
REVOKE ALL ON FUNCTION public.reconcile_liked_songs(uuid, uuid, jsonb, boolean) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_liked_songs(uuid, uuid, jsonb, boolean) TO service_role;