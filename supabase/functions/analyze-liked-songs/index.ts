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
  if (s.audio_liveness != null) parts.push(`live:${s.audio_liveness.toFixed(2)}`);
  return parts.length > 0 ? ` [${parts.join(", ")}]` : "";
}

async function fetchAllLikedSongs(client: any, userId: string, columns: string): Promise<any[]> {
  const allRows: any[] = [];
  const pageSize = 1000;
  let from = 0;

  while (true) {
    const { data, error } = await client
      .from("liked_songs")
      .select(columns)
      .eq("user_id", userId)
      .order("added_at", { ascending: false })
      .range(from, from + pageSize - 1);

    if (error) throw error;
    const rows = data || [];
    allRows.push(...rows);
    if (rows.length < pageSize) break;
    from += pageSize;
  }

  return allRows;
}

// ── Deep analysis tags for tag_only mode ──

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

RULES:
- Be SPECIFIC. "Chill" is not a mood. "Hazy 3am contentment with a tinge of loneliness" is.
- Reference actual sonic qualities you can hear, not marketing buzzwords.
- Two songs in the same genre can have completely different groove_feel, spatial_quality, and tension — capture those differences.
- Each tag must be precise enough that songs with the SAME tag would genuinely sound right next to each other.`;

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
            },
            required: ["index", "mood", "energy", "groove_feel", "vocal_style", "sonic_brightness", "spatial_quality", "rhythmic_identity", "listening_context", "sonic_texture", "intimacy_scale", "tension_level"],
          },
        },
      },
      required: ["songs"],
    },
  },
};

// ── Clustering system prompt — the heart of playlist generation ──

const CLUSTER_SYSTEM_PROMPT = `You are Tempo — a world-class music curator with the sensibility of a vinyl-obsessed DJ, the ear of a mastering engineer, and the soul of someone who has spent decades building perfect listening experiences.

YOUR MISSION: Group these songs into playlists that each feel like ONE COHERENT SONIC WORLD. Every playlist must pass the "would I actually listen to this front-to-back without skipping?" test.

═══════════════════════════════════════════════════════
WHAT MAKES A GREAT PLAYLIST (in order of importance):
═══════════════════════════════════════════════════════

1. **SONIC WORLD UNITY** — Every song must live in the same sonic universe. Think of it like a room: the reverb space, the warmth of the air, the weight of the bass, the texture of the surfaces. Songs that share a sonic world feel like they were recorded in the same emotional space.

2. **GROOVE & RHYTHMIC IDENTITY** — The rhythmic DNA must be compatible. This is NOT about BPM. A lazy swung 95 BPM groove and a rigid driving 95 BPM groove belong in DIFFERENT playlists even though they're the same tempo. What matters: swing feel, bounce character, pulse weight, hi-hat patterns, rhythmic density, groove pocket.

3. **EMOTIONAL THREAD** — Not just "happy" or "sad" but the SPECIFIC shade of emotion. "Wistful nostalgia on a rainy afternoon" is different from "bittersweet memories of summer." Songs must share the same emotional specificity.

4. **PRODUCTION IDENTITY** — The production philosophy must match. Lo-fi tape saturation doesn't sit next to crystal-clean digital production. Analog warmth doesn't mix with sterile precision. Bedroom intimacy doesn't pair with arena bombast.

5. **VOCAL TEXTURE COMPATIBILITY** — Breathy whispers don't pair with powerful belts. Auto-tuned melodic vocals don't sit next to raw punk screams. Vocal delivery is part of the sonic world.

6. **DARKNESS / BRIGHTNESS** — The tonal palette must be consistent. Dark, moody songs don't mix with bright, airy songs within the same playlist.

7. **SPATIAL CONSISTENCY** — Intimate close-mic recordings don't sit next to massive reverb-drenched stadium productions.

8. **TENSION & ENERGY BEHAVIOR** — Not just energy level, but how energy behaves. Building tension is different from sustained intensity. Cathartic release is different from steady cruising.

9. **LISTENING CONTEXT** — A great playlist serves a specific moment. "Late night driving" is different from "Sunday morning kitchen." Songs must serve the same moment.

═══════════════════════════════════════════════════════
WHAT DOES NOT MAKE A GOOD PLAYLIST:
═══════════════════════════════════════════════════════

❌ Grouping by broad genre ("all the rap songs", "all the rock songs")
❌ Grouping by BPM range ("everything between 100-120 BPM")
❌ Grouping by artist ("all songs by this artist go together")
❌ Grouping by release era alone ("all 2020s songs")
❌ Grouping by language alone ("all Spanish songs")
❌ Creating catch-all playlists for songs that don't fit elsewhere
❌ Forcing every song into a playlist — if a song doesn't strongly belong anywhere, it's better to leave it in an "Uncategorized" overflow than to pollute a focused playlist

