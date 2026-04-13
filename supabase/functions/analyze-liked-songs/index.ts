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
      .select("id, spotify_track_id, track_name, artist_name, album_name, image_url, audio_tempo, audio_energy, audio_valence, audio_danceability, audio_acousticness, audio_instrumentalness, audio_speechiness, audio_loudness, audio_liveness")
      .eq("user_id", user.id)
      .order("added_at", { ascending: false })
      .limit(200);

    if (lsError) return json({ error: lsError.message }, 500);
    if (!likedSongs || likedSongs.length === 0) {
      return json({ error: "No liked songs found. Import your Spotify library first." }, 400);
    }

    const hasAudioFeatures = likedSongs.filter(s => s.audio_energy != null).length;
    console.info(`[analyze-liked-songs] Analyzing ${likedSongs.length} songs (${hasAudioFeatures} with audio features) for user ${user.id}`);

    const songList = likedSongs.map((s, i) =>
      `${i + 1}. "${s.track_name}" – ${s.artist_name}${s.album_name ? ` (${s.album_name})` : ""}${formatAudioFeatures(s)}`
    ).join("\n");

    const systemPrompt = `You are Tempo, a premium music intelligence engine that clusters songs based on how they ACTUALLY SOUND, not genre labels.

CRITICAL: You are provided with Spotify audio features for each song. These MUST be your PRIMARY clustering signals:
- **tempo (BPM)**: Group songs with similar BPM ranges together. Never mix 70 BPM ballads with 140 BPM bangers.
- **energy (0-1)**: How intense/active the track sounds. 0.9 energy tracks don't belong with 0.2 energy tracks.
- **valence (0-1)**: Musical positivity. 0.1 = dark/sad, 0.9 = happy/uplifting. Don't mix extremes.
- **danceability (0-1)**: Rhythmic groove. High = danceable, low = ambient/freeform.
- **acousticness (0-1)**: Acoustic vs electronic. Don't mix 0.9 acoustic with 0.05 electronic unless vibe matches.
- **instrumentalness (0-1)**: Vocal vs instrumental focus.
- **speechiness (0-1)**: Spoken word density.
- **loudness (dB)**: Overall volume/compression level.
- **liveness (0-1)**: Live performance feel.

CLUSTERING ALGORITHM:
1. First, sort songs by energy + valence to find natural groupings.
2. Then refine by tempo similarity (±15 BPM within a cluster).
3. Then validate by acousticness/danceability compatibility.
4. Genre is ONLY a weak tiebreaker — never the primary signal.

COHERENCE RULES:
- Energy variance within a cluster must be < 0.35 (e.g., 0.4-0.75 OK, 0.2-0.9 NOT OK)
- Valence variance within a cluster must be < 0.4
- Tempo range within a cluster should be < 30 BPM (unless the vibe clearly works across tempos)
- If a cluster violates these, split it into smaller playlists

PLAYLIST NAMING:
Names must be evocative, aesthetic, 2-3 words. Reflect the SONIC CHARACTER, not genre.
GOOD: "Midnight Drive", "Dark Velvet", "Golden Groove", "Soft Horizon", "Electric Pulse", "After Hours", "Neon Nights"
BAD: "Pop Mix", "Rap Songs", "Rock Playlist", "Electronic Tracks"

Create 5-12 playlists. Every song must appear in exactly one playlist.

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
        temperature: 0.7,
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
                      tempo_range: { type: "string", description: "e.g. '85-100 BPM'" },
                      era_range: { type: "string" },
                      avg_energy: { type: "number", description: "Average energy value of songs in this cluster" },
                      avg_valence: { type: "number", description: "Average valence value of songs in this cluster" },
                      avg_tempo: { type: "number", description: "Average BPM of songs in this cluster" },
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

    console.info(`[analyze-liked-songs] Created ${clusters.length} playlists, assigned ${totalAssigned} tracks (${hasAudioFeatures} had audio features)`);

    return json({
      success: true,
      clusters_created: clusters.length,
      tracks_analyzed: totalAssigned,
      tracks_with_audio_features: hasAudioFeatures,
      total_liked_songs: likedSongs.length,
    });
  } catch (e) {
    console.error("analyze-liked-songs error:", e);
    return json({ error: e instanceof Error ? e.message : "Analysis failed" }, 500);
  }
});
