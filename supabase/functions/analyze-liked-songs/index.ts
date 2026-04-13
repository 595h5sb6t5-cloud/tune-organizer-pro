import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
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

  const opens = { '{': 0, '[': 0 };
  let inString = false, escape = false;
  for (const ch of cleaned) {
    if (escape) { escape = false; continue; }
    if (ch === '\\') { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') opens['{']++;
    if (ch === '}') opens['{']--;
    if (ch === '[') opens['[']++;
    if (ch === ']') opens['[']--;
  }
  if (inString) cleaned += '"';
  cleaned = cleaned.replace(/,\s*"[^"]*"?\s*:?\s*"?[^"]*$/, '');
  cleaned = cleaned.replace(/,\s*\{[^}]*$/, '');
  cleaned = cleaned.replace(/,\s*$/, '');
  for (let i = 0; i < opens['[']; i++) cleaned += ']';
  for (let i = 0; i < opens['{']; i++) cleaned += '}';
  cleaned = cleaned
    .replace(/[\x00-\x1F\x7F]/g, ' ')
    .replace(/,\s*}/g, '}')
    .replace(/,\s*]/g, ']');
  return JSON.parse(cleaned);
}

function formatAudioFeatures(s: any): string {
  const parts: string[] = [];
  if (s.audio_tempo != null) parts.push(`BPM:${Math.round(s.audio_tempo)}`);
  if (s.audio_energy != null) parts.push(`energy:${s.audio_energy.toFixed(2)}`);
  if (s.audio_valence != null) parts.push(`valence:${s.audio_valence.toFixed(2)}`);
  if (s.audio_danceability != null) parts.push(`dance:${s.audio_danceability.toFixed(2)}`);
  if (s.audio_acousticness != null) parts.push(`acoustic:${s.audio_acousticness.toFixed(2)}`);
  if (s.audio_instrumentalness != null) parts.push(`instr:${s.audio_instrumentalness.toFixed(2)}`);
  if (s.audio_speechiness != null) parts.push(`speech:${s.audio_speechiness.toFixed(2)}`);
  if (s.audio_loudness != null) parts.push(`loud:${s.audio_loudness.toFixed(1)}dB`);
  return parts.length > 0 ? ` [${parts.join(", ")}]` : "";
}

function formatDeepTags(s: any): string {
  const tags: string[] = [];
  if (s.mood) tags.push(`mood:"${s.mood}"`);
  if (s.groove_feel) tags.push(`groove:"${s.groove_feel}"`);
  if (s.sonic_brightness) tags.push(`brightness:${s.sonic_brightness}`);
  if (s.spatial_quality) tags.push(`space:"${s.spatial_quality}"`);
  if (s.rhythmic_identity) tags.push(`rhythm:"${s.rhythmic_identity}"`);
  if (s.production_style) tags.push(`prod:"${s.production_style}"`);
  if (s.vocal_style) tags.push(`vocal:"${s.vocal_style}"`);
  if (s.sonic_texture) tags.push(`texture:"${s.sonic_texture}"`);
  if (s.atmosphere) tags.push(`atm:"${s.atmosphere}"`);
  if (s.listening_context) tags.push(`context:"${s.listening_context}"`);
  if (s.intimacy_scale) tags.push(`scale:"${s.intimacy_scale}"`);
  if (s.tension_level) tags.push(`tension:"${s.tension_level}"`);
  if (s.energy) tags.push(`energy_cat:${s.energy}`);
  if (s.genre_tags?.length) tags.push(`genres:[${s.genre_tags.join(", ")}]`);
  return tags.length > 0 ? ` {${tags.join(", ")}}` : "";
}

function formatSongLine(s: any, i: number): string {
  let line = `${i + 1}. "${s.track_name}" – ${s.artist_name}`;
  if (s.album_name) line += ` (${s.album_name})`;
  line += formatAudioFeatures(s);
  line += formatDeepTags(s);
  return line;
}

