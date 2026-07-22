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
  tools?: any[], toolChoice?: any, temp = 0.3, maxTokens = 4096,
): Promise<any> {
  const body: any = {
    model,
    messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }],
    temperature: temp,
    max_tokens: maxTokens,
  };
  if (tools) body.tools = tools;
  if (toolChoice) body.tool_choice = toolChoice;

  // Single attempt with 45s timeout — edge functions have 60s wall clock
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 45_000);
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    clearTimeout(timer);

    if (!res.ok) {
      const text = await res.text();
      console.error(`[callAI] failed: ${res.status} ${text.substring(0, 200)}`);
      if (res.status === 429) throw new Error("RATE_LIMITED");
      if (res.status === 402) throw new Error("CREDITS_EXHAUSTED");
      throw new Error(`AI error ${res.status}: ${text.substring(0, 200)}`);
    }

    const data = await res.json();
    const tc = data.choices?.[0]?.message?.tool_calls?.[0];
    if (tc?.function?.arguments) {
      try { return JSON.parse(tc.function.arguments); } catch { return extractJson(tc.function.arguments); }
    }
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error("Empty AI response");
    return extractJson(content);
  } catch (e: any) {
    console.error(`[callAI] error:`, e.message);
    throw e;
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
  if (s.vocal_style) tags.push(`voc:"${s.vocal_style}"`);
  if (s.sonic_texture) tags.push(`tex:"${s.sonic_texture}"`);
  if (s.rhythmic_identity) tags.push(`rhy:"${s.rhythmic_identity}"`);
  if (tags.length) l += ` {${tags.join(", ")}}`;
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

const SONG_COLS = "id, spotify_track_id, track_name, artist_name, album_name, image_url, audio_tempo, audio_energy, audio_valence, audio_danceability, audio_acousticness, audio_instrumentalness, audio_speechiness, audio_loudness, audio_liveness, mood, energy, atmosphere, production_style, groove_feel, vocal_style, sonic_brightness, spatial_quality, rhythmic_identity, listening_context, sonic_texture, intimacy_scale, tension_level, genre_tags, era, tempo_estimate";

const TAG_SYS = `You are Tempo — a world-class music analyst with encyclopedic knowledge of every genre, era, and production style. Analyze each song across 16 deep musical dimensions. Use your knowledge of the artist, album, and track to give SPECIFIC, insightful tags.

Dimensions:
1. mood — Precise emotional shade. NEVER use generic words like "happy", "sad", "chill", "upbeat". Use specific shades: "wistful nostalgia", "restless yearning", "euphoric abandon", "brooding defiance", "sun-drenched contentment".
2. energy — low / medium-low / medium / medium-high / high
3. genre_tags — 2-4 specific subgenres (e.g. "neo-soul", "bedroom pop", "acid house", "post-punk revival")
4. tempo_estimate — very slow / slow / mid-tempo / uptempo / fast
5. era — Sonic era influence (e.g. "late-2010s", "70s analog", "Y2K pop")
6. atmosphere — Spatial/environmental quality (e.g. "intimate bedroom", "vast stadium", "smoky lounge", "neon-lit city")
7. production_style — Production philosophy (e.g. "lo-fi DIY", "polished pop", "analog warmth", "maximalist electronic")
8. groove_feel — How the rhythm FEELS in the body (e.g. "head-nodding bounce", "hip-swaying groove", "driving pulse", "floating rubato", "syncopated strut")
9. vocal_style — Vocal character (e.g. "breathy whisper", "powerful belt", "auto-tuned croon", "spoken word", "choral harmony", "instrumental")
10. sonic_brightness — very dark / dark / neutral / bright / very bright
11. spatial_quality — Mix space (e.g. "claustrophobic mono", "wide stereo", "cavernous reverb", "dry and intimate")
12. rhythmic_identity — Groove DNA (e.g. "four-on-the-floor", "boom-bap", "reggaeton dembow", "waltz", "breakbeat", "shuffle")
13. listening_context — Best scenario (e.g. "late night drive", "morning coffee", "workout peak", "dinner party", "beach sunset")
14. sonic_texture — Tactile quality (e.g. "silky smooth", "gritty distorted", "crystalline", "warm analog", "glitchy digital")
15. intimacy_scale — intimate / personal / social / arena / epic
16. tension_level — very relaxed / relaxed / moderate / tense / intense

Language IS relevant for grouping. Detect it accurately (english / spanish / portuguese / italian / french / instrumental / other). Tag by sonic qualities normally; language is a separate axis used later by the clusterer.
Be SPECIFIC and CREATIVE with your descriptions. Generic tags are useless.`;

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
              tension_level: { type: "string" },
            },
            required: ["index", "mood", "energy", "groove_feel", "genre_tags", "production_style"],
          },
        },
      },
      required: ["songs"],
    },
  },
};

