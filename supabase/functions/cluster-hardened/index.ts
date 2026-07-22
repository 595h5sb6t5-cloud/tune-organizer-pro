// cluster-hardened v2: Phase 2 with two-tier formation/promotion + calibrated gates.
// - Bucketing: coarser (music_family for non-house, house::subgenre for house)
// - House gates only apply when is_house_related AND house_profile.analysis_confidence >= 0.65
// - Two tiers:
//     candidate: min 4 tracks, avg pair fit >= 0.62, centroid fit >= 0.66, sonic >= 0.68
//     promoted:  min 6 tracks, avg pair fit >= 0.72, centroid fit >= 0.76
// - Penalty caps (individual + total 0.35)
// - Confidence gating for hard gates (>=0.70) — soft weighting otherwise
// - Rejection reason tally + score distribution in the report
// - Does NOT touch generated_playlists / spotify export
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

// ─── Thresholds ─────────────────────────────────────────────────────────────
// Two tiers so we can find groups first, then judge them.
const CAND = {
  min_size: 4,
  centroid_fit: 0.66,
  avg_pair_fit: 0.62,
  sonic_fit: 0.68,
};
const PROMO = {
  min_size: 6,
  centroid_fit: 0.76,
  avg_pair_fit: 0.72,
  min_pair_fit: 0.62, // no track wildly worse than the group
  sonic_coherence: 0.70,
};

const HOUSE_GATES = { groove: 0.78, kick: 0.74, bass: 0.74 };
const HOUSE_GATE_MIN_CONF = 0.65;   // gates only apply if house_profile.analysis_confidence >= this
const ANALYSIS_CONF_HARD_GATE = 0.70; // any hard rejection needs confidence >= this
const ARTIST_SURPRISE = { sonic: 0.90, transition: 0.88, ctx: 0.75 };

// Penalty caps
const PEN_CAPS = {
  artist_identity_break: 0.12,
  scene_distance: 0.15,
  skip_risk: 0.15,
  subgenre_conflict: 0.12,
  production_shift: 0.12,
  total: 0.35,
};

// House subgenre neighbor map
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
  analysis_confidence: number; // overall confidence for hard-gate eligibility
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
  return 0.35;
}

function sceneDistance(a: Track, b: Track): number {
  const sA = String(a.artist_context?.artist_scene ?? "").toLowerCase();
  const sB = String(b.artist_context?.artist_scene ?? "").toLowerCase();
  if (!sA || !sB) return 0.35;
  if (sA === sB) return 0.0;
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
  if (!gA.length || !gB.length) return 0.55; // missing → neutral-ish, don't punish
  const setA = new Set(gA.map((x) => String(x).toLowerCase()));
  const setB = new Set(gB.map((x) => String(x).toLowerCase()));
  let hit = 0;
  for (const g of setA) if (setB.has(g)) hit++;
  const base = hit / Math.max(setA.size, setB.size);
  const dist = sceneDistance(a, b);
  return Math.max(0, Math.min(1, base * 0.6 + (1 - dist) * 0.4));
}

function transitionFit(a: Track, b: Track): number {
  const eA = numOr(a.dims.energy_score);
  const eB = numOr(b.dims.energy_score);
  const energyBridge = 1 - Math.abs(eA - eB);
  const tempoMatch = (a.tempo_feel && b.tempo_feel && a.tempo_feel === b.tempo_feel) ? 1 : 0.7;
  return energyBridge * 0.6 + tempoMatch * 0.4;
}

function capped(v: number, cap: number) { return Math.max(0, Math.min(cap, v)); }

