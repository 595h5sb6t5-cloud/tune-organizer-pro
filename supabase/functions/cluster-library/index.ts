// Cluster-first playlist pipeline. NO AI. Pure sonic math.
// Body: { sample_size?: number, persist?: boolean }
// Returns clusters + unassigned. Only persists when persist=true.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

// ---------- Tunables (Master Prompt v4) ----------
// Hard rule: never publish a playlist with fewer than 10 tracks.
const MIN_SIZE = 10;
const AVG_COMPAT_MIN = 0.84;        // average compat inside cluster
const MIN_COMPAT_FLOOR = 0.74;      // no single track below this
const PCT_ABOVE_STRONG = 0.80;      // at least 80% of tracks above STRONG_FIT
const STRONG_FIT = 0.82;
const SEED_JOIN_THRESHOLD = 0.86;   // stricter join to protect sonic identity
const MAX_DIM_SPREAD = 0.32;        // tighter per-dim spread
// Weights for numeric sonic dims (must sum roughly, we normalize).
const NUMERIC_WEIGHTS: Record<string, number> = {
  energy_score: 1.3,
  darkness: 1.2,
  softness: 1.0,
  aggressiveness: 1.2,
  dance_feel: 1.2,
  drum_intensity: 1.1,
  bass_level: 1.1,
  melody_level: 1.0,
  vocal_intensity: 1.0,
  emotional_intensity: 0.9,
  song_variation: 0.8,
  nostalgia: 0.5,
};
const CATEGORICAL_WEIGHT = 0.9; // per matched categorical dim
const CATEGORICAL_FIELDS = ["tempo_feel", "beat_style", "sound_texture", "main_mood"] as const;

// Language grouping (English isolated; Romance grouped; instrumental neutral)
function langGroup(lang: string | null | undefined): "english" | "romance" | "instrumental" | "other" | "unknown" {
  if (!lang) return "unknown";
  const l = lang.toLowerCase();
  if (l.includes("english") || l === "en") return "english";
  if (l.includes("instrumental")) return "instrumental";
  if (["spanish", "portuguese", "italian", "french", "es", "pt", "it", "fr"].some((k) => l.includes(k))) return "romance";
  return "other";
}
function langCompatible(a: string, b: string) {
  if (a === "instrumental" || b === "instrumental") return true;
  if (a === "unknown" || b === "unknown") return true; // don't block on missing data
  return a === b;
}

type Row = {
  spotify_track_id: string;
  track_name: string | null;
  artist_name: string | null;
  language: string | null;
  tempo_feel: string | null;
  beat_style: string | null;
  sound_texture: string | null;
  main_mood: string | null;
  main_genre: string | null;
  [k: string]: unknown;
};

function num(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : null;
}

function buildVector(r: Row) {
  const vec: Record<string, number | null> = {};
  for (const k of Object.keys(NUMERIC_WEIGHTS)) vec[k] = num((r as any)[k]);
  return vec;
}

function compat(a: Row, b: Row): number {
  const va = buildVector(a);
  const vb = buildVector(b);
  let wSum = 0;
  let dSum = 0;
  for (const [k, w] of Object.entries(NUMERIC_WEIGHTS)) {
    const x = va[k], y = vb[k];
    if (x === null || y === null) continue;
    wSum += w;
    dSum += w * Math.abs(x - y);
  }
  const numeric = wSum > 0 ? 1 - dSum / wSum : 0.5;
  let catBonus = 0;
  let catCount = 0;
  for (const f of CATEGORICAL_FIELDS) {
    const av = (a as any)[f];
    const bv = (b as any)[f];
    if (!av || !bv) continue;
    catCount++;
    if (String(av).toLowerCase() === String(bv).toLowerCase()) catBonus += 1;
  }
  const cat = catCount > 0 ? catBonus / catCount : 0.5;
  // Blend: numeric dominates, categorical tempers
  return Math.max(0, Math.min(1, 0.75 * numeric + 0.25 * cat));
}

