// Deep per-track AI analysis writing to ai_track_analysis.
// Version 2 pipeline: structured outputs, per-track parallelism with semaphore,
// cache lookup by prompt+schema+model, per-track retries, and detailed profiling.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Version markers — bumping any of these invalidates cache and forces re-analysis.
const ANALYSIS_VERSION = "v3";
const PROMPT_VERSION = "v3.0-2026-family-subgenre";
const SCHEMA_VERSION = "v3.0";

const MODEL = "gpt-4o-mini";

const MUSIC_FAMILIES = [
  "house", "techno", "trance", "drum_and_bass", "dubstep", "electronic_other",
  "disco", "funk", "pop_electronic", "indie_electronic",
  "hip_hop", "rap", "rnb", "soul",
  "rock", "indie_rock", "alternative", "metal", "punk",
  "pop", "latin_pop", "reggaeton", "latin_urban", "latin_other",
  "ballad", "singer_songwriter", "acoustic", "folk",
  "jazz", "classical", "world", "country",
  "reggae", "ambient", "soundtrack", "other",
] as const;

const HOUSE_SUBGENRES = [
  "deep_house", "progressive_house", "melodic_house", "organic_house",
  "afro_house", "latin_house", "soulful_house", "vocal_house",
  "piano_house", "disco_house", "french_house", "funky_house",
  "filter_house", "classic_house", "chicago_house", "acid_house",
  "tech_house", "minimal_house", "bass_house", "future_house",
  "electro_house", "big_room", "tropical_house", "slap_house",
  "lo_fi_house", "indie_dance", "nu_disco", "melodic_techno_adjacent",
  "downtempo_electronic_adjacent",
] as const;

/* ─────────────── System prompt (v3 — family + subgenre + house profile + artist context) */
const SYSTEM_PROMPT = `You are Tempo — a world-class music analyst. Given ONE track, return a strict JSON with its sonic DNA, its musical family, subgenre, artist context, and (when applicable) a detailed house profile.

Core rules:
- Judge the ACTUAL sound. Do not label based on the artist name alone.
- Numeric fields are 0.0–1.0 continuous. Use the full range.
- Be specific. Reject generic tags like "chill", "happy", "upbeat".
- Language rule: English groups only with English. Romance languages (Spanish/Portuguese/Italian/French) can share. Instrumental is neutral.
- If you are not confident about a field, LOWER analysis_confidence and subgenre_confidence instead of guessing.

music_family: pick ONE from the enum. This is the broad musical world the track lives in.
primary_subgenre / secondary_subgenres: specific subgenre labels. For house tracks the primary_subgenre MUST come from the house subgenre list. For non-house tracks use accurate descriptive tags.
subgenre_confidence: 0–1, how sure you are of the primary_subgenre.

is_house_related: true if the track is house or a directly adjacent world (melodic techno near house, indie dance, nu-disco, downtempo that could sit in organic/melodic house). When true, fill house_profile with real values based on the sound. When false, still return house_profile with is_house_related=false and all numeric fields at 0 and strings empty "" (structured-output requires the object).

house_profile numeric fields (0–1): four_on_the_floor_strength, kick_weight, bassline_prominence, percussion_density, swing_level, syncopation_level, vocal_presence, piano_presence, disco_influence, funk_influence, soul_influence, latin_influence, afro_influence, organic_instrumentation, synth_prominence, atmospheric_depth, melodic_complexity, darkness, warmth, club_intensity, festival_intensity, commercial_pop_influence, underground_feel, drop_intensity, build_up_intensity, peak_time_fit, sunset_fit, afterhours_fit, lounge_fit, dancefloor_fit, analysis_confidence.
house_profile descriptive strings ("" when unknown or not house): kick_texture, bassline_style, percussion_style, groove_type, vocal_style, synth_style, track_progression.
house_profile primary_house_subgenre: must be from the house subgenre list, or "" when is_house_related=false.

artist_context: artist_primary_genres and artist_secondary_genres (best inference), artist_scene (short label), artist_identity_strength (0–1 how recognizable), track_is_catalog_outlier (true if THIS track is unusual for the artist), track_outlier_confidence (0–1).

Sonic dimensions (0–1): energy_score, darkness, dance_feel, softness, aggressiveness, nostalgia, bass_level, drum_intensity, vocal_intensity, melody_level, emotional_intensity, song_variation.

Descriptive: main_genre, secondary_genres_v2, tempo_feel, beat_style, main_mood, secondary_moods_v2, sound_texture, instrumentation_summary, best_contexts_v2, compatible_playlist_types, transition_in, transition_out, language.

Return ONLY the JSON — no prose.`;

