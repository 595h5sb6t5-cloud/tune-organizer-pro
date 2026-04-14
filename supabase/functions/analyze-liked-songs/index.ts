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

function extractJson(raw: string): any {
  let cleaned = raw.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
  const start = cleaned.search(/[\{\[]/);
  if (start === -1) throw new Error("No JSON found in response");
  cleaned = cleaned.substring(start);
  try { return JSON.parse(cleaned); } catch { /* continue */ }
  const opens = { "{": 0, "[": 0 };
  let inString = false, escape = false;
  for (const ch of cleaned) {
    if (escape) { escape = false; continue; }
    if (ch === "\\") { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "{") opens["{"]++;
    if (ch === "}") opens["{"]--;
    if (ch === "[") opens["["]++;
    if (ch === "]") opens["["]--;
  }
  if (inString) cleaned += '"';
  cleaned = cleaned.replace(/,\s*"[^"]*"?\s*:?\s*"?[^"]*$/, "");
  cleaned = cleaned.replace(/,\s*\{[^}]*$/, "");
  cleaned = cleaned.replace(/,\s*$/, "");
  for (let i = 0; i < opens["["]; i++) cleaned += "]";
  for (let i = 0; i < opens["{"]; i++) cleaned += "}";
  cleaned = cleaned
    .replace(/[\x00-\x1F\x7F]/g, " ")
    .replace(/,\s*}/g, "}")
    .replace(/,\s*]/g, "]");
  return JSON.parse(cleaned);
}

function fmtAudio(s: any): string {
  const p: string[] = [];
  if (s.audio_tempo != null) p.push(`BPM:${Math.round(s.audio_tempo)}`);
  if (s.audio_energy != null) p.push(`e:${s.audio_energy.toFixed(2)}`);
  if (s.audio_valence != null) p.push(`v:${s.audio_valence.toFixed(2)}`);
  if (s.audio_danceability != null) p.push(`d:${s.audio_danceability.toFixed(2)}`);
  if (s.audio_acousticness != null) p.push(`ac:${s.audio_acousticness.toFixed(2)}`);
  if (s.audio_instrumentalness != null) p.push(`in:${s.audio_instrumentalness.toFixed(2)}`);
  return p.length > 0 ? ` [${p.join(",")}]` : "";
}

function fmtTags(s: any): string {
  const t: string[] = [];
  if (s.mood) t.push(`mood:"${s.mood}"`);
  if (s.groove_feel) t.push(`grv:"${s.groove_feel}"`);
  if (s.sonic_brightness) t.push(`brt:${s.sonic_brightness}`);
  if (s.rhythmic_identity) t.push(`rhy:"${s.rhythmic_identity}"`);
  if (s.production_style) t.push(`prd:"${s.production_style}"`);
  if (s.vocal_style) t.push(`voc:"${s.vocal_style}"`);
  if (s.energy) t.push(`E:${s.energy}`);
  if (s.genre_tags?.length) t.push(`g:[${s.genre_tags.join(",")}]`);
  if (s.listening_context) t.push(`ctx:"${s.listening_context}"`);
  if (s.atmosphere) t.push(`atm:"${s.atmosphere}"`);
  return t.length > 0 ? ` {${t.join(", ")}}` : "";
}

function fmtSong(s: any, i: number): string {
  let l = `${i + 1}. "${s.track_name}" – ${s.artist_name}`;
  if (s.album_name) l += ` (${s.album_name})`;
  l += fmtAudio(s);
  l += fmtTags(s);
  if (s.language) l += ` [lang:${s.language}]`;
  return l;
}

async function fetchAll(client: any, table: string, userId: string, columns: string, extra?: { col: string; val: any }): Promise<any[]> {
  const all: any[] = [];
  let from = 0;
  while (true) {
    let q = client.from(table).select(columns).eq("user_id", userId);
    if (extra) q = q.eq(extra.col, extra.val);
    const { data, error } = await q.range(from, from + 999);
    if (error) throw error;
    const rows = data || [];
    all.push(...rows);
    if (rows.length < 1000) break;
    from += 1000;
  }
  return all;
}

async function callAI(
  apiKey: string, model: string, sys: string, usr: string,
  tools?: any[], toolChoice?: any, temp = 0.3, retries = 3,
): Promise<any> {
  const body: any = {
    model,
    messages: [{ role: "system", content: sys }, { role: "user", content: usr }],
    temperature: temp,
  };
  if (tools) body.tools = tools;
  if (toolChoice) body.tool_choice = toolChoice;

  for (let a = 0; a <= retries; a++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 50_000);
      const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!r.ok) {
        const t = await r.text();
        console.error(`AI err (${a}):`, r.status, t.substring(0, 200));
        if (r.status === 429) {
          if (a < retries) { await new Promise(w => setTimeout(w, 3000 * (a + 1))); continue; }
          throw new Error("RATE_LIMIT");
        }
        if (r.status === 402) throw new Error("CREDITS_EXHAUSTED");
        if (a < retries) continue;
        throw new Error(`AI failed: ${r.status}`);
      }
      const d = await r.json();
      const tc = d.choices?.[0]?.message?.tool_calls?.[0];
      if (tc?.function?.arguments) {
        try { return JSON.parse(tc.function.arguments); } catch { return extractJson(tc.function.arguments); }
      }
      const c = d.choices?.[0]?.message?.content;
      if (!c) {
        console.warn(`Empty AI content (finish_reason: ${d.choices?.[0]?.finish_reason}, attempt ${a})`);
        if (a < retries) continue;
        throw new Error("Empty AI response after retries");
      }
      return extractJson(c);
    } catch (e: any) {
      if (e.message === "RATE_LIMIT" || e.message === "CREDITS_EXHAUSTED") throw e;
      if (e.name === "AbortError") {
        console.warn(`AI call timed out (attempt ${a})`);
        if (a < retries) continue;
        throw new Error("AI call timed out");
      }
      if (a < retries) { console.warn(`AI retry ${a + 1}:`, e.message); continue; }
      throw e;
    }
  }
  throw new Error("AI failed after retries");
}

