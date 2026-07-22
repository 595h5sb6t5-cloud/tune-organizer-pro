// cluster-hardened: Phase 2 hardened clustering over a diagnostic sample.
// Writes cluster_candidates (phase='v3-hardened'), cluster_candidate_tracks,
// unassigned_tracks, and a full report on diagnostic_samples.phase2_report.
// Does NOT touch generated_playlists / spotify export.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

// ─── Thresholds (Prompt Maestro) ────────────────────────────────────────────
const MIN_CLUSTER_SIZE = 10;
const AVG_FIT_THRESHOLD = 0.84;
const MIN_FIT_THRESHOLD = 0.74;
const HOUSE_GATES = { groove: 0.78, kick: 0.74, bass: 0.74 };
const SCENE_DISTANCE_MAX = 0.35;
const ARTIST_SURPRISE = { sonic: 0.90, transition: 0.88, ctx: 0.75 };

// House subgenre neighbor map (used for subgenre_fit)
const HOUSE_NEIGHBORS: Record<string, string[]> = {
  deep_house: ["melodic_house", "organic_house", "soulful_house", "vocal_house"],
  melodic_house: ["deep_house", "organic_house", "progressive_house", "melodic_techno_adjacent"],
  organic_house: ["deep_house", "melodic_house", "afro_house", "downtempo_electronic_adjacent"],
  afro_house: ["organic_house", "latin_house", "tribal_house"],
  latin_house: ["afro_house", "tropical_house"],
  tech_house: ["minimal_house", "bass_house"],
  progressive_house: ["melodic_house", "melodic_techno_adjacent"],
  indie_dance: ["nu_disco", "melodic_house"],
  nu_disco: ["indie_dance", "disco_house", "french_house"],
};

const CORE_DIMS = [
  "energy_score", "darkness", "dance_feel", "softness", "aggressiveness",
  "nostalgia", "bass_level", "drum_intensity", "vocal_intensity",
  "melody_level", "emotional_intensity", "song_variation",
];

type Track = {
  spotify_track_id: string;
  track_name: string;
  artist_name: string;
  music_family: string | null;
  primary_subgenre: string | null;
  secondary_subgenres: string[] | null;
  is_house_related: boolean;
  house_profile: any;
  artist_context: any;
  language: string | null;
  dims: Record<string, number>;
  tempo_feel: string | null;
  transition_in: string | null;
  transition_out: string | null;
};

function numOr(v: any, d = 0.5): number {
  const n = typeof v === "number" ? v : parseFloat(v);
  return isFinite(n) ? Math.max(0, Math.min(1, n)) : d;
}

function sonicFit(a: Track, b: Track): number {
  let s = 0;
  for (const k of CORE_DIMS) s += 1 - Math.abs(numOr(a.dims[k]) - numOr(b.dims[k]));
  return s / CORE_DIMS.length;
}

function subgenreFit(a: Track, b: Track): number {
  if (!a.primary_subgenre || !b.primary_subgenre) return 0.5;
  if (a.primary_subgenre === b.primary_subgenre) return 1.0;
  const neighA = HOUSE_NEIGHBORS[a.primary_subgenre] ?? [];
  const neighB = HOUSE_NEIGHBORS[b.primary_subgenre] ?? [];
  if (neighA.includes(b.primary_subgenre) || neighB.includes(a.primary_subgenre)) return 0.7;
  const secA = new Set(a.secondary_subgenres ?? []);
  const secB = new Set(b.secondary_subgenres ?? []);
  if (secA.has(b.primary_subgenre) || secB.has(a.primary_subgenre)) return 0.55;
  return 0.2;
}

function sceneDistance(a: Track, b: Track): number {
  const sA = String(a.artist_context?.artist_scene ?? "").toLowerCase();
  const sB = String(b.artist_context?.artist_scene ?? "").toLowerCase();
  if (!sA || !sB) return 0.4;
  if (sA === sB) return 0.0;
  // token overlap
  const tA = new Set(sA.split(/[\s,/_-]+/).filter(Boolean));
  const tB = new Set(sB.split(/[\s,/_-]+/).filter(Boolean));
  let overlap = 0;
  for (const t of tA) if (tB.has(t)) overlap++;
  const denom = Math.max(tA.size, tB.size, 1);
  return 1 - overlap / denom;
}