function centroidRow(rows: Row[]): Row {
  const out: any = { spotify_track_id: "__centroid__", track_name: null, artist_name: null };
  for (const k of Object.keys(NUMERIC_WEIGHTS)) {
    let s = 0, c = 0;
    for (const r of rows) { const v = num((r as any)[k]); if (v !== null) { s += v; c++; } }
    out[k] = c > 0 ? s / c : null;
  }
  for (const f of CATEGORICAL_FIELDS) {
    const counts = new Map<string, number>();
    for (const r of rows) { const v = (r as any)[f]; if (v) counts.set(String(v).toLowerCase(), (counts.get(String(v).toLowerCase()) ?? 0) + 1); }
    let best = null, bc = 0;
    for (const [k, c] of counts) if (c > bc) { best = k; bc = c; }
    out[f] = best;
  }
  out.language = null;
  return out as Row;
}

function dimSpreadOk(rows: Row[]): { ok: boolean; worst: number } {
  let worst = 0;
  for (const k of Object.keys(NUMERIC_WEIGHTS)) {
    let mn = Infinity, mx = -Infinity, any = false;
    for (const r of rows) {
      const v = num((r as any)[k]);
      if (v === null) continue;
      any = true;
      if (v < mn) mn = v;
      if (v > mx) mx = v;
    }
    if (!any) continue;
    const spread = mx - mn;
    if (spread > worst) worst = spread;
  }
  return { ok: worst <= MAX_DIM_SPREAD, worst };
}

