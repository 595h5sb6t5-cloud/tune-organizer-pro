import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

type RunType = "quick" | "full";
type StageKey = "profile" | "liked_songs" | "saved_albums" | "playlists" | "followed_artists" | "tops_recent" | "audio_analysis";

type StageResult = Record<string, any>;

const STAGES: Array<{ key: StageKey; label: string; order: number }> = [
  { key: "profile", label: "Reading Spotify profile", order: 1 },
  { key: "liked_songs", label: "Liked songs", order: 2 },
  { key: "saved_albums", label: "Saved albums", order: 3 },
  { key: "playlists", label: "Playlists", order: 4 },
  { key: "followed_artists", label: "Followed artists", order: 5 },
  { key: "tops_recent", label: "Top tracks and recent plays", order: 6 },
  { key: "audio_analysis", label: "Audio analysis", order: 7 },
];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null;
}

function isRateLimited(result: unknown) {
  return isRecord(result) && (result.status === "rate_limited" || result.step === "spotify_rate_limited");
}

function retryAfter(result: unknown) {
  if (!isRecord(result)) return 180;
  const n = Number(result.retry_after_seconds ?? result.retry_after ?? 180);
  return Number.isFinite(n) && n > 0 ? Math.min(Math.ceil(n), 900) : 180;
}

function mapStageStatus(status: string) {
  if (status === "waiting_rate_limit") return "running";
  return status;
}

async function getAuthUser(req: Request, supabaseUrl: string, anonKey: string) {
  const auth = req.headers.get("Authorization") ?? req.headers.get("authorization");
  if (!auth) throw new Error("Missing Authorization");
  const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: auth } } });
  const { data: { user }, error } = await userClient.auth.getUser();
  if (error || !user) throw new Error("Unauthorized");
  return { user, auth };
}

async function ensureStages(svc: any, runId: string, userId: string) {
  const rows = STAGES.map((stage) => ({
    sync_run_id: runId,
    user_id: userId,
    stage_key: stage.key,
    label: stage.label,
    status: "pending",
    order_index: stage.order,
  }));
  await svc.from("sync_run_stages").upsert(rows, { onConflict: "sync_run_id,stage_key", ignoreDuplicates: true });
}