function artistContextFit(a: Track, b: Track): number {
  const gA: string[] = a.artist_context?.artist_primary_genres ?? [];
  const gB: string[] = b.artist_context?.artist_primary_genres ?? [];
  if (!gA.length || !gB.length) return 0.5;
  const setA = new Set(gA.map((x) => String(x).toLowerCase()));
  const setB = new Set(gB.map((x) => String(x).toLowerCase()));
  let hit = 0;
  for (const g of setA) if (setB.has(g)) hit++;
  const base = hit / Math.max(setA.size, setB.size);
  const dist = sceneDistance(a, b);
  return Math.max(0, Math.min(1, base * 0.6 + (1 - dist) * 0.4));
}

function transitionFit(a: Track, b: Track): number {
  // Simple: closer tempo_feel + smoother energy_score bridge
  const eA = numOr(a.dims.energy_score);
  const eB = numOr(b.dims.energy_score);
  const energyBridge = 1 - Math.abs(eA - eB);
  const tempoMatch = (a.tempo_feel && b.tempo_feel && a.tempo_feel === b.tempo_feel) ? 1 : 0.7;
  return energyBridge * 0.6 + tempoMatch * 0.4;
}

function artistContextPenalty(a: Track, b: Track): number {
  // Penalize when identity strong on both sides AND scenes clash
  const idA = numOr(a.artist_context?.artist_identity_strength, 0.5);
  const idB = numOr(b.artist_context?.artist_identity_strength, 0.5);
  const scene = sceneDistance(a, b);
  const outlierA = a.artist_context?.track_is_catalog_outlier === true;
  const outlierB = b.artist_context?.track_is_catalog_outlier === true;
  // If either track is a known catalog outlier, tolerate more scene distance.
  const outlierRelief = (outlierA || outlierB) ? 0.5 : 1.0;
  const raw = scene * ((idA + idB) / 2) * outlierRelief;
  return Math.max(0, Math.min(0.6, raw));
}

function pairFit(a: Track, b: Track) {
  const sonic = sonicFit(a, b);
  const sub = subgenreFit(a, b);
  const ctx = artistContextFit(a, b);
  const scene = sceneDistance(a, b);
  const trans = transitionFit(a, b);
  const skip = Math.max(0, Math.min(1, scene * 0.5 + (1 - trans) * 0.5));
  const penalty = artistContextPenalty(a, b);
  // Weighted composite: 65% sonic, 20% context (sub+ctx), 15% flow (trans - skip)
  const composite =
    0.50 * sonic + 0.15 * sub + 0.20 * ctx + 0.15 * (trans * (1 - skip));
  const surprise =
    sonic >= ARTIST_SURPRISE.sonic &&
    trans >= ARTIST_SURPRISE.transition &&
    ctx >= ARTIST_SURPRISE.ctx;
  const final = Math.max(0, Math.min(1, composite - (surprise ? 0 : penalty)));
  return { sonic, sub, ctx, scene, trans, skip, penalty, surprise, final };
}

// ─── Hard gates by family ───────────────────────────────────────────────────
function houseGate(t: Track): { pass: boolean; failed?: string } {
  const hp = t.house_profile ?? {};
  const groove = numOr(hp.four_on_the_floor_strength ?? 0.5);
  const kick = numOr(hp.kick_weight ?? 0.5);
  const bass = numOr(hp.bassline_prominence ?? 0.5);
  if (groove < HOUSE_GATES.groove) return { pass: false, failed: `groove<${HOUSE_GATES.groove} (${groove.toFixed(2)})` };
  if (kick < HOUSE_GATES.kick) return { pass: false, failed: `kick<${HOUSE_GATES.kick} (${kick.toFixed(2)})` };
  if (bass < HOUSE_GATES.bass) return { pass: false, failed: `bass<${HOUSE_GATES.bass} (${bass.toFixed(2)})` };
  return { pass: true };
}