function penalties(a: Track, b: Track) {
  const idA = numOr(a.artist_context?.artist_identity_strength, 0.5);
  const idB = numOr(b.artist_context?.artist_identity_strength, 0.5);
  const scene = sceneDistance(a, b);
  const outlierA = a.artist_context?.track_is_catalog_outlier === true;
  const outlierB = b.artist_context?.track_is_catalog_outlier === true;
  const outlierRelief = (outlierA || outlierB) ? 0.5 : 1.0;

  const artistBreak = capped(scene * ((idA + idB) / 2) * outlierRelief * 0.6, PEN_CAPS.artist_identity_break);
  const scenePen = capped(scene * 0.5, PEN_CAPS.scene_distance);
  const sonic = sonicFit(a, b);
  const trans = transitionFit(a, b);
  const skipRisk = capped((scene * 0.5 + (1 - trans) * 0.5) * 0.5, PEN_CAPS.skip_risk);
  const sub = subgenreFit(a, b);
  const subPen = capped((1 - sub) * 0.4, PEN_CAPS.subgenre_conflict);
  const prodShift = capped(Math.abs(numOr(a.dims.aggressiveness) - numOr(b.dims.aggressiveness)) * 0.3, PEN_CAPS.production_shift);

  const rawTotal = artistBreak + scenePen + skipRisk + subPen + prodShift;
  const total = Math.min(PEN_CAPS.total, rawTotal);
  return { artistBreak, scenePen, skipRisk, subPen, prodShift, total, sonic, trans, scene, sub };
}

function pairFit(a: Track, b: Track) {
  const p = penalties(a, b);
  const ctx = artistContextFit(a, b);
  const composite = 0.55 * p.sonic + 0.15 * p.sub + 0.15 * ctx + 0.15 * p.trans;
  const surprise =
    p.sonic >= ARTIST_SURPRISE.sonic &&
    p.trans >= ARTIST_SURPRISE.transition &&
    ctx >= ARTIST_SURPRISE.ctx;
  const final = Math.max(0, Math.min(1, composite - (surprise ? 0 : p.total)));
  return { sonic: p.sonic, sub: p.sub, ctx, scene: p.scene, trans: p.trans, skip: p.skipRisk, penalty: p.total, surprise, final };
}

// ─── House gate w/ confidence ───────────────────────────────────────────────
function houseGate(t: Track): { pass: boolean; failed?: string; skipped?: boolean } {
  const hp = t.house_profile ?? {};
  const conf = numOr(hp.analysis_confidence, 0);
  if (!t.is_house_related) return { pass: true, skipped: true };
  if (conf < HOUSE_GATE_MIN_CONF) return { pass: true, skipped: true }; // low confidence → don't hard-reject
  const groove = numOr(hp.four_on_the_floor_strength ?? 0.5);
  const kick = numOr(hp.kick_weight ?? 0.5);
  const bass = numOr(hp.bassline_prominence ?? 0.5);
  if (groove < HOUSE_GATES.groove) return { pass: false, failed: `groove<${HOUSE_GATES.groove} (${groove.toFixed(2)})` };
  if (kick < HOUSE_GATES.kick) return { pass: false, failed: `kick<${HOUSE_GATES.kick} (${kick.toFixed(2)})` };
  if (bass < HOUSE_GATES.bass) return { pass: false, failed: `bass<${HOUSE_GATES.bass} (${bass.toFixed(2)})` };
  return { pass: true };
}

// ─── Bucketing (coarser) ────────────────────────────────────────────────────
function bucketKey(t: Track): string {
  if (t.is_house_related) {
    const sg = t.house_profile?.primary_house_subgenre || t.primary_subgenre || "house_generic";
    for (const [k, ns] of Object.entries(HOUSE_NEIGHBORS)) {
      if (sg === k) return `house::${k}`;
      if (ns.includes(sg)) return `house::${k}`;
    }
    return `house::${sg}`;
  }
  // Coarser: family only, so 150 varied tracks don't split into 73 dust buckets
  return t.music_family ?? "other";
}