function stratSample(songs: any[], max: number): any[] {
  if (songs.length <= max) return [...songs];
  const bk = new Map<string, any[]>();
  for (const s of songs) {
    const k = [
      s.sonic_brightness || "?",
      s.energy || "?",
      s.groove_feel?.substring(0, 8) || "?",
      s.mood?.substring(0, 8) || "?",
      s.production_style?.substring(0, 8) || "?",
    ].join("|");
    if (!bk.has(k)) bk.set(k, []);
    bk.get(k)!.push(s);
  }
  const out: any[] = [];
  const ks = [...bk.keys()];
  let r = 0;
  while (out.length < max) {
    let added = false;
    for (const k of ks) { const b = bk.get(k)!; if (r < b.length && out.length < max) { out.push(b[r]); added = true; } }
    if (!added) break;
    r++;
  }
  return out;
}

/* ═══ PROMPTS & TOOLS ═══ */

const TAG_SYS = `You are Tempo — a world-class music analyst with the ear of a mastering engineer, the soul of a DJ, and the vocabulary of a musicologist.

Analyze each song across 17 DEEP musical dimensions. Your analysis must be SPECIFIC enough that songs sharing tags would genuinely sound right next to each other in a playlist.

1. **mood** — Precise emotional shade ("wistful nostalgia", "euphoric release", "brooding tension" — NOT generic "happy"/"sad")
2. **energy** — Overall energy level (low/medium-low/medium/medium-high/high)
3. **genre_tags** — 2-4 specific subgenre tags (e.g. "dream pop", "nu-disco", "bedroom R&B" — NOT just "pop" or "rock")
4. **tempo_estimate** — Rhythmic speed (very slow/slow/mid-tempo/uptempo/fast)
5. **era** — Sonic era influence ("2010s indie", "80s synth", "modern trap" — the sound, not release year)
6. **atmosphere** — Spatial/environmental quality ("intimate bedroom", "vast stadium", "smoky lounge", "open highway")
7. **production_style** — Production philosophy ("polished pop", "lo-fi warmth", "maximalist layers", "stripped acoustic")
8. **groove_feel** — How the rhythm FEELS ("lazy swing", "tight four-on-floor", "syncopated bounce", "reggaeton dembow")
9. **vocal_style** — Vocal character ("breathy whisper", "powerful belt", "autotuned melodic rap", "choir harmonies")
10. **sonic_brightness** — Dark-to-bright spectrum (very dark/dark/neutral/bright/very bright)
11. **spatial_quality** — Mix space ("dry and close", "reverb-drenched", "wide stereo", "mono lo-fi")
12. **rhythmic_identity** — Groove DNA ("steady pulse", "polyrhythmic", "swing shuffle", "breakbeat")
13. **listening_context** — Best listening scenario ("late night drive", "morning coffee", "beach sunset", "gym peak", "dinner party")
14. **sonic_texture** — Tactile quality ("warm analog", "crisp digital", "fuzzy distorted", "glassy clean")
15. **intimacy_scale** — Scale of sound ("whisper-close", "personal", "room-filling", "arena-scale")
16. **tension_level** — Tension vs release ("constant tension", "building", "releasing", "peaceful")
17. **language** — Language of lyrics (or "instrumental")

CRITICAL RULES:
- Be SPECIFIC. "Chill" is NOT a mood. "Hazy sunset melancholy" IS.
- Genre tags must be subgenre-specific. "Pop" alone is NEVER acceptable — use "synth-pop", "indie pop", "chamber pop" etc.
- Two songs can share a language but have COMPLETELY different sonic identities. Language is informational, not a grouping signal.`;

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
              mood: { type: "string" },
              energy: { type: "string", enum: ["low", "medium-low", "medium", "medium-high", "high"] },
              tempo_estimate: { type: "string" }, era: { type: "string" },
              atmosphere: { type: "string" }, production_style: { type: "string" },
              groove_feel: { type: "string" }, vocal_style: { type: "string" },
              sonic_brightness: { type: "string", enum: ["very dark", "dark", "neutral", "bright", "very bright"] },
              spatial_quality: { type: "string" }, rhythmic_identity: { type: "string" },
              listening_context: { type: "string" }, sonic_texture: { type: "string" },
              intimacy_scale: { type: "string" }, tension_level: { type: "string" },
              language: { type: "string" },
            },
            required: ["index", "mood", "energy", "groove_feel", "vocal_style", "sonic_brightness", "spatial_quality", "rhythmic_identity", "listening_context", "sonic_texture", "intimacy_scale", "tension_level", "language"],
          },
        },
      },
      required: ["songs"],
    },
  },
};

