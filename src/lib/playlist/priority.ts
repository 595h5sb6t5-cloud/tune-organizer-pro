import { supabase } from "@/integrations/supabase/client";

/** Expiring per-run leases also recover when a tab closes before finally executes. */
export async function acquireVibePriority(userId: string) {
  const runId = crypto.randomUUID();
  const renew = async () => {
    const { error } = await supabase.from("vibe_priority_leases").upsert({
      user_id: userId, run_id: runId, expires_at: new Date(Date.now() + 30_000).toISOString(),
    });
    if (error) throw new Error("No se pudo dar prioridad al vibe. Intenta otra vez.");
  };
  await renew();
  const timer = setInterval(() => { void renew().catch(() => {}); }, 10_000);
  return async () => {
    clearInterval(timer);
    await supabase.from("vibe_priority_leases").delete().eq("user_id", userId).eq("run_id", runId);
    // Existing pipelines resume; they skip work covered by another active foreground lease.
    for (const fn of ["audio-analyze", "moment-tags", "library-enrich", "listener-tags"]) {
      void supabase.functions.invoke(fn, { body: { user_id: userId } }).catch(() => {});
    }
  };
}

export async function withinBudget<T>(work: PromiseLike<T>, deadline: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve(work),
      new Promise<T>((resolve) => { timer = setTimeout(() => resolve(fallback), Math.max(0, deadline - performance.now())); }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}