const WORLDS_SYS = `You are Tempo — an elite music curator organizing ONLY the songs already in the user's Spotify library (liked songs, saved album tracks, followed artists). NEVER invent tracks or artists. Define "sonic worlds" (playlist concepts) where every song transitions naturally into the next and the whole playlist feels like ONE experience.

DO NOT organize by: genre alone, artist, decade, or a single generic energy label. Those are supporting signals, never the reason a playlist exists.

Instead group by the FULL sonic feel — combining: energy, tempo, rhythm, beat type, drum presence & intensity, bass use, amount of melody, internal changes/dynamics, tonal color, emotion, atmosphere, main instruments, vocal strength & delivery, aggression vs calm, nostalgia, elegance, party-ness, night-ness, cinematic quality, movement, softness vs heaviness, and how easily the song sits next to other songs.

Understand that two songs from the SAME artist or genre can belong in totally different worlds:
- One Julio Iglesias track can be rhythmic and elegant while another is slow and sentimental.
- One Mecano track is quiet and melancholic while another is synth-driven and active.
- Sting has deep atmospheric tracks with strong beats and also very quiet ones.
- AC/DC's heavy, constant-drive rock does NOT mix with melodic softer rock.
- Kanye/Mac Miller's melodic emotional rap does NOT mix with 21 Savage's dark, dry, minimalist rap even though all are "rap".

LANGUAGE RULE (hard):
- English songs go ONLY with other English songs.
- Spanish, Portuguese, Italian and French can share worlds with each other (Romance / Latin family), when sonic DNA matches.
- Never mix English with Spanish/Portuguese/Italian/French in the same world.
- Other languages (Japanese, Korean, German, etc.) stay within their own family unless sonic DNA is exceptional.
- Instrumental / no-vocals songs can join any language family if sonic DNA matches.
- Sonic DNA still decides everything WITHIN a compatible language family.

IRON RULES:
1. Respect the LANGUAGE RULE above as a hard filter, then group by sonic DNA.
2. NEVER name a world after a language ("Spanish Songs", "English Tracks") — name by sonic identity.
3. NEVER create catch-alls ("Uncategorized", "Other", "Mixed", "Various", "Misc").
4. NEVER name a world with only a broad genre ("Pop", "Rock", "Rap", "Indie"). Always specify the VIBE.
5. NEVER be too generic ("Chill Songs", "Party Music", "Old Music"). Prefer things like: "Rock con guitarras fuertes y ritmo constante", "Rap melódico para escuchar de noche", "Pop ochentero suave con sintetizadores", "Canciones oscuras con bajo pesado", "Canciones alegres que no llegan a fiesta", "Música intensa para manejar".
6. Each world has ONE clear identity: specific mood + energy behavior + production texture + listening scenario + compatible language family.

QUALITY STANDARDS:
- Consistent energy range (±1 level) OR an intentional progression declared in vibe_description.
- Recognizable production aesthetic and rhythmic identity.
- Size targets: aim for 15–50 songs per world; minimum 8 (only go lower if identity is very sharp); if a world would exceed ~60, split it by real sonic sub-differences.
- Provide "what_belongs" (required sonic qualities + accepted language family) and "what_breaks_it" (what would feel jarring, including wrong language family).
- Songs that clearly don't fit any world go to "Needs Review" — target under 5% of library.

USE the user's existing playlists as taste hints — mirror curation instincts, elevate with deeper sonic analysis.`;

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

const ASSIGN_SYS = `You are Tempo — a strict playlist curator assigning ONLY songs from the user's real library (never invent tracks) to sonic worlds based PURELY on musical compatibility.

SONIC COMPATIBILITY CHECKLIST (a song needs 7+/10 to belong):
1. Compatible groove / rhythmic identity / beat type
2. Compatible energy range (within ±1 of the world's center)
3. Same emotional shade / mood family
4. Compatible production texture and aesthetic
5. Compatible vocal approach or instrumental character (vocal strength & delivery)
6. Same brightness / tonal color
7. Same spatial scale (intimate vs arena) and cinematic level
8. Compatible tension/aggression pattern
9. Same listening context / scenario (night, drive, dinner, workout, etc.)
10. Would sound NATURAL played right after any song already in that world

Same artist ≠ same world. Two Mecano / Julio Iglesias / Sting / Kanye tracks can go to different worlds if their sonic feel differs. Same genre ≠ same world (melodic rap vs dark minimalist rap must separate; heavy driving rock vs melodic softer rock must separate).

LANGUAGE FILTER (hard):
- English songs ONLY join English-family worlds. Never assign an English song to a world whose accepted family is Romance/Latin (Spanish/Portuguese/Italian/French), and vice versa.
- Spanish, Portuguese, Italian and French songs can be assigned to the same Romance/Latin world if sonic DNA matches.
- Instrumental / no-vocals songs may join any family when sonic DNA matches.
- If a song's language conflicts with the world's family, it goes to "needs_review" (or a different, compatible world) even if the sonic DNA is perfect.

ASSIGNMENT RULES:
- 7+ match AND compatible language family: assign with confidence 0.7–1.0
- 5–6 for BEST compatible world: assign with confidence 0.5–0.6
- <5 for ALL worlds, OR language mismatch on every world: assign to "needs_review" with confidence 0.3
- A song MAY appear in more than one world ONLY if it genuinely fits multiple distinct ambiences at 7+ AND both share a compatible language family
- Never force a song into a world just to place it. "needs_review" is acceptable (<5% of library).
- When tied, pick the world where GROOVE + ENERGY fit better.`;

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