const WORLDS_SYS = `You are Tempo — an expert music curator building playlists from a user's ENTIRE Spotify library.

Your job: Create playlist concepts ("sonic worlds") where EVERY song would transition naturally into the next. Think like a professional DJ or Spotify editorial curator.

═══ WHAT MAKES A GOOD PLAYLIST ═══

A good playlist is defined by the INTERSECTION of multiple dimensions:
- Same groove/rhythm family (bounce, swing, pulse, etc.)
- Compatible energy range (not identical — a slight arc is good)
- Matching production texture (lo-fi with lo-fi, polished with polished)
- Compatible mood/emotional tone
- Same listening context (driving, dinner, gym, etc.)
- Compatible vocal approach

═══ WHAT LANGUAGE MEANS ═══

Language is a WEAK signal. It can be a tiebreaker, never a primary grouping criterion.
- A Spanish indie folk ballad and a Spanish reggaeton banger share NOTHING except language
- An English dream pop song and a French dream pop song MAY belong together
- NEVER create a world called "Spanish Songs", "English Hits", or any language-based name
- If you catch yourself grouping by language, STOP and regroup by sonic qualities

═══ YOUR RULES ═══

1. Study existing playlists DEEPLY — they reveal the user's curatorial instincts
2. If a Spotify playlist contains two distinct sonic identities, create TWO worlds
3. Create as many worlds as the music naturally requires (typically 12-35 for large libraries)
4. Each world MUST be narrow and specific: "Late-night lo-fi bedroom R&B with breathy vocals" IS a world; "Chill vibes" is NOT
5. Include detailed "what_belongs" and "what_breaks_it" — these are critical for assignment
6. NEVER create a world called "Uncategorized", "Other", "Mixed", or any catch-all
7. NEVER create a world primarily around one artist
8. NEVER create a world primarily around one language
9. Every world needs a SONIC identity, not a demographic or metadata identity
10. Aim for worlds that would hold 15-80 songs. If too large, split by energy/mood/context
11. Create 2-3 "micro-worlds" for niche sounds (8-20 songs each)
12. For genuinely hard-to-place songs, create "Sonic Outliers" (max 30 songs) describing what makes them unique

═══ NAMING ═══

Names must be evocative and specific:
✅ "Golden Hour Drive" "Midnight Electronic Haze" "Stripped Acoustic Intimacy" "Peak Energy Dance Floor"
❌ "Pop Hits" "Spanish Songs" "Indie" "Random" "Other" "Miscellaneous"`;

const WORLDS_TOOL = {
  type: "function" as const,
  function: {
    name: "define_sonic_worlds",
    description: "Define sonic worlds (playlist concepts) from the user's library",
    parameters: {
      type: "object",
      properties: {
        worlds: {
          type: "array",
          items: {
            type: "object",
            properties: {
              world_id: { type: "string" },
              name: { type: "string" },
              vibe_description: { type: "string" },
              ai_explanation: { type: "string" },
              mood_tags: { type: "array", items: { type: "string" } },
              color_hex: { type: "string" },
              energy_level: { type: "string", enum: ["low", "medium-low", "medium", "medium-high", "high"] },
              groove_identity: { type: "string" },
              sonic_brightness: { type: "string" },
              spatial_quality: { type: "string" },
              production_identity: { type: "string" },
              atmosphere: { type: "string" },
              listening_context: { type: "string" },
              vocal_character: { type: "string" },
              what_belongs: { type: "string" },
              what_breaks_it: { type: "string" },
              reference_playlist_names: { type: "array", items: { type: "string" } },
              example_song_indices: { type: "array", items: { type: "number" } },
              ideal_size: { type: "string", enum: ["micro (8-20)", "small (20-40)", "medium (40-70)", "large (70-100+)"] },
            },
            required: ["world_id", "name", "vibe_description", "ai_explanation", "mood_tags", "color_hex", "energy_level", "groove_identity", "what_belongs", "what_breaks_it", "ideal_size"],
          },
        },
      },
      required: ["worlds"],
    },
  },
};

