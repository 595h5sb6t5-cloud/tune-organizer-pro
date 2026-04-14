import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/* ── Helpers ── */

function extractJson(raw: string): any {
  let cleaned = raw.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
  const start = cleaned.search(/[{[]/);
  if (start === -1) throw new Error("No JSON found");
  cleaned = cleaned.substring(start);
  try { return JSON.parse(cleaned); } catch { /* repair below */ }

  const opens = { "{": 0, "[": 0 };
  let inStr = false, esc = false;
  for (const ch of cleaned) {
    if (esc) { esc = false; continue; }
    if (ch === "\\") { esc = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === "{") opens["{"]++;
    if (ch === "}") opens["{"]--;
    if (ch === "[") opens["["]++;
    if (ch === "]") opens["["]--;
  }
  if (inStr) cleaned += '"';
  cleaned = cleaned.replace(/,\s*"[^"]*"?\s*:?\s*"?[^"]*$/, "").replace(/,\s*\{[^}]*$/, "").replace(/,\s*$/, "");
  for (let i = 0; i < opens["["]; i++) cleaned += "]";
  for (let i = 0; i < opens["{"]; i++) cleaned += "}";
  cleaned = cleaned.replace(/[\x00-\x1F\x7F]/g, " ").replace(/,\s*}/g, "}").replace(/,\s*]/g, "]");
  return JSON.parse(cleaned);
}

async function callAI(
  apiKey: string, model: string, systemPrompt: string, userPrompt: string,
  tools?: any[], toolChoice?: any, temp = 0.3,
): Promise<any> {
  const body: any = {
    model,
    messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }],
    temperature: temp,
  };
  if (tools) body.tools = tools;
  if (toolChoice) body.tool_choice = toolChoice;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 55_000);
      const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      clearTimeout(timer);

      if (!res.ok) {
        const text = await res.text();
        if (res.status === 429) { await new Promise(r => setTimeout(r, 3000 * (attempt + 1))); continue; }
        if (res.status === 402) throw new Error("CREDITS_EXHAUSTED");
        if (attempt < 2) continue;
        throw new Error(`AI error ${res.status}: ${text.substring(0, 200)}`);
      }

      const data = await res.json();
      const tc = data.choices?.[0]?.message?.tool_calls?.[0];
      if (tc?.function?.arguments) {
        try { return JSON.parse(tc.function.arguments); } catch { return extractJson(tc.function.arguments); }
      }
      const content = data.choices?.[0]?.message?.content;
      if (!content) { if (attempt < 2) continue; throw new Error("Empty AI response"); }
      return extractJson(content);
    } catch (e: any) {
      if (e.message === "CREDITS_EXHAUSTED") throw e;
      if (e.name === "AbortError" && attempt < 2) continue;
      if (attempt < 2) continue;
      throw e;
    }
  }
  throw new Error("AI failed after retries");
}

async function fetchAll(client: any, table: string, userId: string, columns: string): Promise<any[]> {
  const all: any[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await client.from(table).select(columns).eq("user_id", userId).range(from, from + 999);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < 1000) break;
    from += 1000;
  }
  return all;
}

function fmtAudio(s: any): string {
  const p: string[] = [];
  if (s.audio_tempo != null) p.push(`BPM:${Math.round(s.audio_tempo)}`);
  if (s.audio_energy != null) p.push(`e:${s.audio_energy.toFixed(2)}`);
  if (s.audio_valence != null) p.push(`v:${s.audio_valence.toFixed(2)}`);
  if (s.audio_danceability != null) p.push(`d:${s.audio_danceability.toFixed(2)}`);
  if (s.audio_acousticness != null) p.push(`ac:${s.audio_acousticness.toFixed(2)}`);
  return p.length ? ` [${p.join(",")}]` : "";
}

function fmtSong(s: any, i: number): string {
  let l = `${i + 1}. "${s.track_name}" – ${s.artist_name}`;
  if (s.album_name) l += ` (${s.album_name})`;
  l += fmtAudio(s);
  const tags: string[] = [];
  if (s.mood) tags.push(`mood:"${s.mood}"`);
  if (s.groove_feel) tags.push(`grv:"${s.groove_feel}"`);
  if (s.production_style) tags.push(`prd:"${s.production_style}"`);
  if (s.energy) tags.push(`E:${s.energy}`);
  if (s.genre_tags?.length) tags.push(`g:[${s.genre_tags.join(",")}]`);
  if (tags.length) l += ` {${tags.join(", ")}}`;
  if (s.language) l += ` [lang:${s.language}]`;
  return l;
}

function stratSample(songs: any[], max: number): any[] {
  if (songs.length <= max) return [...songs];
  const buckets = new Map<string, any[]>();
  for (const s of songs) {
    const k = `${s.energy || "?"}|${s.groove_feel?.substring(0, 8) || "?"}|${s.mood?.substring(0, 8) || "?"}`;
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k)!.push(s);
  }
  const out: any[] = [];
  const keys = [...buckets.keys()];
  let r = 0;
  while (out.length < max) {
    let added = false;
    for (const k of keys) { const b = buckets.get(k)!; if (r < b.length && out.length < max) { out.push(b[r]); added = true; } }
    if (!added) break;
    r++;
  }
  return out;
}