const VALIDATE_SYS = `You are Tempo — final quality control for generated playlists. You catch mistakes that would make playlists feel incoherent or lazy.

CHECK EACH PLAYLIST FOR:
1. LANGUAGE MIX: Flag any playlist that mixes English with Spanish/Portuguese/Italian/French. English must stay alone; Romance languages can coexist. Instrumental songs are neutral.
2. COHERENCE: Do all songs share compatible groove, energy, mood, and production? Would they flow naturally in sequence?
3. SIZE: Flag playlists with <5 songs (merge into closest match) or >100 songs (split by sub-vibes).
4. IDENTITY: Does the playlist name accurately reflect the actual sonic content?
5. OUTLIERS: Flag any song that would sound jarring next to 80% of the other songs in that playlist.
6. GENERIC NAMES: Flag names like "Uncategorized", "Other", "Mixed", or pure genre names like "Pop" or "Rock".

Actions: "keep" (good as-is), "remove_songs" (remove specific outliers), "merge" (combine with another playlist), "delete" (dissolve — redistribute songs), "rename" (better name needed).`;

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

const ORDER_SYS = `You are Tempo — a DJ sequencing songs for perfect flow inside ONE playlist. All songs already belong to the same sonic world.

Sequence them like a real listening experience:
- Opening track: introduces the ambience clearly (not the peak, not the quietest).
- Following tracks: build the experience — group compatible transitions (similar groove → similar groove, similar tempo, similar brightness).
- Middle: allow the highest energy / intensity or the emotional peak of the playlist.
- Ending: land naturally — do not cut abruptly, do not drop to a jarring contrast.

Rules:
- Never place a very slow song between two very intense songs.
- Never drop a bright/happy song into a dark section without a transition.
- Use tempo, energy, groove, tonal color and instruments to decide neighbors.
- Energy can be steady OR an intentional arc — never chaotic.

Return the reordered indices (1-based) in the optimal listening sequence.`;

const ORDER_TOOL = {
  type: "function" as const,
  function: {
    name: "order_songs",
    description: "Return optimal song order",
    parameters: {
      type: "object",
      properties: {
        ordered_indices: {
          type: "array",
          items: { type: "number" },
          description: "Song indices (1-based) in optimal listening order",
        },
      },
      required: ["ordered_indices"],
    },
  },
};

/* ══════════════════════════════════════════════
   PIPELINE STEP PROCESSOR
   ══════════════════════════════════════════════ */

const INTERNAL_HEADER = "x-tempo-internal";