// ─── Greedy clustering within a bucket ──────────────────────────────────────
function greedyCluster(tracks: Track[]) {
  const sorted = tracks.slice().sort((a, b) => {
    const idA = numOr(a.artist_context?.artist_identity_strength, 0.5);
    const idB = numOr(b.artist_context?.artist_identity_strength, 0.5);
    return idB - idA;
  });

  const used = new Set<string>();
  const clusters: { seed: Track; members: { t: Track; fit: any }[] }[] = [];

  for (const seed of sorted) {
    if (used.has(seed.spotify_track_id)) continue;
    const members: { t: Track; fit: any }[] = [{
      t: seed,
      fit: { sonic: 1, sub: 1, ctx: 1, scene: 0, trans: 1, skip: 0, penalty: 0, surprise: false, final: 1 },
    }];
    used.add(seed.spotify_track_id);

    let expanded = true;
    while (expanded && members.length < 50) {
      expanded = false;
      const cands = sorted.filter((x) => !used.has(x.spotify_track_id));
      const scored = cands.map((c) => {
        let sumFinal = 0, sumSonic = 0, sumCtx = 0, sumSub = 0, sumTrans = 0, sumSkip = 0, sumPen = 0, sumScene = 0;
        let minFinal = 1;
        let surprise = false;
        for (const m of members) {
          const f = pairFit(m.t, c);
          sumFinal += f.final; sumSonic += f.sonic; sumCtx += f.ctx; sumSub += f.sub;
          sumTrans += f.trans; sumSkip += f.skip; sumPen += f.penalty; sumScene += f.scene;
          if (f.final < minFinal) minFinal = f.final;
          if (f.surprise) surprise = true;
        }
        const n = members.length;
        return {
          c, minFinal, surprise,
          avg: sumFinal / n,
          sonic: sumSonic / n, ctx: sumCtx / n, sub: sumSub / n,
          trans: sumTrans / n, skip: sumSkip / n, penalty: sumPen / n, scene: sumScene / n,
        };
      }).sort((a, b) => b.avg - a.avg);

      // Formation tier: use CANDIDATE thresholds so groups can nucleate
      for (const s of scored) {
        if (s.avg < CAND.centroid_fit) break; // sorted desc, nothing lower will pass
        if (s.sonic < CAND.sonic_fit) continue;
        if (s.minFinal < CAND.avg_pair_fit - 0.10) continue; // let one soft member slide a bit
        members.push({
          t: s.c,
          fit: {
            sonic: s.sonic, sub: s.sub, ctx: s.ctx, scene: s.scene,
            trans: s.trans, skip: s.skip, penalty: s.penalty,
            surprise: s.surprise, final: s.avg,
          },
        });
        used.add(s.c.spotify_track_id);
        expanded = true;
        break;
      }
    }
    clusters.push({ seed, members });
  }
  return clusters;
}

function clusterName(seed: Track, members: Track[]): string {
  if (seed.is_house_related) {
    const sg = seed.house_profile?.primary_house_subgenre || "house";
    const avgDark = members.reduce((s, m) => s + numOr(m.dims.darkness), 0) / members.length;
    const avgEnergy = members.reduce((s, m) => s + numOr(m.dims.energy_score), 0) / members.length;
    const mood = avgDark > 0.6 ? "Nocturno" : avgEnergy > 0.75 ? "Peak" : "Sunset";
    return `${mood} ${String(sg).replace(/_/g, " ")}`;
  }
  const fam = seed.music_family ?? "mix";
  const subs = new Set(members.map((m) => m.primary_subgenre).filter(Boolean));
  return `${String(fam).replace(/_/g, " ")} · ${Array.from(subs).slice(0, 2).join(" / ")}`;
}

function detectProblemCases(clusters: { seed: Track; members: { t: Track; fit: any }[] }[]) {
  const cases: any[] = [];
  for (const c of clusters) {
    const artists = c.members.map((m) => m.t.artist_name.toLowerCase());
    if (artists.some((a) => a.includes("kanye")) && artists.some((a) => a.includes("elton"))) {
      cases.push({
        case: "Kanye + Elton en el mismo cluster",
        cluster_seed: c.seed.track_name,
        artists_in_cluster: Array.from(new Set(c.members.map((m) => m.t.artist_name))),
        avg_final_fit: c.members.reduce((s, m) => s + m.fit.final, 0) / c.members.length,
      });
    }
    const rufus = c.members.filter((m) => /r[uü]f[uü]s/i.test(m.t.artist_name));
    if (rufus.length > 0) {
      cases.push({
        case: "RÜFÜS DU SOL en cluster",
        cluster_seed: c.seed.track_name,
        rufus_tracks: rufus.map((r) => ({ name: r.t.track_name, subgenre: r.t.primary_subgenre, fit: r.fit.final })),
      });
    }
  }
  return cases;
}

