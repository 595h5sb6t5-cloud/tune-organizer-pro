// Second-layer validation: artist / genre / scene / taste context.
// Read-only. Does NOT mutate playlists. Returns per-track findings so the UI
// can suggest moves/unassign to the user.
//
// Body: { playlist_id?: string }  -> if omitted, runs on all user playlists.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

// Sonic weights — match cluster-library
const NUMERIC_WEIGHTS: Record<string, number> = {
  energy_score: 1.3, darkness: 1.2, softness: 1.0, aggressiveness: 1.2,
  dance_feel: 1.2, drum_intensity: 1.1, bass_level: 1.1, melody_level: 1.0,
  vocal_intensity: 1.0, emotional_intensity: 0.9, song_variation: 0.8, nostalgia: 0.5,
};
const CATEGORICAL_FIELDS = ["tempo_feel", "beat_style", "sound_texture", "main_mood"] as const;

// Thresholds for artist_surprise gate
const SURPRISE = { sonic: 0.90, context: 0.75, transition: 0.88 };

function num(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : null;
}

type Row = Record<string, any>;

function sonicCompat(a: Row, b: Row): number {
  let w = 0, d = 0;
  for (const [k, wt] of Object.entries(NUMERIC_WEIGHTS)) {
    const x = num(a[k]); const y = num(b[k]);
    if (x === null || y === null) continue;
    w += wt; d += wt * Math.abs(x - y);
  }
  const numeric = w > 0 ? 1 - d / w : 0.5;
  let cs = 0, cc = 0;
  for (const f of CATEGORICAL_FIELDS) {
    const av = a[f], bv = b[f];
    if (!av || !bv) continue;
    cc++;
    if (String(av).toLowerCase() === String(bv).toLowerCase()) cs++;
  }
  const cat = cc > 0 ? cs / cc : 0.5;
  return Math.max(0, Math.min(1, 0.75 * numeric + 0.25 * cat));
}

function centroid(rows: Row[]): Row {
  const out: Row = {};
  for (const k of Object.keys(NUMERIC_WEIGHTS)) {
    let s = 0, c = 0;
    for (const r of rows) { const v = num(r[k]); if (v !== null) { s += v; c++; } }
    out[k] = c > 0 ? s / c : null;
  }
  for (const f of CATEGORICAL_FIELDS) {
    const counts = new Map<string, number>();
    for (const r of rows) { const v = r[f]; if (v) counts.set(String(v).toLowerCase(), (counts.get(String(v).toLowerCase()) ?? 0) + 1); }
    let best: string | null = null, bc = 0;
    for (const [k, c] of counts) if (c > bc) { best = k; bc = c; }
    out[f] = best;
  }
  return out;
}

function decadeOf(dateStr: string | null | undefined): number | null {
  if (!dateStr) return null;
  const y = parseInt(String(dateStr).slice(0, 4), 10);
  if (!Number.isFinite(y)) return null;
  return Math.floor(y / 10) * 10;
}

function musicalContextFit(track: Row, playlist: Row[], playlistMeta: {
  topGenres: Map<string, number>; topDecades: Map<number, number>; total: number;
}): number {
  const { topGenres, topDecades, total } = playlistMeta;
  const tg = (track.main_genre ?? track.primary_genre ?? "").toString().toLowerCase();
  let genreShare = 0;
  if (tg && total > 0) {
    // share of playlist tracks in same or adjacent genre family
    const same = topGenres.get(tg) ?? 0;
    // adjacency by first token (e.g. "indie rock" ~ "rock")
    const tgHead = tg.split(/[\s\/-]/)[0];
    let adj = 0;
    for (const [g, n] of topGenres) if (g !== tg && g.split(/[\s\/-]/)[0] === tgHead) adj += n;
    genreShare = (same + 0.5 * adj) / total;
  }
  const td = decadeOf(track.release_date);
  let decadeShare = 0.5;
  if (td !== null && total > 0) {
    const same = topDecades.get(td) ?? 0;
    const adj = (topDecades.get(td - 10) ?? 0) + (topDecades.get(td + 10) ?? 0);
    decadeShare = (same + 0.5 * adj) / total;
  }
  // Blend: genre dominates, era tempers
  const raw = 0.7 * genreShare + 0.3 * decadeShare;
  // Convert share into a fit score anchored so a fully-matching track ~0.95, alien track ~0.35
  return Math.max(0.3, Math.min(1, 0.35 + raw * 0.65));
}

