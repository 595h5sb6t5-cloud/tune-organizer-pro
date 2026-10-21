/** Active foreground leases stop new background work; expiration recovers closed tabs. */
export async function vibeHasPriority(admin: any): Promise<boolean> {
  const { data, error } = await admin.from("vibe_priority_leases").select("run_id")
    .gt("expires_at", new Date().toISOString()).limit(1);
  // Fail closed: a failed priority read must not flood a foreground vibe.
  return !!error || !!data?.length;
}