async function fetchAllRows(client: any, table: string, userId: string, columns: string): Promise<any[]> {
  const allRows: any[] = [];
  const pageSize = 1000;
  let from = 0;
  while (true) {
    const { data, error } = await client
      .from(table)
      .select(columns)
      .eq("user_id", userId)
      .range(from, from + pageSize - 1);
    if (error) throw error;
    const rows = data || [];
    allRows.push(...rows);
    if (rows.length < pageSize) break;
    from += pageSize;
  }
  return allRows;
}

async function callAI(apiKey: string, model: string, systemPrompt: string, userPrompt: string, tools?: any[], toolChoice?: any, temperature = 0.3): Promise<any> {
  const body: any = {
    model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    temperature,
  };
  if (tools) body.tools = tools;
  if (toolChoice) body.tool_choice = toolChoice;

  const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    console.error("AI gateway error:", response.status, text);
    if (response.status === 429) throw new Error("RATE_LIMIT");
    if (response.status === 402) throw new Error("CREDITS_EXHAUSTED");
    throw new Error(`AI request failed: ${response.status}`);
  }

  const data = await response.json();
  const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
  if (toolCall?.function?.arguments) {
    try { return JSON.parse(toolCall.function.arguments); } catch { return extractJson(toolCall.function.arguments); }
  }
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("Empty AI response");
  return extractJson(content);
}

const TAG_SYSTEM_PROMPT = `You are Tempo — a world-class music analyst with the ear of a mastering engineer, the soul of a DJ, and the vocabulary of a musicologist.

Your job is to analyze each song across DEEP musical dimensions that go far beyond genre and BPM.

For each song, you must determine:

1. **mood** — The specific emotional shade (not just "happy/sad" — be precise: "wistful nostalgia", "defiant confidence", "melancholic euphoria")
2. **energy** — Overall energy level
3. **genre_tags** — 2-4 specific subgenre tags (e.g. "neo-soul", "trap-influenced R&B", "shoegaze-adjacent dream pop")
4. **tempo_estimate** — Rhythmic speed category
5. **era** — Sonic era influence (not just release year — what era does it SOUND like?)
6. **atmosphere** — The spatial/environmental quality ("cavernous reverb cathedral", "tight dry studio", "open-air festival")
7. **production_style** — Production philosophy ("lo-fi tape-saturated", "hyper-polished maximalist", "organic analog warmth")
8. **groove_feel** — How the rhythm FEELS ("laid-back swing", "driving four-on-the-floor", "syncopated bounce", "freeform rubato", "trap hi-hat stutter")
9. **vocal_style** — Vocal character ("breathy intimate whisper", "powerful belt", "nasal indie drawl", "auto-tuned melodic rap", "no vocals/instrumental")
10. **sonic_brightness** — Dark-to-bright spectrum ("very dark", "dark", "neutral", "bright", "very bright")
11. **spatial_quality** — Mix space ("intimate/close", "wide/spacious", "layered/dense", "sparse/minimal", "cavernous/reverberant")
12. **rhythmic_identity** — The groove DNA ("straight rigid", "swung lazy", "polyrhythmic complex", "halftime heavy", "broken/glitchy", "organic human")
13. **listening_context** — Best listening scenario ("late night alone", "driving highway", "morning coffee", "workout intensity", "dinner party background", "deep focus work")
14. **sonic_texture** — The tactile quality ("warm analog", "cold digital", "gritty distorted", "crystalline clean", "fuzzy saturated", "airy ethereal")
15. **intimacy_scale** — Scale of the sound ("whisper-close intimate", "bedroom personal", "club communal", "arena massive", "stadium epic")
16. **tension_level** — Tension vs release ("deeply relaxed", "gently flowing", "building tension", "high tension", "cathartic release")
17. **language** — The language of the lyrics ("english", "spanish", "french", "instrumental", etc.)

RULES:
- Be SPECIFIC. "Chill" is not a mood. "Hazy 3am contentment with a tinge of loneliness" is.
- Reference actual sonic qualities you can hear, not marketing buzzwords.
- Two songs in the same genre can have completely different groove_feel, spatial_quality, and tension — capture those differences.
- Each tag must be precise enough that songs with the SAME tag would genuinely sound right next to each other.
- ALWAYS detect the language of the lyrics accurately.`;

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
              index: { type: "number", description: "1-indexed song number" },
              genre_tags: { type: "array", items: { type: "string" } },
              mood: { type: "string" },
              energy: { type: "string", enum: ["low", "medium-low", "medium", "medium-high", "high"] },
              tempo_estimate: { type: "string" },
              era: { type: "string" },
              atmosphere: { type: "string" },
              production_style: { type: "string" },
              groove_feel: { type: "string" },
              vocal_style: { type: "string" },
              sonic_brightness: { type: "string", enum: ["very dark", "dark", "neutral", "bright", "very bright"] },
              spatial_quality: { type: "string" },
              rhythmic_identity: { type: "string" },
              listening_context: { type: "string" },
              sonic_texture: { type: "string" },
              intimacy_scale: { type: "string" },
              tension_level: { type: "string" },
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