/* ─────────────── Structured Outputs schema (strict) ─────────────── */
const NUM = { type: "number", minimum: 0, maximum: 1 };
const STR = { type: "string" };

const HOUSE_PROFILE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "is_house_related", "primary_house_subgenre", "secondary_house_subgenres",
    "four_on_the_floor_strength", "kick_weight", "kick_texture",
    "bassline_style", "bassline_prominence", "percussion_density", "percussion_style",
    "groove_type", "swing_level", "syncopation_level",
    "vocal_presence", "vocal_style", "piano_presence",
    "disco_influence", "funk_influence", "soul_influence", "latin_influence", "afro_influence",
    "organic_instrumentation", "synth_prominence", "synth_style",
    "atmospheric_depth", "melodic_complexity", "darkness", "warmth",
    "club_intensity", "festival_intensity", "commercial_pop_influence", "underground_feel",
    "drop_intensity", "build_up_intensity", "track_progression",
    "peak_time_fit", "sunset_fit", "afterhours_fit", "lounge_fit", "dancefloor_fit",
    "analysis_confidence",
  ],
  properties: {
    is_house_related: { type: "boolean" },
    primary_house_subgenre: { type: "string", enum: [...HOUSE_SUBGENRES, ""] },
    secondary_house_subgenres: { type: "array", items: { type: "string", enum: [...HOUSE_SUBGENRES] } },
    four_on_the_floor_strength: NUM, kick_weight: NUM, kick_texture: STR,
    bassline_style: STR, bassline_prominence: NUM, percussion_density: NUM, percussion_style: STR,
    groove_type: STR, swing_level: NUM, syncopation_level: NUM,
    vocal_presence: NUM, vocal_style: STR, piano_presence: NUM,
    disco_influence: NUM, funk_influence: NUM, soul_influence: NUM, latin_influence: NUM, afro_influence: NUM,
    organic_instrumentation: NUM, synth_prominence: NUM, synth_style: STR,
    atmospheric_depth: NUM, melodic_complexity: NUM, darkness: NUM, warmth: NUM,
    club_intensity: NUM, festival_intensity: NUM, commercial_pop_influence: NUM, underground_feel: NUM,
    drop_intensity: NUM, build_up_intensity: NUM, track_progression: STR,
    peak_time_fit: NUM, sunset_fit: NUM, afterhours_fit: NUM, lounge_fit: NUM, dancefloor_fit: NUM,
    analysis_confidence: NUM,
  },
};

const ARTIST_CONTEXT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "artist_primary_genres", "artist_secondary_genres", "artist_scene",
    "artist_identity_strength", "track_is_catalog_outlier", "track_outlier_confidence",
  ],
  properties: {
    artist_primary_genres: { type: "array", items: { type: "string" } },
    artist_secondary_genres: { type: "array", items: { type: "string" } },
    artist_scene: { type: "string" },
    artist_identity_strength: NUM,
    track_is_catalog_outlier: { type: "boolean" },
    track_outlier_confidence: NUM,
  },
};