// ─── Bucketing ──────────────────────────────────────────────────────────────
function bucketKey(t: Track): string {
  if (t.is_house_related) {
    const sg = t.house_profile?.primary_house_subgenre || t.primary_subgenre || "house_generic";
    // group neighbors together
    for (const [k, ns] of Object.entries(HOUSE_NEIGHBORS)) {
      if (sg === k) return `house::${k}`;
      if (ns.includes(sg)) return `house::${k}`;
    }
    return `house::${sg}`;
  }
  return `${t.music_family ?? "other"}::${t.primary_subgenre ?? "generic"}`;
}

// ─── Greedy clustering within a bucket ──────────────────────────────────────
function greedyCluster(tracks: Track[]) {
  // Sort by artist identity strength desc, then energy → deterministic seeds
  const sorted = tracks.slice().sort((a, b) => {
    const idA = numOr(a.artist_context?.artist_identity_strength, 0.5);
    const idB = numOr(b.artist_context?.artist_identity_strength, 0.5);
    return idB - idA;
  });

  const used = new Set<string>();
  const clusters: { seed: Track; members: { t: Track; fit: ReturnType<typeof pairFit> }[] }[] = [];

  for (const seed of sorted) {
    if (used.has(seed.spotify_track_id)) continue;
    const members: { t: Track; fit: ReturnType<typeof pairFit> }[] = [{
      t: seed,
      fit: { sonic: 1, sub: 1, ctx: 1, scene: 0, trans: 1, skip: 0, penalty: 0, surprise: false, final: 1 },
    }];
    used.add(seed.spotify_track_id);

    // Candidates: everything not-yet-used in this bucket
    const cands = sorted.filter((x) => !used.has(x.spotify_track_id));
    // Score each against current centroid = average fit against all current members
    const scored = cands.map((c) => {
      let sumFinal = 0;
      let minFinal = 1;
      let sumParts = { sonic: 0, sub: 0, ctx: 0, scene: 0, trans: 0, skip: 0, penalty: 0 } as any;
      let surprise = false;
      for (const m of members) {
        const f = pairFit(m.t, c);
        sumFinal += f.final;
        if (f.final < minFinal) minFinal = f.final;
        for (const k of Object.keys(sumParts)) sumParts[k] += (f as any)[k];
        if (f.surprise) surprise = true;
      }
      const n = members.length;
      const avg = sumFinal / n;
      const parts = Object.fromEntries(Object.entries(sumParts).map(([k, v]: any) => [k, v / n]));
      return { c, avg, minFinal, parts, surprise };
    }).sort((a, b) => b.avg - a.avg);

    for (const s of scored) {
      if (s.minFinal < MIN_FIT_THRESHOLD) continue;
      if (s.avg < MIN_FIT_THRESHOLD) continue;
      members.push({
        t: s.c,
        fit: {
          sonic: s.parts.sonic, sub: s.parts.sub, ctx: s.parts.ctx,
          scene: s.parts.scene, trans: s.parts.trans, skip: s.parts.skip,
          penalty: s.parts.penalty, surprise: s.surprise, final: s.avg,
        },
      });
      used.add(s.c.spotify_track_id);
      if (members.length >= 50) break;
    }

    clusters.push({ seed, members });
  }
  return clusters;
}

// ─── Cluster naming (simple, no LLM) ────────────────────────────────────────
function clusterName(seed: Track, members: Track[]): string {
  if (seed.is_house_related) {
    const sg = seed.house_profile?.primary_house_subgenre || "house";
    const avgDark = members.reduce((s, m) => s + numOr(m.dims.darkness), 0) / members.length;
    const avgEnergy = members.reduce((s, m) => s + numOr(m.dims.energy_score), 0) / members.length;
    const mood = avgDark > 0.6 ? "Nocturno" : avgEnergy > 0.75 ? "Peak" : "Sunset";
    return `${mood} ${sg.replace(/_/g, " ")}`;
  }
  const fam = seed.music_family ?? "mix";
  const subs = new Set(members.map((m) => m.primary_subgenre).filter(Boolean));
  return `${fam.replace(/_/g, " ")} · ${Array.from(subs).slice(0, 2).join(" / ")}`;
}