function dominantDimensions(rows: Row[]) {
  const c = centroidRow(rows);
  const strong: { dim: string; value: number }[] = [];
  for (const k of Object.keys(NUMERIC_WEIGHTS)) {
    const v = num((c as any)[k]);
    if (v === null) continue;
    // Strong = either very high or very low + low spread on that dim
    let mn = 1, mx = 0, cnt = 0;
    for (const r of rows) { const x = num((r as any)[k]); if (x === null) continue; mn = Math.min(mn, x); mx = Math.max(mx, x); cnt++; }
    if (cnt < 2) continue;
    const spread = mx - mn;
    if ((v >= 0.7 || v <= 0.3) && spread <= 0.25) strong.push({ dim: k, value: v });
  }
  strong.sort((a, b) => Math.abs(b.value - 0.5) - Math.abs(a.value - 0.5));
  return {
    strong: strong.slice(0, 6),
    tempo: (c as any).tempo_feel,
    beat: (c as any).beat_style,
    texture: (c as any).sound_texture,
    mood: (c as any).main_mood,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const auth = req.headers.get("Authorization") ?? "";
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const svc = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const userClient = createClient(supabaseUrl, anon, { global: { headers: { Authorization: auth } } });
    const adm = createClient(supabaseUrl, svc);
    const { data: { user }, error: uerr } = await userClient.auth.getUser();
    if (uerr || !user) return json({ error: "unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const sampleSize: number | undefined = body.sample_size;
    const persist: boolean = body.persist === true;
    const runId = crypto.randomUUID();

    // Pull deep analyses (v2.1 and v3.0 share the same numeric sonic columns).
    const SELECT_COLS = "spotify_track_id, track_name, artist_name, language, tempo_feel, beat_style, sound_texture, main_mood, main_genre, energy_score, melody_level, bass_level, drum_intensity, vocal_intensity, aggressiveness, softness, darkness, nostalgia, dance_feel, emotional_intensity, song_variation, schema_version";
    const PAGE = 1000;
    const allAnalyses: any[] = [];
    for (let offset = 0; ; offset += PAGE) {
      const { data: page, error: aerr } = await adm
        .from("ai_track_analysis")
        .select(SELECT_COLS)
        .eq("user_id", user.id)
        .in("schema_version", ["v2.1", "v3.0"])
        .not("spotify_track_id", "is", null)
        .order("spotify_track_id", { ascending: true })
        .range(offset, offset + PAGE - 1);
      if (aerr) return json({ error: aerr.message }, 500);
      const chunk = page ?? [];
      allAnalyses.push(...chunk);
      if (chunk.length < PAGE) break;
      if (offset > 50000) break;
    }

    // Library universe: every active liked song (paginated).
    const likedIds = new Set<string>();
    for (let offset = 0; ; offset += PAGE) {
      const { data: page, error: lerr } = await adm
        .from("liked_songs")
        .select("spotify_track_id")
        .eq("user_id", user.id)
        .eq("is_active", true)
        .eq("is_available", true)
        .order("spotify_track_id", { ascending: true })
        .range(offset, offset + PAGE - 1);
      if (lerr) return json({ error: lerr.message }, 500);
      const chunk = page ?? [];
      for (const l of chunk) likedIds.add((l as any).spotify_track_id);
      if (chunk.length < PAGE) break;
      if (offset > 50000) break;
    }

    // Deduplicate by spotify_track_id, preferring the newest schema (v3.0 over v2.1).
    const byTrack = new Map<string, any>();
    for (const r of allAnalyses) {
      if (r.energy_score === null) continue;
      if (likedIds.size > 0 && !likedIds.has(r.spotify_track_id)) continue;
      const prev = byTrack.get(r.spotify_track_id);
      if (!prev || (prev.schema_version !== "v3.0" && r.schema_version === "v3.0")) {
        byTrack.set(r.spotify_track_id, r);
      }
    }
    let rows: Row[] = [...byTrack.values()] as Row[];
    const libraryTotal = likedIds.size;
    const pendingAnalysis = Math.max(libraryTotal - rows.length, 0);
    if (rows.length === 0) {
      return json({ error: "No hay canciones con análisis profundo. Corre el Deep Analysis primero." }, 400);
    }


    // Enrich track/artist name if missing from liked_songs.
    const missing = rows.filter((r) => !r.track_name || !r.artist_name).map((r) => r.spotify_track_id);
    if (missing.length) {
      const m = new Map<string, any>();
      for (let i = 0; i < missing.length; i += 300) {
        const { data: liked } = await adm
          .from("liked_songs")
          .select("spotify_track_id, track_name, artist_name")
          .eq("user_id", user.id)
          .in("spotify_track_id", missing.slice(i, i + 300));
        for (const l of liked ?? []) m.set((l as any).spotify_track_id, l);
      }
      rows = rows.map((r) => {
        const l: any = m.get(r.spotify_track_id);
        if (!l) return r;
        return { ...r, track_name: r.track_name ?? l.track_name, artist_name: r.artist_name ?? l.artist_name };
      });
    }


    // Optional sample: prefer diverse subset by shuffling
    if (sampleSize && rows.length > sampleSize) {
      rows = rows.map((r) => ({ r, k: Math.random() })).sort((a, b) => a.k - b.k).slice(0, sampleSize).map((x) => x.r);
    }

    // Group by language
    const groups: Record<string, Row[]> = {};
    for (const r of rows) {
      const g = langGroup(r.language);
      (groups[g] ??= []).push(r);
    }

    type Cluster = {
      id: string;
      language_group: string;
      members: Row[];
      avg_compat: number;
      min_compat: number;
      status: "candidate" | "rejected";
      rejection_reason?: string;
    };
    const clusters: Cluster[] = [];
    const unassigned: Row[] = [];
    const leftovers: Row[] = [];


    // Greedy clustering inside each language group
    for (const [g, list] of Object.entries(groups)) {
      const pool = [...list];
      // Sort by "distinctiveness" (distance from 0.5 across dims) so we seed on strong tracks first
      pool.sort((a, b) => {
        const score = (r: Row) => {
          let s = 0, c = 0;
          for (const k of Object.keys(NUMERIC_WEIGHTS)) { const v = num((r as any)[k]); if (v === null) continue; s += Math.abs(v - 0.5); c++; }
          return c ? s / c : 0;
        };
        return score(b) - score(a);
      });


      const used = new Set<string>();
      for (const seed of pool) {
        if (used.has(seed.spotify_track_id)) continue;
        const members: Row[] = [seed];
        used.add(seed.spotify_track_id);
        // Grow greedily
        let changed = true;
        while (changed && members.length < 45) {
          changed = false;
          const c = centroidRow(members);
          const candidates: { r: Row; s: number }[] = [];
          for (const r of pool) {
            if (used.has(r.spotify_track_id)) continue;
            const s = compat(c, r);
            if (s >= SEED_JOIN_THRESHOLD) candidates.push({ r, s });
          }
          candidates.sort((a, b) => b.s - a.s);
          // Try adding top candidate if spread still ok
          for (const { r } of candidates) {
            const test = [...members, r];
            const spread = dimSpreadOk(test);
            if (!spread.ok) continue;
            members.push(r);
            used.add(r.spotify_track_id);
            changed = true;
            break;
          }
        }

        // Compute metrics
        const cent = centroidRow(members);
        const compats = members.map((m) => compat(cent, m));
        const avg = compats.reduce((a, b) => a + b, 0) / compats.length;
        const mn = Math.min(...compats);

        // Validate against master-prompt quality gates
        const pctStrong = compats.filter((c) => c >= STRONG_FIT).length / compats.length;
        let ok = true;
        let reason: string | undefined;
        if (members.length < MIN_SIZE) { ok = false; reason = `size ${members.length} < ${MIN_SIZE}`; }
        else if (avg < AVG_COMPAT_MIN) { ok = false; reason = `avg_compat ${avg.toFixed(2)} < ${AVG_COMPAT_MIN}`; }
        else if (mn < MIN_COMPAT_FLOOR) { ok = false; reason = `min_compat ${mn.toFixed(2)} < ${MIN_COMPAT_FLOOR}`; }
        else if (pctStrong < PCT_ABOVE_STRONG) { ok = false; reason = `only ${(pctStrong * 100).toFixed(0)}% of tracks >= ${STRONG_FIT} (need ${PCT_ABOVE_STRONG * 100}%)`; }

        if (ok) {
          clusters.push({
            id: crypto.randomUUID(),
            language_group: g,
            members,
            avg_compat: avg,
            min_compat: mn,
            status: "candidate",
          });
        }
        // Failed attempts keep their members locked here (re-seeding the whole pool
        // is quadratic and blows the function's CPU budget). They are recovered
        // cheaply in the rescue pass below.

      }

      // Whatever is still loose in this language group after the greedy pass.
      const clusteredIds = new Set(clusters.flatMap((c) => c.members.map((m) => m.spotify_track_id)));
      for (const r of list) {
        if (!clusteredIds.has(r.spotify_track_id)) leftovers.push(r);
      }
    }

    // ---- Rescue pass: try to place leftovers into an existing valid cluster ----
    // Keeps the quality gates intact (track must be strongly compatible with the
    // centroid and must not blow the per-dimension spread) but stops throwing away
    // hundreds of tracks that simply never got a good seed.
    const centroidCache = new Map<string, Row>();
    const centroidOf = (c: Cluster) => {
      let cached = centroidCache.get(c.id);
      if (!cached) { cached = centroidRow(c.members); centroidCache.set(c.id, cached); }
      return cached;
    };
    for (const r of leftovers) {
      const g = langGroup(r.language);
      let best: { c: Cluster; s: number } | null = null;
      for (const c of clusters) {
        if (c.members.length >= 50) continue;
        if (!langCompatible(g, c.language_group)) continue;
        const s = compat(centroidOf(c), r);
        if (s < STRONG_FIT) continue;
        if (!best || s > best.s) best = { c, s };
      }
      if (best && dimSpreadOk([...best.c.members, r]).ok) {
        best.c.members.push(r);
        centroidCache.delete(best.c.id);
      } else {
        unassigned.push(r);
      }
    }
    // Recompute cluster metrics after the rescue pass.
    for (const c of clusters) {
      const cent = centroidRow(c.members);
      const compats = c.members.map((m) => compat(cent, m));
      c.avg_compat = compats.reduce((a, b) => a + b, 0) / compats.length;
      c.min_compat = Math.min(...compats);
    }



    // Build report
    const report = clusters.map((c) => {
      const cent = centroidRow(c.members);
      const compats = c.members.map((m) => ({ m, s: compat(cent, m) }));
      compats.sort((a, b) => a.s - b.s);
      const worst = compats[0];
      const dims = dominantDimensions(c.members);
      return {
        id: c.id,
        language_group: c.language_group,
        size: c.members.length,
        avg_compat: Number(c.avg_compat.toFixed(3)),
        min_compat: Number(c.min_compat.toFixed(3)),
        least_compatible: worst ? { name: worst.m.track_name, artist: worst.m.artist_name, compat: Number(worst.s.toFixed(3)) } : null,
        dominant_dimensions: dims,
        tracks: c.members.map((m) => ({
          spotify_track_id: m.spotify_track_id,
          name: m.track_name, artist: m.artist_name,
          compat: Number(compat(cent, m).toFixed(3)),
        })),
      };
    });

    const unassignedReport = unassigned.map((u) => ({
      spotify_track_id: u.spotify_track_id, name: u.track_name, artist: u.artist_name, language: u.language,
    }));

    if (persist) {
      // Wipe previous unpromoted candidates for this user
      await adm.from("cluster_candidates").delete().eq("user_id", user.id).eq("status", "candidate");
      await adm.from("unassigned_tracks").delete().eq("user_id", user.id);

      for (const c of clusters) {
        const cent = centroidRow(c.members);
        const dims = dominantDimensions(c.members);
        const { data: ins, error: cErr } = await adm.from("cluster_candidates").insert({
          id: c.id,
          user_id: user.id,
          status: "candidate",
          centroid: { ...Object.fromEntries(Object.keys(NUMERIC_WEIGHTS).map((k) => [k, (cent as any)[k]])), tempo_feel: (cent as any).tempo_feel, beat_style: (cent as any).beat_style, sound_texture: (cent as any).sound_texture, main_mood: (cent as any).main_mood },
          avg_compat: c.avg_compat,
          min_compat: c.min_compat,
          size: c.members.length,
          dominant_dimensions: dims,
          language_group: c.language_group,
          run_id: runId,
        }).select("id").single();
        if (cErr) { console.error(cErr); continue; }
        const rows = c.members.map((m, i) => ({
          cluster_id: ins.id,
          user_id: user.id,
          spotify_track_id: m.spotify_track_id,
          compat_to_centroid: compat(cent, m),
          position: i + 1,
        }));
        if (rows.length) await adm.from("cluster_candidate_tracks").insert(rows);
      }
      if (unassigned.length) {
        const rows = unassigned.map((u) => ({
          user_id: user.id,
          spotify_track_id: u.spotify_track_id,
          last_run_id: runId,
          reason: "no_compatible_cluster",
        }));
        // Upsert-ish: unique on (user_id, spotify_track_id)
        for (let i = 0; i < rows.length; i += 500) {
          await adm.from("unassigned_tracks").upsert(rows.slice(i, i + 500), { onConflict: "user_id,spotify_track_id" });
        }
      }
    }

    return json({
      success: true,
      run_id: runId,
      persisted: persist,
      totals: {
        library_total: libraryTotal,
        pending_analysis: pendingAnalysis,
        analyzed: rows.length,
        clusters: clusters.length,
        clustered_tracks: clusters.reduce((a, c) => a + c.members.length, 0),
        unassigned: unassigned.length,
      },

      thresholds: { MIN_SIZE, AVG_COMPAT_MIN, MIN_COMPAT_FLOOR, PCT_ABOVE_STRONG, STRONG_FIT, SEED_JOIN_THRESHOLD, MAX_DIM_SPREAD },
      clusters: report,
      unassigned: unassignedReport,
    });
  } catch (e: any) {
    console.error("cluster-library", e);
    return json({ error: e?.message ?? "unknown" }, 500);
  }
});