async function updateJob(adm: any, jobId: string, patch: Record<string, unknown>) {
  await adm.from("playlist_generation_jobs").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", jobId);
}

async function failJob(adm: any, jobId: string, message: string) {
  await updateJob(adm, jobId, { status: "failed", phase: "failed", status_message: "Failed.", error_message: message, completed_at: new Date().toISOString() });
}

/* ── Prompts & Tools ── */

const SONG_COLS = "id, spotify_track_id, track_name, artist_name, album_name, image_url, audio_tempo, audio_energy, audio_valence, audio_danceability, audio_acousticness, audio_instrumentalness, audio_speechiness, audio_loudness, audio_liveness, mood, energy, atmosphere, production_style, groove_feel, vocal_style, sonic_brightness, spatial_quality, rhythmic_identity, listening_context, sonic_texture, intimacy_scale, tension_level, genre_tags, era, tempo_estimate, language";

const TAG_SYS = `You are Tempo — a world-class music analyst. Analyze each song across 17 deep musical dimensions:
1. mood — Precise emotional shade (NOT generic "happy"/"sad")
2. energy — low/medium-low/medium/medium-high/high
3. genre_tags — 2-4 specific subgenres
4. tempo_estimate — very slow/slow/mid-tempo/uptempo/fast
5. era — Sonic era influence
6. atmosphere — Spatial/environmental quality
7. production_style — Production philosophy
8. groove_feel — How the rhythm FEELS
9. vocal_style — Vocal character
10. sonic_brightness — very dark/dark/neutral/bright/very bright
11. spatial_quality — Mix space
12. rhythmic_identity — Groove DNA
13. listening_context — Best listening scenario
14. sonic_texture — Tactile quality
15. intimacy_scale — Scale of sound
16. tension_level — Tension vs release
17. language — Language of lyrics (or "instrumental")

Be SPECIFIC. "Chill" is NOT a mood. Language is informational, never a grouping signal.`;

const TAG_TOOL = {
  type: "function" as const,
  function: {
    name: "tag_songs",
    description: "Save deep musical analysis tags for each song",
    parameters: {
      type: "object",
      properties: {
        songs: {
          type: "array",
          items: {
            type: "object",
            properties: {
              index: { type: "number" },
              genre_tags: { type: "array", items: { type: "string" } },
              mood: { type: "string" }, energy: { type: "string" },
              tempo_estimate: { type: "string" }, era: { type: "string" },
              atmosphere: { type: "string" }, production_style: { type: "string" },
              groove_feel: { type: "string" }, vocal_style: { type: "string" },
              sonic_brightness: { type: "string" }, spatial_quality: { type: "string" },
              rhythmic_identity: { type: "string" }, listening_context: { type: "string" },
              sonic_texture: { type: "string" }, intimacy_scale: { type: "string" },
              tension_level: { type: "string" }, language: { type: "string" },
            },
            required: ["index", "mood", "energy", "groove_feel", "language"],
          },
        },
      },
      required: ["songs"],
    },
  },
};

const WORLDS_SYS = `You are Tempo — an expert music curator building playlists from a user's full Spotify library.

Create playlist concepts ("sonic worlds") where every song would transition naturally into the next.

RULES:
- Group by SOUND, never by language. A Spanish ballad and Spanish reggaeton share NOTHING.
- Each world needs a clear sonic identity: groove + energy + production + mood + context.
- Aim for 12-35 worlds for large libraries.
- NEVER create "Uncategorized", "Other", or language-based worlds.
- Include "what_belongs" and "what_breaks_it" for each world.`;

const WORLDS_TOOL = {
  type: "function" as const,
  function: {
    name: "define_sonic_worlds",
    description: "Define sonic worlds (playlist concepts)",
    parameters: {
      type: "object",
      properties: {
        worlds: {
          type: "array",
          items: {
            type: "object",
            properties: {
              world_id: { type: "string" }, name: { type: "string" },
              vibe_description: { type: "string" }, ai_explanation: { type: "string" },
              mood_tags: { type: "array", items: { type: "string" } },
              color_hex: { type: "string" },
              energy_level: { type: "string" },
              groove_identity: { type: "string" },
              production_identity: { type: "string" },
              listening_context: { type: "string" },
              what_belongs: { type: "string" }, what_breaks_it: { type: "string" },
            },
            required: ["world_id", "name", "vibe_description", "mood_tags", "energy_level", "what_belongs", "what_breaks_it"],
          },
        },
      },
      required: ["worlds"],
    },
  },
};