const DEFINE_WORLDS_SYSTEM = `You are Tempo — a world-class music curator. Your mission is to define the SONIC WORLDS that exist in a user's music library.

A "sonic world" is a cluster of songs that share:
- Compatible groove and rhythmic identity
- Compatible atmosphere and spatial quality
- Compatible production philosophy
- Compatible emotional direction
- Compatible listening purpose
- Compatible vocal texture and brightness

You are given:
1. A SAMPLE of the user's tagged songs (with deep analysis tags)
2. The user's EXISTING Spotify playlists (showing how they already group music)
3. Information about their followed artists and saved albums

From this data, you must define the distinct sonic worlds that exist in this library.

CRITICAL RULES:
- Create as many worlds as the music naturally requires (typically 8-25 for a large library)
- Each world must be SPECIFIC and NARROW — it's better to have many precise worlds than few broad ones
- Genre and BPM are WEAK signals — two songs in the same genre can belong to completely different worlds
- Language is IMPORTANT: by default, keep English and Spanish songs in separate worlds unless the sonic world is so unified that language is irrelevant
- Use the user's existing playlists as reference for their natural grouping tendencies
- Each world definition must be specific enough that you could reliably assign new songs to it
- DO NOT create catch-all or "miscellaneous" worlds

For each world, provide:
- A clear identity definition covering groove, atmosphere, production, mood, vocals, brightness, spatial quality
- The listening context (when/where this world lives)
- 2-4 example songs from the sample that exemplify this world`;

const DEFINE_WORLDS_TOOL = {
  type: "function" as const,
  function: {
    name: "define_sonic_worlds",
    description: "Define the sonic worlds found in the user's library",
    parameters: {
      type: "object",
      properties: {
        worlds: {
          type: "array",
          items: {
            type: "object",
            properties: {
              world_id: { type: "string", description: "Short snake_case identifier" },
              name: { type: "string", description: "Evocative 2-4 word playlist name" },
              vibe_description: { type: "string", description: "One-line vibe (15-25 words)" },
              ai_explanation: { type: "string", description: "3-4 sentences: sonic thread, groove, production, mood, what belongs" },
              mood_tags: { type: "array", items: { type: "string" }, description: "2-4 specific mood tags" },
              color_hex: { type: "string" },
              energy_level: { type: "string", enum: ["low", "medium-low", "medium", "medium-high", "high"] },
              primary_language: { type: "string" },
              groove_identity: { type: "string", description: "The rhythmic DNA" },
              sonic_brightness: { type: "string" },
              spatial_quality: { type: "string" },
              production_identity: { type: "string" },
              atmosphere: { type: "string" },
              listening_context: { type: "string" },
              vocal_character: { type: "string" },
              example_song_indices: { type: "array", items: { type: "number" }, description: "1-indexed song numbers from the sample" },
            },
            required: ["world_id", "name", "vibe_description", "ai_explanation", "mood_tags", "color_hex", "energy_level", "primary_language", "groove_identity"],
          },
        },
      },
      required: ["worlds"],
    },
  },
};

