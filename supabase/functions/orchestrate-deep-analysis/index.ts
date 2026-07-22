// Long-running orchestrator for deep track analysis.
// - Creates or resumes a sync_jobs row (job_type='deep_analysis').
// - Runs analyze-tracks-deep in a background task via EdgeRuntime.waitUntil,
//   so the analysis keeps going after the client disconnects.
// - Updates sync_jobs after every batch: items_processed, stage, meta.
// - Self-chains before hitting the CPU wall so long libraries finish reliably.
// - Idempotent: if a job is already running for the user, returns it.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const JOB_TYPE = "deep_analysis";
const MAX_RUN_MS = 240_000; // self-chain before hitting edge CPU limit
const BATCH_SIZE = 15;
const CONCURRENCY = 5;
const MAX_CONSECUTIVE_FAILURES = 5;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

interface JobMeta {
  cache_hits: number;
  failed_count: number;
  retry_count: number;
  batches_completed: number;
  eta_seconds: number | null;
  avg_ms_per_track: number | null;
  last_error: string | null;
  started_at_ms: number;
  force: boolean;
}

async function callAnalyzer(
  supabaseUrl: string,
  svcKey: string,
  userId: string,
  force: boolean,
): Promise<any> {
  const res = await fetch(`${supabaseUrl}/functions/v1/analyze-tracks-deep`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${svcKey}`,
      "Content-Type": "application/json",
      apikey: svcKey,
    },
    body: JSON.stringify({
      user_id: userId,
      batch_size: BATCH_SIZE,
      concurrency: CONCURRENCY,
      force,
      profile: true,
    }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`analyzer_${res.status}: ${text.substring(0, 300)}`);
  try { return JSON.parse(text); } catch { throw new Error(`analyzer_invalid_json: ${text.substring(0, 200)}`); }
}

async function runLoop(
  supabaseUrl: string,
  svcKey: string,
  userId: string,
  jobId: string,
  force: boolean,
) {
  const adm = createClient(supabaseUrl, svcKey);
  const runStart = Date.now();

  // Load prior meta so we can accumulate across self-chained invocations.
  const { data: jobRow } = await adm
    .from("sync_jobs")
    .select("meta, items_processed, total_items")
    .eq("id", jobId)
    .maybeSingle();

  const priorMeta: Partial<JobMeta> = (jobRow?.meta as any) ?? {};
  const meta: JobMeta = {
    cache_hits: priorMeta.cache_hits ?? 0,
    failed_count: priorMeta.failed_count ?? 0,
    retry_count: priorMeta.retry_count ?? 0,
    batches_completed: priorMeta.batches_completed ?? 0,
    eta_seconds: null,
    avg_ms_per_track: priorMeta.avg_ms_per_track ?? null,
    last_error: null,
    started_at_ms: priorMeta.started_at_ms ?? runStart,
    force,
  };

  let processedTotal = jobRow?.items_processed ?? 0;
  let totalItems = jobRow?.total_items ?? 0;
  let consecutiveFailures = 0;
  const batchDurationsMs: number[] = [];

  // Stage → Preparing
  await adm.from("sync_jobs").update({
    stage: "preparing_library",
    status: "running",
    meta: meta as any,
  }).eq("id", jobId);

  while (true) {
    const elapsedThisRun = Date.now() - runStart;
    if (elapsedThisRun > MAX_RUN_MS) {
      // Self-chain to a fresh invocation, then exit this one.
      try {
        await fetch(`${supabaseUrl}/functions/v1/orchestrate-deep-analysis`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${svcKey}`,
            "Content-Type": "application/json",
            apikey: svcKey,
          },
          body: JSON.stringify({ job_id: jobId, user_id: userId, force, resume: true }),
        });
      } catch (e) {
        console.error("self-chain failed:", e);
      }
      await adm.from("sync_jobs").update({
        stage: "chaining",
        meta: { ...meta, last_error: null } as any,
      }).eq("id", jobId);
      return;
    }

    const batchStart = Date.now();
    let data: any;
    try {
      data = await callAnalyzer(supabaseUrl, svcKey, userId, force);
      consecutiveFailures = 0;
    } catch (e: any) {
      consecutiveFailures++;
      const msg = e?.message ?? "unknown";
      meta.last_error = msg;
      console.error(`batch failure #${consecutiveFailures}:`, msg);
      await adm.from("sync_jobs").update({
        stage: "recovering",
        meta: meta as any,
      }).eq("id", jobId);

      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        await adm.from("sync_jobs").update({
          status: "failed",
          stage: "error",
          error_message: msg,
          finished_at: new Date().toISOString(),
          meta: meta as any,
        }).eq("id", jobId);
        return;
      }
      // Backoff and retry the whole batch on transient failure
      await new Promise((r) => setTimeout(r, 2000 * consecutiveFailures));
      continue;
    }

    const batchMs = Date.now() - batchStart;
    batchDurationsMs.push(batchMs);
    meta.batches_completed++;
    meta.failed_count += data.failed ?? 0;
    meta.retry_count += data.profile?.retries ?? 0;
    if (data.profile?.avg_ms_per_track != null) meta.avg_ms_per_track = data.profile.avg_ms_per_track;

    const analyzedNow = data.analyzed ?? 0;
    totalItems = data.total ?? totalItems;

    // Real coverage from DB (source of truth) — avoids double-counting cache
    // hits when the analyzer re-reads the same page across batches.
    const { count: coveredCount } = await adm
      .from("ai_track_analysis")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("analysis_version", "v2")
      .eq("prompt_version", "v2.1-2026-11")
      .eq("schema_version", "v2.0");
    processedTotal = coveredCount ?? processedTotal;
    meta.cache_hits = Math.max(0, processedTotal - analyzedNow * meta.batches_completed >= 0 ? (processedTotal - (analyzedNow * meta.batches_completed)) : 0);
    // Simpler: cache_hits = total covered - freshly analyzed this run. Track fresh across the whole run:
    // (recomputed below)

    // ETA: average across the last few batches
    const recent = batchDurationsMs.slice(-5);
    const avgBatchMs = recent.reduce((a, b) => a + b, 0) / recent.length;
    const remainingItems = Math.max(0, (data.remaining ?? 0));
    const remainingBatches = Math.ceil(remainingItems / BATCH_SIZE);
    meta.eta_seconds = Math.round((remainingBatches * avgBatchMs) / 1000);

    const stage = data.done ? "finalizing" : "analyzing_songs";

    await adm.from("sync_jobs").update({
      stage,
      items_processed: Math.min(processedTotal, totalItems),
      total_items: totalItems,
      meta: meta as any,
    }).eq("id", jobId);

    if (data.done || analyzedNow === 0) {
      await adm.from("sync_jobs").update({
        status: "completed",
        stage: "done",
        finished_at: new Date().toISOString(),
        items_processed: totalItems,
        meta: { ...meta, eta_seconds: 0 } as any,
      }).eq("id", jobId);
      return;
    }

    // Gentle pacing to keep OpenAI happy
    await new Promise((r) => setTimeout(r, 300));
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const svc = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const auth = req.headers.get("Authorization") ?? "";
    const isService = auth === `Bearer ${svc}`;

    const body = await req.json().catch(() => ({}));
    const force = body.force === true;
    const resumeJobId: string | undefined = body.job_id;

    // Resolve user
    let userId: string;
    if (isService && body.user_id) {
      userId = body.user_id;
    } else {
      const userClient = createClient(supabaseUrl, anon, { global: { headers: { Authorization: auth } } });
      const { data: { user }, error } = await userClient.auth.getUser();
      if (error || !user) return json({ error: "unauthorized" }, 401);
      userId = user.id;
    }

    const adm = createClient(supabaseUrl, svc);

    // Resume path
    if (resumeJobId) {
      const { data: existing } = await adm
        .from("sync_jobs")
        .select("id, user_id, status")
        .eq("id", resumeJobId)
        .maybeSingle();
      if (!existing || existing.user_id !== userId) return json({ error: "job_not_found" }, 404);
      if (existing.status !== "running") return json({ job_id: resumeJobId, status: existing.status });
      // @ts-ignore
      EdgeRuntime.waitUntil(runLoop(supabaseUrl, svc, userId, resumeJobId, force));
      return json({ job_id: resumeJobId, status: "resumed" });
    }

    // Fresh start — but if a job is already running, return it (idempotent).
    const { data: activeJob } = await adm
      .from("sync_jobs")
      .select("id, status, items_processed, total_items, stage, meta")
      .eq("user_id", userId)
      .eq("job_type", JOB_TYPE)
      .eq("status", "running")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (activeJob) {
      return json({ job_id: activeJob.id, status: "already_running", job: activeJob });
    }

    // Count total for the initial UI display
    const { count: totalCount } = await adm
      .from("liked_songs")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId);

    const { data: newJob, error: insertErr } = await adm
      .from("sync_jobs")
      .insert({
        user_id: userId,
        job_type: JOB_TYPE,
        status: "running",
        stage: "preparing_library",
        items_processed: 0,
        total_items: totalCount ?? 0,
        started_at: new Date().toISOString(),
        meta: {
          cache_hits: 0,
          failed_count: 0,
          retry_count: 0,
          batches_completed: 0,
          eta_seconds: null,
          avg_ms_per_track: null,
          last_error: null,
          force,
        },
      })
      .select("id")
      .single();

    if (insertErr || !newJob) {
      return json({ error: insertErr?.message ?? "failed_to_create_job" }, 500);
    }

    // @ts-ignore
    EdgeRuntime.waitUntil(runLoop(supabaseUrl, svc, userId, newJob.id, force));

    return json({ job_id: newJob.id, status: "started", total_items: totalCount ?? 0 });
  } catch (e: any) {
    console.error("orchestrator error:", e);
    return json({ error: e?.message ?? "unknown" }, 500);
  }
});