// ─── Problem-case detector ──────────────────────────────────────────────────
function detectProblemCases(clusters: { seed: Track; members: { t: Track; fit: any }[] }[]) {
  const cases: any[] = [];
  for (const c of clusters) {
    const artists = c.members.map((m) => m.t.artist_name.toLowerCase());
    const hasKanye = artists.some((a) => a.includes("kanye"));
    const hasElton = artists.some((a) => a.includes("elton"));
    if (hasKanye && hasElton) {
      cases.push({
        case: "Kanye + Elton en el mismo cluster",
        cluster_seed: c.seed.track_name,
        artists_in_cluster: Array.from(new Set(c.members.map((m) => m.t.artist_name))),
        avg_final_fit: c.members.reduce((s, m) => s + m.fit.final, 0) / c.members.length,
      });
    }
    const rufus = c.members.filter((m) => m.t.artist_name.toLowerCase().includes("rüfüs") || m.t.artist_name.toLowerCase().includes("rufus"));
    if (rufus.length > 0) {
      const bucket = bucketKey(c.seed);
      cases.push({
        case: "RÜFÜS DU SOL en cluster",
        cluster_seed: c.seed.track_name,
        bucket,
        rufus_tracks: rufus.map((r) => ({ name: r.t.track_name, subgenre: r.t.primary_subgenre, fit: r.fit.final })),
      });
    }
  }
  return cases;
}