const ASSIGN_SYS = `You are Tempo — a strict playlist curator assigning songs to sonic worlds.

COMPATIBILITY CHECKLIST (need 7+/10):
1. Compatible groove/rhythm
2. Compatible energy range
3. Same emotional shade
4. Compatible production texture
5. Compatible vocal approach
6. Same brightness spectrum
7. Same spatial scale
8. Compatible tension pattern
9. Same listening context
10. Would sound natural in sequence

LANGUAGE has ZERO weight. A Spanish ballad goes with English ballads if they share sonic DNA.
If <7 for ALL worlds, assign "needs_review". Maximum 25 needs_review across entire library.`;

const ASSIGN_TOOL = {
  type: "function" as const,
  function: {
    name: "assign_songs",
    description: "Assign songs to sonic worlds",
    parameters: {
      type: "object",
      properties: {
        assignments: {
          type: "array",
          items: {
            type: "object",
            properties: {
              index: { type: "number" },
              world_id: { type: "string" },
              confidence: { type: "number" },
            },
            required: ["index", "world_id", "confidence"],
          },
        },
      },
      required: ["assignments"],
    },
  },
};

const VALIDATE_SYS = `You are Tempo — final quality control for generated playlists.
Evaluate coherence, identity, size, outliers, and language traps.
Actions: "keep", "remove_songs", "merge", "delete", "rename".
Flag any playlist grouped primarily by language.`;

const VALIDATE_TOOL = {
  type: "function" as const,
  function: {
    name: "validate_playlists",
    description: "Validate playlist quality",
    parameters: {
      type: "object",
      properties: {
        actions: {
          type: "array",
          items: {
            type: "object",
            properties: {
              action: { type: "string", enum: ["keep", "remove_songs", "merge", "delete", "rename"] },
              world_id: { type: "string" },
              coherence_score: { type: "number" },
              song_indices_to_remove: { type: "array", items: { type: "number" } },
              target_world_id: { type: "string" },
              new_name: { type: "string" },
              reason: { type: "string" },
            },
            required: ["action", "world_id", "reason"],
          },
        },
      },
      required: ["actions"],
    },
  },
};

/* ══════════════════════════════════════════════
   PIPELINE STEP PROCESSOR
   ══════════════════════════════════════════════ */

const INTERNAL_HEADER = "x-tempo-internal";