// ─── Classify each formed cluster ───────────────────────────────────────────
type ClusterStatus =
  | "promoted"
  | "candidate_needs_more_tracks"
  | "candidate_needs_review"
  | "rejected_incoherent"
  | "single_track";

function classify(size: number, avgFinal: number, minFinal: number, avgSonic: number): { status: ClusterStatus; reason: string } {
  if (size < 2) return { status: "single_track", reason: "no_pair_evidence" };
  // Coherent enough to eventually promote?
  const coherent =
    avgFinal >= CAND.centroid_fit &&
    avgSonic >= CAND.sonic_fit &&
    minFinal >= CAND.avg_pair_fit - 0.10;
  if (!coherent) return { status: "rejected_incoherent", reason: `avg=${avgFinal.toFixed(2)} sonic=${avgSonic.toFixed(2)} min=${minFinal.toFixed(2)} below candidate floor` };

  if (size < CAND.min_size) return { status: "candidate_needs_more_tracks", reason: `size=${size}<${CAND.min_size}` };

  const meetsPromoted =
    size >= PROMO.min_size &&
    avgFinal >= PROMO.centroid_fit &&
    minFinal >= PROMO.min_pair_fit &&
    avgSonic >= PROMO.sonic_coherence;
  if (meetsPromoted) return { status: "promoted", reason: "meets_promoted_thresholds" };

  // Close but not enough
  if (size < PROMO.min_size) return { status: "candidate_needs_more_tracks", reason: `size=${size}<${PROMO.min_size}` };
  return { status: "candidate_needs_review", reason: `avg=${avgFinal.toFixed(2)} sonic=${avgSonic.toFixed(2)} min=${minFinal.toFixed(2)} below promoted floor` };
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

    // Allow re-running without touching guard: accept sample_id explicitly OR pick latest for the user.
    let sampleId: string | undefined = body.sample_id;
    if (!sampleId) {
      const { data: latest } = await adm
        .from("diagnostic_samples")
        .select("id, phase2_status")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(1);
      sampleId = latest?.[0]?.id;
    }
    if (!sampleId) return json({ error: "no sample" }, 400);

    const { data: sample } = await adm
      .from("diagnostic_samples")
      .select("id, user_id, spotify_track_ids, phase2_status")
      .eq("id", sampleId).maybeSingle();
    if (!sample) return json({ error: "sample not found" }, 404);
    if (sample.user_id !== userId) return json({ error: "forbidden" }, 403);

    // Mark running for this recalibrated pass (idempotent — we accept re-runs from the UI)
    await adm.from("diagnostic_samples").update({
      phase2_status: "running",
      phase2_started_at: new Date().toISOString(),
      phase2_block_reason: null,
    }).eq("id", sampleId);

    const ids: string[] = sample.spotify_track_ids ?? [];
    const analyses: any[] = [];
    for (let i = 0; i < ids.length; i += 500) {
      const chunk = ids.slice(i, i + 500);
      const { data } = await adm
        .from("ai_track_analysis")
        .select("spotify_track_id, track_name, artist_name, music_family, primary_subgenre, secondary_subgenres, is_house_related, house_profile, artist_context, language, energy_score, darkness, dance_feel, softness, aggressiveness, nostalgia, bass_level, drum_intensity, vocal_intensity, melody_level, emotional_intensity, song_variation, tempo_feel")
        .eq("user_id", userId)
        .eq("analysis_version", "v3")
        .in("spotify_track_id", chunk);
      if (data) analyses.push(...data);
    }

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
      analysis_confidence: numOr(a.artist_context?.analysis_confidence ?? a.house_profile?.analysis_confidence, 0.6),
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

    // Segmentation with confidence-aware gating
    const buckets = new Map<string, Track[]>();
    const gateRejected: { track: Track; reason: string }[] = [];
    for (const t of tracks) {
      const g = houseGate(t);
      if (!g.pass && t.analysis_confidence >= ANALYSIS_CONF_HARD_GATE) {
        gateRejected.push({ track: t, reason: `house_gate:${g.failed}` });
        continue;
      }
      const k = bucketKey(t);
      if (!buckets.has(k)) buckets.set(k, []);
      buckets.get(k)!.push(t);
    }

    // Score-distribution sample: 10 random pairs from all bucket-eligible tracks
    const sampleTracks = tracks.filter((t) => !gateRejected.some((g) => g.track.spotify_track_id === t.spotify_track_id));
    const scoreSamples: any[] = [];
    for (let i = 0; i < Math.min(10, Math.floor(sampleTracks.length / 2)); i++) {
      const a = sampleTracks[Math.floor(Math.random() * sampleTracks.length)];
      const b = sampleTracks[Math.floor(Math.random() * sampleTracks.length)];
      if (a.spotify_track_id === b.spotify_track_id) continue;
      const f = pairFit(a, b);
      scoreSamples.push({
        a: `${a.track_name} — ${a.artist_name}`,
        b: `${b.track_name} — ${b.artist_name}`,
        sonic: +f.sonic.toFixed(3),
        subgenre: +f.sub.toFixed(3),
        ctx: +f.ctx.toFixed(3),
        transition: +f.trans.toFixed(3),
        scene_distance: +f.scene.toFixed(3),
        penalty: +f.penalty.toFixed(3),
        final: +f.final.toFixed(3),
      });
    }

    type ClusterOut = {
      name: string; bucket: string; seed: Track; members: { t: Track; fit: any }[];
      avg_final: number; min_final: number; avg_sonic: number;
      status: ClusterStatus; reason: string;
    };
    const allClusters: ClusterOut[] = [];
    for (const [key, list] of buckets.entries()) {
      const raw = greedyCluster(list);
      for (const c of raw) {
        const avg = c.members.reduce((s, m) => s + m.fit.final, 0) / c.members.length;
        const min = c.members.reduce((m, x) => Math.min(m, x.fit.final), 1);
        const avgSonic = c.members.reduce((s, m) => s + (m.fit.sonic ?? 1), 0) / c.members.length;
        const cls = classify(c.members.length, avg, min, avgSonic);
        allClusters.push({
          name: clusterName(c.seed, c.members.map((m) => m.t)),
          bucket: key, seed: c.seed, members: c.members,
          avg_final: avg, min_final: min, avg_sonic: avgSonic,
          status: cls.status, reason: cls.reason,
        });
      }
    }

    // Unassigned: tracks not in any promoted OR candidate cluster
    const keptStatuses: ClusterStatus[] = ["promoted", "candidate_needs_more_tracks", "candidate_needs_review"];
    const kept = allClusters.filter((c) => keptStatuses.includes(c.status));
    const keptIds = new Set<string>();
    for (const c of kept) for (const m of c.members) keptIds.add(m.t.spotify_track_id);

    const unassigned: { track: Track; reason: string }[] = [];
    for (const c of allClusters) {
      if (keptStatuses.includes(c.status)) continue;
      for (const m of c.members) {
        if (!keptIds.has(m.t.spotify_track_id)) unassigned.push({ track: m.t, reason: c.status === "single_track" ? "single_track_no_match" : `rejected_incoherent:${c.reason}` });
      }
    }
    for (const r of gateRejected) if (!keptIds.has(r.track.spotify_track_id)) unassigned.push(r);
    const analyzedIds = new Set(tracks.map((t) => t.spotify_track_id));
    for (const id of ids) if (!analyzedIds.has(id)) {
      unassigned.push({ track: { spotify_track_id: id, track_name: nameById.get(id)?.track_name ?? "(unknown)", artist_name: nameById.get(id)?.artist_name ?? "(unknown)" } as any, reason: "no_v3_analysis" });
    }

    // Persist — clear previous v3-hardened runs for this sample
    await adm.from("cluster_candidates").delete().eq("user_id", userId).eq("sample_id", sampleId).eq("phase", "v3-hardened");
    await adm.from("unassigned_tracks").delete().eq("user_id", userId).eq("sample_id", sampleId).eq("phase", "v3-hardened");

    for (const c of kept) {
      const { data: inserted, error: insErr } = await adm.from("cluster_candidates").insert({
        user_id: userId, sample_id: sampleId, phase: "v3-hardened",
        status: c.status === "promoted" ? "candidate" : c.status,
        name: c.name, music_family: c.seed.music_family,
        dominant_subgenre: c.seed.is_house_related ? (c.seed.house_profile?.primary_house_subgenre ?? c.seed.primary_subgenre) : c.seed.primary_subgenre,
        size: c.members.length,
        avg_compat: c.avg_final, min_compat: c.min_final,
        avg_final_fit: c.avg_final, min_final_fit: c.min_final,
        sonic_summary: `bucket=${c.bucket} status=${c.status}`,
        language_group: c.members[0]?.t.language ?? null,
      }).select("id").maybeSingle();
      if (insErr || !inserted) { console.error("insert cluster err", insErr); continue; }
      const rows = c.members.map((m, i) => ({
        cluster_id: inserted.id, user_id: userId,
        spotify_track_id: m.t.spotify_track_id, position: i,
        compat_to_centroid: m.fit.final,
        sonic_fit: m.fit.sonic, subgenre_fit: m.fit.sub,
        artist_context_fit: m.fit.ctx, scene_distance: m.fit.scene,
        skip_risk: m.fit.skip, transition_fit: m.fit.trans,
        artist_context_penalty: m.fit.penalty,
        final_fit: m.fit.final, is_artist_surprise: m.fit.surprise,
      }));
      if (rows.length) await adm.from("cluster_candidate_tracks").insert(rows);
    }

    if (unassigned.length) {
      const seen = new Set<string>();
      const uRows = unassigned.filter((u) => {
        if (seen.has(u.track.spotify_track_id)) return false;
        seen.add(u.track.spotify_track_id); return true;
      }).map((u) => ({
        user_id: userId, spotify_track_id: u.track.spotify_track_id,
        sample_id: sampleId, phase: "v3-hardened", reason: u.reason,
        details: {
          track_name: u.track.track_name, artist_name: u.track.artist_name,
          music_family: u.track.music_family, primary_subgenre: u.track.primary_subgenre,
        },
      }));
      for (let i = 0; i < uRows.length; i += 200) {
        await adm.from("unassigned_tracks").upsert(uRows.slice(i, i + 200), { onConflict: "user_id,spotify_track_id" });
      }
    }

    // Rejection tally
    const rejTally: Record<string, number> = {};
    for (const c of allClusters) {
      if (c.status === "promoted" || c.status === "candidate_needs_more_tracks" || c.status === "candidate_needs_review") continue;
      const key = c.status === "single_track" ? "single_track_no_neighbor" : "rejected_incoherent";
      rejTally[key] = (rejTally[key] ?? 0) + 1;
    }
    rejTally["house_hard_gate"] = gateRejected.length;

    const bucketStats: Record<string, number> = {};
    for (const [k, list] of buckets.entries()) bucketStats[k] = list.length;

    // Score distribution across all formed clusters
    const allFinals: number[] = [];
    for (const c of allClusters) for (const m of c.members) if (typeof m.fit.final === "number" && c.members.length > 1) allFinals.push(m.fit.final);
    allFinals.sort((a, b) => a - b);
    const dist = allFinals.length ? {
      min: +allFinals[0].toFixed(3),
      p25: +allFinals[Math.floor(allFinals.length * 0.25)].toFixed(3),
      p50: +allFinals[Math.floor(allFinals.length * 0.50)].toFixed(3),
      p75: +allFinals[Math.floor(allFinals.length * 0.75)].toFixed(3),
      max: +allFinals[allFinals.length - 1].toFixed(3),
      avg: +(allFinals.reduce((a, b) => a + b, 0) / allFinals.length).toFixed(3),
      n: allFinals.length,
    } : null;

    const promoted = allClusters.filter((c) => c.status === "promoted");
    const needsMore = allClusters.filter((c) => c.status === "candidate_needs_more_tracks");
    const needsReview = allClusters.filter((c) => c.status === "candidate_needs_review");
    const rejected = allClusters.filter((c) => c.status === "rejected_incoherent" || c.status === "single_track");
    const problemCases = detectProblemCases(kept);

    const clusterReport = (c: ClusterOut) => ({
      name: c.name, bucket: c.bucket, size: c.members.length,
      status: c.status, reason: c.reason,
      avg_final_fit: +c.avg_final.toFixed(3),
      min_final_fit: +c.min_final.toFixed(3),
      avg_sonic: +c.avg_sonic.toFixed(3),
      dominant_subgenre: c.seed.is_house_related ? c.seed.house_profile?.primary_house_subgenre : c.seed.primary_subgenre,
      tracks: c.members.map((m) => ({
        name: m.t.track_name, artist: m.t.artist_name,
        subgenre: m.t.primary_subgenre,
        final_fit: +(m.fit.final ?? 0).toFixed(3),
        sonic: +(m.fit.sonic ?? 0).toFixed(3),
        artist_context: +(m.fit.ctx ?? 0).toFixed(3),
        scene_distance: +(m.fit.scene ?? 0).toFixed(3),
        artist_penalty: +(m.fit.penalty ?? 0).toFixed(3),
        surprise: !!m.fit.surprise,
      })),
    });

    const report = {
      finished_at: new Date().toISOString(),
      sample_size: ids.length, analyzed_v3: tracks.length,
      buckets: bucketStats,
      bucket_count: buckets.size,
      calibration_version: "v3.1-two-tier",
      score_distribution: dist,
      pairwise_samples: scoreSamples,
      rejection_reasons: rejTally,
      counts: {
        promoted: promoted.length,
        candidate_needs_more_tracks: needsMore.length,
        candidate_needs_review: needsReview.length,
        rejected: rejected.length,
        unassigned_tracks: unassigned.length,
        gate_rejected_tracks: gateRejected.length,
      },
      clusters_promoted: promoted.map(clusterReport),
      clusters_candidate_more_tracks: needsMore.map(clusterReport),
      clusters_candidate_review: needsReview.map(clusterReport),
      clusters_rejected: rejected.map((c) => ({
        bucket: c.bucket, size: c.members.length, reason: c.reason,
        seed: `${c.seed.track_name} — ${c.seed.artist_name}`,
        avg_final_fit: +c.avg_final.toFixed(3),
        min_final_fit: +c.min_final.toFixed(3),
      })),
      unassigned: unassigned.map((u) => ({
        name: u.track.track_name, artist: u.track.artist_name,
        subgenre: u.track.primary_subgenre, reason: u.reason,
      })),
      problem_cases: problemCases,
      thresholds: { candidate: CAND, promoted: PROMO, house_gates: HOUSE_GATES, house_gate_min_confidence: HOUSE_GATE_MIN_CONF, penalty_caps: PEN_CAPS },
    };

    await adm.from("diagnostic_samples").update({
      phase2_status: "completed_awaiting_review",
      phase2_finished_at: new Date().toISOString(),
      phase2_report: report,
      phase2_progress: { done: true, promoted: promoted.length, unassigned: unassigned.length },
    }).eq("id", sampleId);

    return json({
      ok: true, sample_id: sampleId,
      promoted: promoted.length,
      candidates_more_tracks: needsMore.length,
      candidates_review: needsReview.length,
      rejected: rejected.length,
      unassigned: unassigned.length,
      distribution: dist,
    });
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
