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

/**
 * Fetches ALL liked songs for a user across pagination boundaries.
 * Supabase default limit is 1000, so we paginate with .range().
 */
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

    // Parse request body for batch parameters
    let batchOffset = 0;
    let batchSize = 200; // max songs per AI call — fits context window well
    let mode: "cluster" | "tag_only" = "cluster";
    try {
      const body = await req.json();
      if (typeof body?.offset === "number") batchOffset = body.offset;
      if (typeof body?.batch_size === "number") batchSize = Math.min(body.batch_size, 200);
      if (body?.mode === "tag_only") mode = "tag_only";
    } catch { /* no body is fine */ }

    // Get total count first
    const { count: totalLikedSongs } = await supabase
      .from("liked_songs")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id);

    const total = totalLikedSongs ?? 0;
    if (total === 0) {
      return json({ error: "No liked songs found. Import your Spotify library first." }, 400);
    }

    // For clustering mode (first batch only), we fetch ALL songs to cluster them all at once
    // For tag_only mode, we fetch a specific batch of unanalyzed songs
    if (mode === "tag_only") {
      // Fetch a batch of songs that haven't been analyzed yet
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
        // Count how many are analyzed
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

      const tagPrompt = `Analyze these ${songs.length} songs. For each song, provide genre tags, mood, energy level, tempo estimate, era, atmosphere, and production style.

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
            { role: "system", content: "You are a music analysis engine. Analyze each song and return structured metadata." },
            { role: "user", content: tagPrompt },
          ],
          temperature: 0.3,
          tools: [{
            type: "function",
            function: {
              name: "tag_songs",
              description: "Save analysis tags for each song",
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
                      },
                      required: ["index", "mood", "energy"],
                    },
                  },
                },
                required: ["songs"],
              },
            },
          }],
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
          analyzed_at: nowIso,
        }).eq("id", songId);
        taggedCount++;
      }

      // Count total analyzed now
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

    // ── CLUSTER MODE: fetch ALL songs, cluster them all ──
    const columns = "id, spotify_track_id, track_name, artist_name, album_name, image_url, audio_tempo, audio_energy, audio_valence, audio_danceability, audio_acousticness, audio_instrumentalness, audio_speechiness, audio_loudness, audio_liveness";
    const likedSongs = await fetchAllLikedSongs(supabase, user.id, columns);

    if (likedSongs.length === 0) {
      return json({ error: "No liked songs found. Import your Spotify library first." }, 400);
    }

    const hasAudioFeatures = likedSongs.filter(s => s.audio_energy != null).length;
    console.info(`[analyze-liked-songs] Clustering ${likedSongs.length} songs (${hasAudioFeatures} with audio features) for user ${user.id}`);

    const songList = likedSongs.map((s, i) =>
      `${i + 1}. "${s.track_name}" – ${s.artist_name}${s.album_name ? ` (${s.album_name})` : ""}${formatAudioFeatures(s)}`
    ).join("\n");

    const systemPrompt = `You are Tempo, a premium music intelligence engine that clusters songs into playlists that feel like ONE cohesive listening world.

CORE PRINCIPLE: It is better to make FEWER playlists with STRONG identity than MORE playlists with weak or random grouping.
A song should ONLY be placed into a playlist if it strongly matches across MULTIPLE dimensions simultaneously.

PRIMARY CLUSTERING SIGNALS (from Spotify audio features):
- **tempo (BPM)**: Songs within a cluster must be within ±15 BPM of each other.
- **energy (0-1)**: Energy variance within a cluster must be < 0.25.
- **valence (0-1)**: Valence variance must be < 0.3. Don't mix dark (0.1) with upbeat (0.8).
- **danceability (0-1)**: Rhythmic groove compatibility. Don't mix freeform ambient with club bangers.
- **acousticness (0-1)**: Production world must match. Don't mix raw acoustic (0.9) with polished electronic (0.05).
- **instrumentalness (0-1)**: Vocal vs instrumental focus must be compatible.
- **loudness (dB)**: Production intensity must be compatible.

DEEP COMPATIBILITY CHECKS — every song must pass MOST of these before placement:
1. Mood & emotional tone (same shade of emotion, not just "happy/sad")
2. Atmosphere & sonic texture (same sonic world — reverb space, warmth, spatial quality)
3. Production style (lo-fi vs polished, analog vs digital, compressed vs dynamic)
4. Instrumentation compatibility (similar instrument families and timbres)
5. Vocal style & intensity (breathy vs powerful, falsetto vs baritone, etc.)
6. Rhythmic feel & groove character (straight vs swung, driving vs laid-back)
7. Darkness vs brightness of the sonic palette
8. Mainstream vs underground feel
9. Era influence & sonic generation
10. Listening context (driving, studying, working out, late night, etc.)
11. Transition compatibility (would these songs flow naturally in sequence?)

LANGUAGE RULES — CRITICAL:
- Detect the language of each track (from artist name, track name, and your musical knowledge).
- By DEFAULT, English songs cluster with English songs. Spanish songs cluster with Spanish songs.
- Do NOT casually mix Spanish and English in the same playlist. This breaks listening coherence.
- Only mix languages if there is a VERY strong musical reason AND the playlist still feels intentional.
- Language mixing should be the EXCEPTION, not the default.

COHERENCE RULES (STRICT):
- Energy variance within a cluster must be < 0.25
- Valence variance within a cluster must be < 0.3
- Tempo range within a cluster should be < 25 BPM
- If a cluster violates these, SPLIT it into smaller playlists
- Genre is ONLY a weak tiebreaker — never the primary signal

PLAYLIST NAMING:
Names must be evocative, aesthetic, 2-3 words. Reflect the SONIC CHARACTER, not genre.
GOOD: "Midnight Drive", "Dark Velvet", "Golden Groove", "Soft Horizon", "Neon Nights"
BAD: "Pop Mix", "Rap Songs", "Rock Playlist", "Spanish Mix", "English Vibes"

Create 5-20 playlists (scale with library size). Every song must appear in exactly one playlist. Favor precision over quantity.

Return ONLY valid JSON via the save_playlists function.`;

    const userPrompt = `Cluster these ${likedSongs.length} liked songs into coherent vibe-based playlists using their audio features as PRIMARY signals:

${songList}

Use the save_playlists function to return your clustering result.`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.5,
        tools: [{
          type: "function",
          function: {
            name: "save_playlists",
            description: "Save the curated playlists generated from audio-feature-based clustering",
            parameters: {
              type: "object",
              properties: {
                playlists: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      name: { type: "string", description: "Evocative, aesthetic playlist name (2-3 words)" },
                      vibe_description: { type: "string", description: "One-line vibe summary reflecting audio character, 10-20 words" },
                      ai_explanation: { type: "string", description: "2-3 sentences explaining the sonic thread. Reference specific audio features (tempo, energy, valence)." },
                      mood_tags: { type: "array", items: { type: "string" }, description: "2-4 mood/vibe tags" },
                      color_hex: { type: "string", description: "Hex color matching the playlist mood" },
                      energy_level: { type: "string", enum: ["low", "medium-low", "medium", "medium-high", "high"] },
                      primary_language: { type: "string" },
                      language_consistency: { type: "number" },
                      tempo_range: { type: "string", description: "e.g. '85-100 BPM'" },
                      era_range: { type: "string" },
                      avg_energy: { type: "number" },
                      avg_valence: { type: "number" },
                      avg_tempo: { type: "number" },
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
          analysis_model: "google/gemini-2.5-flash+audio-features",
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

    console.info(`[analyze-liked-songs] Created ${clusters.length} playlists, assigned ${totalAssigned} tracks (${hasAudioFeatures} had audio features), total analyzed: ${analyzedNow}/${total}`);

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