async function createRun(svc: any, userId: string, runType: RunType) {
  if (runType === "full") {
    const { data: existing } = await svc
      .from("sync_runs")
      .select("id, status")
      .eq("user_id", userId)
      .eq("run_type", "full")
      .in("status", ["pending", "running", "waiting_rate_limit"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existing?.id) return { run: existing, reused: true };
  }

  const { data, error } = await svc
    .from("sync_runs")
    .insert({
      user_id: userId,
      run_type: runType,
      status: "pending",
      locked_until: new Date(Date.now() + 30 * 60_000).toISOString(),
    })
    .select("id, status")
    .single();
  if (error) {
    if (runType === "full" && error.code === "23505") {
      const { data: existing } = await svc
        .from("sync_runs")
        .select("id, status")
        .eq("user_id", userId)
        .eq("run_type", "full")
        .in("status", ["pending", "running", "waiting_rate_limit"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (existing?.id) return { run: existing, reused: true };
    }
    throw error;
  }
  await ensureStages(svc, data.id, userId);
  return { run: data, reused: false };
}

async function updateRun(svc: any, runId: string, patch: Record<string, any>) {
  await svc.from("sync_runs").update(patch).eq("id", runId);
}

async function updateStage(svc: any, runId: string, key: StageKey, patch: Record<string, any>) {
  await svc.from("sync_run_stages").update(patch).eq("sync_run_id", runId).eq("stage_key", key);
}

async function invokeFunction(supabaseUrl: string, anonKey: string, auth: string, name: string, body: Record<string, any>) {
  const res = await fetch(`${supabaseUrl}/functions/v1/${name}`, {
    method: "POST",
    headers: {
      Authorization: auth,
      apikey: anonKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw_body: text }; }
  if (!res.ok) {
    const message = data?.error || data?.message || `Edge function ${name} failed with ${res.status}`;
    const err = new Error(message);
    (err as any).status = res.status;
    (err as any).payload = data;
    throw err;
  }
  return data ?? {};
}

function stageMetrics(stage: StageKey, result: StageResult) {
  switch (stage) {
    case "profile":
      return { found: result.profile ? 1 : 0, processed: result.profile ? 1 : 0, created: 0, updated: result.profile ? 1 : 0, removed: 0 };
    case "liked_songs":
      return {
        found: Number(result.spotify_liked_total_raw ?? result.liked_songs_total ?? 0),
        processed: Number(result.liked_songs_total ?? 0),
        created: Number(result.liked_songs_added ?? 0),
        updated: Math.max(0, Number(result.liked_songs_total ?? 0) - Number(result.liked_songs_added ?? 0)),
        removed: Number(result.liked_songs_removed ?? 0),
      };
    case "saved_albums":
      return { found: Number(result.albums_total ?? 0), processed: Number(result.albums_total ?? 0), created: Number(result.albums_added ?? 0), updated: 0, removed: Number(result.albums_removed ?? 0) };
    case "playlists":
      return { found: Number(result.playlists_total ?? 0), processed: Number(result.playlists_total ?? 0), created: Number(result.playlists_changed ?? 0), updated: Number(result.playlists_with_tracks_imported ?? 0), removed: Number(result.playlists_removed ?? 0) };
    case "followed_artists":
      return { found: Number(result.artists_total ?? 0), processed: Number(result.artists_total ?? 0), created: Number(result.artists_added ?? 0), updated: Number(result.artist_top_tracks_imported ?? 0), removed: Number(result.artists_removed ?? 0) };
    case "tops_recent":
      return { found: Number(result.top_tracks ?? 0) + Number(result.top_artists ?? 0) + Number(result.recent_plays ?? 0), processed: Number(result.top_tracks ?? 0) + Number(result.top_artists ?? 0) + Number(result.recent_plays ?? 0), created: 0, updated: 0, removed: 0 };
    case "audio_analysis":
      return { found: Number(result.audio_features ?? 0), processed: Number(result.audio_features ?? 0), created: 0, updated: Number(result.audio_features ?? 0), removed: 0 };
  }
}

async function countPendingAnalysis(svc: any, userId: string) {
  const { count: likedCount } = await svc
    .from("liked_songs")
    .select("id", { head: true, count: "exact" })
    .eq("user_id", userId)
    .eq("is_active", true)
    .eq("is_available", true);
  const { count: analyzedCount } = await svc
    .from("ai_track_analysis")
    .select("id", { head: true, count: "exact" })
    .eq("user_id", userId)
    .eq("analysis_version", "v2.2-2026-11-lang");
  return Math.max(0, Number(likedCount ?? 0) - Number(analyzedCount ?? 0));
}

async function runPipeline(supabaseUrl: string, anonKey: string, svc: any, auth: string, userId: string, runId: string, runType: RunType) {
  const forceFull = runType === "full";
  const finalSummary: Record<string, any> = {};
  let hasRestrictions = false;

  try {
    await updateRun(svc, runId, {
      status: "running",
      started_at: new Date().toISOString(),
      locked_until: new Date(Date.now() + 30 * 60_000).toISOString(),
      error_message: null,
    });

    const runStage = async (stage: StageKey, fn: () => Promise<StageResult>, opts: { optional?: boolean } = {}) => {
      await updateRun(svc, runId, { active_stage: stage, status: "running", locked_until: new Date(Date.now() + 30 * 60_000).toISOString() });
      await updateStage(svc, runId, stage, { status: "running", started_at: new Date().toISOString(), completed_at: null, error_message: null });

      const started = Date.now();
      try {
        const result = await fn();
        if (isRateLimited(result)) {
          const wait = retryAfter(result);
          if (opts.optional) {
            await updateStage(svc, runId, stage, {
              status: "skipped",
              completed_at: new Date().toISOString(),
              error_message: result.message ?? "Spotify rate limited this optional stage.",
              retry_count: 1,
              meta: { ...result, duration_ms: Date.now() - started, retry_after_seconds_capped: wait },
            });
            finalSummary[`${stage}_status`] = "skipped_rate_limited";
            hasRestrictions = true;
            return true;
          }
          await updateRun(svc, runId, {
            status: "waiting_rate_limit",
            error_message: result.message ?? "Spotify is rate limiting this stage.",
            locked_until: new Date(Date.now() + wait * 1000 + 60_000).toISOString(),
          });
          await updateStage(svc, runId, stage, {
            status: "running",
            error_message: result.message ?? "Waiting for Spotify rate limit",
            retry_count: 1,
            meta: { ...result, duration_ms: Date.now() - started, waiting_until: new Date(Date.now() + wait * 1000).toISOString() },
          });
          return false;
        }

        const m = stageMetrics(stage, result);
        await updateStage(svc, runId, stage, {
          status: "completed",
          completed_at: new Date().toISOString(),
          items_found: m.found,
          items_processed: m.processed,
          items_created: m.created,
          items_updated: m.updated,
          items_removed_or_deactivated: m.removed,
          meta: { ...result, duration_ms: Date.now() - started },
        });
        Object.assign(finalSummary, result);
        if (result.partial_success || result.status === "completed_with_restrictions") hasRestrictions = true;
        return true;
      } catch (e: any) {
        const message = String(e?.message || e);
        await updateStage(svc, runId, stage, {
          status: opts.optional ? "skipped" : "failed",
          completed_at: new Date().toISOString(),
          error_message: message,
          meta: { payload: e?.payload ?? null, duration_ms: Date.now() - started },
        });
        if (opts.optional) return true;
        await updateRun(svc, runId, { status: "failed", completed_at: new Date().toISOString(), error_message: message, active_stage: stage });
        throw e;
      }
    };

    const profileOk = await runStage("profile", () => invokeFunction(supabaseUrl, anonKey, auth, "spotify-sync-extras", { scope: "profile" }), { optional: true });
    if (!profileOk) return;

    const likedOk = await runStage("liked_songs", () => invokeFunction(supabaseUrl, anonKey, auth, "spotify-import-tracks", { scope: "liked", force_full: forceFull, sync_run_id: runId }));
    if (!likedOk) return;

    const albumsOk = await runStage("saved_albums", () => invokeFunction(supabaseUrl, anonKey, auth, "spotify-import-tracks", { scope: "albums", force_full: forceFull, sync_run_id: runId }));
    if (!albumsOk) return;

    const playlistsOk = await runStage("playlists", async () => {
      let combined: Record<string, any> = { playlists_total: 0, playlists_changed: 0, playlists_removed: 0, playlist_tracks_synced: 0, playlists_restricted: 0, playlists_with_tracks_imported: 0, playlists_failed: 0 };
      for (let batch = 0; batch < 50; batch++) {
        const res = await invokeFunction(supabaseUrl, anonKey, auth, "spotify-import-tracks", { scope: "playlists", force_full: forceFull, sync_run_id: runId });
        if (isRateLimited(res)) return res;
        combined = {
          ...combined,
          ...res,
          playlists_total: Math.max(Number(combined.playlists_total ?? 0), Number(res.playlists_total ?? 0)),
          playlists_changed: Math.max(Number(combined.playlists_changed ?? 0), Number(res.playlists_changed ?? 0)),
          playlists_removed: Math.max(Number(combined.playlists_removed ?? 0), Number(res.playlists_removed ?? 0)),
          playlist_tracks_synced: Number(combined.playlist_tracks_synced ?? 0) + Number(res.playlist_tracks_synced ?? 0),
          playlists_restricted: Number(combined.playlists_restricted ?? 0) + Number(res.playlists_restricted ?? 0),
          playlists_with_tracks_imported: Number(combined.playlists_with_tracks_imported ?? 0) + Number(res.playlists_with_tracks_imported ?? 0),
          playlists_failed: Number(combined.playlists_failed ?? 0) + Number(res.playlists_failed ?? 0),
        };
        if (Number(res.playlists_remaining ?? 0) <= 0) break;
      }
      return combined;
    });
    if (!playlistsOk) return;

    const artistsOk = await runStage("followed_artists", () => invokeFunction(supabaseUrl, anonKey, auth, "spotify-import-tracks", { scope: "artists", force_full: forceFull, sync_run_id: runId }));
    if (!artistsOk) return;

    const topsOk = await runStage("tops_recent", () => invokeFunction(supabaseUrl, anonKey, auth, "spotify-sync-extras", { scope: "tops_recent" }), { optional: true });
    if (!topsOk) return;

    const analysisOk = await runStage("audio_analysis", async () => {
      const audio = await invokeFunction(supabaseUrl, anonKey, auth, "spotify-import-tracks", { scope: "analysis", force_full: forceFull, sync_run_id: runId });
      if (isRateLimited(audio)) return audio;
      const pending_ai_analysis = await countPendingAnalysis(svc, userId);
      return { ...audio, pending_ai_analysis };
    }, { optional: true });
    if (!analysisOk) return;

    const completedAt = new Date().toISOString();
    await svc.from("spotify_connections").update({
      sync_status: "idle",
      sync_error: null,
      ...(forceFull ? { last_full_sync_at: completedAt } : {}),
      last_incremental_sync_at: completedAt,
    }).eq("user_id", userId);

    await updateRun(svc, runId, {
      status: hasRestrictions ? "completed_with_restrictions" : "completed",
      active_stage: null,
      completed_at: completedAt,
      locked_until: null,
      error_message: null,
      summary: finalSummary,
    });
  } catch (e: any) {
    const message = String(e?.message || e);
    await svc.from("spotify_connections").update({ sync_status: "error", sync_error: message }).eq("user_id", userId);
    await updateRun(svc, runId, { status: "failed", completed_at: new Date().toISOString(), locked_until: null, error_message: message });
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const svc = createClient(supabaseUrl, serviceKey);
    const { user, auth } = await getAuthUser(req, supabaseUrl, anonKey);

    let body: Record<string, any> = {};
    try { body = await req.json(); } catch { body = {}; }

    const action = body.action === "status" ? "status" : "start";
    const runType: RunType = body.mode === "quick" ? "quick" : "full";

    if (action === "status") {
      const runId = typeof body.run_id === "string" ? body.run_id : null;
      const query = svc.from("sync_runs").select("*").eq("user_id", user.id).order("created_at", { ascending: false }).limit(1);
      const { data: run } = runId
        ? await svc.from("sync_runs").select("*").eq("user_id", user.id).eq("id", runId).maybeSingle()
        : await query.maybeSingle();
      const { data: stages } = run?.id
        ? await svc.from("sync_run_stages").select("*").eq("sync_run_id", run.id).order("order_index", { ascending: true })
        : { data: [] };
      return json({ success: true, run: run ? { ...run, status: mapStageStatus(run.status) } : null, stages: stages ?? [] });
    }

    const { run, reused } = await createRun(svc, user.id, runType);
    await ensureStages(svc, run.id, user.id);

    if (!reused) {
      const background = runPipeline(supabaseUrl, anonKey, svc, auth, user.id, run.id, runType);
      // @ts-ignore EdgeRuntime is provided by the edge runtime.
      if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) {
        // @ts-ignore EdgeRuntime is provided by the edge runtime.
        EdgeRuntime.waitUntil(background);
      } else {
        background.catch((e) => console.error("[spotify-sync-library] background failed", e));
      }
    }

    const { data: stages } = await svc.from("sync_run_stages").select("*").eq("sync_run_id", run.id).order("order_index", { ascending: true });
    return json({ success: true, reused, run_id: run.id, run: { ...run, status: mapStageStatus(run.status) }, stages: stages ?? [] }, reused ? 200 : 202);
  } catch (e: any) {
    console.error("[spotify-sync-library]", e);
    return json({ error: String(e?.message || e) }, /Unauthorized|Missing Authorization/.test(String(e?.message)) ? 401 : 500);
  }
});