═══════════════════════════════════════════════════════
STRICT COHERENCE RULES:
═══════════════════════════════════════════════════════

Before placing a song in a playlist, it must pass AT LEAST 7 of these 10 checks:
✓ Same sonic world (reverb space, tonal warmth, frequency balance)
✓ Compatible groove feel (swing, bounce, pocket weight)
✓ Same emotional shade (specific, not broad)
✓ Compatible production philosophy (lo-fi/hi-fi, analog/digital, raw/polished)
✓ Compatible vocal texture (style, intensity, treatment)
✓ Same darkness/brightness spectrum
✓ Same spatial scale (intimate vs. massive)
✓ Compatible tension behavior (building vs. releasing vs. sustaining)
✓ Same listening context (when/where you'd play this)
✓ Transition compatibility (would these songs flow naturally in sequence?)

A song that only matches on 4-5 dimensions does NOT belong in that playlist, even if it's the "closest" match.

═══════════════════════════════════════════════════════
BPM & GENRE RULES:
═══════════════════════════════════════════════════════

- BPM is a WEAK supporting signal. Two songs at 90 BPM can feel completely different rhythmically.
- Genre is a WEAK supporting signal. Two "hip-hop" songs can belong in completely different sonic worlds.
- NEVER use BPM buckets as a primary clustering method.
- NEVER use genre labels as a primary clustering method.
- Same-BPM songs go together ONLY if they also share groove feel, sonic world, production identity, and emotional tone.
- Same-genre songs go together ONLY if they share sonic world, rhythmic identity, and emotional compatibility.

═══════════════════════════════════════════════════════
LANGUAGE RULES:
═══════════════════════════════════════════════════════

- Detect the language of each track.
- English songs cluster with English songs by default.
- Spanish songs cluster with Spanish songs by default.
- Do NOT mix languages in the same playlist unless the sonic world is SO unified that language becomes irrelevant (rare).
- Language mixing should be the EXCEPTION, not the default.

═══════════════════════════════════════════════════════
ARTIST RULES:
═══════════════════════════════════════════════════════

- NEVER assume songs by the same artist belong in the same playlist.
- An artist can have tracks that span multiple sonic worlds — classify EACH track individually.
- A single album can contain songs for different playlists.

═══════════════════════════════════════════════════════
PLAYLIST QUALITY STANDARDS:
═══════════════════════════════════════════════════════

Each playlist MUST feel like:
- One coherent world you can inhabit for 30-60 minutes
- One specific mood/emotion sustained throughout
- One consistent production quality and sonic texture
- One rhythmic logic that doesn't jolt you out of the flow
- A listening experience with ZERO skips

PREFER: Fewer, smaller, stronger playlists (5-25 songs each)
AVOID: Large, broad, catch-all playlists (30+ songs of mixed character)

If you have 15 dark moody songs that split into two distinct sub-worlds (e.g., "dark ambient electronic" vs "dark acoustic folk"), make TWO playlists of 7-8 songs, not one playlist of 15.

═══════════════════════════════════════════════════════
NAMING:
═══════════════════════════════════════════════════════

Names must be evocative, aesthetic, 2-4 words. Reflect the SONIC CHARACTER, not the genre.
GOOD: "Midnight Drive", "Velvet Haze", "Golden Groove", "Soft Horizon", "Neon Cathedral", "Smoke & Amber"
BAD: "Pop Mix", "Rap Songs", "Rock Playlist", "Spanish Mix", "Chill Vibes"

═══════════════════════════════════════════════════════
OUTPUT REQUIREMENTS:
═══════════════════════════════════════════════════════

Create 5-25 playlists (scale with library size). Every song must appear in exactly one playlist.
For each playlist, provide:
- Evocative name
- Specific vibe description referencing sonic qualities
- Detailed AI explanation referencing production, rhythm, mood, and texture
- Mood tags that are SPECIFIC (not "chill" — say "hazy late-night contentment")
- Energy level, tempo range, era range
- Audio feature averages (from the Spotify data provided)

Return ONLY valid JSON via the save_playlists function.`;

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

    let batchOffset = 0;
    let batchSize = 200;
    let mode: "cluster" | "tag_only" = "cluster";
    try {
      const body = await req.json();
      if (typeof body?.offset === "number") batchOffset = body.offset;
      if (typeof body?.batch_size === "number") batchSize = Math.min(body.batch_size, 200);
      if (body?.mode === "tag_only") mode = "tag_only";
    } catch { /* no body is fine */ }

    const { count: totalLikedSongs } = await supabase
      .from("liked_songs")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id);

    const total = totalLikedSongs ?? 0;
    if (total === 0) {
      return json({ error: "No liked songs found. Import your Spotify library first." }, 400);
    }

    // ═══════════════════════════════════════════
    // TAG_ONLY MODE — deep per-song analysis
    // ═══════════════════════════════════════════
    if (mode === "tag_only") {
      const { data: unanalyzed, error: fetchErr } = await supabase
        .from("liked_songs")
        .select("id, spotify_track_id, track_name, artist_name, album_name, image_url, audio_tempo, audio_energy, audio_valence, audio_danceability, audio_acousticness, audio_instrumentalness, audio_speechiness, audio_loudness, audio_liveness")
        .eq("user_id", user.id)
        .is("analyzed_at", null)
        .order("added_at", { ascending: false })
        .limit(batchSize);

      if (fetchErr) return json({ error: fetchErr.message }, 500);
      const songs = unanalyzed || [];

      if (songs.length === 0) {
        const { count: analyzedCount } = await supabase
          .from("liked_songs")
          .select("id", { count: "exact", head: true })
          .eq("user_id", user.id)
          .not("analyzed_at", "is", null);

        return json({
          success: true,
          done: true,
          tracks_analyzed_this_batch: 0,
          total_analyzed: analyzedCount ?? 0,
          total_liked_songs: total,
        });
      }

      console.info(`[analyze-liked-songs] tag_only batch: ${songs.length} unanalyzed songs for user ${user.id}`);

      const songList = songs.map((s, i) =>
        `${i + 1}. "${s.track_name}" – ${s.artist_name}${s.album_name ? ` (${s.album_name})` : ""}${formatAudioFeatures(s)}`
      ).join("\n");

      const tagPrompt = `Analyze these ${songs.length} songs with DEEP musical analysis. For each song, provide all dimensions: genre_tags, mood, energy, tempo_estimate, era, atmosphere, production_style, groove_feel, vocal_style, sonic_brightness, spatial_quality, rhythmic_identity, listening_context, sonic_texture, intimacy_scale, tension_level.

Be SPECIFIC and PRECISE — your tags will be used to cluster songs into playlists. Generic tags create bad playlists. Two songs tagged identically should genuinely sound right next to each other.

${songList}

Use the tag_songs function to return your analysis.`;

      const tagResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [
            { role: "system", content: TAG_SYSTEM_PROMPT },
            { role: "user", content: tagPrompt },
          ],
          temperature: 0.3,
          tools: [TAG_TOOL],
          tool_choice: { type: "function", function: { name: "tag_songs" } },
        }),
      });

      if (!tagResponse.ok) {
        const text = await tagResponse.text();
        console.error("AI gateway error:", tagResponse.status, text);
        if (tagResponse.status === 429) return json({ error: "Rate limit exceeded. Try again in a moment." }, 429);
        return json({ error: `AI analysis failed: ${tagResponse.status}` }, 500);
      }

      const tagData = await tagResponse.json();
      let parsed: any;
      const toolCall = tagData.choices?.[0]?.message?.tool_calls?.[0];
      if (toolCall?.function?.arguments) {
        try { parsed = JSON.parse(toolCall.function.arguments); } catch { parsed = extractJson(toolCall.function.arguments); }
      } else {
        const content = tagData.choices?.[0]?.message?.content;
        if (!content) return json({ error: "Empty AI response" }, 500);
        parsed = extractJson(content);
      }

      const taggedSongs = parsed.songs || [];
      let taggedCount = 0;
      const nowIso = new Date().toISOString();

      for (const tagged of taggedSongs) {
        const idx = (tagged.index || 0) - 1;
        if (idx < 0 || idx >= songs.length) continue;

        const songId = songs[idx].id;
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
        }).eq("id", songId);
        taggedCount++;
      }

      const { count: analyzedNow } = await supabase
        .from("liked_songs")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id)
        .not("analyzed_at", "is", null);

      const totalAnalyzed = analyzedNow ?? 0;

      console.info(`[analyze-liked-songs] tag_only: tagged ${taggedCount} songs, total analyzed: ${totalAnalyzed}/${total}`);

      return json({
        success: true,
        done: totalAnalyzed >= total,
        tracks_analyzed_this_batch: taggedCount,
        total_analyzed: totalAnalyzed,
        total_liked_songs: total,
      });
    }

    // ═══════════════════════════════════════════
    // CLUSTER MODE — group ALL songs into playlists
    // ═══════════════════════════════════════════
    const columns = "id, spotify_track_id, track_name, artist_name, album_name, image_url, audio_tempo, audio_energy, audio_valence, audio_danceability, audio_acousticness, audio_instrumentalness, audio_speechiness, audio_loudness, audio_liveness, mood, energy, atmosphere, production_style, groove_feel, vocal_style, sonic_brightness, spatial_quality, rhythmic_identity, listening_context, sonic_texture, intimacy_scale, tension_level, genre_tags, era, tempo_estimate";
    const likedSongs = await fetchAllLikedSongs(supabase, user.id, columns);

    if (likedSongs.length === 0) {
      return json({ error: "No liked songs found. Import your Spotify library first." }, 400);
    }

    const hasAudioFeatures = likedSongs.filter(s => s.audio_energy != null).length;
    const hasDeepTags = likedSongs.filter(s => s.groove_feel != null).length;
    console.info(`[analyze-liked-songs] Clustering ${likedSongs.length} songs (${hasAudioFeatures} with audio features, ${hasDeepTags} with deep tags) for user ${user.id}`);

    // Build rich song descriptions including deep tags when available
    const songList = likedSongs.map((s, i) => {
      let line = `${i + 1}. "${s.track_name}" – ${s.artist_name}`;
      if (s.album_name) line += ` (${s.album_name})`;
      line += formatAudioFeatures(s);

      // Add deep analysis tags if available
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

      if (tags.length > 0) line += ` {${tags.join(", ")}}`;
      return line;
    }).join("\n");

    const userPrompt = `Cluster these ${likedSongs.length} liked songs into coherent playlists. Each song includes Spotify audio features AND deep analysis tags (mood, groove, brightness, spatial quality, rhythmic identity, production style, vocal style, texture, atmosphere, listening context, intimacy scale, tension level).

USE THE DEEP TAGS AS YOUR PRIMARY CLUSTERING SIGNALS. Songs with similar groove_feel + sonic_brightness + spatial_quality + production_style + mood + rhythmic_identity belong together. Audio features (BPM, energy, valence) are SUPPORTING data only.

${songList}

Use the save_playlists function to return your clustering result.`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-pro",
        messages: [
          { role: "system", content: CLUSTER_SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.4,
        tools: [{
          type: "function",
          function: {
            name: "save_playlists",
            description: "Save the curated playlists generated from deep sonic-world clustering",
            parameters: {
              type: "object",
              properties: {
                playlists: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      name: { type: "string", description: "Evocative, aesthetic playlist name (2-4 words)" },
                      vibe_description: { type: "string", description: "One-line vibe summary referencing sonic world, groove, and emotional tone (15-25 words)" },
                      ai_explanation: { type: "string", description: "3-4 sentences explaining the sonic thread. Reference groove feel, production identity, spatial quality, mood, and what makes these songs belong together." },
                      mood_tags: { type: "array", items: { type: "string" }, description: "2-4 specific mood/vibe tags (not generic — 'hazy late-night nostalgia' not 'chill')" },
                      color_hex: { type: "string", description: "Hex color matching the playlist mood" },
                      energy_level: { type: "string", enum: ["low", "medium-low", "medium", "medium-high", "high"] },
                      primary_language: { type: "string" },
                      language_consistency: { type: "number" },
                      tempo_range: { type: "string", description: "e.g. '85-100 BPM'" },
                      era_range: { type: "string" },
                      avg_energy: { type: "number" },
                      avg_valence: { type: "number" },
                      avg_tempo: { type: "number" },
                      sonic_world: { type: "string", description: "The unifying sonic world in 1-2 sentences" },
                      groove_identity: { type: "string", description: "The rhythmic DNA of this playlist" },
                      songs: {
                        type: "array",
                        items: {
                          type: "object",
                          properties: {
                            index: { type: "number", description: "1-indexed song number from the input list" },
                            analysis: {
                              type: "object",
                              properties: {
                                genre_tags: { type: "array", items: { type: "string" } },
                                mood: { type: "string" },
                                energy: { type: "string" },
                                tempo_estimate: { type: "string" },
                                era: { type: "string" },
                                atmosphere: { type: "string" },
                                production_style: { type: "string" },
                              },
                            },
                          },
                          required: ["index"],
                        },
                      },
                    },
                    required: ["name", "vibe_description", "ai_explanation", "songs"],
                  },
                },
              },
              required: ["playlists"],
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "save_playlists" } },
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      console.error("AI gateway error:", response.status, text);
      if (response.status === 429) return json({ error: "Rate limit exceeded. Try again in a moment." }, 429);
      if (response.status === 402) return json({ error: "AI credits exhausted." }, 402);
      return json({ error: `AI analysis failed: ${response.status}` }, 500);
    }

    const aiData = await response.json();

    let parsed: any;
    const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];
    if (toolCall?.function?.arguments) {
      try {
        parsed = JSON.parse(toolCall.function.arguments);
      } catch {
        parsed = extractJson(toolCall.function.arguments);
      }
    } else {
      const content = aiData.choices?.[0]?.message?.content;
      if (!content) return json({ error: "Empty AI response" }, 500);
      parsed = extractJson(content);
    }

    const clusters = parsed.playlists || parsed.clusters;
    if (!clusters || !Array.isArray(clusters)) {
      return json({ error: "Invalid AI response structure" }, 500);
    }

    // Clear previous data
    await admin.from("liked_song_cluster_tracks").delete().eq("user_id", user.id);
    await admin.from("liked_song_clusters").delete().eq("user_id", user.id);

    let totalAssigned = 0;

    for (let ci = 0; ci < clusters.length; ci++) {
      const cluster = clusters[ci];
      const songs = cluster.songs || [];

      const coverTracks: { image_url: string; track_name: string }[] = [];
      for (const song of songs) {
        if (coverTracks.length >= 4) break;
        const idx = (song.index || 0) - 1;
        if (idx >= 0 && idx < likedSongs.length && likedSongs[idx].image_url) {
          coverTracks.push({
            image_url: likedSongs[idx].image_url!,
            track_name: likedSongs[idx].track_name,
          });
        }
      }

      const { data: insertedCluster, error: clusterError } = await admin
        .from("liked_song_clusters")
        .insert({
          user_id: user.id,
          name: cluster.name || `Playlist ${ci + 1}`,
          description: cluster.ai_explanation || cluster.description || null,
          vibe_description: cluster.vibe_description || null,
          ai_explanation: cluster.ai_explanation || null,
          mood_tags: cluster.mood_tags || [],
          color_hex: cluster.color_hex || "#6366f1",
          energy_level: cluster.energy_level || "medium",
          tempo_range: cluster.tempo_range || "Mixed",
          era_range: cluster.era_range || "Mixed",
          track_count: songs.length,
          cover_tracks: coverTracks,
          analysis_model: "google/gemini-2.5-pro+deep-sonic-clustering",
          sort_order: ci,
        })
        .select("id")
        .single();

      if (clusterError || !insertedCluster) {
        console.error("Cluster insert error:", clusterError);
        continue;
      }

      const trackAssignments: any[] = [];
      for (const song of songs) {
        const idx = (song.index || 0) - 1;
        if (idx < 0 || idx >= likedSongs.length) continue;

        const likedSong = likedSongs[idx];
        trackAssignments.push({
          user_id: user.id,
          cluster_id: insertedCluster.id,
          liked_song_id: likedSong.id,
          spotify_track_id: likedSong.spotify_track_id,
          confidence_score: 0.85,
        });

        const analysis = song.analysis;
        if (analysis) {
          await admin.from("liked_songs").update({
            genre_tags: analysis.genre_tags || [],
            mood: analysis.mood || null,
            energy: analysis.energy || null,
            tempo_estimate: analysis.tempo_estimate || null,
            era: analysis.era || null,
            atmosphere: analysis.atmosphere || null,
            production_style: analysis.production_style || null,
            analyzed_at: new Date().toISOString(),
          }).eq("id", likedSong.id);
        }
      }

      if (trackAssignments.length > 0) {
        const { error: assignError } = await admin
          .from("liked_song_cluster_tracks")
          .insert(trackAssignments);
        if (assignError) console.error("Track assignment error:", assignError);
        totalAssigned += trackAssignments.length;
      }
    }

    // Count total analyzed
    const { count: analyzedNow } = await supabase
      .from("liked_songs")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .not("analyzed_at", "is", null);

    console.info(`[analyze-liked-songs] Created ${clusters.length} playlists, assigned ${totalAssigned} tracks (${hasAudioFeatures} had audio features, ${hasDeepTags} had deep tags), total analyzed: ${analyzedNow}/${total}`);

    return json({
      success: true,
      done: (analyzedNow ?? 0) >= total,
      clusters_created: clusters.length,
      tracks_analyzed: totalAssigned,
      tracks_with_audio_features: hasAudioFeatures,
      total_analyzed: analyzedNow ?? 0,
      total_liked_songs: total,
    });
  } catch (e) {
    console.error("analyze-liked-songs error:", e);
    return json({ error: e instanceof Error ? e.message : "Analysis failed" }, 500);
  }
});