const RESPONSE_SCHEMA = {
  name: "track_deep_analysis_v3",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: [
      "music_family", "primary_subgenre", "secondary_subgenres", "subgenre_confidence",
      "is_house_related", "house_profile", "artist_context",
      "main_genre", "secondary_genres_v2", "tempo_feel", "beat_style",
      "energy_score", "melody_level", "bass_level", "drum_intensity",
      "vocal_intensity", "aggressiveness", "softness", "darkness",
      "nostalgia", "dance_feel", "emotional_intensity", "song_variation",
      "main_mood", "secondary_moods_v2", "sound_texture",
      "instrumentation_summary", "best_contexts_v2",
      "compatible_playlist_types", "transition_in", "transition_out",
      "language", "analysis_confidence",
    ],
    properties: {
      music_family: { type: "string", enum: [...MUSIC_FAMILIES] },
      primary_subgenre: STR,
      secondary_subgenres: { type: "array", items: { type: "string" } },
      subgenre_confidence: NUM,
      is_house_related: { type: "boolean" },
      house_profile: HOUSE_PROFILE_SCHEMA,
      artist_context: ARTIST_CONTEXT_SCHEMA,
      main_genre: STR,
      secondary_genres_v2: { type: "array", items: { type: "string" } },
      tempo_feel: STR,
      beat_style: STR,
      energy_score: NUM, melody_level: NUM, bass_level: NUM, drum_intensity: NUM,
      vocal_intensity: NUM, aggressiveness: NUM, softness: NUM, darkness: NUM,
      nostalgia: NUM, dance_feel: NUM, emotional_intensity: NUM, song_variation: NUM,
      main_mood: STR,
      secondary_moods_v2: { type: "array", items: { type: "string" } },
      sound_texture: STR,
      instrumentation_summary: STR,
      best_contexts_v2: { type: "array", items: { type: "string" } },
      compatible_playlist_types: { type: "array", items: { type: "string" } },
      transition_in: STR,
      transition_out: STR,
      language: {
        type: "string",
        enum: ["English", "Spanish", "Portuguese", "Italian", "French", "Instrumental", "Other"],
      },
      analysis_confidence: NUM,
    },
  },
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/* ─────────────── Adaptive reasoning: decides which songs are "hard cases".
   Kept even for non-reasoning models — we record the label for later. ─────────────── */
function classifyDifficulty(s: any, prevTags: any): "normal" | "hard" {
  const e = s.audio_energy, v = s.audio_valence, a = s.audio_acousticness, d = s.audio_danceability;
  // Contradictory features → hard case
  if (e != null && v != null) {
    if (e > 0.7 && v < 0.3) return "hard";   // energetic but dark
    if (a != null && e > 0.6 && a > 0.6) return "hard"; // energetic + acoustic
    if (d != null && d > 0.7 && v < 0.3) return "hard"; // danceable but sad
  }
  // Disparate previous genre tags → hard case
  if (prevTags?.genre_tags && Array.isArray(prevTags.genre_tags) && prevTags.genre_tags.length >= 3) return "hard";
  return "normal";
}

function fmtTrackCompact(s: any, ctx: any, prevTags: any): string {
  const parts: string[] = [
    `track: "${s.track_name}"`,
    `artist: "${s.artist_name}"`,
  ];
  if (s.album_name) parts.push(`album: "${s.album_name}"`);
  const audio: string[] = [];
  if (s.audio_tempo != null) audio.push(`bpm=${Math.round(s.audio_tempo)}`);
  if (s.audio_energy != null) audio.push(`energy=${s.audio_energy.toFixed(2)}`);
  if (s.audio_valence != null) audio.push(`valence=${s.audio_valence.toFixed(2)}`);
  if (s.audio_danceability != null) audio.push(`dance=${s.audio_danceability.toFixed(2)}`);
  if (s.audio_acousticness != null) audio.push(`acoustic=${s.audio_acousticness.toFixed(2)}`);
  if (s.audio_instrumentalness != null) audio.push(`instr=${s.audio_instrumentalness.toFixed(2)}`);
  if (s.audio_speechiness != null) audio.push(`speech=${s.audio_speechiness.toFixed(2)}`);
  if (audio.length) parts.push(`spotify_features: ${audio.join(", ")}`);
  if (ctx.followed) parts.push("user_follows_artist: yes");
  if (prevTags?.genre_tags?.length) parts.push(`prev_genre_tags: ${prevTags.genre_tags.slice(0, 5).join(", ")}`);
  if (prevTags?.mood) parts.push(`prev_mood: ${prevTags.mood}`);
  return parts.join("\n");
}