// ─── Main handler ───────────────────────────────────────────────────────────
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
      const uc = createClient(supabaseUrl, anon, { global: { headers: { Authorization: auth } } });
      const { data: { user } } = await uc.auth.getUser();
      if (!user) return json({ error: "unauthorized" }, 401);
      userId = user.id;
    }

    let sampleId: string | undefined = body.sample_id;
    if (!sampleId) {
      const { data: latest } = await adm
        .from("diagnostic_samples")
        .select("id")
        .eq("user_id", userId)
        .eq("phase2_status", "running")
        .order("created_at", { ascending: false })
        .limit(1);
      sampleId = latest?.[0]?.id;
    }
    if (!sampleId) return json({ error: "no running sample" }, 400);

    const { data: sample } = await adm
      .from("diagnostic_samples")
      .select("id, user_id, spotify_track_ids, phase2_status")
      .eq("id", sampleId).maybeSingle();
    if (!sample) return json({ error: "sample not found" }, 404);
    if (sample.user_id !== userId) return json({ error: "forbidden" }, 403);
    if (sample.phase2_status !== "running") {
      // Guard is the only path that sets running; refuse if something else
      return json({ ok: true, skipped: `status=${sample.phase2_status}` });
    }

    const ids: string[] = sample.spotify_track_ids ?? [];
    // Fetch v3 analyses + names
    const analyses: any[] = [];
    for (let i = 0; i < ids.length; i += 500) {
      const chunk = ids.slice(i, i + 500);
      const { data } = await adm
        .from("ai_track_analysis")
        .select("spotify_track_id, track_name, artist_name, music_family, primary_subgenre, secondary_subgenres, is_house_related, house_profile, artist_context, language, energy_score, darkness, dance_feel, softness, aggressiveness, nostalgia, bass_level, drum_intensity, vocal_intensity, melody_level, emotional_intensity, song_variation, tempo_feel, transition_in, transition_out")
        .eq("user_id", userId)
        .eq("analysis_version", "v3")
        .in("spotify_track_id", chunk);
      if (data) analyses.push(...data);
    }

    // Fallback names from liked_songs when analysis lacks them
    const nameById = new Map<string, { track_name: string; artist_name: string }>();
    for (let i = 0; i < ids.length; i += 500) {
      const chunk = ids.slice(i, i + 500);
      const { data } = await adm
        .from("liked_songs")
        .select("spotify_track_id, track_name, artist_name")
        .eq("user_id", userId)
        .in("spotify_track_id", chunk);
      if (data) for (const r of data) nameById.set(r.spotify_track_id, { track_name: r.track_name, artist_name: r.artist_name });
    }

    const tracks: Track[] = analyses.map((a) => ({
      spotify_track_id: a.spotify_track_id,
      track_name: a.track_name || nameById.get(a.spotify_track_id)?.track_name || "(unknown)",
      artist_name: a.artist_name || nameById.get(a.spotify_track_id)?.artist_name || "(unknown)",
      music_family: a.music_family,
      primary_subgenre: a.primary_subgenre,
      secondary_subgenres: a.secondary_subgenres,
      is_house_related: a.is_house_related === true,
      house_profile: a.house_profile ?? {},
      artist_context: a.artist_context ?? {},
      language: a.language,
      tempo_feel: a.tempo_feel,
      transition_in: a.transition_in,
      transition_out: a.transition_out,
      dims: {
        energy_score: numOr(a.energy_score),
        darkness: numOr(a.darkness),
        dance_feel: numOr(a.dance_feel),
        softness: numOr(a.softness),
        aggressiveness: numOr(a.aggressiveness),
        nostalgia: numOr(a.nostalgia),
        bass_level: numOr(a.bass_level),
        drum_intensity: numOr(a.drum_intensity),
        vocal_intensity: numOr(a.vocal_intensity),
        melody_level: numOr(a.melody_level),
        emotional_intensity: numOr(a.emotional_intensity),
        song_variation: numOr(a.song_variation),
      },
    }));

    // 1. Segmentation into buckets
    const buckets = new Map<string, Track[]>();
    const rejectedByGate: { track: Track; reason: string }[] = [];
    for (const t of tracks) {
      if (t.is_house_related) {
        const g = houseGate(t);
        if (!g.pass) {
          rejectedByGate.push({ track: t, reason: `house_gate_failed:${g.failed}` });
          continue;
        }
      }
      const k = bucketKey(t);
      if (!buckets.has(k)) buckets.set(k, []);
      buckets.get(k)!.push(t);
    }

    // 2. Cluster within each bucket
    type ClusterOut = {
      name: string;
      bucket: string;
      seed: Track;
      members: { t: Track; fit: any }[];
      avg_final: number;
      min_final: number;
      promoted: boolean;
      rejection_reason?: string;
    };
    const allClusters: ClusterOut[] = [];
    for (const [key, list] of buckets.entries()) {
      const raw = greedyCluster(list);
      for (const c of raw) {
        const avg = c.members.reduce((s, m) => s + m.fit.final, 0) / c.members.length;
        const min = c.members.reduce((m, x) => Math.min(m, x.fit.final), 1);
        const promoted =
          c.members.length >= MIN_CLUSTER_SIZE &&
          avg >= AVG_FIT_THRESHOLD &&
          min >= MIN_FIT_THRESHOLD;
        let reason: string | undefined;
        if (!promoted) {
          if (c.members.length < MIN_CLUSTER_SIZE) reason = `too_small(${c.members.length}<${MIN_CLUSTER_SIZE})`;
          else if (avg < AVG_FIT_THRESHOLD) reason = `avg_fit_low(${avg.toFixed(3)}<${AVG_FIT_THRESHOLD})`;
          else if (min < MIN_FIT_THRESHOLD) reason = `min_fit_low(${min.toFixed(3)}<${MIN_FIT_THRESHOLD})`;
        }
        allClusters.push({
          name: clusterName(c.seed, c.members.map((m) => m.t)),
          bucket: key,
          seed: c.seed,
          members: c.members,
          avg_final: avg,
          min_final: min,
          promoted,
          rejection_reason: reason,
        });
      }
    }

    // 3. Unassigned: tracks in non-promoted clusters + gate-rejected + never bucketed
    const promotedIds = new Set<string>();
    for (const c of allClusters) if (c.promoted) for (const m of c.members) promotedIds.add(m.t.spotify_track_id);
    const unassigned: { track: Track; reason: string }[] = [];
    for (const c of allClusters) {
      if (c.promoted) continue;
      for (const m of c.members) {
        if (!promotedIds.has(m.t.spotify_track_id)) {
          unassigned.push({ track: m.t, reason: c.rejection_reason ?? "no_cluster_reached_min" });
        }
      }
    }
    for (const r of rejectedByGate) {
      if (!promotedIds.has(r.track.spotify_track_id)) unassigned.push(r);
    }
    // Tracks with no analysis at all (shouldn't happen post-guard, but safe)
    const analyzedIds = new Set(tracks.map((t) => t.spotify_track_id));
    for (const id of ids) if (!analyzedIds.has(id)) {
      unassigned.push({ track: { spotify_track_id: id, track_name: nameById.get(id)?.track_name ?? "(unknown)", artist_name: nameById.get(id)?.artist_name ?? "(unknown)" } as any, reason: "no_v3_analysis" });
    }

    // 4. Persist — clear previous v3-hardened runs for this sample, then insert fresh
    await adm.from("cluster_candidates").delete().eq("user_id", userId).eq("sample_id", sampleId).eq("phase", "v3-hardened");
    await adm.from("unassigned_tracks").delete().eq("user_id", userId).eq("sample_id", sampleId).eq("phase", "v3-hardened");

    for (const c of allClusters.filter((c) => c.promoted)) {
      const { data: inserted, error: insErr } = await adm.from("cluster_candidates").insert({
        user_id: userId,
        sample_id: sampleId,
        phase: "v3-hardened",
        status: "candidate",
        name: c.name,
        music_family: c.seed.music_family,
        dominant_subgenre: c.seed.is_house_related ? (c.seed.house_profile?.primary_house_subgenre ?? c.seed.primary_subgenre) : c.seed.primary_subgenre,
        size: c.members.length,
        avg_compat: c.avg_final,
        min_compat: c.min_final,
        avg_final_fit: c.avg_final,
        min_final_fit: c.min_final,
        sonic_summary: `bucket=${c.bucket}`,
        language_group: c.members[0]?.t.language ?? null,
      }).select("id").maybeSingle();
      if (insErr || !inserted) { console.error("insert cluster err", insErr); continue; }
      const rows = c.members.map((m, i) => ({
        cluster_id: inserted.id,
        user_id: userId,
        spotify_track_id: m.t.spotify_track_id,
        position: i,
        compat_to_centroid: m.fit.final,
        sonic_fit: m.fit.sonic,
        subgenre_fit: m.fit.sub,
        artist_context_fit: m.fit.ctx,
        scene_distance: m.fit.scene,
        skip_risk: m.fit.skip,
        transition_fit: m.fit.trans,
        artist_context_penalty: m.fit.penalty,
        final_fit: m.fit.final,
        is_artist_surprise: m.fit.surprise,
      }));
      if (rows.length) await adm.from("cluster_candidate_tracks").insert(rows);
    }

    if (unassigned.length) {
      // dedupe by track id
      const seen = new Set<string>();
      const uRows = unassigned.filter((u) => {
        if (seen.has(u.track.spotify_track_id)) return false;
        seen.add(u.track.spotify_track_id);
        return true;
      }).map((u) => ({
        user_id: userId,
        spotify_track_id: u.track.spotify_track_id,
        sample_id: sampleId,
        phase: "v3-hardened",
        reason: u.reason,
        details: {
          track_name: u.track.track_name,
          artist_name: u.track.artist_name,
          music_family: u.track.music_family,
          primary_subgenre: u.track.primary_subgenre,
        },
      }));
      // Delete-then-insert already handled above
      if (uRows.length) {
        // batch insert to avoid unique conflicts
        for (let i = 0; i < uRows.length; i += 200) {
          await adm.from("unassigned_tracks").upsert(uRows.slice(i, i + 200), { onConflict: "user_id,spotify_track_id" });
        }
      }
    }

    // 5. Build report
    const problemCases = detectProblemCases(allClusters.filter((c) => c.promoted));
    const bucketStats: Record<string, number> = {};
    for (const [k, list] of buckets.entries()) bucketStats[k] = list.length;

    // Load previous v2 clusters for diff (any phase != 'v3-hardened' for this user)
    const { data: prevClusters } = await adm
      .from("cluster_candidates")
      .select("id, size, avg_compat")
      .eq("user_id", userId)
      .neq("phase", "v3-hardened");
    const prevCount = prevClusters?.length ?? 0;
    const prevAvgSize = prevCount ? (prevClusters!.reduce((s, x: any) => s + (x.size ?? 0), 0) / prevCount) : 0;

    const promoted = allClusters.filter((c) => c.promoted);
    const report = {
      finished_at: new Date().toISOString(),
      sample_size: ids.length,
      analyzed_v3: tracks.length,
      buckets: bucketStats,
      clusters_promoted: promoted.map((c) => ({
        name: c.name,
        bucket: c.bucket,
        size: c.members.length,
        avg_final_fit: +c.avg_final.toFixed(3),
        min_final_fit: +c.min_final.toFixed(3),
        dominant_subgenre: c.seed.is_house_related ? c.seed.house_profile?.primary_house_subgenre : c.seed.primary_subgenre,
        tracks: c.members.map((m) => ({
          name: m.t.track_name,
          artist: m.t.artist_name,
          subgenre: m.t.primary_subgenre,
          final_fit: +m.fit.final.toFixed(3),
          sonic: +m.fit.sonic.toFixed(3),
          artist_context: +m.fit.ctx.toFixed(3),
          scene_distance: +m.fit.scene.toFixed(3),
          skip_risk: +m.fit.skip.toFixed(3),
          artist_penalty: +m.fit.penalty.toFixed(3),
          surprise: m.fit.surprise,
        })),
      })),
      clusters_rejected: allClusters.filter((c) => !c.promoted).map((c) => ({
        bucket: c.bucket,
        size: c.members.length,
        reason: c.rejection_reason,
        seed: `${c.seed.track_name} — ${c.seed.artist_name}`,
        avg_final_fit: +c.avg_final.toFixed(3),
        min_final_fit: +c.min_final.toFixed(3),
      })),
      unassigned: unassigned.map((u) => ({
        name: u.track.track_name,
        artist: u.track.artist_name,
        subgenre: u.track.primary_subgenre,
        reason: u.reason,
      })),
      problem_cases: problemCases,
      diff_vs_previous: {
        previous_cluster_count: prevCount,
        previous_avg_size: +prevAvgSize.toFixed(1),
        new_cluster_count: promoted.length,
        new_avg_size: promoted.length ? +(promoted.reduce((s, c) => s + c.members.length, 0) / promoted.length).toFixed(1) : 0,
        new_avg_fit: promoted.length ? +(promoted.reduce((s, c) => s + c.avg_final, 0) / promoted.length).toFixed(3) : 0,
      },
      thresholds: {
        min_cluster_size: MIN_CLUSTER_SIZE,
        avg_fit_threshold: AVG_FIT_THRESHOLD,
        min_fit_threshold: MIN_FIT_THRESHOLD,
        house_gates: HOUSE_GATES,
      },
    };

    await adm.from("diagnostic_samples").update({
      phase2_status: "completed_awaiting_review",
      phase2_finished_at: new Date().toISOString(),
      phase2_report: report,
      phase2_progress: { done: true, promoted: promoted.length, unassigned: unassigned.length },
    }).eq("id", sampleId);

    return json({ ok: true, sample_id: sampleId, promoted: promoted.length, unassigned: unassigned.length, problem_cases: problemCases.length });
  } catch (e: any) {
    console.error("cluster-hardened error", e);
    try {
      const svc = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const adm = createClient(supabaseUrl, svc);
      const body = await req.json().catch(() => ({}));
      if (body?.sample_id) {
        await adm.from("diagnostic_samples").update({
          phase2_status: "failed",
          phase2_block_reason: e?.message ?? "unknown",
        }).eq("id", body.sample_id);
      }
    } catch (_) {}
    return json({ error: e?.message ?? "unknown" }, 500);
  }
});