async function queueNextStep(
  functionUrl: string, anonKey: string, serviceKey: string,
  jobId: string, userId: string, forceRetag: boolean,
): Promise<boolean> {
  // The receiver acknowledges with HTTP 202 immediately and continues work
  // inside its own EdgeRuntime.waitUntil(). So we just await the fetch.
  // We use AbortSignal.timeout as a safety net only — never abort on purpose.
  try {
    const res = await fetch(functionUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${serviceKey}`,
        apikey: anonKey,
        [INTERNAL_HEADER]: "1",
      },
      body: JSON.stringify({ mode: "process_step", job_id: jobId, user_id: userId, force_retag: forceRetag }),
      signal: AbortSignal.timeout(20_000),
    });
    console.log(`[pipeline] dispatched next chunk for job ${jobId} → HTTP ${res.status}`);
    // Drain body to free the connection; ignore content
    try { await res.text(); } catch { /* ignore */ }
    return res.ok || res.status === 202;
  } catch (e: any) {
    console.error(`[pipeline] queue error:`, e?.message || e);
    return false;
  }
}

/* ══════════════════════════════════════════════
   MAIN HANDLER
   ══════════════════════════════════════════════ */

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const API_KEY = Deno.env.get("OPENAI_API_KEY");
    if (!API_KEY) throw new Error("OPENAI_API_KEY not configured");

    const url = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const svc = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const functionUrl = `${url}/functions/v1/analyze-liked-songs`;

    let mode = "tag_batch";
    let batchSize = 10;
    let forceRetag = false;
    let jobId: string | null = null;
    let internalUserId: string | null = null;

    try {
      const b = await req.json();
      if (b?.mode) mode = String(b.mode);
      if (typeof b?.batch_size === "number") batchSize = Math.min(b.batch_size, 15);
      if (b?.force_retag) forceRetag = true;
      if (b?.job_id) jobId = b.job_id;
      if (typeof b?.user_id === "string") internalUserId = b.user_id;
    } catch { /* no body */ }

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

    /* ═══ TAG BATCH (standalone) ═══ */
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

      const p = await callAI(API_KEY, "gpt-4o-mini", TAG_SYS,
        `Analyze these ${songs.length} songs. Be SPECIFIC.\n\n${list}\n\nUse tag_songs.`,
        [TAG_TOOL], { type: "function", function: { name: "tag_songs" } });

      const now = new Date().toISOString();
      const updates: Promise<any>[] = [];
      for (const tg of p.songs || []) {
        const idx = (tg.index || 0) - 1;
        if (idx < 0 || idx >= songs.length) continue;
        updates.push(adm.from("liked_songs").update({
          genre_tags: tg.genre_tags || [], mood: tg.mood, energy: tg.energy,
          tempo_estimate: tg.tempo_estimate, era: tg.era, atmosphere: tg.atmosphere,
          production_style: tg.production_style, groove_feel: tg.groove_feel,
          vocal_style: tg.vocal_style, sonic_brightness: tg.sonic_brightness,
          spatial_quality: tg.spatial_quality, rhythmic_identity: tg.rhythmic_identity,
          listening_context: tg.listening_context, sonic_texture: tg.sonic_texture,
          intimacy_scale: tg.intimacy_scale, tension_level: tg.tension_level,
          analyzed_at: now,
        }).eq("id", songs[idx].id));
      }
      await Promise.all(updates);

      const { count: analyzed } = await adm.from("liked_songs").select("id", { count: "exact", head: true })
        .eq("user_id", userId).not("groove_feel", "is", null);
      const { count: totalCount } = await adm.from("liked_songs").select("id", { count: "exact", head: true }).eq("user_id", userId);

      return json({ success: true, done: (analyzed ?? 0) >= (totalCount ?? 0), analyzed: analyzed ?? 0, total: totalCount ?? 0, batch: (p.songs || []).length });
    }

    /* ═══ RUN PIPELINE (user-facing dispatcher) ═══ */
    /* Also handles RESUME of a previously failed/paused job (no work is lost). */
    if (mode === "run_pipeline" || mode === "resume_pipeline") {
      if (!jobId) return json({ error: "job_id required" }, 400);

      const { data: checkJob } = await adm
        .from("playlist_generation_jobs")
        .select("status, phase")
        .eq("id", jobId)
        .single();
      if (!checkJob) return json({ error: "Job not found" }, 404);

      const isResumable =
        checkJob.status === "failed" ||
        checkJob.status === "paused_waiting_for_next_chunk" ||
        checkJob.status === "running" ||
        checkJob.status === "pending";

      if (checkJob.status === "completed" || checkJob.status === "cancelled") {
        return json({ error: "Job already terminated", status: checkJob.status }, 400);
      }
      if (mode === "run_pipeline" && !isResumable) {
        return json({ error: "Job not in a runnable state", status: checkJob.status }, 400);
      }

      // Pick a sensible phase: keep current one if mid-pipeline, else start at tagging.
      const resumePhase =
        checkJob.phase && checkJob.phase !== "queued" && checkJob.phase !== "failed"
          ? checkJob.phase
          : "tagging";

      await updateJob(adm, jobId, {
        status: "running",
        phase: resumePhase,
        started_at: new Date().toISOString(),
        status_message: mode === "resume_pipeline" ? "Resuming…" : "Preparing library…",
        error_message: null,
      });

      const dispatchPromise = queueNextStep(functionUrl, anon, svc, jobId, userId, forceRetag);
      // @ts-ignore EdgeRuntime is a Deno Deploy global
      if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) {
        EdgeRuntime.waitUntil(dispatchPromise);
      } else {
        dispatchPromise.catch(e => console.error("[pipeline] dispatch error:", e));
      }

      return json({ success: true, job_id: jobId, phase: resumePhase, message: "Pipeline running" }, 202);
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
      if (["completed", "cancelled"].includes(job.status)) {
        return json({ success: true, terminal: true });
      }
      // If a previous chunk crashed (failed) or paused, auto-recover and keep going.
      if (job.status === "failed" || job.status === "paused_waiting_for_next_chunk") {
        await updateJob(adm, jobId!, { status: "running", error_message: null });
      }

      const queue = async () => {
        await queueNextStep(functionUrl, anon, svc, jobId!, userId, forceRetag);
      };

      // Pause-on-error helper: never marks job as failed for transient errors.
      // Saved progress remains intact; resume will pick up from groove_feel IS NULL.
      const pauseAndChain = async (reason: string) => {
        try {
          await updateJob(adm, jobId!, {
            status: "paused_waiting_for_next_chunk",
            error_message: reason.substring(0, 500),
            status_message: "Paused — auto-resuming next chunk…",
          });
        } catch (e) { console.error("[pipeline] pause update failed:", e); }
        try { await queue(); } catch (e) { console.error("[pipeline] pause-chain queue failed:", e); }
      };

      // Worker that performs the actual chunk and chains the next one.
      // We ACK 202 to the dispatcher immediately and run this in waitUntil
      // so the parent isolate is freed (no nested 5-min wall-clock dependency).
      const runChunk = async () => {
        try {
          // (phase handlers below; their `return json(...)` only exits runChunk)
        /* ── PHASE: TAGGING ── */
        if (job.phase === "tagging" || job.phase === "queued") {
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
              era: null, tempo_estimate: null, genre_tags: [],
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
            await updateJob(adm, jobId!, {
              total_analyzed: totalSongs, phase: "defining_worlds", status: "running",
              status_message: "All songs analyzed. Designing sonic worlds…",
            });
            await queue();
            return json({ success: true, phase: "defining_worlds" }, 202);
          }

          const list = songs.map((s: any, i: number) =>
            `${i + 1}. "${s.track_name}" – ${s.artist_name}${s.album_name ? ` (${s.album_name})` : ""}${fmtAudio(s)}`
          ).join("\n");

          const p = await callAI(API_KEY, "gpt-4o-mini", TAG_SYS,
            `Analyze these ${songs.length} songs across all 16 dimensions. Be SPECIFIC and CREATIVE.\n\n${list}\n\nUse tag_songs.`,
            [TAG_TOOL], { type: "function", function: { name: "tag_songs" } }, 0.3, 8192);

          const now = new Date().toISOString();
          const updates: Promise<any>[] = [];
          for (const tg of p.songs || []) {
            const idx = (tg.index || 0) - 1;
            if (idx < 0 || idx >= songs.length) continue;
            updates.push(adm.from("liked_songs").update({
              genre_tags: tg.genre_tags || [], mood: tg.mood, energy: tg.energy,
              tempo_estimate: tg.tempo_estimate, era: tg.era, atmosphere: tg.atmosphere,
              production_style: tg.production_style, groove_feel: tg.groove_feel,
              vocal_style: tg.vocal_style, sonic_brightness: tg.sonic_brightness,
              spatial_quality: tg.spatial_quality, rhythmic_identity: tg.rhythmic_identity,
              listening_context: tg.listening_context, sonic_texture: tg.sonic_texture,
              intimacy_scale: tg.intimacy_scale, tension_level: tg.tension_level,
              analyzed_at: now,
            }).eq("id", songs[idx].id));
          }
          await Promise.all(updates);

          const { count: analyzed } = await adm.from("liked_songs").select("id", { count: "exact", head: true })
            .eq("user_id", userId).not("groove_feel", "is", null);

          const done = (analyzed ?? 0) >= totalSongs;
          await updateJob(adm, jobId!, {
            total_analyzed: analyzed ?? 0,
            phase: done ? "defining_worlds" : "tagging",
            status_message: done ? "All songs analyzed. Designing sonic worlds…" : `${analyzed ?? 0} of ${totalSongs} songs analyzed…`,
          });

          await queue();
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

          // Build user's playlist context as taste signal
          const pls = await fetchAll(adm, "spotify_playlists", userId, "id, name, description, track_count, is_owned_by_user");
          const plTracks = await fetchAll(adm, "spotify_playlist_tracks", userId, "playlist_id, track_name, artist_name, position");
          const plMap = new Map<string, any[]>();
          for (const t of plTracks) { if (!plMap.has(t.playlist_id)) plMap.set(t.playlist_id, []); plMap.get(t.playlist_id)!.push(t); }

          const plBlocks: string[] = [];
          let budget = 0;
          for (const pl of pls) {
            if (budget > 15000) break;
            const tks = (plMap.get(pl.id) || []).sort((a: any, b: any) => (a.position || 0) - (b.position || 0)).slice(0, 30);
            if (tks.length > 0) {
              const block = `📋 "${pl.name}" (${pl.track_count}tk${pl.is_owned_by_user ? ", user-created" : ""})\n${tks.map((t: any) => `  - "${t.track_name}" – ${t.artist_name}`).join("\n")}`;
              plBlocks.push(block);
              budget += block.length;
            }
          }

          const [arts, albs] = await Promise.all([
            fetchAll(adm, "spotify_followed_artists", userId, "artist_name, genres"),
            fetchAll(adm, "spotify_saved_albums", userId, "album_name, artist_name, genres, release_date"),
          ]);

          // Use larger sample for world definition
          const sample = stratSample(tagged, 500);
          const suggest = Math.max(12, Math.min(35, Math.floor(allSongs.length / 45)));

          const ctx = [
            `LIBRARY: ${allSongs.length} liked songs (${tagged.length} analyzed)`,
            `\nUSER'S EXISTING SPOTIFY PLAYLISTS (${pls.length}) — These reveal how the user naturally organizes music. Study the patterns:`,
            plBlocks.join("\n\n") || "None imported yet",
            `\nFOLLOWED ARTISTS (${arts.length}):`,
            arts.slice(0, 60).map((a: any) => `- ${a.artist_name}${a.genres?.length ? ` [${a.genres.slice(0, 3).join(", ")}]` : ""}`).join("\n") || "None",
            `\nSAVED ALBUMS (${albs.length}):`,
            albs.slice(0, 40).map((a: any) => `- "${a.album_name}" by ${a.artist_name}`).join("\n") || "None",
            `\nANALYZED SONG SAMPLE (${sample.length} of ${tagged.length}):`,
            sample.map((s: any, i: number) => fmtSong(s, i)).join("\n"),
          ].join("\n");

          const result = await callAI(API_KEY, "gpt-4o-mini", WORLDS_SYS,
            `Design ALL sonic worlds for this library. Aim for ${suggest}+ distinct worlds.\n\nREMINDER: NEVER group by language. NEVER create "Uncategorized". Every world needs a specific sonic identity.\n\n${ctx}\n\nUse define_sonic_worlds.`,
            [WORLDS_TOOL], { type: "function", function: { name: "define_sonic_worlds" } }, 0.5, 8192);

          const worlds = result.worlds || [];
          if (!worlds.length) {
            await failJob(adm, jobId!, "No sonic worlds generated.");
            return json({ error: "No worlds generated" }, 500);
          }

          // Filter out any language-based or generic worlds
          const filtered = worlds.filter((w: any) => {
            const name = (w.name || "").toLowerCase();
            const bad = ["uncategorized", "other", "mixed", "miscellaneous", "various", "random",
              "spanish songs", "english songs", "french songs", "latin songs", "korean songs",
              "japanese songs", "portuguese songs", "german songs", "italian songs"];
            return !bad.some(b => name.includes(b));
          });

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
          for (const w of filtered) {
            const { data: inserted } = await adm.from("liked_song_clusters").insert({
              user_id: userId, name: w.name,
              description: w.ai_explanation || null, vibe_description: w.vibe_description || null,
              ai_explanation: w.ai_explanation || null, mood_tags: w.mood_tags || [],
              color_hex: w.color_hex || "#6366f1", energy_level: w.energy_level || "medium",
              tempo_range: "Mixed", era_range: "Mixed", track_count: 0, cover_tracks: [],
              analysis_model: "sonic-worlds-v5", sort_order: sortOrder,
            }).select("id").single();
            if (inserted) persistedWorlds.push({ ...w, cluster_id: inserted.id, sort_order: sortOrder });
            sortOrder++;
          }

          // Create "Needs Review" bucket (not "Uncategorized" or "Sonic Outliers")
          const { data: reviewBucket } = await adm.from("liked_song_clusters").insert({
            user_id: userId, name: "Needs Review",
            description: "Songs that didn't strongly match any sonic world. Review and reassign manually.",
            vibe_description: "Diverse tracks needing manual curation", mood_tags: ["review"],
            color_hex: "#a1a1aa", energy_level: "mixed", tempo_range: "Mixed", era_range: "Mixed",
            track_count: 0, cover_tracks: [], analysis_model: "sonic-worlds-v5", sort_order: sortOrder,
          }).select("id").single();

          if (reviewBucket) persistedWorlds.push({ world_id: "needs_review", name: "Needs Review", cluster_id: reviewBucket.id, is_review: true });

          await updateJob(adm, jobId!, {
            worlds_count: filtered.length,
            world_definitions: persistedWorlds,
            total_worlds: filtered.length + 1,
            phase: "assigning", status: "running",
            assigned_count: 0, saved_worlds: 0,
            status_message: `Created ${filtered.length} sonic worlds. Assigning songs…`,
          });

          await queue();
          return json({ success: true, phase: "assigning", worlds: filtered.length }, 202);
        }

        /* ── PHASE: ASSIGNING ── */
        if (job.phase === "assigning") {
          const storedWorlds = Array.isArray(job.world_definitions) ? job.world_definitions : [];
          const assignable = storedWorlds.filter((w: any) => !w.is_review && w.cluster_id);
          const reviewClusterId = storedWorlds.find((w: any) => w.is_review)?.cluster_id;

          if (!assignable.length || !reviewClusterId) {
            await failJob(adm, jobId!, "Missing stored worlds for assignment.");
            return json({ error: "Missing worlds" }, 500);
          }

          // Use ID-based cursor to avoid offset drift
          const existingTrackIds = new Set<string>();
          const allExisting = await fetchAll(adm, "liked_song_cluster_tracks", userId, "liked_song_id");
          for (const t of allExisting) existingTrackIds.add(t.liked_song_id);

          const processed = existingTrackIds.size;
          const totalSongs = job.total_songs ?? 0;

          // Fetch songs NOT yet assigned
          const allSongIds = await fetchAll(adm, "liked_songs", userId, "id");
          const unassignedIds = allSongIds.filter((s: any) => !existingTrackIds.has(s.id)).map((s: any) => s.id);

          if (unassignedIds.length === 0) {
            await updateJob(adm, jobId!, {
              assigned_count: processed, phase: "saving", status: "running",
              status_message: "All songs assigned. Finalizing playlists…",
            });
            await queue();
            return json({ success: true, phase: "saving" }, 202);
          }

          // Fetch batch of unassigned songs
          const batchIds = unassignedIds.slice(0, batchSize);
          const { data: batch } = await adm.from("liked_songs")
            .select(SONG_COLS).in("id", batchIds);

          const songs = batch || [];

          if (songs.length === 0) {
            await updateJob(adm, jobId!, {
              assigned_count: totalSongs, phase: "saving", status: "running",
              status_message: "All songs assigned. Finalizing playlists…",
            });
            await queue();
            return json({ success: true, phase: "saving" }, 202);
          }

          // Build world descriptions
          const worldIdToCluster = new Map<string, string>();
          for (const w of assignable) worldIdToCluster.set(w.world_id, w.cluster_id);

          let rows: any[] = [];
          try {
            const ws = assignable.map((w: any) =>
              `[${w.world_id}] "${w.name}"\n  Vibe: ${w.vibe_description || "?"}\n  Energy: ${w.energy_level || "?"}\n  Groove: ${w.groove_identity || "?"}\n  Production: ${w.production_identity || "?"}\n  Context: ${w.listening_context || "?"}\n  ✅ ${w.what_belongs || "N/A"}\n  ❌ ${w.what_breaks_it || "N/A"}`
            ).join("\n\n");

            const sl = songs.map((s: any, i: number) => fmtSong(s, i)).join("\n");
            const p = await callAI(API_KEY, "gpt-4o-mini", ASSIGN_SYS,
              `WORLDS (${assignable.length}):\n${ws}\n\nSONGS TO ASSIGN (${songs.length}):\n${sl}\n\nAssign each song to its best sonic world. Use "needs_review" ONLY if the song truly doesn't fit anywhere (<5% of songs). IGNORE language completely.\n\nUse assign_songs.`,
              [ASSIGN_TOOL], { type: "function", function: { name: "assign_songs" } }, 0.2, 4096);

            const assignMap = new Map<number, { world_id: string; confidence: number }>();
            for (const a of p.assignments || []) {
              const idx = (a.index || 0) - 1;
              if (idx >= 0 && idx < songs.length) assignMap.set(idx, { world_id: a.world_id, confidence: a.confidence ?? 0.8 });
            }

            rows = songs.map((s: any, idx: number) => {
              const a = assignMap.get(idx);
              let clusterId: string;
              if (a && a.world_id === "needs_review") {
                clusterId = reviewClusterId;
              } else if (a && worldIdToCluster.has(a.world_id)) {
                clusterId = worldIdToCluster.get(a.world_id)!;
              } else {
                clusterId = reviewClusterId;
              }
              return {
                user_id: userId, cluster_id: clusterId,
                liked_song_id: s.id, spotify_track_id: s.spotify_track_id,
                confidence_score: a?.confidence ?? 0.4, position: 0,
              };
            });
          } catch (e: any) {
            console.warn("[pipeline] assign batch error, sending to review:", e.message);
            rows = songs.map((s: any) => ({
              user_id: userId, cluster_id: reviewClusterId,
              liked_song_id: s.id, spotify_track_id: s.spotify_track_id,
              confidence_score: 0.2, position: 0,
            }));
          }

          // Insert in chunks
          for (let i = 0; i < rows.length; i += 100) {
            await adm.from("liked_song_cluster_tracks").insert(rows.slice(i, i + 100));
          }

          const newTotal = processed + rows.length;
          const done = newTotal >= totalSongs;

          await updateJob(adm, jobId!, {
            assigned_count: newTotal,
            phase: done ? "saving" : "assigning",
            status_message: done ? "All songs assigned. Finalizing playlists…" : `${newTotal} of ${totalSongs} songs assigned…`,
          });

          await queue();
          return json({ success: true, phase: done ? "saving" : "assigning", assigned: newTotal }, 202);
        }

        /* ── PHASE: SAVING (finalize clusters + order songs) ── */
        if (job.phase === "saving") {
          const clusters = await fetchAll(adm, "liked_song_clusters", userId, "id, name, sort_order, vibe_description");
          const allTracks = await fetchAll(adm, "liked_song_cluster_tracks", userId, "id, cluster_id, liked_song_id");

          const byCluster = new Map<string, any[]>();
          for (const t of allTracks) {
            if (!byCluster.has(t.cluster_id)) byCluster.set(t.cluster_id, []);
            byCluster.get(t.cluster_id)!.push(t);
          }

          // Get song metadata for covers and ordering
          const songIds = [...new Set(allTracks.map((t: any) => t.liked_song_id))];
          const songMap = new Map<string, any>();
          for (let i = 0; i < songIds.length; i += 500) {
            const { data: songs } = await adm.from("liked_songs")
              .select("id, track_name, artist_name, image_url, mood, energy, groove_feel, production_style, tempo_estimate")
              .in("id", songIds.slice(i, i + 500));
            for (const s of songs || []) songMap.set(s.id, s);
          }

          const empty: string[] = [];
          let saved = 0;

          for (const c of clusters) {
            const tracks = byCluster.get(c.id) || [];
            if (tracks.length === 0) { empty.push(c.id); continue; }

            // Build cover art
            const covers: any[] = [];
            for (const t of tracks.slice(0, 4)) {
              const s = songMap.get(t.liked_song_id);
              if (s?.image_url) covers.push({ image_url: s.image_url, track_name: s.track_name });
            }

            // Order songs within playlist using AI (for playlists with 5-80 songs)
            if (tracks.length >= 5 && tracks.length <= 80) {
              try {
                const trackList = tracks.map((t: any, i: number) => {
                  const s = songMap.get(t.liked_song_id);
                  if (!s) return `${i + 1}. [unknown]`;
                  return `${i + 1}. "${s.track_name}" – ${s.artist_name} {mood:"${s.mood || "?"}", energy:"${s.energy || "?"}", groove:"${s.groove_feel || "?"}", tempo:"${s.tempo_estimate || "?"}"}`;
                }).join("\n");

                const orderResult = await callAI(API_KEY, "gpt-4o-mini", ORDER_SYS,
                  `Playlist: "${c.name}" (${c.vibe_description || ""})\n\n${trackList}\n\nReorder for optimal flow. Use order_songs.`,
                  [ORDER_TOOL], { type: "function", function: { name: "order_songs" } }, 0.2, 2048);

                const ordered = orderResult.ordered_indices || [];
                if (ordered.length > 0) {
                  const posUpdates: Promise<any>[] = [];
                  for (let pos = 0; pos < ordered.length; pos++) {
                    const origIdx = (ordered[pos] || 0) - 1;
                    if (origIdx >= 0 && origIdx < tracks.length) {
                      posUpdates.push(
                        adm.from("liked_song_cluster_tracks").update({ position: pos }).eq("id", tracks[origIdx].id)
                      );
                    }
                  }
                  await Promise.all(posUpdates);
                }
              } catch (e: any) {
                console.warn(`[pipeline] ordering skipped for "${c.name}":`, e.message);
                // Set default positions
                const posUpdates = tracks.map((t: any, i: number) =>
                  adm.from("liked_song_cluster_tracks").update({ position: i }).eq("id", t.id)
                );
                await Promise.all(posUpdates);
              }
            } else {
              // Too large or too small for AI ordering — use default
              const posUpdates = tracks.map((t: any, i: number) =>
                adm.from("liked_song_cluster_tracks").update({ position: i }).eq("id", t.id)
              );
              await Promise.all(posUpdates);
            }

            await adm.from("liked_song_clusters").update({ track_count: tracks.length, cover_tracks: covers }).eq("id", c.id);
            saved++;
          }

          if (empty.length) await adm.from("liked_song_clusters").delete().in("id", empty);

          await updateJob(adm, jobId!, {
            saved_worlds: saved, total_worlds: saved,
            phase: "validating", status: "running",
            status_message: "Running quality check…",
          });

          await queue();
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
                const tl = tks.slice(0, 40).map((t: any, i: number) => {
                  const s = sm.get(t.liked_song_id);
                  return s ? fmtSong(s, i) : `${i + 1}. [?]`;
                }).join("\n");
                sums.push(`📋 [${wid}] "${c.name}" (${tks.length} songs)\nVibe: ${c.vibe_description || "?"}\n${tl}`);
              }

              const v = await callAI(API_KEY, "gpt-4o-mini", VALIDATE_SYS,
                `Review these ${cls.length} playlists for quality. Flag language traps, incoherent groupings, bad names, and outliers.\n\n${sums.join("\n\n")}\n\nUse validate_playlists.`,
                [VALIDATE_TOOL], { type: "function", function: { name: "validate_playlists" } }, 0.2, 4096);

              for (const act of v.actions || []) {
                const cid = wcm[act.world_id];
                if (!cid) continue;

                if (act.action === "remove_songs" && act.song_indices_to_remove?.length) {
                  const tl = ctk[cid] || [];
                  const toRemove: string[] = [];
                  for (const idx of act.song_indices_to_remove) {
                    const ri = idx - 1;
                    if (ri >= 0 && ri < tl.length) toRemove.push(tl[ri].id);
                  }
                  if (toRemove.length) {
                    await adm.from("liked_song_cluster_tracks").delete().in("id", toRemove);
                    const { count } = await adm.from("liked_song_cluster_tracks").select("id", { count: "exact", head: true }).eq("cluster_id", cid).eq("user_id", userId);
                    await adm.from("liked_song_clusters").update({ track_count: count ?? 0 }).eq("id", cid);
                  }
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
            status_message: `${finalCount ?? 0} playlists ready!`,
            completed_at: new Date().toISOString(),
            total_worlds: finalCount ?? 0,
            saved_worlds: finalCount ?? 0,
          });

          return json({ success: true, phase: "done" });
        }

          await failJob(adm, jobId!, `Unknown phase: ${job.phase}`);
          return;
        } catch (e: any) {
          console.error("[pipeline] step error:", e);
          // Critical: do NOT mark as failed if progress was saved.
          // Pause cleanly and chain the next chunk so the pipeline self-heals.
          await pauseAndChain(e?.message || "transient chunk error");
        }
      };

      // Ack 202 immediately and run worker in background.
      // @ts-ignore EdgeRuntime is a Deno Deploy global
      if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) {
        // @ts-ignore
        EdgeRuntime.waitUntil(runChunk());
      } else {
        runChunk().catch((e) => console.error("[pipeline] runChunk err:", e));
      }
      return json({ accepted: true, job_id: jobId, phase: job.phase }, 202);
    }

    return json({ error: `Unknown mode: ${mode}` }, 400);
  } catch (e: any) {
    console.error("[analyze] fatal:", e);
    return json({ error: e.message || "Unknown error" }, 500);
  }
});
