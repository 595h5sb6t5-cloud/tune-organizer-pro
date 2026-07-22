// Selects ~150 liked_songs designed to STRESS-TEST the new clustering system.
// Forces inclusion of: house across multiple subgenres, RÜFÜS DU SOL, Kanye West,
// Elton John, high-identity artists, cross-genre bridges, mood-lookalikes.
// Persists the sample to `diagnostic_samples` so we can rerun the same set.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

type Song = {
  spotify_track_id: string;
  track_name: string | null;
  artist_name: string | null;
  main_genre?: string | null;
  beat_style?: string | null;
  energy_score?: number | null;
  dance_feel?: number | null;
  darkness?: number | null;
  language?: string | null;
};

const TARGET_SIZE = 150;

// Artists we EXPLICITLY want in the sample (edge cases from previous runs).
const MUST_INCLUDE_ARTISTS = [
  "rüfüs du sol", "rufus du sol",
  "kanye west",
  "elton john",
];

// High-identity artists — if present in library, force at least 1 each.
const HIGH_IDENTITY_ARTISTS = [
  "ac/dc", "the weeknd", "bad bunny", "drake", "billie eilish",
  "daft punk", "arctic monkeys", "tame impala", "kendrick lamar",
  "coldplay", "queen", "michael jackson", "frank ocean",
];

// House-related seed patterns — we search track/artist/main_genre/beat_style.
const HOUSE_PATTERNS = [
  "house", "deep house", "tech house", "afro house", "melodic house",
  "progressive house", "organic house", "disco house", "nu-disco",
  "indie dance", "tropical house", "big room", "future house",
];

function pickN<T>(arr: T[], n: number): T[] {
  const copy = [...arr];
  const out: T[] = [];
  while (out.length < n && copy.length) {
    const i = Math.floor(Math.random() * copy.length);
    out.push(copy.splice(i, 1)[0]);
  }
  return out;
}

