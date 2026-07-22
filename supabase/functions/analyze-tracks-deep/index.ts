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
const ANALYSIS_VERSION = "v2";
const PROMPT_VERSION = "v2.1-2026-11";
const SCHEMA_VERSION = "v2.0";
const MODEL = "gpt-4o-mini";

/* ─────────────── System prompt (stable — long fixed instructions live here so
   OpenAI's automatic prompt caching kicks in and repeated tokens are discounted).
   User message per track stays minimal. ─────────────── */
const SYSTEM_PROMPT = `You are Tempo — a world-class music analyst. Given ONE track, return a strict JSON object with its sonic DNA. Analyze the ACTUAL musical qualities, not surface labels.

Rules of curation (never violate):
- Never group by language. A Spanish ballad and an English ballad with the same softness/nostalgia belong together.
- Never group by decade or genre label alone. Rock spans huge sonic distances.
- Melodic rap ≠ dark aggressive rap. Soft rock ≠ heavy rock. Same artist can span multiple worlds.
- Judge each song by ITS own energy, darkness, dance feel, softness, aggressiveness, and emotional weight.
- Numeric fields are 0.0–1.0 continuous values. Use the full range, not just 0/0.5/1.
- Be specific. Avoid generic tags like "happy", "chill", "upbeat".

Guidance for numeric dimensions (0.0–1.0):
- energy_score: overall perceived energy end-to-end.
- darkness: darkness / minor-key gravity / shadow.
- dance_feel: how much it makes you move.
- softness: gentleness, warmth, delicacy.
- aggressiveness: hard edge, distortion, punch, intensity.
- nostalgia: retro/vintage/emotional-throwback feel.
- bass_level: prominence of bass in the mix.
- drum_intensity: how hard the drums hit.
- vocal_intensity: how loud/dramatic/present the vocals are.
- melody_level: how memorable and melodic the topline is.
- emotional_intensity: emotional weight regardless of loudness.
- song_variation: how much the arrangement changes across the song.

Descriptive fields:
- main_genre / secondary_genres_v2: honest genre tags (not language, not decade).
- tempo_feel: "very slow" | "slow" | "mid" | "upbeat" | "fast" | "driving" | "frantic".
- beat_style: short phrase describing the groove (e.g. "loose live drums", "808 trap", "four-on-the-floor").
- main_mood + secondary_moods_v2: specific moods.
- sound_texture: e.g. "warm analog", "glossy digital", "raw lo-fi", "polished maximalist".
- instrumentation_summary: main instruments in one line.
- best_contexts_v2: array of usage contexts (drive, focus, dinner, late-night, gym…).
- compatible_playlist_types: array of concept names it would fit in.
- transition_in / transition_out: how it opens / closes for sequencing.
- analysis_confidence: 0.0–1.0 how sure you are given the info provided.

Return ONLY the JSON — no prose, no markdown.`;

/* ─────────────── Structured Outputs schema (strict) ─────────────── */
const NUM = { type: "number", minimum: 0, maximum: 1 };
const RESPONSE_SCHEMA = {
  name: "track_deep_analysis",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: [
      "main_genre", "secondary_genres_v2", "tempo_feel", "beat_style",
      "energy_score", "melody_level", "bass_level", "drum_intensity",
      "vocal_intensity", "aggressiveness", "softness", "darkness",
      "nostalgia", "dance_feel", "emotional_intensity", "song_variation",
      "main_mood", "secondary_moods_v2", "sound_texture",
      "instrumentation_summary", "best_contexts_v2",
      "compatible_playlist_types", "transition_in", "transition_out",
      "analysis_confidence",
    ],
    properties: {
      main_genre: { type: "string" },
      secondary_genres_v2: { type: "array", items: { type: "string" } },
      tempo_feel: { type: "string" },
      beat_style: { type: "string" },
      energy_score: NUM, melody_level: NUM, bass_level: NUM, drum_intensity: NUM,
      vocal_intensity: NUM, aggressiveness: NUM, softness: NUM, darkness: NUM,
      nostalgia: NUM, dance_feel: NUM, emotional_intensity: NUM, song_variation: NUM,
      main_mood: { type: "string" },
      secondary_moods_v2: { type: "array", items: { type: "string" } },
      sound_texture: { type: "string" },
      instrumentation_summary: { type: "string" },
      best_contexts_v2: { type: "array", items: { type: "string" } },
      compatible_playlist_types: { type: "array", items: { type: "string" } },
      transition_in: { type: "string" },
      transition_out: { type: "string" },
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

    const batchSize: number = Math.min(Math.max(body.batch_size ?? 10, 1), 100);
    const concurrency: number = Math.min(Math.max(body.concurrency ?? 5, 1), 15);
    const force = body.force === true;
    const profile = body.profile === true;
    const benchmarkLabel: string | undefined = body.benchmark_label;

    // Plan gating
    const { data: sub } = await adm
      .from("user_subscription")
      .select("plan, song_analysis_limit")
      .eq("user_id", userId)
      .maybeSingle();
    const planLimit: number = sub?.song_analysis_limit ?? 100;
    const isUnlimited = planLimit === -1;

    // ── Stage: DB read ──
    const tDbRead0 = performance.now();
    const fetchLimit = isUnlimited ? Math.max(batchSize * 3, 200) : Math.min(planLimit + 100, 2000);
    const { data: liked } = await adm
      .from("liked_songs")
      .select("id, spotify_track_id, track_name, artist_name, album_name, audio_tempo, audio_energy, audio_valence, audio_danceability, audio_acousticness, audio_instrumentalness, audio_speechiness, genre_tags, mood")
      .eq("user_id", userId)
      .order("added_at", { ascending: false })
      .limit(fetchLimit);

    if (!liked || liked.length === 0) {
      return json({ done: true, analyzed: 0, remaining: 0, total: 0, message: "No liked songs" });
    }

    const { count: totalCount } = await adm
      .from("liked_songs")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId);

    // Existing v2 analysis for this user (cache lookup key)
    const { data: existing } = await adm
      .from("ai_track_analysis")
      .select("spotify_track_id, prompt_version, schema_version, model_used")
      .eq("user_id", userId)
      .eq("analysis_version", ANALYSIS_VERSION);

    const cacheKey = (id: string) => `${id}::${PROMPT_VERSION}::${SCHEMA_VERSION}::${MODEL}`;
    const cachedSet = new Set<string>(
      (existing ?? [])
        .filter((e: any) => !force && e.prompt_version === PROMPT_VERSION && e.schema_version === SCHEMA_VERSION && e.model_used === MODEL)
        .map((e: any) => e.spotify_track_id ? cacheKey(e.spotify_track_id) : null)
        .filter(Boolean) as string[]
    );

    // Filter: only tracks NOT already cached (deep pipeline; quick stage can be added later)
    const pending = liked.filter((l: any) => l.spotify_track_id && !cachedSet.has(cacheKey(l.spotify_track_id)));
    const cache_hits_total = liked.length - pending.length;

    if (pending.length === 0) {
      return json({ done: true, analyzed: 0, remaining: 0, total: totalCount ?? 0, cache_hits: cache_hits_total, message: "All up to date" });
    }

    // Respect plan cap
    let effectiveBatchSize = batchSize;
    if (!isUnlimited) {
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
        analysis_confidence: r.analysis_confidence,
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