function queueNextStep(
  functionUrl: string, anonKey: string, serviceKey: string,
  jobId: string, userId: string, forceRetag: boolean,
) {
  const work = fetch(functionUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${serviceKey}`,
      apikey: anonKey,
      [INTERNAL_HEADER]: "1",
    },
    body: JSON.stringify({ mode: "process_step", job_id: jobId, user_id: userId, force_retag: forceRetag }),
  }).catch(e => console.error("[pipeline] queue error:", e));

  if (typeof (globalThis as any).EdgeRuntime?.waitUntil === "function") {
    (globalThis as any).EdgeRuntime.waitUntil(work);
  }
}

/* ══════════════════════════════════════════════
   MAIN HANDLER
   ══════════════════════════════════════════════ */

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const url = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const svc = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const functionUrl = `${url}/functions/v1/analyze-liked-songs`;

    // Parse body
    let mode = "tag_batch";
    let batchSize = 40;
    let forceRetag = false;
    let jobId: string | null = null;
    let internalUserId: string | null = null;

    try {
      const b = await req.json();
      if (b?.mode) mode = String(b.mode);
      if (typeof b?.batch_size === "number") batchSize = Math.min(b.batch_size, 50);
      if (b?.force_retag) forceRetag = true;
      if (b?.job_id) jobId = b.job_id;
      if (typeof b?.user_id === "string") internalUserId = b.user_id;
    } catch { /* no body */ }

    // Auth: internal service calls vs user calls
    const isInternal = req.headers.get(INTERNAL_HEADER) === "1" && req.headers.get("Authorization") === `Bearer ${svc}`;
    const adm = createClient(url, svc);
    let userId: string;

    if (isInternal) {
      if (!internalUserId) return json({ error: "user_id required" }, 400);
      userId = internalUserId;
    } else {
      const auth = req.headers.get("Authorization");
      if (!auth) return json({ error: "Not authenticated" }, 401);
      const sb = createClient(url, anon, { global: { headers: { Authorization: auth } } });
      const { data: { user }, error: ue } = await sb.auth.getUser();
      if (ue || !user) return json({ error: "Invalid session" }, 401);
      userId = user.id;
    }

    console.info(`[analyze] mode=${mode} user=${userId.substring(0, 8)}`);

    /* ═══ TAG BATCH ═══ */
    if (mode === "tag_batch") {
      const { data: unan } = await adm.from("liked_songs")
        .select("id, spotify_track_id, track_name, artist_name, album_name, image_url, audio_tempo, audio_energy, audio_valence, audio_danceability, audio_acousticness, audio_instrumentalness, audio_speechiness, audio_loudness, audio_liveness")
        .eq("user_id", userId).is("groove_feel", null)
        .order("added_at", { ascending: false }).limit(batchSize);

      const songs = unan || [];
      if (songs.length === 0) {
        const { count } = await adm.from("liked_songs").select("id", { count: "exact", head: true }).eq("user_id", userId);
        return json({ success: true, done: true, total: count ?? 0 });
      }

      const list = songs.map((s: any, i: number) =>
        `${i + 1}. "${s.track_name}" – ${s.artist_name}${s.album_name ? ` (${s.album_name})` : ""}${fmtAudio(s)}`
      ).join("\n");

      const p = await callAI(API_KEY, "google/gemini-2.5-flash", TAG_SYS,
        `Analyze these ${songs.length} songs. Be SPECIFIC.\n\n${list}\n\nUse tag_songs.`,
        [TAG_TOOL], { type: "function", function: { name: "tag_songs" } });

      const now = new Date().toISOString();
      for (const tg of p.songs || []) {
        const idx = (tg.index || 0) - 1;
        if (idx < 0 || idx >= songs.length) continue;
        await adm.from("liked_songs").update({
          genre_tags: tg.genre_tags || [], mood: tg.mood, energy: tg.energy,
          tempo_estimate: tg.tempo_estimate, era: tg.era, atmosphere: tg.atmosphere,
          production_style: tg.production_style, groove_feel: tg.groove_feel,
          vocal_style: tg.vocal_style, sonic_brightness: tg.sonic_brightness,
          spatial_quality: tg.spatial_quality, rhythmic_identity: tg.rhythmic_identity,
          listening_context: tg.listening_context, sonic_texture: tg.sonic_texture,
          intimacy_scale: tg.intimacy_scale, tension_level: tg.tension_level,
          language: tg.language || null, analyzed_at: now,
        }).eq("id", songs[idx].id);
      }

      const { count: analyzed } = await adm.from("liked_songs").select("id", { count: "exact", head: true })
        .eq("user_id", userId).not("groove_feel", "is", null);
      const { count: totalCount } = await adm.from("liked_songs").select("id", { count: "exact", head: true }).eq("user_id", userId);

      return json({ success: true, done: (analyzed ?? 0) >= (totalCount ?? 0), analyzed: analyzed ?? 0, total: totalCount ?? 0, batch: (p.songs || []).length });
    }

    /* ═══ RUN PIPELINE (user-facing dispatcher) ═══ */
    if (mode === "run_pipeline") {
      if (!jobId) return json({ error: "job_id required" }, 400);

      await updateJob(adm, jobId, {
        status: "running",
        phase: "tagging",
        started_at: new Date().toISOString(),
        status_message: "Starting deep analysis…",
        error_message: null,
      });

      queueNextStep(functionUrl, anon, svc, jobId, userId, forceRetag);
      return json({ success: true, job_id: jobId, message: "Pipeline started" }, 202);
    }

    /* ═══ PROCESS STEP (internal, self-chaining) ═══ */
    if (mode === "process_step") {
      if (!isInternal) return json({ error: "Forbidden" }, 403);
      if (!jobId) return json({ error: "job_id required" }, 400);

      const { data: job, error: jobErr } = await adm
        .from("playlist_generation_jobs")
        .select("*")
        .eq("id", jobId)
        .single();

      if (jobErr || !job) return json({ error: "Job not found" }, 404);
      if (job.user_id !== userId) return json({ error: "Forbidden" }, 403);
      if (["completed", "failed", "cancelled"].includes(job.status)) {
        return json({ success: true, terminal: true });
      }

      const queue = () => queueNextStep(functionUrl, anon, svc, jobId!, userId, forceRetag);

      try {
        /* ── PHASE: TAGGING ── */
        if (job.phase === "tagging" || job.phase === "queued") {
          // Count total songs
          let totalSongs = job.total_songs;
          if (!totalSongs) {
            const { count } = await adm.from("liked_songs").select("id", { count: "exact", head: true }).eq("user_id", userId);
            totalSongs = count ?? 0;
            await updateJob(adm, jobId!, { total_songs: totalSongs, phase: "tagging", status: "running" });
          }

          if (totalSongs === 0) {
            await failJob(adm, jobId!, "No liked songs. Import your library first.");
            return json({ error: "No liked songs" }, 400);
          }

          // Force retag: wipe metadata on first step only
          if (forceRetag && (job.total_analyzed ?? 0) === 0 && (job.worlds_count ?? 0) === 0) {
            await adm.from("liked_songs").update({
              analyzed_at: null, groove_feel: null, vocal_style: null, sonic_brightness: null,
              spatial_quality: null, rhythmic_identity: null, listening_context: null,
              sonic_texture: null, intimacy_scale: null, tension_level: null,
              mood: null, energy: null, atmosphere: null, production_style: null,
              era: null, tempo_estimate: null, genre_tags: [], language: null,
            }).eq("user_id", userId);

            const existing = await fetchAll(adm, "liked_song_clusters", userId, "id");
            if (existing.length) {
              for (let i = 0; i < existing.length; i += 50) {
                await adm.from("liked_song_cluster_tracks").delete().in("cluster_id", existing.slice(i, i + 50).map((c: any) => c.id));
              }
              await adm.from("liked_song_clusters").delete().eq("user_id", userId);
            }
          }

          // Tag one batch
          const { data: untagged } = await adm.from("liked_songs")
            .select("id, spotify_track_id, track_name, artist_name, album_name, image_url, audio_tempo, audio_energy, audio_valence, audio_danceability, audio_acousticness, audio_instrumentalness, audio_speechiness, audio_loudness, audio_liveness")
            .eq("user_id", userId).is("groove_feel", null)
            .order("added_at", { ascending: false }).limit(batchSize);

          const songs = untagged || [];

          if (songs.length === 0) {
            // All tagged — advance to defining_worlds
            await updateJob(adm, jobId!, {
              total_analyzed: totalSongs, phase: "defining_worlds", status: "running",
              status_message: "Studying your library ecosystem…",
            });
            queue();
            return json({ success: true, phase: "defining_worlds" }, 202);
          }

          const list = songs.map((s: any, i: number) =>
            `${i + 1}. "${s.track_name}" – ${s.artist_name}${s.album_name ? ` (${s.album_name})` : ""}${fmtAudio(s)}`
          ).join("\n");

          const p = await callAI(API_KEY, "google/gemini-2.5-flash", TAG_SYS,
            `Analyze these ${songs.length} songs. Be SPECIFIC.\n\n${list}\n\nUse tag_songs.`,
            [TAG_TOOL], { type: "function", function: { name: "tag_songs" } });

          const now = new Date().toISOString();
          for (const tg of p.songs || []) {
            const idx = (tg.index || 0) - 1;
            if (idx < 0 || idx >= songs.length) continue;
            await adm.from("liked_songs").update({
              genre_tags: tg.genre_tags || [], mood: tg.mood, energy: tg.energy,
              tempo_estimate: tg.tempo_estimate, era: tg.era, atmosphere: tg.atmosphere,
              production_style: tg.production_style, groove_feel: tg.groove_feel,
              vocal_style: tg.vocal_style, sonic_brightness: tg.sonic_brightness,
              spatial_quality: tg.spatial_quality, rhythmic_identity: tg.rhythmic_identity,
              listening_context: tg.listening_context, sonic_texture: tg.sonic_texture,
              intimacy_scale: tg.intimacy_scale, tension_level: tg.tension_level,
              language: tg.language || null, analyzed_at: now,
            }).eq("id", songs[idx].id);
          }

          const { count: analyzed } = await adm.from("liked_songs").select("id", { count: "exact", head: true })
            .eq("user_id", userId).not("groove_feel", "is", null);

          const done = (analyzed ?? 0) >= totalSongs;
          await updateJob(adm, jobId!, {
            total_analyzed: analyzed ?? 0,
            phase: done ? "defining_worlds" : "tagging",
            status_message: done ? "Studying your library ecosystem…" : `${analyzed ?? 0} of ${totalSongs} songs analyzed…`,
          });

          queue();
          return json({ success: true, phase: done ? "defining_worlds" : "tagging", analyzed: analyzed ?? 0 }, 202);
        }

        /* ── PHASE: DEFINING WORLDS ── */
        if (job.phase === "defining_worlds") {
          const allSongs = await fetchAll(adm, "liked_songs", userId, SONG_COLS);
          const tagged = allSongs.filter((s: any) => s.groove_feel != null);

          if (tagged.length < 10) {
            await failJob(adm, jobId!, `Only ${tagged.length} tagged songs. Need at least 10.`);
            return json({ error: "Not enough tagged songs" }, 400);
          }

          // Build context
          const pls = await fetchAll(adm, "spotify_playlists", userId, "id, name, description, track_count, is_owned_by_user");
          const plTracks = await fetchAll(adm, "spotify_playlist_tracks", userId, "playlist_id, track_name, artist_name, position");
          const plMap = new Map<string, any[]>();
          for (const t of plTracks) { if (!plMap.has(t.playlist_id)) plMap.set(t.playlist_id, []); plMap.get(t.playlist_id)!.push(t); }

          const plBlocks: string[] = [];
          let budget = 0;
          for (const pl of pls) {
            if (budget > 12000) break;
            const tks = (plMap.get(pl.id) || []).sort((a: any, b: any) => (a.position || 0) - (b.position || 0)).slice(0, 25);
            if (tks.length > 0) {
              const block = `📋 "${pl.name}" (${pl.track_count}tk)\n${tks.map((t: any) => `  - "${t.track_name}" – ${t.artist_name}`).join("\n")}`;
              plBlocks.push(block);
              budget += block.length;
            }
          }

          const [arts, albs] = await Promise.all([
            fetchAll(adm, "spotify_followed_artists", userId, "artist_name, genres"),
            fetchAll(adm, "spotify_saved_albums", userId, "album_name, artist_name, genres, release_date"),
          ]);

          const sample = stratSample(tagged, 350);
          const suggest = Math.max(12, Math.min(35, Math.floor(allSongs.length / 50)));

          const ctx = `LIBRARY: ${allSongs.length} songs (${tagged.length} analyzed)\n\nPLAYLISTS (${pls.length}):\n${plBlocks.join("\n\n") || "None"}\n\nARTISTS (${arts.length}):\n${arts.slice(0, 60).map((a: any) => `- ${a.artist_name}${a.genres?.length ? ` [${a.genres.slice(0, 3).join(", ")}]` : ""}`).join("\n") || "None"}\n\nALBUMS (${albs.length}):\n${albs.slice(0, 40).map((a: any) => `- "${a.album_name}" by ${a.artist_name}`).join("\n") || "None"}\n\nTAGGED SAMPLE (${sample.length}):\n${sample.map((s: any, i: number) => fmtSong(s, i)).join("\n")}`;

          const result = await callAI(API_KEY, "google/gemini-2.5-flash", WORLDS_SYS,
            `Define ALL sonic worlds. NEVER group by language. Aim for ${suggest}+ worlds.\n\n${ctx}\n\nUse define_sonic_worlds.`,
            [WORLDS_TOOL], { type: "function", function: { name: "define_sonic_worlds" } }, 0.4);

          const worlds = result.worlds || [];
          if (!worlds.length) {
            await failJob(adm, jobId!, "No sonic worlds generated.");
            return json({ error: "No worlds generated" }, 500);
          }

          // Clear old clusters
          const old = await fetchAll(adm, "liked_song_clusters", userId, "id");
          if (old.length) {
            for (let i = 0; i < old.length; i += 50) {
              await adm.from("liked_song_cluster_tracks").delete().in("cluster_id", old.slice(i, i + 50).map((c: any) => c.id));
            }
            await adm.from("liked_song_clusters").delete().eq("user_id", userId);
          }

          // Create cluster shells
          const persistedWorlds: any[] = [];
          let sortOrder = 0;
          for (const w of worlds) {
            const { data: inserted } = await adm.from("liked_song_clusters").insert({
              user_id: userId, name: w.name,
              description: w.ai_explanation || null, vibe_description: w.vibe_description || null,
              ai_explanation: w.ai_explanation || null, mood_tags: w.mood_tags || [],
              color_hex: w.color_hex || "#6366f1", energy_level: w.energy_level || "medium",
              tempo_range: "Mixed", era_range: "Mixed", track_count: 0, cover_tracks: [],
              analysis_model: "sonic-worlds-v4", sort_order: sortOrder,
            }).select("id").single();
            if (inserted) persistedWorlds.push({ ...w, cluster_id: inserted.id, sort_order: sortOrder });
            sortOrder++;
          }

          // Create outlier bucket
          const { data: outlier } = await adm.from("liked_song_clusters").insert({
            user_id: userId, name: "Sonic Outliers",
            description: "Unique tracks that don't fit neatly into any sonic world.",
            vibe_description: "Eclectic edges", mood_tags: ["eclectic"],
            color_hex: "#71717a", energy_level: "medium", tempo_range: "Mixed", era_range: "Mixed",
            track_count: 0, cover_tracks: [], analysis_model: "sonic-worlds-v4", sort_order: sortOrder,
          }).select("id").single();

          if (outlier) persistedWorlds.push({ world_id: "__outliers__", name: "Sonic Outliers", cluster_id: outlier.id, is_outlier: true });

          await updateJob(adm, jobId!, {
            worlds_count: worlds.length,
            world_definitions: persistedWorlds,
            total_worlds: worlds.length + 1,
            phase: "assigning", status: "running",
            assigned_count: 0, saved_worlds: 0,
            status_message: "Assigning songs to sonic worlds…",
          });

          queue();
          return json({ success: true, phase: "assigning", worlds: worlds.length }, 202);
        }

        /* ── PHASE: ASSIGNING ── */
        if (job.phase === "assigning") {
          const storedWorlds = Array.isArray(job.world_definitions) ? job.world_definitions : [];
          const assignable = storedWorlds.filter((w: any) => !w.is_outlier && w.cluster_id);
          const outlierClusterId = storedWorlds.find((w: any) => w.is_outlier)?.cluster_id;

          if (!assignable.length || !outlierClusterId) {
            await failJob(adm, jobId!, "Missing stored worlds for assignment.");
            return json({ error: "Missing worlds" }, 500);
          }

          // Count already-assigned tracks
          const { count: processedCount } = await adm.from("liked_song_cluster_tracks")
            .select("id", { count: "exact", head: true }).eq("user_id", userId);
          const processed = processedCount ?? 0;
          const totalSongs = job.total_songs ?? 0;

          // Fetch next batch
          const { data: batch } = await adm.from("liked_songs")
            .select(SONG_COLS).eq("user_id", userId)
            .order("added_at", { ascending: true })
            .range(processed, processed + batchSize - 1);

          const songs = batch || [];

          if (songs.length === 0) {
            // All assigned — advance to finalizing
            await updateJob(adm, jobId!, {
              assigned_count: processed, phase: "saving", status: "running",
              status_message: "Finalizing playlists…",
            });
            queue();
            return json({ success: true, phase: "saving" }, 202);
          }

          // Build world descriptions
          const worldIdToCluster = new Map<string, string>();
          for (const w of assignable) worldIdToCluster.set(w.world_id, w.cluster_id);

          let rows: any[] = [];
          try {
            const ws = assignable.map((w: any) =>
              `[${w.world_id}] "${w.name}"\n  Vibe: ${w.vibe_description || "?"}\n  ✅ ${w.what_belongs || "N/A"}\n  ❌ ${w.what_breaks_it || "N/A"}`
            ).join("\n\n");

            const sl = songs.map((s: any, i: number) => fmtSong(s, i)).join("\n");
            const p = await callAI(API_KEY, "google/gemini-2.5-flash", ASSIGN_SYS,
              `WORLDS (${assignable.length}):\n${ws}\n\nSONGS (${songs.length}):\n${sl}\n\nAssign each song. Use assign_songs.`,
              [ASSIGN_TOOL], { type: "function", function: { name: "assign_songs" } });

            const assignMap = new Map<number, { world_id: string; confidence: number }>();
            for (const a of p.assignments || []) {
              const idx = (a.index || 0) - 1;
              if (idx >= 0 && idx < songs.length) assignMap.set(idx, { world_id: a.world_id, confidence: a.confidence ?? 0.8 });
            }

            rows = songs.map((s: any, idx: number) => {
              const a = assignMap.get(idx);
              const clusterId = a && worldIdToCluster.has(a.world_id)
                ? worldIdToCluster.get(a.world_id)!
                : outlierClusterId;
              return {
                user_id: userId, cluster_id: clusterId,
                liked_song_id: s.id, spotify_track_id: s.spotify_track_id,
                confidence_score: a?.confidence ?? 0.4, position: 0,
              };
            });
          } catch (e: any) {
            console.warn("[pipeline] assign fallback:", e.message);
            rows = songs.map((s: any) => ({
              user_id: userId, cluster_id: outlierClusterId,
              liked_song_id: s.id, spotify_track_id: s.spotify_track_id,
              confidence_score: 0.2, position: 0,
            }));
          }

          for (let i = 0; i < rows.length; i += 100) {
            await adm.from("liked_song_cluster_tracks").insert(rows.slice(i, i + 100));
          }

          const newTotal = processed + rows.length;
          const done = newTotal >= totalSongs;

          await updateJob(adm, jobId!, {
            assigned_count: newTotal,
            phase: done ? "saving" : "assigning",
            status_message: done ? "Finalizing playlists…" : `${newTotal} of ${totalSongs} songs assigned…`,
          });

          queue();
          return json({ success: true, phase: done ? "saving" : "assigning", assigned: newTotal }, 202);
        }

        /* ── PHASE: SAVING (finalize clusters) ── */
        if (job.phase === "saving") {
          const clusters = await fetchAll(adm, "liked_song_clusters", userId, "id, name, sort_order");
          const allTracks = await fetchAll(adm, "liked_song_cluster_tracks", userId, "id, cluster_id, liked_song_id");

          const byCluster = new Map<string, any[]>();
          for (const t of allTracks) {
            if (!byCluster.has(t.cluster_id)) byCluster.set(t.cluster_id, []);
            byCluster.get(t.cluster_id)!.push(t);
          }

          // Get song metadata for covers
          const songIds = [...new Set(allTracks.map((t: any) => t.liked_song_id))];
          const songMap = new Map<string, any>();
          for (let i = 0; i < songIds.length; i += 500) {
            const { data: songs } = await adm.from("liked_songs").select("id, track_name, image_url").in("id", songIds.slice(i, i + 500));
            for (const s of songs || []) songMap.set(s.id, s);
          }

          // Delete empty clusters, update non-empty ones
          const empty: string[] = [];
          let saved = 0;

          for (const c of clusters) {
            const tracks = byCluster.get(c.id) || [];
            if (tracks.length === 0) { empty.push(c.id); continue; }

            const covers: any[] = [];
            for (const t of tracks.slice(0, 4)) {
              const s = songMap.get(t.liked_song_id);
              if (s?.image_url) covers.push({ image_url: s.image_url, track_name: s.track_name });
            }

            await adm.from("liked_song_clusters").update({ track_count: tracks.length, cover_tracks: covers }).eq("id", c.id);
            saved++;
          }

          if (empty.length) await adm.from("liked_song_clusters").delete().in("id", empty);

          await updateJob(adm, jobId!, {
            saved_worlds: saved, total_worlds: saved,
            phase: "validating", status: "running",
            status_message: "Running final quality check…",
          });

          queue();
          return json({ success: true, phase: "validating", saved }, 202);
        }

        /* ── PHASE: VALIDATING ── */
        if (job.phase === "validating") {
          try {
            const { data: cls } = await adm.from("liked_song_clusters")
              .select("id, name, vibe_description, track_count")
              .eq("user_id", userId).order("sort_order");

            if (cls?.length) {
              const allSongs = await fetchAll(adm, "liked_songs", userId, SONG_COLS);
              const sm = new Map<string, any>();
              for (const s of allSongs) sm.set(s.id, s);

              const allCt = await fetchAll(adm, "liked_song_cluster_tracks", userId, "id, liked_song_id, cluster_id");
              const ctk: Record<string, any[]> = {};
              for (const t of allCt) { if (!ctk[t.cluster_id]) ctk[t.cluster_id] = []; ctk[t.cluster_id].push(t); }

              const wcm: Record<string, string> = {};
              const sums: string[] = [];
              for (const c of cls) {
                const tks = ctk[c.id] || [];
                const wid = c.name.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "").substring(0, 30);
                wcm[wid] = c.id;
                const tl = tks.slice(0, 30).map((t: any, i: number) => {
                  const s = sm.get(t.liked_song_id);
                  return s ? fmtSong(s, i) : `${i + 1}. [?]`;
                }).join("\n");
                sums.push(`📋 [${wid}] "${c.name}" (${tks.length} songs)\nVibe: ${c.vibe_description || "?"}\n${tl}`);
              }

              const v = await callAI(API_KEY, "google/gemini-2.5-flash", VALIDATE_SYS,
                `Review these ${cls.length} playlists.\n\n${sums.join("\n\n")}\n\nUse validate_playlists.`,
                [VALIDATE_TOOL], { type: "function", function: { name: "validate_playlists" } });

              for (const act of v.actions || []) {
                const cid = wcm[act.world_id];
                if (!cid) continue;

                if (act.action === "remove_songs" && act.song_indices_to_remove?.length) {
                  const tl = ctk[cid] || [];
                  for (const idx of act.song_indices_to_remove) {
                    const ri = idx - 1;
                    if (ri >= 0 && ri < tl.length) await adm.from("liked_song_cluster_tracks").delete().eq("id", tl[ri].id);
                  }
                  const { count } = await adm.from("liked_song_cluster_tracks").select("id", { count: "exact", head: true }).eq("cluster_id", cid).eq("user_id", userId);
                  await adm.from("liked_song_clusters").update({ track_count: count ?? 0 }).eq("id", cid);
                }
                if (act.action === "delete") {
                  await adm.from("liked_song_cluster_tracks").delete().eq("cluster_id", cid);
                  await adm.from("liked_song_clusters").delete().eq("id", cid);
                }
                if (act.action === "merge" && act.target_world_id) {
                  const tid = wcm[act.target_world_id];
                  if (tid) {
                    await adm.from("liked_song_cluster_tracks").update({ cluster_id: tid }).eq("cluster_id", cid).eq("user_id", userId);
                    const { count } = await adm.from("liked_song_cluster_tracks").select("id", { count: "exact", head: true }).eq("cluster_id", tid).eq("user_id", userId);
                    await adm.from("liked_song_clusters").update({ track_count: count ?? 0 }).eq("id", tid);
                    await adm.from("liked_song_clusters").delete().eq("id", cid);
                  }
                }
                if (act.action === "rename" && act.new_name) {
                  await adm.from("liked_song_clusters").update({ name: act.new_name }).eq("id", cid);
                }
              }
            }
          } catch (e: any) {
            console.warn("[pipeline] validate skipped:", e.message);
          }

          // DONE
          const { count: finalCount } = await adm.from("liked_song_clusters")
            .select("id", { count: "exact", head: true }).eq("user_id", userId);

          await updateJob(adm, jobId!, {
            status: "completed", phase: "done",
            status_message: "Playlists ready!",
            completed_at: new Date().toISOString(),
            total_worlds: finalCount ?? 0,
            saved_worlds: finalCount ?? 0,
          });

          return json({ success: true, phase: "done" });
        }

        await failJob(adm, jobId!, `Unknown phase: ${job.phase}`);
        return json({ error: `Unknown phase: ${job.phase}` }, 400);
      } catch (e: any) {
        console.error("[pipeline] step error:", e);
        await failJob(adm, jobId!, e.message || "Pipeline failed").catch(() => {});
        return json({ error: e.message }, 500);
      }
    }

    return json({ error: `Unknown mode: ${mode}` }, 400);
  } catch (e: any) {
    console.error("[analyze] fatal:", e);
    return json({ error: e.message || "Unknown error" }, 500);
  }
});