/* ─────────────── One-track OpenAI call with retries + timing. ─────────────── */
async function analyzeOneTrack(
  openaiKey: string,
  s: any,
  ctx: any,
  prevTags: any,
): Promise<{
  ok: boolean;
  result?: any;
  error?: string;
  retries: number;
  ms_openai: number;
  usage?: { prompt_tokens?: number; completion_tokens?: number; reasoning_tokens?: number; cached_prompt_tokens?: number };
  reasoning_mode: "normal" | "hard";
  json_errors: number;
}> {
  const reasoning_mode = classifyDifficulty(s, prevTags);
  const userPrompt = fmtTrackCompact(s, ctx, prevTags);

  const body: any = {
    model: MODEL,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ],
    response_format: { type: "json_schema", json_schema: RESPONSE_SCHEMA },
    temperature: 0.3,
  };

  const MAX_ATTEMPTS = 3;
  const backoffs = [500, 2000, 6000];
  let json_errors = 0;
  let lastErr = "";
  let msOpenai = 0;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const t0 = performance.now();
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 60_000);
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${openaiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      msOpenai += performance.now() - t0;

      if (!res.ok) {
        const text = await res.text();
        lastErr = `openai_${res.status}: ${text.substring(0, 200)}`;
        if (res.status === 429 || res.status >= 500) {
          await new Promise((r) => setTimeout(r, backoffs[attempt]));
          continue;
        }
        return { ok: false, error: lastErr, retries: attempt, ms_openai: msOpenai, reasoning_mode, json_errors };
      }

      const data = await res.json();
      const usage = {
        prompt_tokens: data.usage?.prompt_tokens,
        completion_tokens: data.usage?.completion_tokens,
        reasoning_tokens: data.usage?.completion_tokens_details?.reasoning_tokens,
        cached_prompt_tokens: data.usage?.prompt_tokens_details?.cached_tokens,
      };
      const content = data.choices?.[0]?.message?.content;
      if (!content) {
        json_errors++;
        lastErr = "empty_content";
        await new Promise((r) => setTimeout(r, backoffs[attempt]));
        continue;
      }
      try {
        const parsed = JSON.parse(content);
        return { ok: true, result: parsed, retries: attempt, ms_openai: msOpenai, usage, reasoning_mode, json_errors };
      } catch (e) {
        json_errors++;
        lastErr = "invalid_json";
        await new Promise((r) => setTimeout(r, backoffs[attempt]));
        continue;
      }
    } catch (e: any) {
      msOpenai += performance.now() - t0;
      lastErr = `fetch_error: ${e?.message ?? "unknown"}`;
      if (attempt < MAX_ATTEMPTS - 1) await new Promise((r) => setTimeout(r, backoffs[attempt]));
    }
  }
  return { ok: false, error: lastErr, retries: MAX_ATTEMPTS, ms_openai: msOpenai, reasoning_mode, json_errors };
}