const ASSIGN_SYS = `You are Tempo — a strict playlist curator assigning songs to sonic worlds.

═══ COMPATIBILITY CHECKLIST (need 7+/10) ═══

For EACH song, evaluate against each world:

1. ✓ Compatible groove/rhythm (swing, bounce, pulse, dembow, etc.)
2. ✓ Compatible energy range (within the world's energy band)
3. ✓ Same emotional shade/mood family
4. ✓ Compatible production texture (lo-fi with lo-fi, polished with polished)
5. ✓ Compatible vocal approach (breathy with breathy, powerful with powerful)
6. ✓ Same brightness spectrum (dark songs don't go with bright songs)
7. ✓ Same spatial scale (intimate songs don't go with arena-scale songs)
8. ✓ Compatible tension/release pattern
9. ✓ Same listening context (gym songs don't go with dinner songs)
10. ✓ Would sound natural in sequence with other songs in this world

═══ LANGUAGE RULE (CRITICAL — READ CAREFULLY) ═══

Language is NOT one of the 10 compatibility criteria above. It has ZERO weight in assignment.

CORRECT assignments:
- Spanish acoustic ballad → "Stripped Acoustic Intimacy" (with English/French ballads) ✅
- Spanish reggaeton banger → "Peak Energy Dance Floor" (with English dance tracks) ✅  
- Spanish indie rock → "Indie Guitar Drive" (with English indie rock) ✅
- Spanish electronic track → "Midnight Electronic Haze" (with any language electronic) ✅

WRONG assignments (language-based grouping):
- Putting all 4 Spanish songs above in the same world ❌ (they share NO sonic qualities)
- Creating a world where >80% of songs happen to be the same language AND they don't share groove/energy/production ❌

If you notice you're assigning multiple songs to the same world primarily because they share a language, STOP and re-evaluate each song's sonic qualities independently.

═══ OTHER RULES ═══

- Genre alone is NOT enough — two "pop" songs can be completely incompatible.
- Same artist does NOT mean same world — artists have diverse songs.
- Be STRICT. A polluted playlist is worse than a smaller one.
- If 7+ pass for multiple worlds, pick the BEST fit (highest score).
- If <7 for ALL worlds, assign "needs_review" — but try hard to find a match first.
- DISTRIBUTE songs across ALL worlds. If >60% go to 3 worlds, you're being too loose.
- Pay close attention to "what_breaks_it" — if a song matches a break condition, it CANNOT go there.
- Maximum 25 songs can be "needs_review" across the ENTIRE library. Lower threshold to 6/10 for borderline cases.
- For "needs_review" songs, provide suggest_worlds (top 2-3 closest matches with scores).`;

const ASSIGN_TOOL = {
  type: "function" as const,
  function: {
    name: "assign_songs",
    description: "Assign songs to sonic worlds with compatibility scores",
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
              suggest_worlds: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    world_id: { type: "string" },
                    score: { type: "number" },
                  },
                },
              },
            },
            required: ["index", "world_id", "confidence"],
          },
        },
      },
      required: ["assignments"],
    },
  },
};

const ORDER_SYS = `You are Tempo — ordering songs within a playlist for the best listening flow.

Create a smooth listening journey:
1. START with an inviting, representative song (not the most intense)
2. BUILD energy gradually in the first third
3. PEAK in the middle section
4. WIND DOWN in the final third
5. END with a satisfying closer

Rules:
- Adjacent songs should share at least 2-3 sonic qualities
- Avoid jarring tempo jumps (>30 BPM between adjacent songs)
- Avoid extreme mood whiplash
- Group mini-sequences of 3-5 related songs within the playlist
- Language transitions should feel natural, not jarring`;

const ORDER_TOOL = {
  type: "function" as const,
  function: {
    name: "order_playlist",
    description: "Return the optimal song order for a playlist",
    parameters: {
      type: "object",
      properties: {
        ordered_indices: {
          type: "array",
          items: { type: "number" },
          description: "Song indices in optimal playback order (1-based)",
        },
      },
      required: ["ordered_indices"],
    },
  },
};

const VALIDATE_SYS = `You are Tempo — final quality control for generated playlists.

For each playlist, evaluate:
1. COHERENCE: Would every song transition smoothly? Score 1-10.
2. IDENTITY: Does the playlist have a clear, specific concept? (Not "mixed" or language-based)
3. SIZE: Is the size appropriate? (Ideal: 15-80. Flag if <8 or >100)
4. OUTLIERS: List any songs that feel out of place (by index)
5. LANGUAGE TRAP: Is this playlist secretly just "songs in X language"? If >80% same language AND songs don't share sonic identity, FLAG IT.
6. SPLITS: If two distinct sub-groups exist, recommend splitting

Actions:
- "keep" — playlist is good
- "remove_songs" — remove specific outlier songs (they go to needs_review)
- "merge" — merge with another playlist (they're too similar)
- "delete" — playlist is incoherent or too small, redistribute songs
- "rename" — name is too generic or language-based

CRITICAL: Flag ANY playlist whose name or grouping logic is primarily based on language.`;

