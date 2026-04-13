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

    const { data: likedSongs, error: lsError } = await supabase
      .from("liked_songs")
      .select("id, spotify_track_id, track_name, artist_name, album_name, image_url")
      .eq("user_id", user.id)
      .order("added_at", { ascending: false })
      .limit(200);

    if (lsError) return json({ error: lsError.message }, 500);
    if (!likedSongs || likedSongs.length === 0) {
      return json({ error: "No liked songs found. Import your Spotify library first." }, 400);
    }

    console.info(`[analyze-liked-songs] Analyzing ${likedSongs.length} songs for user ${user.id}`);

    const songList = likedSongs.map((s, i) =>
      `${i + 1}. "${s.track_name}" – ${s.artist_name}${s.album_name ? ` (${s.album_name})` : ""}`
    ).join("\n");

    const systemPrompt = `You are Tempo, a premium music curation engine. Your job is to transform a user's liked songs into a set of beautifully curated playlists. Each playlist must feel intentional, coherent, and expressive — like it was hand-crafted by a music-savvy curator.

CRITICAL PRINCIPLES:
1. Group songs by REAL MUSICAL COMPATIBILITY — not genre labels. Two rap songs can belong in completely different playlists based on mood, production, atmosphere, and energy.
2. Analyze across 15+ dimensions: mood, atmosphere, tempo, rhythmic feel, energy level, emotional tone, production style, instrumentation, language, era, vocal style, darkness vs brightness, polished vs raw, mainstream vs underground, listening context, overall sonic identity.
3. Each playlist represents a LISTENING MOMENT or SONIC WORLD — not a category.
4. Every song must be in exactly one playlist.
5. Create 5-10 playlists depending on library diversity.

PLAYLIST NAMING — CRITICAL:
Names must feel musical, aesthetic, and premium. They should evoke a feeling or scene.
NEVER use generic names like "Pop Mix", "Rap Songs", "Electronic Tracks", "Indie Vibes".
GOOD examples: "Midnight Drive", "Dark Velvet", "Neon Nights", "Golden Groove", "Soft Horizons", "Velvet Energy", "Sunset Motion", "After Hours", "Electric Pulse", "Ocean Echo", "Silent Heat", "Urban Glow", "Crimson Pulse", "Slow Burn", "Glass Towers"

VIBE DESCRIPTION — CRITICAL:
Each playlist needs a one-line vibe summary (10-20 words) that instantly communicates the playlist's identity.
Examples:
- "Dark atmospheric rap with hypnotic rhythm and late-night energy"
- "Warm soul and funk with uplifting rhythm and smooth vintage energy"
- "Modern electronic pulse with polished production and night-city atmosphere"
- "Calm indie and melodic tracks with warm emotional tone"

AI EXPLANATION:
For each playlist, write 2-3 sentences explaining the sonic thread that connects its songs. This should read like an expert curator explaining their choices.

Return ONLY valid JSON, no markdown.`;

    const userPrompt = `Transform these ${likedSongs.length} liked songs into curated Tempo playlists:

${songList}

Return JSON using the save_playlists function.`;

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
        temperature: 0.8,
        tools: [{
          type: "function",
          function: {
            name: "save_playlists",
            description: "Save the curated playlists generated from the user's liked songs",
            parameters: {
              type: "object",
              properties: {
                playlists: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      name: { type: "string", description: "Evocative, aesthetic playlist name (2-3 words)" },
                      vibe_description: { type: "string", description: "One-line vibe summary, 10-20 words" },
                      ai_explanation: { type: "string", description: "2-3 sentences explaining the sonic thread connecting these songs" },
                      mood_tags: { type: "array", items: { type: "string" }, description: "2-4 mood/vibe tags" },
                      color_hex: { type: "string", description: "Hex color matching the playlist mood" },
                      energy_level: { type: "string", enum: ["low", "medium-low", "medium", "medium-high", "high"] },
                      tempo_range: { type: "string" },
                      era_range: { type: "string" },
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

      // Pick up to 4 cover tracks (songs with images)
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
          analysis_model: "google/gemini-2.5-flash",
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

    console.info(`[analyze-liked-songs] Created ${clusters.length} playlists, assigned ${totalAssigned} tracks`);

    return json({
      success: true,
      clusters_created: clusters.length,
      tracks_analyzed: totalAssigned,
      total_liked_songs: likedSongs.length,
    });
  } catch (e) {
    console.error("analyze-liked-songs error:", e);
    return json({ error: e instanceof Error ? e.message : "Analysis failed" }, 500);
  }
});
