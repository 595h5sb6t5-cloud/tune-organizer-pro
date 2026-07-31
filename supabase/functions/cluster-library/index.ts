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
// Categorical "DJ ear" fields. Texture/tempo/beat/mood carry the vibe; family,
// subgenre and genre are only light references so two different genres that feel
// the same can still live in one set.
const CATEGORICAL_WEIGHTS: Record<string, number> = {
  sound_texture: 1.0,
  tempo_feel: 1.0,
  beat_style: 0.9,
  main_mood: 0.9,
  music_family: 0.5,
  primary_subgenre: 0.35,
  main_genre: 0.25,
};
const CATEGORICAL_FIELDS = Object.keys(CATEGORICAL_WEIGHTS);

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

const NUMERIC_KEYS = Object.keys(NUMERIC_WEIGHTS);
const NUMERIC_W = NUMERIC_KEYS.map((k) => (NUMERIC_WEIGHTS as any)[k] as number);
const vecCache = new WeakMap<object, (number | null)[]>();

function buildVector(r: Row): (number | null)[] {
  const cached = vecCache.get(r as unknown as object);
  if (cached) return cached;
  const vec = NUMERIC_KEYS.map((k) => num((r as any)[k]));
  vecCache.set(r as unknown as object, vec);
  return vec;
}

function compat(a: Row, b: Row): number {
  const va = buildVector(a);
  const vb = buildVector(b);
  let wSum = 0;
  let dSum = 0;
  for (let i = 0; i < NUMERIC_KEYS.length; i++) {
    const x = va[i], y = vb[i];
    if (x === null || y === null) continue;
    const w = NUMERIC_W[i];
    wSum += w;
    dSum += w * Math.abs(x - y);
  }

  const numeric = wSum > 0 ? 1 - dSum / wSum : 0.5;
  let catBonus = 0;
  let catWeight = 0;
  for (const f of CATEGORICAL_FIELDS) {
    const av = (a as any)[f];
    const bv = (b as any)[f];
    if (!av || !bv) continue;
    const w = CATEGORICAL_WEIGHTS[f];
    catWeight += w;
    if (String(av).toLowerCase() === String(bv).toLowerCase()) catBonus += w;
  }
  const cat = catWeight > 0 ? catBonus / catWeight : 0.5;
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

function dimSpreadOk(rows: Row[], maxSpread = MAX_DIM_SPREAD): { ok: boolean; worst: number } {
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
  return { ok: worst <= maxSpread, worst };
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
    const SELECT_COLS = "spotify_track_id, track_name, artist_name, language, tempo_feel, beat_style, sound_texture, main_mood, main_genre, music_family, primary_subgenre, energy_score, melody_level, bass_level, drum_intensity, vocal_intensity, aggressiveness, softness, darkness, nostalgia, dance_feel, emotional_intensity, song_variation, schema_version";
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

    // Multi-round greedy clustering. Each round only sees the tracks that are still
    // loose, so a song burned by a weak seed in round 1 gets fresh chances later
    // instead of being discarded forever.
    const ROUNDS = 4;
    let pending: Row[] = rows;
    for (let round = 0; round < ROUNDS && pending.length >= MIN_SIZE; round++) {
      const groups: Record<string, Row[]> = {};
      for (const r of pending) {
        const g = langGroup(r.language);
        (groups[g] ??= []).push(r);
      }
      const roundLeftovers: Row[] = [];
      // Later rounds loosen only the *growth* heuristics (how easily a track joins a
      // forming group); the publication gates below stay untouched.
      const joinThreshold = Math.max(SEED_JOIN_THRESHOLD - round * 0.015, 0.80);
      const maxSpread = MAX_DIM_SPREAD + round * 0.03;

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
        const placed = new Set<string>();
        for (const seed of pool) {
          if (used.has(seed.spotify_track_id)) continue;

          // Cheap pre-filter: if the seed does not even have MIN_SIZE-1 compatible
          // neighbours left, there is no point running the expensive growth loop.
          let neighbours: { r: Row; s: number }[] = [];
          for (const r of pool) {
            if (r === seed || used.has(r.spotify_track_id)) continue;
            const s = compat(seed, r);
            if (s >= joinThreshold - 0.04) neighbours.push({ r, s });
          }
          if (neighbours.length + 1 < MIN_SIZE) continue;
          neighbours.sort((a, b) => b.s - a.s);
          neighbours = neighbours.slice(0, 160);

          const members: Row[] = [seed];
          used.add(seed.spotify_track_id);
          // Grow greedily, re-centroiding after each accepted member but only
          // rescoring the short-listed neighbourhood instead of the whole pool.
          let changed = true;
          while (changed && members.length < 45) {
            changed = false;
            const c = centroidRow(members);
            const scored: { r: Row; s: number }[] = [];
            for (const n of neighbours) {
              if (used.has(n.r.spotify_track_id)) continue;
              const s = compat(c, n.r);
              if (s >= joinThreshold) scored.push({ r: n.r, s });
            }
            scored.sort((a, b) => b.s - a.s);
            for (const { r } of scored) {
              if (!dimSpreadOk([...members, r], maxSpread).ok) continue;
              members.push(r);
              used.add(r.spotify_track_id);
              changed = true;
              break;
            }
          }


          const cent = centroidRow(members);
          const compats = members.map((m) => compat(cent, m));
          const avg = compats.reduce((a, b) => a + b, 0) / compats.length;
          const mn = Math.min(...compats);
          const pctStrong = compats.filter((c) => c >= STRONG_FIT).length / compats.length;

          let ok = true;
          if (members.length < MIN_SIZE) ok = false;
          else if (avg < AVG_COMPAT_MIN) ok = false;
          else if (mn < MIN_COMPAT_FLOOR) ok = false;
          else if (pctStrong < PCT_ABOVE_STRONG) ok = false;

          if (ok) {
            clusters.push({
              id: crypto.randomUUID(),
              language_group: g,
              members,
              avg_compat: avg,
              min_compat: mn,
              status: "candidate",
            });
            for (const m of members) placed.add(m.spotify_track_id);
          }
        }

        for (const r of list) {
          if (!placed.has(r.spotify_track_id)) roundLeftovers.push(r);
        }
      }

      if (roundLeftovers.length === pending.length) { pending = roundLeftovers; break; }
      pending = roundLeftovers;
    }
    const leftovers: Row[] = pending;


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