const ASSIGN_SYSTEM = `You are Tempo — a strict music curator assigning songs to pre-defined sonic worlds.

You are given:
1. A list of SONIC WORLD definitions (each with identity, groove, mood, production, atmosphere)
2. A batch of songs with deep analysis tags

For EACH song, assign it to the BEST matching world. A song MUST pass at least 7 of these 10 compatibility checks to belong:
✓ Same sonic world (reverb space, tonal warmth, frequency balance)
✓ Compatible groove feel (swing, bounce, pocket weight)
✓ Same emotional shade (specific, not broad)
✓ Compatible production philosophy (lo-fi/hi-fi, analog/digital, raw/polished)
✓ Compatible vocal texture
✓ Same darkness/brightness spectrum
✓ Same spatial scale (intimate vs massive)
✓ Compatible tension behavior
✓ Same listening context
✓ Language compatibility (English with English, Spanish with Spanish by default)

If a song does not strongly match ANY world (fewer than 7 checks pass), assign it to "__unassigned__".

Be STRICT. It is better to leave a song unassigned than to pollute a good world.

IMPORTANT: Do NOT assign all songs to just 2-3 worlds. Distribute properly across all available worlds based on actual sonic compatibility.`;

const ASSIGN_TOOL = {
  type: "function" as const,
  function: {
    name: "assign_songs",
    description: "Assign each song to a sonic world",
    parameters: {
      type: "object",
      properties: {
        assignments: {
          type: "array",
          items: {
            type: "object",
            properties: {
              index: { type: "number", description: "1-indexed song number from the batch" },
              world_id: { type: "string", description: "The world_id to assign to, or '__unassigned__'" },
              confidence: { type: "number", description: "0-1 confidence score" },
            },
            required: ["index", "world_id"],
          },
        },
      },
      required: ["assignments"],
    },
  },
};

const REFINE_SYSTEM = `You are Tempo — a strict music curator doing a final quality pass on playlists.

You are given playlists (sonic worlds) with their assigned songs. For each playlist:

1. CHECK COHERENCE: Do all songs truly belong? Remove any that break the sonic unity.
2. CHECK SIZE: If a playlist has fewer than 3 songs, mark it for merging or deletion.
3. CHECK LANGUAGE: Flag if languages are mixed inappropriately.
4. SPLIT IF NEEDED: If a playlist has distinct sub-groups (e.g., 15 dark songs that split into "dark ambient electronic" vs "dark acoustic folk"), recommend splitting.

Return the refined playlist assignments.`;

