// phase2-guard: validates that a diagnostic sample is fully analyzed with v3 data
// before firing cluster-hardened. Idempotent — safe to call multiple times.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const REQUIRED_ANALYSIS_VERSION = "v3";

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), {
    status: s,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

function fireCluster(supabaseUrl: string, svc: string, userId: string, sampleId: string) {
  try {
    // @ts-ignore Deno EdgeRuntime global
    const wu = typeof EdgeRuntime !== "undefined" ? EdgeRuntime.waitUntil : (p: Promise<any>) => p;
    wu(
      fetch(`${supabaseUrl}/functions/v1/cluster-hardened`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${svc}` },
        body: JSON.stringify({ user_id: userId, sample_id: sampleId }),
      }).catch(() => {}),
    );
  } catch (_) {}
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const svc = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const adm = createClient(supabaseUrl, svc);

    const auth = req.headers.get("Authorization") ?? "";
    const isServiceCaller = auth === `Bearer ${svc}`;
    const body = await req.json().catch(() => ({} as any));

    let userId: string | undefined = body.user_id;
    if (!isServiceCaller || !userId) {
      const userClient = createClient(supabaseUrl, anon, { global: { headers: { Authorization: auth } } });
      const { data: { user } } = await userClient.auth.getUser();
      if (!user) return json({ error: "unauthorized" }, 401);
      userId = user.id;
    }

    // Find most recent sample awaiting phase 2 for this user
    const sampleId: string | undefined = body.sample_id;
    let query = adm
      .from("diagnostic_samples")
      .select("id, user_id, spotify_track_ids, phase2_status")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(1);
    if (sampleId) query = query.eq("id", sampleId) as any;
    else query = query.in("phase2_status", ["pending_analysis", "blocked"]) as any;

    const { data: samples, error: sampleErr } = await query;
    if (sampleErr) return json({ error: sampleErr.message }, 500);
    const sample = samples?.[0];
    if (!sample) return json({ ok: true, skipped: "no_pending_sample" });

    // Idempotency: if already running / completed, skip
    if (["running", "completed_awaiting_review", "approved_for_rollout"].includes(sample.phase2_status)) {
      return json({ ok: true, skipped: `already_${sample.phase2_status}`, sample_id: sample.id });
    }

    const ids: string[] = sample.spotify_track_ids ?? [];
    if (ids.length === 0) {
      await adm.from("diagnostic_samples").update({
        phase2_status: "blocked",
        phase2_block_reason: "sample has no tracks",
      }).eq("id", sample.id);
      return json({ ok: false, blocked: "empty_sample" });
    }

    // Pull v3 analyses for all sample tracks (paginate for safety)
    const analyses: any[] = [];
    for (let i = 0; i < ids.length; i += 500) {
      const chunk = ids.slice(i, i + 500);
      const { data } = await adm
        .from("ai_track_analysis")
        .select("spotify_track_id, analysis_version, music_family, primary_subgenre, artist_context, house_profile, is_house_related, last_error, analysis_stage")
        .eq("user_id", userId)
        .eq("analysis_version", REQUIRED_ANALYSIS_VERSION)
        .in("spotify_track_id", chunk);
      if (data) analyses.push(...data);
    }

    const byId = new Map<string, any>();
    for (const a of analyses) byId.set(a.spotify_track_id, a);

    const missing: string[] = [];
    const incompleteCore: string[] = [];
    const incompleteHouse: string[] = [];
    const errored: string[] = [];

    for (const id of ids) {
      const a = byId.get(id);
      if (!a) { missing.push(id); continue; }
      if (a.last_error) { errored.push(id); continue; }
      if (!a.music_family || !a.primary_subgenre || !a.artist_context) {
        incompleteCore.push(id);
        continue;
      }
      if (a.is_house_related === true) {
        const hp = a.house_profile ?? {};
        if (!hp || typeof hp !== "object" || !hp.primary_house_subgenre) {
          incompleteHouse.push(id);
        }
      }
    }

    const blockReasons: Record<string, any> = {};
    if (missing.length) blockReasons.missing_analysis = { count: missing.length, sample: missing.slice(0, 5) };
    if (incompleteCore.length) blockReasons.missing_v3_fields = { count: incompleteCore.length, sample: incompleteCore.slice(0, 5) };
    if (incompleteHouse.length) blockReasons.incomplete_house_profile = { count: incompleteHouse.length, sample: incompleteHouse.slice(0, 5) };
    if (errored.length) blockReasons.errored_tracks = { count: errored.length, sample: errored.slice(0, 5) };

    if (Object.keys(blockReasons).length > 0) {
      await adm.from("diagnostic_samples").update({
        phase2_status: "blocked",
        phase2_block_reason: JSON.stringify(blockReasons),
        phase2_progress: {
          checked_at: new Date().toISOString(),
          total: ids.length,
          analyzed_v3: ids.length - missing.length,
        },
      }).eq("id", sample.id);
      return json({ ok: false, blocked: blockReasons, sample_id: sample.id });
    }

    // All good — mark running and fire cluster-hardened
    const { error: upErr } = await adm.from("diagnostic_samples").update({
      phase2_status: "running",
      phase2_started_at: new Date().toISOString(),
      phase2_block_reason: null,
      phase2_progress: { started_at: new Date().toISOString(), total: ids.length, stage: "dispatched" },
    }).eq("id", sample.id).eq("phase2_status", sample.phase2_status); // optimistic lock

    if (upErr) return json({ error: upErr.message }, 500);

    fireCluster(supabaseUrl, svc, userId!, sample.id);
    return json({ ok: true, dispatched: true, sample_id: sample.id, total: ids.length });
  } catch (e: any) {
    console.error("phase2-guard error", e);
    return json({ error: e?.message ?? "unknown" }, 500);
  }
});