/* ─────────────── Simple concurrency semaphore. ─────────────── */
async function runWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, i: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      results[i] = await worker(items[i], i);
    }
  });
  await Promise.all(runners);
  return results;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const tStart = performance.now();

  try {
    const auth = req.headers.get("Authorization") ?? "";
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const svc = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const openaiKey = Deno.env.get("OPENAI_API_KEY");
    if (!openaiKey) return json({ error: "OPENAI_API_KEY missing" }, 500);

    const userClient = createClient(supabaseUrl, anon, { global: { headers: { Authorization: auth } } });
    const adm = createClient(supabaseUrl, svc);

    const body = await req.json().catch(() => ({}));
    // Service-role callers (orchestrator background loop) must supply user_id explicitly.
    const isServiceCaller = auth === `Bearer ${svc}`;
    let userId: string;
    if (isServiceCaller && body.user_id) {
      userId = body.user_id;
    } else {
      const { data: { user }, error: userErr } = await userClient.auth.getUser();
      if (userErr || !user) return json({ error: "unauthorized" }, 401);
      userId = user.id;
    }

    const batchSize: number = Math.min(Math.max(body.batch_size ?? 10, 1), 200);
    const concurrency: number = Math.min(Math.max(body.concurrency ?? 5, 1), 15);
    const force = body.force === true;
    const profile = body.profile === true;
    const benchmarkLabel: string | undefined = body.benchmark_label;
    const restrictIds: string[] | undefined = Array.isArray(body.spotify_track_ids) && body.spotify_track_ids.length
      ? body.spotify_track_ids.filter((x: any) => typeof x === "string") : undefined;
    const restrictSet = restrictIds ? new Set(restrictIds) : null;
    const diagnosticMode: boolean = body.diagnostic === true || !!restrictIds;


    // Plan gating
    const { data: sub } = await adm
      .from("user_subscription")
      .select("plan, song_analysis_limit")
      .eq("user_id", userId)
      .maybeSingle();
    const planLimit: number = sub?.song_analysis_limit ?? 100;
    const isUnlimited = planLimit === -1;

    // ── Stage: DB read ──
    // Paginate liked_songs so we cover the whole library, not just the top page.
    // Only unanalyzed tracks reach the OpenAI stage; already-cached ones are
    // filtered out below.
    const tDbRead0 = performance.now();
    const PAGE_SIZE = 1000;
    const HARD_CAP = isUnlimited ? 10000 : Math.min(planLimit + 500, 5000);
    const liked: any[] = [];
    for (let offset = 0; offset < HARD_CAP; offset += PAGE_SIZE) {
      const upper = Math.min(offset + PAGE_SIZE, HARD_CAP) - 1;
      const { data: page } = await adm
        .from("liked_songs")
        .select("id, spotify_track_id, track_name, artist_name, album_name, audio_tempo, audio_energy, audio_valence, audio_danceability, audio_acousticness, audio_instrumentalness, audio_speechiness, genre_tags, mood")
        .eq("user_id", userId)
        .order("added_at", { ascending: false })
        .range(offset, upper);
      if (!page || page.length === 0) break;
      liked.push(...page);
      if (page.length < PAGE_SIZE) break;
    }

    if (!liked || liked.length === 0) {
      return json({ done: true, analyzed: 0, remaining: 0, total: 0, message: "No liked songs" });
    }

    const { count: totalCount } = await adm
      .from("liked_songs")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId);

    // Existing v2 analysis for this user (cache lookup key). Paginate to bypass
    // the 1000-row default limit for libraries with many prior analyses.
    const existing: any[] = [];
    for (let offset = 0; offset < 20000; offset += 1000) {
      const { data: page } = await adm
        .from("ai_track_analysis")
        .select("spotify_track_id, prompt_version, schema_version, model_used")
        .eq("user_id", userId)
        .eq("analysis_version", ANALYSIS_VERSION)
        .range(offset, offset + 999);
      if (!page || page.length === 0) break;
      existing.push(...page);
      if (page.length < 1000) break;
    }

    const cacheKey = (id: string) => `${id}::${PROMPT_VERSION}::${SCHEMA_VERSION}::${MODEL}`;
    const cachedSet = new Set<string>(
      (existing ?? [])
        .filter((e: any) => !force && e.prompt_version === PROMPT_VERSION && e.schema_version === SCHEMA_VERSION && e.model_used === MODEL)
        .map((e: any) => e.spotify_track_id ? cacheKey(e.spotify_track_id) : null)
        .filter(Boolean) as string[]
    );

    // Filter: only tracks NOT already cached (deep pipeline; quick stage can be added later)
    let pending = liked.filter((l: any) => l.spotify_track_id && !cachedSet.has(cacheKey(l.spotify_track_id)));
    // Diagnostic mode: restrict to the provided ids (force re-analyze them even if cached)
    if (restrictSet) {
      pending = liked.filter((l: any) => l.spotify_track_id && restrictSet.has(l.spotify_track_id));
    }
    const cache_hits_total = liked.length - pending.length;

    if (pending.length === 0) {
      firePhase2Guard(supabaseUrl, svc, userId);
      return json({ done: true, analyzed: 0, remaining: 0, total: totalCount ?? 0, cache_hits: cache_hits_total, message: "All up to date" });
    }

    // Respect plan cap (bypassed in diagnostic mode so a paid test isn't blocked by the free tier count)
    let effectiveBatchSize = batchSize;
    if (!isUnlimited && !diagnosticMode) {
      const { count: alreadyCount } = await adm
        .from("ai_track_analysis")
        .select("id", { head: true, count: "exact" })
        .eq("user_id", userId);
      const remainingQuota = Math.max(0, planLimit - (alreadyCount ?? 0));
      effectiveBatchSize = Math.min(batchSize, remainingQuota);
      if (effectiveBatchSize === 0) {
        return json({ done: true, analyzed: 0, remaining: 0, total: totalCount ?? 0, plan_limited: true, plan: sub?.plan ?? "free", limit: planLimit });
      }
    }

    const batch = pending.slice(0, effectiveBatchSize);
    const spotifyIds = batch.map((b: any) => b.spotify_track_id);

    // Load followed artists to enrich context (in parallel with tracks lookup)
    const [{ data: followed }, { data: existingTracks }] = await Promise.all([
      adm.from("spotify_followed_artists").select("artist_name").eq("user_id", userId),
      adm.from("tracks").select("id, spotify_track_id").in("spotify_track_id", spotifyIds),
    ]);
    const followedSet = new Set<string>((followed ?? []).map((f: any) => f.artist_name?.toLowerCase()));
    const trackIdBySpotify = new Map<string, string>();
    for (const t of existingTracks ?? []) trackIdBySpotify.set(t.spotify_track_id, t.id);

    // Insert any missing track rows in one shot
    const missing = batch.filter((s: any) => !trackIdBySpotify.has(s.spotify_track_id));
    if (missing.length) {
      const toIns = missing.map((s: any) => ({
        spotify_track_id: s.spotify_track_id,
        name: s.track_name,
        artist_names: [s.artist_name],
        album_name: s.album_name,
      }));
      const { data: inserted } = await adm.from("tracks").upsert(toIns, { onConflict: "spotify_track_id" }).select("id, spotify_track_id");
      for (const t of inserted ?? []) trackIdBySpotify.set(t.spotify_track_id, t.id);
    }
    const tDbRead = performance.now() - tDbRead0;

    // ── Stage: prompt build + parallel analyze ──
    const tPromptBuild0 = performance.now();
    // Prompt build is folded into analyzeOneTrack; keep near-zero measurement here.
    const tPromptBuild = performance.now() - tPromptBuild0;

    const tOpenai0 = performance.now();
    const perTrackMs: number[] = [];
    const analyses = await runWithConcurrency(batch, concurrency, async (s: any) => {
      const tTrack0 = performance.now();
      const prevTags = { genre_tags: s.genre_tags, mood: s.mood };
      const ctx = { followed: followedSet.has(s.artist_name?.toLowerCase()) };
      const r = await analyzeOneTrack(openaiKey, s, ctx, prevTags);
      perTrackMs.push(performance.now() - tTrack0);
      return { song: s, ...r };
    });
    const tOpenai = performance.now() - tOpenai0;

    // ── Stage: validate + save ──
    const tValidate0 = performance.now();
    const rows: any[] = [];
    let jsonErrors = 0;
    let retriesTotal = 0;
    let ok = 0, failed = 0;
    let promptTokens = 0, completionTokens = 0, reasoningTokens = 0, cachedPromptTokens = 0;

    for (const a of analyses) {
      jsonErrors += a.json_errors;
      retriesTotal += a.retries;
      if (a.usage) {
        promptTokens += a.usage.prompt_tokens ?? 0;
        completionTokens += a.usage.completion_tokens ?? 0;
        reasoningTokens += a.usage.reasoning_tokens ?? 0;
        cachedPromptTokens += a.usage.cached_prompt_tokens ?? 0;
      }
      const trackId = trackIdBySpotify.get(a.song.spotify_track_id);
      if (!a.ok || !a.result || !trackId) { failed++; continue; }
      const r = a.result;
      rows.push({
        user_id: userId,
        track_id: trackId,
        liked_song_id: a.song.id,
        spotify_track_id: a.song.spotify_track_id,
        track_name: a.song.track_name,
        artist_name: a.song.artist_name,
        // v2 numeric
        energy_score: r.energy_score, melody_level: r.melody_level, bass_level: r.bass_level,
        drum_intensity: r.drum_intensity, vocal_intensity: r.vocal_intensity,
        aggressiveness: r.aggressiveness, softness: r.softness, darkness: r.darkness,
        nostalgia: r.nostalgia, dance_feel: r.dance_feel,
        emotional_intensity: r.emotional_intensity, song_variation: r.song_variation,
        // v2 descriptive
        main_genre: r.main_genre,
        secondary_genres_v2: r.secondary_genres_v2 ?? [],
        tempo_feel: r.tempo_feel, beat_style: r.beat_style,
        main_mood: r.main_mood, secondary_moods_v2: r.secondary_moods_v2 ?? [],
        sound_texture: r.sound_texture,
        instrumentation_summary: r.instrumentation_summary,
        best_contexts_v2: r.best_contexts_v2 ?? [],
        compatible_playlist_types: r.compatible_playlist_types ?? [],
        transition_in: r.transition_in, transition_out: r.transition_out,
        language: r.language ?? null,
        analysis_confidence: r.analysis_confidence,
        // v3 new fields
        music_family: r.music_family ?? null,
        primary_subgenre: r.primary_subgenre ?? null,
        secondary_subgenres: r.secondary_subgenres ?? [],
        subgenre_confidence: r.subgenre_confidence ?? null,
        is_house_related: r.is_house_related === true,
        house_profile: r.house_profile ?? null,
        artist_context: r.artist_context ?? null,

        full_analysis: r,
        // metadata
        model_used: MODEL,
        analysis_version: ANALYSIS_VERSION,
        prompt_version: PROMPT_VERSION,
        schema_version: SCHEMA_VERSION,
        reasoning_mode: a.reasoning_mode,
        analysis_stage: "deep",
        retry_count: a.retries,
        last_error: null,
        confidence_score: r.analysis_confidence, // keep legacy column populated too
      });
      ok++;
    }
    const tValidate = performance.now() - tValidate0;

    const tDbWrite0 = performance.now();
    if (rows.length) {
      // Batch upsert
      const CHUNK = 25;
      for (let i = 0; i < rows.length; i += CHUNK) {
        const slice = rows.slice(i, i + CHUNK);
        const { error: upErr } = await adm.from("ai_track_analysis").upsert(slice, { onConflict: "user_id,track_id" });
        if (upErr) console.error("upsert error:", upErr.message);
      }
    }
    const tDbWrite = performance.now() - tDbWrite0;

    const totalMs = performance.now() - tStart;
    const openaiCalls = analyses.length; // 1 per track
    const avgPerTrack = analyses.length ? totalMs / analyses.length : 0;
    const cacheHitPct = liked.length ? (cache_hits_total / liked.length) * 100 : 0;

    // Optional: persist benchmark row
    if (profile && benchmarkLabel) {
      await adm.from("analysis_benchmarks").insert({
        user_id: userId,
        label: benchmarkLabel,
        model_used: MODEL,
        prompt_version: PROMPT_VERSION,
        schema_version: SCHEMA_VERSION,
        sample_size: analyses.length,
        concurrency,
        total_ms: Math.round(totalMs),
        avg_ms_per_track: avgPerTrack,
        openai_calls: openaiCalls,
        cache_hits: cache_hits_total,
        cache_hit_pct: cacheHitPct,
        json_errors: jsonErrors,
        retries: retriesTotal,
        total_prompt_tokens: promptTokens,
        total_completion_tokens: completionTokens,
        total_reasoning_tokens: reasoningTokens,
        cached_prompt_tokens: cachedPromptTokens,
        per_stage_ms: {
          t_db_read: Math.round(tDbRead),
          t_prompt_build: Math.round(tPromptBuild),
          t_openai: Math.round(tOpenai),
          t_validate: Math.round(tValidate),
          t_db_write: Math.round(tDbWrite),
        },
        per_track_ms: perTrackMs.map((n) => Math.round(n)),
      });
    }

    return json({
      done: (ok + cache_hits_total) >= (totalCount ?? 0) || pending.length <= analyses.length,
      analyzed: ok,
      failed,
      cache_hits: cache_hits_total,
      batch_size: analyses.length,
      remaining: Math.max(0, pending.length - analyses.length),
      total: totalCount ?? 0,
      concurrency,
      profile: profile ? {
        total_ms: Math.round(totalMs),
        avg_ms_per_track: Math.round(avgPerTrack),
        openai_calls: openaiCalls,
        json_errors: jsonErrors,
        retries: retriesTotal,
        cache_hit_pct: +cacheHitPct.toFixed(1),
        tokens: {
          prompt: promptTokens,
          completion: completionTokens,
          reasoning: reasoningTokens,
          cached_prompt: cachedPromptTokens,
        },
        per_stage_ms: {
          t_db_read: Math.round(tDbRead),
          t_prompt_build: Math.round(tPromptBuild),
          t_openai: Math.round(tOpenai),
          t_validate: Math.round(tValidate),
          t_db_write: Math.round(tDbWrite),
        },
        per_track_ms_summary: {
          min: perTrackMs.length ? Math.round(Math.min(...perTrackMs)) : 0,
          max: perTrackMs.length ? Math.round(Math.max(...perTrackMs)) : 0,
          median: perTrackMs.length
            ? Math.round(perTrackMs.slice().sort((a, b) => a - b)[Math.floor(perTrackMs.length / 2)])
            : 0,
        },
      } : undefined,
      model: MODEL,
      prompt_version: PROMPT_VERSION,
      schema_version: SCHEMA_VERSION,
    });
  } catch (e: any) {
    console.error("analyze-tracks-deep error", e);
    return json({ error: e.message ?? "unknown" }, 500);
  }
});
