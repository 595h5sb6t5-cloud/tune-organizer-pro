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
      .limit(300);

    if (lsError) return json({ error: lsError.message }, 500);
    if (!likedSongs || likedSongs.length === 0) {
      return json({ error: "No liked songs found. Import your Spotify library first." }, 400);
    }

    console.info(`[analyze-liked-songs] Analyzing ${likedSongs.length} songs for user ${user.id}`);

    // Build song list for AI
    const songList = likedSongs.map((s, i) =>
      `${i + 1}. "${s.track_name}" by ${s.artist_name} (Album: ${s.album_name || "Unknown"})`
    ).join("\n");

    const systemPrompt = `You are an elite music intelligence system for Tempo, a personal music library app. Your job is to deeply analyze a user's liked songs and organize them into coherent musical clusters.

CRITICAL RULES:
1. DO NOT cluster by simple genre labels. Two rap songs can belong to completely different clusters based on mood, production, era, and atmosphere.
2. Each cluster should represent a LISTENING MOMENT or SONIC IDENTITY — not a genre.
3. Analyze each song across: genre, subgenre, tempo, rhythmic feel, energy level, mood, atmosphere, emotional tone, production style, instrumentation, language, era, vocal style, intensity, listening context, mainstream vs underground, polished vs raw, dark vs bright.
4. Create 5-10 clusters depending on library diversity.
5. Every song MUST be assigned to exactly one cluster.
6. Cluster names should be evocative and personal — like playlist names a music-savvy friend would create.
7. Each cluster must have a rich description explaining the sonic thread that connects the songs.

For each song, provide a brief analysis of its key musical qualities.

Return ONLY valid JSON, no markdown fences.`;

    const userPrompt = `Analyze and organize these ${likedSongs.length} liked songs into intelligent clusters:

${songList}

Return this exact JSON structure:
{
  "clusters": [
    {
      "name": "Evocative cluster name",
      "description": "2-3 sentence explanation of what connects these songs musically",
      "vibe_description": "One sentence that captures the feeling of this cluster",
      "mood_tags": ["Tag1", "Tag2", "Tag3"],
      "color_hex": "#hexcolor",
      "energy_level": "low | medium-low | medium | medium-high | high",
      "tempo_range": "60-80 BPM | 80-100 BPM | 100-120 BPM | 120-140 BPM | 140+ BPM",
      "era_range": "1960s-1980s | 1980s-2000s | 2000s-2020s | Mixed",
      "songs": [
        {
          "index": 1,
          "analysis": {
            "genre_tags": ["Genre1", "Subgenre"],
            "mood": "Primary mood",
            "energy": "low | medium | high",
            "tempo_estimate": "slow | mid-tempo | upbeat | fast",
            "era": "1970s | 1980s | 1990s | 2000s | 2010s | 2020s",
            "atmosphere": "dark | warm | bright | ethereal | gritty | smooth",
            "production_style": "lo-fi | polished | live | electronic | organic | hybrid"
          }
        }
      ]
    }
  ]
}

IMPORTANT:
- Use evocative, non-generic cluster names (NOT "Pop Songs" or "Hip Hop")
- Good examples: "Midnight Drive Soundtracks", "Sun-Soaked Grooves", "Velvet Soul Sessions", "Electronic Dreamscapes"
- Choose distinct color_hex values for each cluster that match its mood
- Every song must appear in exactly one cluster (reference by its index number from the list above)`;

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
    const content = aiData.choices?.[0]?.message?.content;
    if (!content) return json({ error: "Empty AI response" }, 500);

    let parsed: any;
    try {
      const cleaned = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      parsed = JSON.parse(cleaned);
    } catch {
      console.error("Failed to parse AI response:", content.substring(0, 500));
      return json({ error: "Failed to parse AI analysis" }, 500);
    }

    if (!parsed.clusters || !Array.isArray(parsed.clusters)) {
      return json({ error: "Invalid AI response structure" }, 500);
    }

    // Clear previous clusters for this user
    await admin.from("liked_song_cluster_tracks").delete().eq("user_id", user.id);
    await admin.from("liked_song_clusters").delete().eq("user_id", user.id);

    // Create clusters and assignments
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

      // Assign songs to cluster
      const trackAssignments: any[] = [];
      for (const song of songs) {
        const idx = (song.index || 0) - 1; // Convert 1-indexed to 0-indexed
        if (idx < 0 || idx >= likedSongs.length) continue;

        const likedSong = likedSongs[idx];
        trackAssignments.push({
          user_id: user.id,
          cluster_id: insertedCluster.id,
          liked_song_id: likedSong.id,
          spotify_track_id: likedSong.spotify_track_id,
          confidence_score: 0.85,
        });

        // Update song analysis
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