function containsAny(hay: string | null | undefined, needles: string[]): boolean {
  if (!hay) return false;
  const h = hay.toLowerCase();
  return needles.some((n) => h.includes(n));
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
    const label: string = body.label ?? `phase1-diagnostic-${new Date().toISOString().slice(0, 10)}`;
    const size: number = Math.min(200, Math.max(50, body.size ?? TARGET_SIZE));

    // Pull liked_songs (paginated) with joined v2 analysis fields.
    const liked: Song[] = [];
    for (let offset = 0; offset < 10000; offset += 1000) {
      const { data: page, error } = await adm
        .from("liked_songs")
        .select("spotify_track_id, track_name, artist_name")
        .eq("user_id", user.id)
        .range(offset, offset + 999);
      if (error) return json({ error: error.message }, 500);
      if (!page || page.length === 0) break;
      liked.push(...(page as any));
      if (page.length < 1000) break;
    }
    if (liked.length === 0) return json({ error: "No liked songs found" }, 400);

    // Enrich with v2 analysis (best-effort — some tracks may lack it)
    const ids = liked.map((l) => l.spotify_track_id).filter(Boolean);
    const analysisById = new Map<string, any>();
    for (let i = 0; i < ids.length; i += 500) {
      const chunk = ids.slice(i, i + 500);
      const { data: rows } = await adm
        .from("ai_track_analysis")
        .select("spotify_track_id, main_genre, beat_style, energy_score, dance_feel, darkness, language")
        .eq("user_id", user.id)
        .in("spotify_track_id", chunk);
      for (const r of rows ?? []) analysisById.set((r as any).spotify_track_id, r);
    }
    const enriched: Song[] = liked.map((l) => ({ ...l, ...(analysisById.get(l.spotify_track_id) ?? {}) }));

    const selected = new Map<string, string>(); // id -> reason
    const add = (song: Song, reason: string) => {
      if (!song?.spotify_track_id) return;
      if (selected.has(song.spotify_track_id)) return;
      selected.set(song.spotify_track_id, reason);
    };

    // 1) MUST-INCLUDE artists (all their liked tracks, up to 6 each)
    for (const needle of MUST_INCLUDE_ARTISTS) {
      const hits = enriched.filter((s) => (s.artist_name ?? "").toLowerCase().includes(needle));
      for (const s of pickN(hits, 6)) add(s, `must_include:${needle}`);
    }

    // 2) High-identity artists (1-2 each)
    for (const needle of HIGH_IDENTITY_ARTISTS) {
      const hits = enriched.filter((s) => (s.artist_name ?? "").toLowerCase().includes(needle));
      for (const s of pickN(hits, 2)) add(s, `high_identity:${needle}`);
    }

    // 3) House-related — try to spread across as many subgenre hints as possible
    const houseCandidates = enriched.filter((s) =>
      containsAny(s.main_genre, HOUSE_PATTERNS) ||
      containsAny(s.beat_style, HOUSE_PATTERNS) ||
      containsAny(s.track_name, HOUSE_PATTERNS)
    );
    // Bucket by first matching hint
    const houseBuckets = new Map<string, Song[]>();
    for (const s of houseCandidates) {
      const key = HOUSE_PATTERNS.find((p) =>
        containsAny(s.main_genre, [p]) || containsAny(s.beat_style, [p]) || containsAny(s.track_name, [p])
      ) ?? "house";
      (houseBuckets.get(key) ?? houseBuckets.set(key, []).get(key)!).push(s);
    }
    // Take ~4 per bucket, capped at 50 house tracks total
    let houseAdded = 0;
    for (const [k, list] of houseBuckets) {
      if (houseAdded >= 50) break;
      for (const s of pickN(list, 4)) {
        if (houseAdded >= 50) break;
        add(s, `house_subgenre_hint:${k}`);
        houseAdded++;
      }
    }
    // If we didn't find enough via labels, sample dance-heavy electronic-feeling tracks
    if (houseAdded < 25) {
      const danceLike = enriched.filter((s) =>
        (s.dance_feel ?? 0) >= 0.7 && (s.energy_score ?? 0) >= 0.55 && !selected.has(s.spotify_track_id)
      );
      for (const s of pickN(danceLike, 25 - houseAdded)) add(s, "house_candidate_by_dance_energy");
    }

    // 4) Genre variety — pick top main_genre values and grab a few from each
    const byGenre = new Map<string, Song[]>();
    for (const s of enriched) {
      const g = (s.main_genre ?? "unknown").toLowerCase();
      (byGenre.get(g) ?? byGenre.set(g, []).get(g)!).push(s);
    }
    const genresSorted = [...byGenre.entries()].sort((a, b) => b[1].length - a[1].length);
    for (const [g, list] of genresSorted) {
      if (g === "unknown") continue;
      for (const s of pickN(list, 3)) add(s, `genre_variety:${g}`);
      if (selected.size >= size * 0.75) break;
    }

    // 5) Language variety — grab from each language bucket
    const byLang = new Map<string, Song[]>();
    for (const s of enriched) {
      const l = (s.language ?? "unknown").toLowerCase();
      (byLang.get(l) ?? byLang.set(l, []).get(l)!).push(s);
    }
    for (const [l, list] of byLang) {
      for (const s of pickN(list, 2)) add(s, `language_variety:${l}`);
    }

    // 6) Fill to target with random remaining
    const remaining = enriched.filter((s) => !selected.has(s.spotify_track_id));
    for (const s of pickN(remaining, Math.max(0, size - selected.size))) {
      add(s, "random_fill");
    }

    // Trim to size (keep must-include first)
    const priorityOrder = (r: string) =>
      r.startsWith("must_include") ? 0 :
      r.startsWith("high_identity") ? 1 :
      r.startsWith("house_") ? 2 :
      r.startsWith("genre_variety") ? 3 :
      r.startsWith("language_variety") ? 4 : 5;
    const finalList = [...selected.entries()]
      .sort((a, b) => priorityOrder(a[1]) - priorityOrder(b[1]))
      .slice(0, size);

    const spotifyIds = finalList.map(([id]) => id);
    const reasons = Object.fromEntries(finalList);

    // Persist sample
    const { data: inserted, error: insErr } = await adm
      .from("diagnostic_samples")
      .insert({
        user_id: user.id,
        label,
        spotify_track_ids: spotifyIds,
        size: spotifyIds.length,
        selection_reasons: reasons,
      })
      .select("id")
      .single();
    if (insErr) return json({ error: insErr.message }, 500);

    // Buckets summary for the UI
    const summary: Record<string, number> = {};
    for (const r of Object.values(reasons)) {
      const key = (r as string).split(":")[0];
      summary[key] = (summary[key] ?? 0) + 1;
    }

    // Track-level preview (first 30) so the user sees what got picked
    const previewIds = spotifyIds.slice(0, 30);
    const preview = enriched
      .filter((s) => previewIds.includes(s.spotify_track_id))
      .map((s) => ({
        spotify_track_id: s.spotify_track_id,
        name: s.track_name,
        artist: s.artist_name,
        reason: reasons[s.spotify_track_id],
      }));

    return json({
      sample_id: inserted!.id,
      label,
      size: spotifyIds.length,
      library_size: liked.length,
      spotify_track_ids: spotifyIds,
      reasons_summary: summary,
      preview,
    });
  } catch (e: any) {
    console.error("select-diagnostic-sample", e);
    return json({ error: e?.message ?? "unknown" }, 500);
  }
});
