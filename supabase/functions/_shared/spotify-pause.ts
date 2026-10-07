// Shared Spotify "paused" state (Spotify's limit is per app, so the latest pause applies to everyone).
export const SPOTIFY_PAUSE_REASONS = ["quota", "rate_limit"];

export async function activeSpotifyPause(admin: any): Promise<string | null> {
  const { data } = await admin.from("library_enrichment").select("paused_until")
    .in("pause_reason", SPOTIFY_PAUSE_REASONS).gt("paused_until", new Date().toISOString())
    .order("paused_until", { ascending: false }).limit(1);
  return data?.[0]?.paused_until ?? null;
}

/** Record a Spotify 429 seen by a user action, so the app stops calling Spotify. */
export async function recordSpotifyPause(admin: any, userId: string, retryAfterS: number, quota: boolean) {
  const until = new Date(Date.now() + Math.max(retryAfterS, quota ? 3600 : 0) * 1000).toISOString();
  await admin.from("library_enrichment").upsert({
    user_id: userId, status: "paused", paused_until: until, pause_reason: quota ? "quota" : "rate_limit",
    last_spotify_status: 429, last_retry_after: retryAfterS, updated_at: new Date().toISOString(),
  }, { onConflict: "user_id" });
  await admin.rpc("enrich_resume_arm", { _on: true });
  return until;
}

/** User actions (Sync, Save to Spotify) get priority: background genre lookups hold off for a while. */
export async function markUserAction(admin: any, userId: string, minutes = 10) {
  await admin.from("library_enrichment").upsert(
    { user_id: userId, user_action_until: new Date(Date.now() + minutes * 60_000).toISOString() },
    { onConflict: "user_id" },
  );
}

export const pausedBody = (until: string) => ({
  error: "Spotify paused requests for this app.",
  error_code: "spotify_paused",
  retry_at: until,
});