const REFINE_TOOL = {
  type: "function" as const,
  function: {
    name: "refine_playlists",
    description: "Refine playlist assignments after coherence check",
    parameters: {
      type: "object",
      properties: {
        actions: {
          type: "array",
          items: {
            type: "object",
            properties: {
              action: { type: "string", enum: ["keep", "remove", "move", "split", "merge", "delete_world"] },
              world_id: { type: "string" },
              song_index: { type: "number", description: "For remove/move actions" },
              target_world_id: { type: "string", description: "For move actions" },
              new_world: {
                type: "object",
                description: "For split actions — define the new world",
                properties: {
                  world_id: { type: "string" },
                  name: { type: "string" },
                  vibe_description: { type: "string" },
                  ai_explanation: { type: "string" },
                  mood_tags: { type: "array", items: { type: "string" } },
                  color_hex: { type: "string" },
                  energy_level: { type: "string" },
                  primary_language: { type: "string" },
                  song_indices: { type: "array", items: { type: "number" } },
                },
              },
            },
            required: ["action", "world_id"],
          },
        },
      },
      required: ["actions"],
    },
  },
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Not authenticated" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const supabase = createClient(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const admin = createClient(supabaseUrl, serviceKey);

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) return json({ error: "Invalid session" }, 401);

    let mode: "tag_only" | "define_worlds" | "assign_batch" | "refine" | "full_rebuild" = "full_rebuild";
    let batchSize = 150;
    let forceRetag = false;
    let worldDefs: any[] = [];
    let batchOffset = 0;

    try {
      const body = await req.json();
      if (body?.mode) mode = body.mode;
      if (typeof body?.batch_size === "number") batchSize = Math.min(body.batch_size, 200);
      if (body?.force_retag === true) forceRetag = true;
      if (body?.world_definitions) worldDefs = body.world_definitions;
      if (typeof body?.offset === "number") batchOffset = body.offset;
    } catch { /* no body */ }

    const SONG_COLUMNS = "id, spotify_track_id, track_name, artist_name, album_name, image_url, audio_tempo, audio_energy, audio_valence, audio_danceability, audio_acousticness, audio_instrumentalness, audio_speechiness, audio_loudness, audio_liveness, mood, energy, atmosphere, production_style, groove_feel, vocal_style, sonic_brightness, spatial_quality, rhythmic_identity, listening_context, sonic_texture, intimacy_scale, tension_level, genre_tags, era, tempo_estimate";

    if (forceRetag && mode === "tag_only") {
      console.info(`[analyze] FORCE RETAG: clearing all data for user ${user.id}`);
      await admin.from("liked_songs").update({
        analyzed_at: null,
        groove_feel: null, vocal_style: null, sonic_brightness: null,
        spatial_quality: null, rhythmic_identity: null, listening_context: null,
        sonic_texture: null, intimacy_scale: null, tension_level: null,
      }).eq("user_id", user.id);

      const { data: existingClusters } = await admin
        .from("liked_song_clusters").select("id").eq("user_id", user.id);
      if (existingClusters?.length) {
        const ids = existingClusters.map(c => c.id);
        await admin.from("liked_song_cluster_tracks").delete().in("cluster_id", ids);
        await admin.from("liked_song_clusters").delete().eq("user_id", user.id);
      }
    }

    const { count: totalLikedSongs } = await supabase
      .from("liked_songs").select("id", { count: "exact", head: true }).eq("user_id", user.id);
    const total = totalLikedSongs ?? 0;
    if (total === 0 && mode !== "refine") {
      return json({ error: "No liked songs found. Import your Spotify library first." }, 400);
    }

    if (mode === "tag_only") {
      const { data: unanalyzed } = await supabase
        .from("liked_songs")
        .select("id, spotify_track_id, track_name, artist_name, album_name, image_url, audio_tempo, audio_energy, audio_valence, audio_danceability, audio_acousticness, audio_instrumentalness, audio_speechiness, audio_loudness, audio_liveness")
        .eq("user_id", user.id)
        .is("analyzed_at", null)
        .order("added_at", { ascending: false })
        .limit(batchSize);

      const songs = unanalyzed || [];

      if (songs.length === 0) {
        const { count: analyzedCount } = await supabase
          .from("liked_songs").select("id", { count: "exact", head: true })
          .eq("user_id", user.id).not("analyzed_at", "is", null);
        return json({ success: true, done: true, tracks_analyzed_this_batch: 0, total_analyzed: analyzedCount ?? 0, total_liked_songs: total });
      }

      console.info(`[analyze] tag_only: ${songs.length} songs for user ${user.id}`);

      const songList = songs.map((s, i) =>
        `${i + 1}. "${s.track_name}" – ${s.artist_name}${s.album_name ? ` (${s.album_name})` : ""}${formatAudioFeatures(s)}`
      ).join("\n");

      const parsed = await callAI(
        LOVABLE_API_KEY, "google/gemini-2.5-flash", TAG_SYSTEM_PROMPT,
        `Analyze these ${songs.length} songs with DEEP musical analysis. For each song, provide ALL dimensions including language detection.\n\n${songList}\n\nUse the tag_songs function.`,
        [TAG_TOOL], { type: "function", function: { name: "tag_songs" } }
      );

      const taggedSongs = parsed.songs || [];
      const nowIso = new Date().toISOString();

      for (const tagged of taggedSongs) {
        const idx = (tagged.index || 0) - 1;
        if (idx < 0 || idx >= songs.length) continue;
        await admin.from("liked_songs").update({
          genre_tags: tagged.genre_tags || [],
          mood: tagged.mood || null,
          energy: tagged.energy || null,
          tempo_estimate: tagged.tempo_estimate || null,
          era: tagged.era || null,
          atmosphere: tagged.atmosphere || null,
          production_style: tagged.production_style || null,
          groove_feel: tagged.groove_feel || null,
          vocal_style: tagged.vocal_style || null,
          sonic_brightness: tagged.sonic_brightness || null,
          spatial_quality: tagged.spatial_quality || null,
          rhythmic_identity: tagged.rhythmic_identity || null,
          listening_context: tagged.listening_context || null,
          sonic_texture: tagged.sonic_texture || null,
          intimacy_scale: tagged.intimacy_scale || null,
          tension_level: tagged.tension_level || null,
          analyzed_at: nowIso,
        }).eq("id", songs[idx].id);
      }

      const { count: analyzedNow } = await supabase
        .from("liked_songs").select("id", { count: "exact", head: true })
        .eq("user_id", user.id).not("analyzed_at", "is", null);

      return json({
        success: true, done: (analyzedNow ?? 0) >= total,
        tracks_analyzed_this_batch: taggedSongs.length,
        total_analyzed: analyzedNow ?? 0, total_liked_songs: total,
      });
    }

    if (mode === "define_worlds") {
      const allSongs = await fetchAllRows(supabase, "liked_songs", user.id, SONG_COLUMNS);
      const taggedSongs = allSongs.filter(s => s.groove_feel != null);

      const playlists = await fetchAllRows(supabase, "spotify_playlists", user.id, "id, name, description, track_count, spotify_playlist_id, is_owned_by_user, is_collaborative");

      const playlistContext: string[] = [];
      for (const pl of playlists.slice(0, 30)) {
        const { data: tracks } = await supabase
          .from("spotify_playlist_tracks")
          .select("track_name, artist_name")
          .eq("playlist_id", pl.id)
          .eq("user_id", user.id)
          .order("position")
          .limit(15);

        if (tracks && tracks.length > 0) {
          const trackList = tracks.map(t => `  - "${t.track_name}" – ${t.artist_name}`).join("\n");
          playlistContext.push(`📋 "${pl.name}" (${pl.track_count} tracks${pl.is_owned_by_user ? ", user-created" : ""}${pl.is_collaborative ? ", collaborative" : ""}):\n${trackList}`);
        }
      }

      const artists = await fetchAllRows(supabase, "spotify_followed_artists", user.id, "artist_name, genres");
      const artistContext = artists.slice(0, 50).map(a =>
        `- ${a.artist_name}${a.genres?.length ? ` [${a.genres.slice(0, 3).join(", ")}]` : ""}`
      ).join("\n");

      const albums = await fetchAllRows(supabase, "spotify_saved_albums", user.id, "album_name, artist_name, album_type, genres");
      const albumContext = albums.slice(0, 40).map(a =>
        `- "${a.album_name}" by ${a.artist_name}${a.genres?.length ? ` [${a.genres.slice(0, 2).join(", ")}]` : ""}`
      ).join("\n");

      const buckets = new Map<string, any[]>();
      for (const s of taggedSongs) {
        const key = `${s.sonic_brightness || "?"}_${s.energy || "?"}`;
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key)!.push(s);
      }

      const maxSample = Math.min(300, taggedSongs.length);
      const sample: any[] = [];
      const bucketKeys = [...buckets.keys()];
      let round = 0;
      while (sample.length < maxSample) {
        let added = false;
        for (const key of bucketKeys) {
          const bucket = buckets.get(key)!;
          if (round < bucket.length && sample.length < maxSample) {
            sample.push(bucket[round]);
            added = true;
          }
        }
        if (!added) break;
        round++;
      }

      const sampleLines = sample.map((s, i) => formatSongLine(s, i)).join("\n");

      const contextBlock = `
═══ USER'S SPOTIFY ECOSYSTEM ═══

LIBRARY SIZE: ${allSongs.length} liked songs (${taggedSongs.length} fully analyzed)

${playlistContext.length > 0 ? `EXISTING PLAYLISTS (showing how the user already groups music):\n${playlistContext.join("\n\n")}` : "No existing playlists found."}

${artistContext ? `FOLLOWED ARTISTS:\n${artistContext}` : ""}

${albumContext ? `SAVED ALBUMS:\n${albumContext}` : ""}

═══ REPRESENTATIVE SAMPLE (${sample.length} of ${taggedSongs.length} tagged songs) ═══

${sampleLines}
`;

      console.info(`[analyze] define_worlds: ${sample.length} sample songs, ${playlists.length} playlists, ${artists.length} artists for user ${user.id}`);

      const parsed = await callAI(
        LOVABLE_API_KEY, "google/gemini-2.5-pro", DEFINE_WORLDS_SYSTEM,
        `Define the sonic worlds in this user's library. Create as many as the music naturally requires — be specific and narrow. Use the existing playlists as reference signals for the user's natural grouping tendencies.\n\n${contextBlock}\n\nUse the define_sonic_worlds function.`,
        [DEFINE_WORLDS_TOOL], { type: "function", function: { name: "define_sonic_worlds" } },
        0.4
      );

      const worlds = parsed.worlds || [];
      console.info(`[analyze] defined ${worlds.length} sonic worlds`);

      return json({
        success: true,
        worlds,
        total_songs: allSongs.length,
        tagged_songs: taggedSongs.length,
        playlists_analyzed: playlists.length,
      });
    }

    if (mode === "assign_batch") {
      if (!worldDefs || worldDefs.length === 0) {
        return json({ error: "world_definitions required for assign_batch mode" }, 400);
      }

      const allSongs = await fetchAllRows(supabase, "liked_songs", user.id, SONG_COLUMNS);
      const batch = allSongs.slice(batchOffset, batchOffset + batchSize);

      if (batch.length === 0) {
        return json({ success: true, done: true, assigned: 0, total: allSongs.length });
      }

      const worldSummary = worldDefs.map(w =>
        `[${w.world_id}] "${w.name}" — ${w.vibe_description}\n  Groove: ${w.groove_identity || "mixed"} | Brightness: ${w.sonic_brightness || "mixed"} | Space: ${w.spatial_quality || "mixed"} | Production: ${w.production_identity || "mixed"} | Atmosphere: ${w.atmosphere || "mixed"} | Vocals: ${w.vocal_character || "mixed"} | Context: ${w.listening_context || "mixed"} | Language: ${w.primary_language || "any"} | Energy: ${w.energy_level || "mixed"}`
      ).join("\n\n");

      const songLines = batch.map((s, i) => formatSongLine(s, i)).join("\n");

      const parsed = await callAI(
        LOVABLE_API_KEY, "google/gemini-2.5-flash", ASSIGN_SYSTEM,
        `SONIC WORLDS:\n${worldSummary}\n\nSONGS TO ASSIGN (batch of ${batch.length}):\n${songLines}\n\nAssign each song to its best matching world. Use the assign_songs function.`,
        [ASSIGN_TOOL], { type: "function", function: { name: "assign_songs" } }
      );

      const assignments = parsed.assignments || [];

      const result = assignments.map((a: any) => {
        const idx = (a.index || 0) - 1;
        if (idx < 0 || idx >= batch.length) return null;
        return {
          song_id: batch[idx].id,
          spotify_track_id: batch[idx].spotify_track_id,
          world_id: a.world_id,
          confidence: a.confidence ?? 0.8,
        };
      }).filter(Boolean);

      return json({
        success: true,
        done: batchOffset + batch.length >= allSongs.length,
        assignments: result,
        batch_size: batch.length,
        offset: batchOffset,
        total: allSongs.length,
      });
    }

    if (mode === "refine") {
      const { data: clusters } = await supabase
        .from("liked_song_clusters")
        .select("id, name, vibe_description, ai_explanation, mood_tags, energy_level, track_count")
        .eq("user_id", user.id)
        .order("sort_order");

      if (!clusters || clusters.length === 0) {
        return json({ success: true, message: "No clusters to refine" });
      }

      const clusterSummaries: string[] = [];
      const allSongsMap = new Map<string, any>();

      const allSongs = await fetchAllRows(supabase, "liked_songs", user.id, SONG_COLUMNS);
      for (const s of allSongs) allSongsMap.set(s.id, s);

      for (const cluster of clusters) {
        const { data: tracks } = await supabase
          .from("liked_song_cluster_tracks")
          .select("liked_song_id, spotify_track_id")
          .eq("cluster_id", cluster.id)
          .eq("user_id", user.id);

        const trackLines = (tracks || []).map((t, i) => {
          const song = allSongsMap.get(t.liked_song_id);
          if (!song) return `${i + 1}. [unknown]`;
          return formatSongLine(song, i);
        }).join("\n");

        clusterSummaries.push(
          `\n📋 "${cluster.name}" (${cluster.track_count} songs)\nVibe: ${cluster.vibe_description || "N/A"}\n${trackLines}`
        );
      }

      if (clusterSummaries.length > 0) {
        try {
          const parsed = await callAI(
            LOVABLE_API_KEY, "google/gemini-2.5-flash", REFINE_SYSTEM,
            `Review these playlists for coherence. Flag any songs that break the sonic unity, playlists that should be split, or playlists that are too small to keep.\n\n${clusterSummaries.join("\n\n")}\n\nUse the refine_playlists function.`,
            [REFINE_TOOL], { type: "function", function: { name: "refine_playlists" } }
          );

          const actions = parsed.actions || [];
          let removals = 0;
          for (const action of actions) {
            if (action.action === "remove" && action.song_index != null && action.world_id) {
              const cluster = clusters.find(c => c.name === action.world_id || c.id === action.world_id);
              if (cluster) {
                removals++;
              }
            }
          }

          console.info(`[analyze] refine: ${actions.length} actions, ${removals} removals suggested`);
          return json({ success: true, actions_count: actions.length, removals });
        } catch (e) {
          console.error("Refine error:", e);
          return json({ success: true, message: "Refinement skipped due to error" });
        }
      }

      return json({ success: true, message: "Refinement complete" });
    }

    const allSongs = await fetchAllRows(supabase, "liked_songs", user.id, SONG_COLUMNS);
    if (allSongs.length === 0) {
      return json({ error: "No liked songs found." }, 400);
    }

    const taggedCount = allSongs.filter(s => s.groove_feel != null).length;
    console.info(`[analyze] full_rebuild: ${allSongs.length} songs (${taggedCount} tagged) for user ${user.id}`);

    if (taggedCount < allSongs.length * 0.8) {
      return json({
        success: false,
        needs_tagging: true,
        total_songs: allSongs.length,
        tagged_songs: taggedCount,
        message: "Most songs need deep analysis first. Run tag_only batches.",
      });
    }

    return json({
      success: false,
      needs_world_definition: true,
      total_songs: allSongs.length,
      tagged_songs: taggedCount,
      message: "Use define_worlds mode to start the multi-phase pipeline.",
    });

  } catch (e) {
    console.error("analyze-liked-songs error:", e);
    const msg = e instanceof Error ? e.message : "Analysis failed";
    if (msg === "RATE_LIMIT") return json({ error: "Rate limit exceeded. Try again in a moment." }, 429);
    if (msg === "CREDITS_EXHAUSTED") return json({ error: "AI credits exhausted." }, 402);
    return json({ error: msg }, 500);
  }
});
