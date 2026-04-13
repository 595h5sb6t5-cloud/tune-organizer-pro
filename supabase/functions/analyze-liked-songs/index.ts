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

/** Attempt to extract and repair JSON from potentially truncated AI output */
function extractJson(raw: string): any {
  let cleaned = raw.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();

  // Find JSON boundaries
  const start = cleaned.search(/[\{\[]/);
  if (start === -1) throw new Error("No JSON found in response");

  cleaned = cleaned.substring(start);

  // Try direct parse first
  try { return JSON.parse(cleaned); } catch { /* continue */ }

  // Detect and repair truncation — close unclosed brackets/braces
  const opens = { '{': 0, '[': 0 };
  let inString = false;
  let escape = false;
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

  // If we're inside a string, close it
  if (inString) cleaned += '"';

  // Remove trailing comma and incomplete key/value
  cleaned = cleaned.replace(/,\s*"[^"]*"?\s*:?\s*"?[^"]*$/, '');
  cleaned = cleaned.replace(/,\s*\{[^}]*$/, '');
  cleaned = cleaned.replace(/,\s*$/, '');

  // Close unclosed structures
  for (let i = 0; i < opens['[']; i++) cleaned += ']';
  for (let i = 0; i < opens['{']; i++) cleaned += '}';

  // Clean control characters and trailing commas
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

    // Fetch liked songs
    const { data: likedSongs, error: lsError } = await supabase
      .from("liked_songs")
      .select("id, spotify_track_id, track_name, artist_name, album_name")
      .eq("user_id", user.id)
      .order("added_at", { ascending: false })
      .limit(200);

    if (lsError) return json({ error: lsError.message }, 500);
    if (!likedSongs || likedSongs.length === 0) {
      return json({ error: "No liked songs found. Import your Spotify library first." }, 400);
    }

    console.info(`[analyze-liked-songs] Analyzing ${likedSongs.length} songs for user ${user.id}`);

    // Build compact song list
    const songList = likedSongs.map((s, i) =>
      `${i + 1}. "${s.track_name}" – ${s.artist_name}${s.album_name ? ` (${s.album_name})` : ""}`
    ).join("\n");

    const systemPrompt = `You are an elite music intelligence system. Analyze liked songs and organize them into coherent musical clusters based on SONIC IDENTITY, not genre labels.

RULES:
- 5-10 clusters based on library diversity
- Cluster by listening moment / sonic identity, NOT genre
- Every song assigned to exactly one cluster (by its index number)
- Evocative cluster names like "Midnight Drive Soundtracks", not "Pop Songs"
- For song analysis, keep values brief — single words or short phrases
- Return ONLY valid JSON, no markdown`;

    const userPrompt = `Organize these ${likedSongs.length} liked songs into clusters:

${songList}

Return JSON:
{
  "clusters": [
    {
      "name": "Evocative name",
      "description": "What connects these songs",
      "vibe_description": "One sentence feeling",
      "mood_tags": ["Tag1", "Tag2"],
      "color_hex": "#hexcolor",
      "energy_level": "low|medium-low|medium|medium-high|high",
      "tempo_range": "e.g. 80-100 BPM",
      "era_range": "e.g. 2000s-2020s",
      "songs": [
        {"index": 1, "analysis": {"genre_tags": ["Genre"], "mood": "mood", "energy": "low|medium|high", "tempo_estimate": "slow|mid-tempo|upbeat|fast", "era": "2020s", "atmosphere": "dark|warm|bright", "production_style": "lo-fi|polished|electronic"}}
      ]
    }
  ]
}

Every song (1 to ${likedSongs.length}) must appear in exactly one cluster.`;

    // Use tool calling for structured output to avoid truncation
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
            name: "save_clusters",
            description: "Save the analyzed song clusters",
            parameters: {
              type: "object",
              properties: {
                clusters: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      name: { type: "string" },
                      description: { type: "string" },
                      vibe_description: { type: "string" },
                      mood_tags: { type: "array", items: { type: "string" } },
                      color_hex: { type: "string" },
                      energy_level: { type: "string" },
                      tempo_range: { type: "string" },
                      era_range: { type: "string" },
                      songs: {
                        type: "array",
                        items: {
                          type: "object",
                          properties: {
                            index: { type: "number" },
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
                              required: ["mood", "energy"],
                            },
                          },
                          required: ["index"],
                        },
                      },
                    },
                    required: ["name", "description", "songs"],
                  },
                },
              },
              required: ["clusters"],
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "save_clusters" } },
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

    // Try tool call first, then fall back to content
    let parsed: any;
    const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];
    if (toolCall?.function?.arguments) {
      try {
        parsed = JSON.parse(toolCall.function.arguments);
      } catch {
        console.warn("Tool call JSON parse failed, attempting repair");
        parsed = extractJson(toolCall.function.arguments);
      }
    } else {
      const content = aiData.choices?.[0]?.message?.content;
      if (!content) return json({ error: "Empty AI response" }, 500);
      parsed = extractJson(content);
    }

    if (!parsed.clusters || !Array.isArray(parsed.clusters)) {
      return json({ error: "Invalid AI response structure" }, 500);
    }

    // Clear previous clusters
    await admin.from("liked_song_cluster_tracks").delete().eq("user_id", user.id);
    await admin.from("liked_song_clusters").delete().eq("user_id", user.id);

    let totalAssigned = 0;

    for (let ci = 0; ci < parsed.clusters.length; ci++) {
      const cluster = parsed.clusters[ci];
      const songs = cluster.songs || [];

      const { data: insertedCluster, error: clusterError } = await admin
        .from("liked_song_clusters")
        .insert({
          user_id: user.id,
          name: cluster.name || `Cluster ${ci + 1}`,
          description: cluster.description || null,
          vibe_description: cluster.vibe_description || null,
          mood_tags: cluster.mood_tags || [],
          color_hex: cluster.color_hex || "#6366f1",
          energy_level: cluster.energy_level || "medium",
          tempo_range: cluster.tempo_range || "Mixed",
          era_range: cluster.era_range || "Mixed",
          track_count: songs.length,
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

    console.info(`[analyze-liked-songs] Created ${parsed.clusters.length} clusters, assigned ${totalAssigned} tracks`);

    return json({
      success: true,
      clusters_created: parsed.clusters.length,
      tracks_analyzed: totalAssigned,
      total_liked_songs: likedSongs.length,
    });
  } catch (e) {
    console.error("analyze-liked-songs error:", e);
    return json({ error: e instanceof Error ? e.message : "Analysis failed" }, 500);
  }
});