const VALIDATE_TOOL = {
  type: "function" as const,
  function: {
    name: "validate_playlists",
    description: "Validate and refine playlist quality",
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
            required: ["action", "world_id", "coherence_score", "reason"],
          },
        },
      },
      required: ["actions"],
    },
  },
};

/* ═══ MAIN ═══ */

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const auth = req.headers.get("Authorization");
    if (!auth) return json({ error: "Not authenticated" }, 401);

    const url = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const svc = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const sb = createClient(url, anon, { global: { headers: { Authorization: auth } } });
    const adm = createClient(url, svc);

    const { data: { user }, error: ue } = await sb.auth.getUser();
    if (ue || !user) return json({ error: "Invalid session" }, 401);

    let mode = "tag_only";
    let batchSize = 50;
    let forceRetag = false;
    let worldDefs: any[] = [];
    let offset = 0;
    let clusterIds: string[] = [];

    try {
      const b = await req.json();
      if (b?.mode) mode = b.mode;
      if (typeof b?.batch_size === "number") batchSize = Math.min(b.batch_size, 50);
      if (b?.force_retag) forceRetag = true;
      if (b?.world_definitions) worldDefs = b.world_definitions;
      if (typeof b?.offset === "number") offset = b.offset;
      if (b?.cluster_ids) clusterIds = b.cluster_ids;
      let jobId: string | null = null;
      if (b?.job_id) jobId = b.job_id;
    } catch { /* no body */ }

    console.info(`[analyze] mode=${mode}, batch=${batchSize}, offset=${offset}, user=${user.id.substring(0, 8)}`);

    const COLS = "id, spotify_track_id, track_name, artist_name, album_name, image_url, audio_tempo, audio_energy, audio_valence, audio_danceability, audio_acousticness, audio_instrumentalness, audio_speechiness, audio_loudness, audio_liveness, mood, energy, atmosphere, production_style, groove_feel, vocal_style, sonic_brightness, spatial_quality, rhythmic_identity, listening_context, sonic_texture, intimacy_scale, tension_level, genre_tags, era, tempo_estimate, language";

    /* ═══ TAG ═══ */
    if (mode === "tag_only") {
      if (forceRetag) {
        console.info("[tag] force retag — wiping all metadata");
        await adm.from("liked_songs").update({
          analyzed_at: null, groove_feel: null, vocal_style: null,
          sonic_brightness: null, spatial_quality: null, rhythmic_identity: null,
          listening_context: null, sonic_texture: null, intimacy_scale: null,
          tension_level: null, mood: null, energy: null, atmosphere: null,
          production_style: null, era: null, tempo_estimate: null, genre_tags: [], language: null,
        }).eq("user_id", user.id);

        const { data: ec } = await adm.from("liked_song_clusters").select("id").eq("user_id", user.id);
        if (ec?.length) {
          await adm.from("liked_song_cluster_tracks").delete().in("cluster_id", ec.map((c: any) => c.id));
          await adm.from("liked_song_clusters").delete().eq("user_id", user.id);
        }
      }

      const { count: total } = await sb.from("liked_songs").select("id", { count: "exact", head: true }).eq("user_id", user.id);
      const t = total ?? 0;
      if (t === 0) return json({ error: "No liked songs. Import library first." }, 400);

      const { data: unan } = await sb.from("liked_songs")
        .select("id, spotify_track_id, track_name, artist_name, album_name, image_url, audio_tempo, audio_energy, audio_valence, audio_danceability, audio_acousticness, audio_instrumentalness, audio_speechiness, audio_loudness, audio_liveness")
        .eq("user_id", user.id).is("groove_feel", null)
        .order("added_at", { ascending: false }).limit(batchSize);

      const songs = unan || [];
      if (songs.length === 0) {
        const { count: ac } = await sb.from("liked_songs").select("id", { count: "exact", head: true })
          .eq("user_id", user.id).not("groove_feel", "is", null);
        return json({ success: true, done: true, tracks_analyzed_this_batch: 0, total_analyzed: ac ?? 0, total_liked_songs: t });
      }

      console.info(`[tag] analyzing ${songs.length} of ${t} songs`);
      const list = songs.map((s: any, i: number) =>
        `${i + 1}. "${s.track_name}" – ${s.artist_name}${s.album_name ? ` (${s.album_name})` : ""}${fmtAudio(s)}`
      ).join("\n");

      const p = await callAI(API_KEY, "google/gemini-2.5-flash", TAG_SYS,
        `Analyze these ${songs.length} songs across all 17 dimensions. Be SPECIFIC — no generic tags.\n\n${list}\n\nUse tag_songs.`,
        [TAG_TOOL], { type: "function", function: { name: "tag_songs" } });

      const ts = p.songs || [];
      const now = new Date().toISOString();

      const updates = ts.map((tg: any) => {
        const idx = (tg.index || 0) - 1;
        if (idx < 0 || idx >= songs.length) return null;
        return { id: songs[idx].id, tg };
      }).filter(Boolean);

      for (let i = 0; i < updates.length; i += 10) {
        const batch = updates.slice(i, i + 10);
        await Promise.all(batch.map((u: any) =>
          adm.from("liked_songs").update({
            genre_tags: u.tg.genre_tags || [], mood: u.tg.mood, energy: u.tg.energy,
            tempo_estimate: u.tg.tempo_estimate, era: u.tg.era, atmosphere: u.tg.atmosphere,
            production_style: u.tg.production_style, groove_feel: u.tg.groove_feel,
            vocal_style: u.tg.vocal_style, sonic_brightness: u.tg.sonic_brightness,
            spatial_quality: u.tg.spatial_quality, rhythmic_identity: u.tg.rhythmic_identity,
            listening_context: u.tg.listening_context, sonic_texture: u.tg.sonic_texture,
            intimacy_scale: u.tg.intimacy_scale, tension_level: u.tg.tension_level,
            language: u.tg.language || null,
            analyzed_at: now,
          }).eq("id", u.id)
        ));
      }

      const { count: an } = await sb.from("liked_songs").select("id", { count: "exact", head: true })
        .eq("user_id", user.id).not("groove_feel", "is", null);
      return json({ success: true, done: (an ?? 0) >= t, tracks_analyzed_this_batch: ts.length, total_analyzed: an ?? 0, total_liked_songs: t });
    }

    /* ═══ DEFINE WORLDS ═══ */
    if (mode === "define_worlds") {
      const all = await fetchAll(sb, "liked_songs", user.id, COLS);
      const tagged = all.filter((s: any) => s.groove_feel != null);
      if (tagged.length < 10) return json({ error: "Need more tagged songs. Run tagging first.", needs_tagging: true, tagged: tagged.length, total: all.length }, 400);

      // Fetch playlists and their tracks
      const pls = await fetchAll(sb, "spotify_playlists", user.id, "id, name, description, track_count, is_owned_by_user, is_collaborative");
      const allPlTracks = await fetchAll(sb, "spotify_playlist_tracks", user.id, "playlist_id, track_name, artist_name, position");
      const plTrackMap = new Map<string, any[]>();
      for (const t of allPlTracks) {
        if (!plTrackMap.has(t.playlist_id)) plTrackMap.set(t.playlist_id, []);
        plTrackMap.get(t.playlist_id)!.push(t);
      }

      // Build compact playlist summaries (limit total size to prevent token overflow)
      const plBlocks: string[] = [];
      let plTokenBudget = 0;
      const MAX_PL_CHARS = 15000;
      for (const pl of pls) {
        if (plTokenBudget > MAX_PL_CHARS) break;
        const tks = (plTrackMap.get(pl.id) || []).sort((a: any, b: any) => (a.position || 0) - (b.position || 0));
        const shown = tks.slice(0, 30);
        if (shown.length > 0) {
          const tl = shown.map((t: any) => `  - "${t.track_name}" – ${t.artist_name}`).join("\n");
          const f = [pl.is_owned_by_user ? "user-created" : "followed", `${pl.track_count}tk`].filter(Boolean).join(", ");
          const block = `📋 "${pl.name}" (${f})\n${tl}${tks.length > 30 ? `\n  +${tks.length - 30} more` : ""}`;
          plBlocks.push(block);
          plTokenBudget += block.length;
        }
      }

      // Fetch artists and albums in parallel
      const [arts, albs] = await Promise.all([
        fetchAll(sb, "spotify_followed_artists", user.id, "artist_name, genres, popularity"),
        fetchAll(sb, "spotify_saved_albums", user.id, "album_name, artist_name, genres, release_date"),
      ]);

      const artL = arts.slice(0, 80).map((a: any) => `- ${a.artist_name}${a.genres?.length ? ` [${a.genres.slice(0, 3).join(", ")}]` : ""}`).join("\n");
      const albL = albs.slice(0, 50).map((a: any) => `- "${a.album_name}" by ${a.artist_name} (${a.release_date || "?"})${a.genres?.length ? ` [${a.genres.slice(0, 2).join(", ")}]` : ""}`).join("\n");

      const sample = stratSample(tagged, 400);
      const sampleL = sample.map((s: any, i: number) => fmtSong(s, i)).join("\n");
      const suggest = Math.max(12, Math.min(35, Math.floor(all.length / 50)));

      const ctx = `═══ LIBRARY: ${all.length} liked songs (${tagged.length} analyzed) ═══

═══ PLAYLISTS (${pls.length} — PRIMARY BLUEPRINT for user's curatorial taste) ═══
${plBlocks.length > 0 ? plBlocks.join("\n\n") : "None"}

═══ FOLLOWED ARTISTS (${arts.length}) ═══
${artL || "None"}

═══ SAVED ALBUMS (${albs.length}) ═══
${albL || "None"}

═══ TAGGED SONG SAMPLE (${sample.length} of ${tagged.length}) ═══
${sampleL}`;

      console.info(`[worlds] ${sample.length} sample, ${pls.length} playlists, ${arts.length} artists, ${albs.length} albums`);

      const p = await callAI(API_KEY, "google/gemini-2.5-flash", WORLDS_SYS,
        `Study this library and define ALL sonic worlds needed.
REMEMBER: NEVER group by language. Group by SOUND.
Use playlists as reference for user taste, not as templates.
Aim for ${suggest}+ worlds for ${all.length} songs.
Each world must have a CLEAR sonic identity.

${ctx}

Use define_sonic_worlds.`,
        [WORLDS_TOOL], { type: "function", function: { name: "define_sonic_worlds" } }, 0.4);

      const worlds = p.worlds || [];
      console.info(`[worlds] defined ${worlds.length} worlds`);
      return json({ success: true, worlds, total_songs: all.length, tagged_songs: tagged.length, playlists_analyzed: pls.length });
    }

    /* ═══ ASSIGN ═══ */
    if (mode === "assign_batch") {
      if (!worldDefs?.length) return json({ error: "world_definitions required" }, 400);

      // TRUE server-side pagination — only fetch the batch we need
      const { data: batch, error: batchErr } = await sb.from("liked_songs")
        .select(COLS)
        .eq("user_id", user.id)
        .order("added_at", { ascending: true })
        .range(offset, offset + batchSize - 1);

      if (batchErr) throw batchErr;
      const songs = batch || [];
      if (songs.length === 0) {
        const { count } = await sb.from("liked_songs").select("id", { count: "exact", head: true }).eq("user_id", user.id);
        return json({ success: true, done: true, assignments: [], total: count ?? 0 });
      }

      const { count: totalCount } = await sb.from("liked_songs").select("id", { count: "exact", head: true }).eq("user_id", user.id);

      // Compact world descriptions
      const ws = worldDefs.map((w: any) =>
        `[${w.world_id}] "${w.name}"
  Vibe: ${w.vibe_description || "?"}
  Groove: ${w.groove_identity || "?"} | Bright: ${w.sonic_brightness || "?"} | Energy: ${w.energy_level || "?"}
  Context: ${w.listening_context || "?"} | Production: ${w.production_identity || "?"}
  ✅ ${w.what_belongs || "N/A"}
  ❌ ${w.what_breaks_it || "N/A"}`
      ).join("\n\n");

      const sl = songs.map((s: any, i: number) => fmtSong(s, i)).join("\n");
      console.info(`[assign] ${songs.length} songs (offset ${offset}) → ${worldDefs.length} worlds`);

      const p = await callAI(API_KEY, "google/gemini-2.5-flash", ASSIGN_SYS,
        `WORLDS (${worldDefs.length}):\n${ws}\n\nSONGS (${songs.length}):\n${sl}\n\nRun the 10-point checklist for each song. Assign to best world or "needs_review". Use assign_songs.`,
        [ASSIGN_TOOL], { type: "function", function: { name: "assign_songs" } });

      const asgn = (p.assignments || []).map((a: any) => {
        const i = (a.index || 0) - 1;
        if (i < 0 || i >= songs.length) return null;
        return {
          song_id: songs[i].id,
          spotify_track_id: songs[i].spotify_track_id,
          world_id: a.world_id,
          confidence: a.confidence ?? 0.8,
          suggest_worlds: a.suggest_worlds || [],
        };
      }).filter(Boolean);

      const total = totalCount ?? 0;
      return json({
        success: true,
        done: offset + songs.length >= total,
        assignments: asgn,
        batch_size: songs.length,
        offset,
        total,
      });
    }

    /* ═══ ORDER SONGS WITHIN PLAYLISTS ═══ */
    if (mode === "order_playlist") {
      if (!clusterIds?.length) return json({ error: "cluster_ids required" }, 400);

      const results: Record<string, number[]> = {};

      for (const clusterId of clusterIds) {
        const allClusterTracks = await fetchAll(sb, "liked_song_cluster_tracks", user.id, "id, liked_song_id, cluster_id");
        const clusterTracks = allClusterTracks.filter(t => t.cluster_id === clusterId);

        if (clusterTracks.length < 3) {
          results[clusterId] = clusterTracks.map((_, i) => i + 1);
          continue;
        }

        // Cap ordering at 60 songs to keep prompt manageable
        const toOrder = clusterTracks.slice(0, 60);
        const songIds = toOrder.map(t => t.liked_song_id);
        const songMap = new Map<string, any>();
        for (let i = 0; i < songIds.length; i += 500) {
          const { data: songs } = await sb.from("liked_songs").select(COLS).in("id", songIds.slice(i, i + 500));
          for (const s of songs || []) songMap.set(s.id, s);
        }

        const songList = toOrder.map((t, i) => {
          const s = songMap.get(t.liked_song_id);
          return s ? fmtSong(s, i) : `${i + 1}. [Unknown]`;
        }).join("\n");

        try {
          const p = await callAI(API_KEY, "google/gemini-2.5-flash", ORDER_SYS,
            `Order these ${toOrder.length} songs for optimal listening flow:\n\n${songList}\n\nUse order_playlist.`,
            [ORDER_TOOL], { type: "function", function: { name: "order_playlist" } }, 0.2);

          results[clusterId] = p.ordered_indices || toOrder.map((_, i) => i + 1);
        } catch (e) {
          console.warn(`[order] failed for cluster ${clusterId}:`, e);
          results[clusterId] = toOrder.map((_, i) => i + 1);
        }
      }

      return json({ success: true, orders: results });
    }

    /* ═══ VALIDATE ═══ */
    if (mode === "validate") {
      const { data: cls } = await sb.from("liked_song_clusters")
        .select("id, name, vibe_description, ai_explanation, track_count")
        .eq("user_id", user.id).order("sort_order");
      if (!cls?.length) return json({ success: true, actions: [], removals: 0, merges: 0, deletions: 0, renames: 0 });

      const allS = await fetchAll(sb, "liked_songs", user.id, COLS);
      const sm = new Map<string, any>();
      for (const s of allS) sm.set(s.id, s);

      const allClusterTracks = await fetchAll(sb, "liked_song_cluster_tracks", user.id, "id, liked_song_id, cluster_id");
      const ctk: Record<string, { id: string; liked_song_id: string }[]> = {};
      for (const t of allClusterTracks) {
        if (!ctk[t.cluster_id]) ctk[t.cluster_id] = [];
        ctk[t.cluster_id].push(t);
      }

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
        sums.push(`📋 [${wid}] "${c.name}" (${tks.length} songs)\nVibe: ${c.vibe_description || "N/A"}\n${tl}${tks.length > 40 ? `\n+${tks.length - 40} more songs` : ""}`);
      }

      console.info(`[validate] ${cls.length} playlists`);

      try {
        const p = await callAI(API_KEY, "google/gemini-2.5-flash", VALIDATE_SYS,
          `Review these ${cls.length} playlists for quality. Check for language-only grouping, weak identity, outliers, and size issues.\n\n${sums.join("\n\n")}\n\nUse validate_playlists.`,
          [VALIDATE_TOOL], { type: "function", function: { name: "validate_playlists" } });

        let rem = 0, mrg = 0, del = 0, ren = 0;
        for (const act of (p.actions || [])) {
          const cid = wcm[act.world_id];
          if (!cid && act.action !== "keep") continue;

          if (act.action === "remove_songs" && act.song_indices_to_remove?.length && cid) {
            const tl = ctk[cid] || [];
            for (const idx of act.song_indices_to_remove) {
              const ri = idx - 1;
              if (ri >= 0 && ri < tl.length) {
                await adm.from("liked_song_cluster_tracks").delete().eq("id", tl[ri].id);
                rem++;
              }
            }
            const { count } = await sb.from("liked_song_cluster_tracks").select("id", { count: "exact", head: true }).eq("cluster_id", cid).eq("user_id", user.id);
            await adm.from("liked_song_clusters").update({ track_count: count ?? 0 }).eq("id", cid);
          }
          if (act.action === "delete" && cid) {
            await adm.from("liked_song_cluster_tracks").delete().eq("cluster_id", cid);
            await adm.from("liked_song_clusters").delete().eq("id", cid);
            del++;
          }
          if (act.action === "merge" && act.target_world_id && cid) {
            const tid = wcm[act.target_world_id];
            if (tid) {
              await adm.from("liked_song_cluster_tracks").update({ cluster_id: tid }).eq("cluster_id", cid).eq("user_id", user.id);
              const { count } = await sb.from("liked_song_cluster_tracks").select("id", { count: "exact", head: true }).eq("cluster_id", tid).eq("user_id", user.id);
              await adm.from("liked_song_clusters").update({ track_count: count ?? 0 }).eq("id", tid);
              await adm.from("liked_song_clusters").delete().eq("id", cid);
              mrg++;
            }
          }
          if (act.action === "rename" && act.new_name && cid) {
            await adm.from("liked_song_clusters").update({ name: act.new_name }).eq("id", cid);
            ren++;
          }
        }
        console.info(`[validate] ${rem} removals, ${mrg} merges, ${del} deletes, ${ren} renames`);
        return json({ success: true, removals: rem, merges: mrg, deletions: del, renames: ren, actions: p.actions || [] });
      } catch (e: any) {
        console.error("Validate err:", e);
        return json({ success: true, removals: 0, merges: 0, deletions: 0, renames: 0, actions: [] });
      }
    }

    return json({ error: `Unknown mode: ${mode}` }, 400);
  } catch (e: any) {
    console.error("analyze error:", e);
    const m = e instanceof Error ? e.message : "Analysis failed";
    if (m === "RATE_LIMIT") return json({ error: "Rate limit. Try again in a moment." }, 429);
    if (m === "CREDITS_EXHAUSTED") return json({ error: "AI credits exhausted." }, 402);
    return json({ error: m }, 500);
  }
});