function artistContextPenalty(track: Row, artistCounts: Map<string, number>, total: number, contextFit: number): number {
  const artist = (track.artist_name ?? track.artist_names?.[0] ?? "").toString().toLowerCase();
  const share = artist ? (artistCounts.get(artist) ?? 0) / total : 0;
  // If the artist is a repeat presence, penalty is small.
  // If artist is unique AND musical context is weak, penalty rises.
  const uniqueness = 1 - share; // 0 (many songs) .. ~1 (only one)
  const contextGap = Math.max(0, 0.85 - contextFit); // 0 if strong context
  const raw = uniqueness * 0.15 + contextGap * 0.6;
  return Math.max(0, Math.min(0.35, raw));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const auth = req.headers.get("Authorization") ?? "";
    const url = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const svc = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const userClient = createClient(url, anon, { global: { headers: { Authorization: auth } } });
    const adm = createClient(url, svc);
    const { data: { user }, error: uerr } = await userClient.auth.getUser();
    if (uerr || !user) return json({ error: "unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const playlistId: string | undefined = body.playlist_id;

    // Fetch playlists
    let plQuery = adm.from("generated_playlists").select("id, name, concept, vibe").eq("user_id", user.id);
    if (playlistId) plQuery = plQuery.eq("id", playlistId);
    const { data: playlists, error: perr } = await plQuery;
    if (perr) return json({ error: perr.message }, 500);
    if (!playlists?.length) return json({ success: true, playlists: [] });

    // Taste profile — from feedback (dismissed artists) and removed_by_user tracks (not tracked
    // in schema yet). We soft-penalize artists the user dismissed 2+ times.
    const { data: feedback } = await adm
      .from("recommendation_feedback")
      .select("track_artist, action")
      .eq("user_id", user.id);
    const artistDismissals = new Map<string, number>();
    for (const f of feedback ?? []) {
      if (f.action === "dismissed" && f.track_artist) {
        const k = f.track_artist.toLowerCase();
        artistDismissals.set(k, (artistDismissals.get(k) ?? 0) + 1);
      }
    }
    const tasteFor = (artist: string | null | undefined): number => {
      if (!artist) return 0.75;
      const dismisses = artistDismissals.get(artist.toLowerCase()) ?? 0;
      if (dismisses === 0) return 0.80;
      if (dismisses === 1) return 0.70;
      if (dismisses === 2) return 0.55;
      return 0.40;
    };

    const results: any[] = [];

    for (const pl of playlists) {
      const { data: pTracks } = await adm
        .from("generated_playlist_tracks")
        .select("id, position, fit_score, track:tracks(id, spotify_track_id, name, artist_names, release_date)")
        .eq("generated_playlist_id", pl.id)
        .order("position");
      if (!pTracks?.length) { results.push({ playlist_id: pl.id, name: pl.name, tracks: [], findings: [] }); continue; }

      const spotifyIds = pTracks.map((t: any) => t.track?.spotify_track_id).filter(Boolean);
      const { data: analyses } = await adm
        .from("ai_track_analysis")
        .select("spotify_track_id, artist_name, main_genre, primary_genre, tempo_feel, beat_style, sound_texture, main_mood, energy_score, melody_level, bass_level, drum_intensity, vocal_intensity, aggressiveness, softness, darkness, nostalgia, dance_feel, emotional_intensity, song_variation, transition_in, transition_out")
        .eq("user_id", user.id)
        .in("spotify_track_id", spotifyIds);
      const aMap = new Map((analyses ?? []).map((a: any) => [a.spotify_track_id, a]));

      // Build enriched rows
      const rows = pTracks.map((t: any) => {
        const a = aMap.get(t.track?.spotify_track_id) ?? {};
        return {
          gpt_id: t.id,
          position: t.position,
          spotify_track_id: t.track?.spotify_track_id,
          track_name: t.track?.name,
          artist_name: a.artist_name ?? t.track?.artist_names?.[0] ?? null,
          release_date: t.track?.release_date ?? null,
          ...a,
        };
      });

      const cent = centroid(rows);
      const topGenres = new Map<string, number>();
      const topDecades = new Map<number, number>();
      const artistCounts = new Map<string, number>();
      for (const r of rows) {
        const g = (r.main_genre ?? r.primary_genre ?? "").toString().toLowerCase();
        if (g) topGenres.set(g, (topGenres.get(g) ?? 0) + 1);
        const d = decadeOf(r.release_date);
        if (d !== null) topDecades.set(d, (topDecades.get(d) ?? 0) + 1);
        const ar = (r.artist_name ?? "").toString().toLowerCase();
        if (ar) artistCounts.set(ar, (artistCounts.get(ar) ?? 0) + 1);
      }
      const total = rows.length;
      const dominantGenre = [...topGenres.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

      const findings: any[] = [];
      for (const r of rows) {
        const sonic = sonicCompat(cent, r);
        const context = musicalContextFit(r, rows, { topGenres, topDecades, total });
        const taste = tasteFor(r.artist_name);
        const penalty = artistContextPenalty(r, artistCounts, total, context);
        const final = Math.max(0, Math.min(1, sonic * 0.65 + context * 0.20 + taste * 0.15 - penalty));

        const artistShare = r.artist_name ? (artistCounts.get(r.artist_name.toLowerCase()) ?? 0) / total : 0;
        const isSurprise = artistShare <= 1 / total && dominantGenre &&
          (r.main_genre ?? "").toLowerCase().split(/[\s\/-]/)[0] !== dominantGenre.split(/[\s\/-]/)[0];
        // For surprise tracks: only keep if all thresholds met
        let action: "keep" | "review" | "move" | "unassign" | "surprise_ok" = "keep";
        let reason = "";
        if (isSurprise) {
          const transitionFit = 0.5 + 0.5 * sonic; // proxy: we don't have raw transition score here
          const passes = sonic >= SURPRISE.sonic && context >= SURPRISE.context && transitionFit >= SURPRISE.transition;
          if (passes) {
            action = "surprise_ok";
            reason = `Artista único en la playlist pero encaja: sonic ${sonic.toFixed(2)}, contexto ${context.toFixed(2)}.`;
          } else {
            action = context < 0.5 ? "unassign" : "move";
            reason = `Artista ajeno al mundo sonoro (${r.main_genre ?? "género desconocido"} vs. ${dominantGenre}). Sonic ${sonic.toFixed(2)}, contexto ${context.toFixed(2)}.`;
          }
        } else if (final < 0.60) {
          action = "unassign";
          reason = `Fit final ${final.toFixed(2)} demasiado bajo. Penalización de artista ${penalty.toFixed(2)}.`;
        } else if (final < 0.72 || penalty >= 0.18) {
          action = "move";
          reason = `Contexto débil (${context.toFixed(2)}) o penalización alta (${penalty.toFixed(2)}). Fit ${final.toFixed(2)}.`;
        } else if (penalty >= 0.10) {
          action = "review";
          reason = `Encaja pero el artista rompe ligeramente la identidad del grupo.`;
        }

        findings.push({
          gpt_id: r.gpt_id,
          position: r.position,
          spotify_track_id: r.spotify_track_id,
          track_name: r.track_name,
          artist_name: r.artist_name,
          genre: r.main_genre ?? r.primary_genre ?? null,
          sonic_fit: Number(sonic.toFixed(3)),
          musical_context_fit: Number(context.toFixed(3)),
          user_taste_fit: Number(taste.toFixed(3)),
          artist_context_penalty: Number(penalty.toFixed(3)),
          final_fit_score: Number(final.toFixed(3)),
          artist_surprise: !!isSurprise,
          action,
          reason,
        });
      }

      findings.sort((a, b) => a.final_fit_score - b.final_fit_score);
      results.push({
        playlist_id: pl.id,
        name: pl.name,
        dominant_genre: dominantGenre,
        total,
        summary: {
          keep: findings.filter((f) => f.action === "keep" || f.action === "surprise_ok").length,
          review: findings.filter((f) => f.action === "review").length,
          move: findings.filter((f) => f.action === "move").length,
          unassign: findings.filter((f) => f.action === "unassign").length,
          surprise: findings.filter((f) => f.artist_surprise).length,
        },
        findings,
      });
    }

    return json({ success: true, playlists: results });
  } catch (e: any) {
    console.error("validate-playlist-context", e);
    return json({ error: e?.message ?? "unknown" }, 500);
  }
});
