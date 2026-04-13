import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const {
      discoveryMode = "balanced",
      knownSongs = [],
      playlists = [],
      audioProfile,
      tasteSignals,
      clusters = [],
      playlistVibes = [],
      userTasteProfile,
      acceptedHistory = [],
      dismissedHistory = [],
      sampleTracks = [],
    } = await req.json();

    // ── Build rich taste context ──

    let audioSection = "No Spotify audio features available yet.";
    if (audioProfile) {
      audioSection = `AUDIO FINGERPRINT (from ${audioProfile.count} tracks with Spotify audio features):
- Average BPM: ${audioProfile.avgTempo} (range ${audioProfile.tempoRange[0]}–${audioProfile.tempoRange[1]})
- Average Energy: ${audioProfile.avgEnergy} (range ${audioProfile.energyRange[0]}–${audioProfile.energyRange[1]})
- Average Valence: ${audioProfile.avgValence}
- Average Danceability: ${audioProfile.avgDanceability}
- Average Acousticness: ${audioProfile.avgAcousticness}
- Average Instrumentalness: ${audioProfile.avgInstrumentalness}
- Average Loudness: ${audioProfile.avgLoudness} dB
INTERPRETATION: ${audioProfile.avgEnergy > 0.65 ? "High-energy listener" : audioProfile.avgEnergy < 0.35 ? "Low-energy / ambient preference" : "Mid-energy range"}. ${audioProfile.avgValence > 0.6 ? "Tends toward upbeat, positive music" : audioProfile.avgValence < 0.35 ? "Gravitates toward melancholic, darker tones" : "Balanced emotional range"}. ${audioProfile.avgDanceability > 0.65 ? "Strong rhythmic / danceable preference" : "Varied rhythmic preferences"}. ${audioProfile.avgAcousticness > 0.5 ? "Leans acoustic/organic" : "Prefers electronic/produced sound"}.`;
    }

    let tasteSection = "";
    if (tasteSignals) {
      tasteSection = `TASTE DNA:
- Top genres: ${tasteSignals.topGenres?.join(", ") || "unknown"}
- Top moods: ${tasteSignals.topMoods?.join(", ") || "unknown"}
- Top atmospheres: ${tasteSignals.topAtmospheres?.join(", ") || "unknown"}
- Production styles: ${tasteSignals.topProductionStyles?.join(", ") || "unknown"}
- Preferred eras: ${tasteSignals.topEras?.join(", ") || "mixed"}
- Most listened artists: ${tasteSignals.topArtists?.join(", ") || "unknown"}`;
    }

    let clusterSection = "";
    if (clusters.length > 0) {
      clusterSection = `\nTEMPO-GENERATED SONIC CLUSTERS (from liked songs analysis):
${clusters.map((c: any) => `- "${c.name}" — ${c.vibe || "no description"} | Energy: ${c.energy || "?"} | Tempo: ${c.tempo || "?"} | Era: ${c.era || "?"} | ${c.trackCount} tracks | Moods: ${(c.moods || []).join(", ")}`).join("\n")}`;
    }

    let vibeSection = "";
    if (playlistVibes.length > 0) {
      vibeSection = `\nPLAYLIST VIBE IDENTITIES (AI-analyzed):
${playlistVibes.map((v: any) => `- Primary: "${v.primaryVibe}" | Mood: ${v.moodSummary || "?"} | Energy: ${v.energySummary || "?"} | Production: ${v.productionSummary || "?"} | Context: ${v.listeningContext || "?"} | Keywords: ${(v.emotionalKeywords || []).join(", ")}`).join("\n")}`;
    }

    let sampleSection = "";
    if (sampleTracks.length > 0) {
      sampleSection = `\nSAMPLE TRACKS FROM LIBRARY (with audio features):
${sampleTracks.slice(0, 25).map((t: any) => {
  const parts = [`"${t.title}" by ${t.artist}`];
  if (t.mood) parts.push(`mood:${t.mood}`);
  if (t.atmosphere) parts.push(`atm:${t.atmosphere}`);
  if (t.production) parts.push(`prod:${t.production}`);
  if (t.tempo) parts.push(`${t.tempo}BPM`);
  if (t.audioEnergy != null) parts.push(`E:${t.audioEnergy}`);
  if (t.valence != null) parts.push(`V:${t.valence}`);
  if (t.danceability != null) parts.push(`D:${t.danceability}`);
  if (t.acousticness != null) parts.push(`A:${t.acousticness}`);
  return `- ${parts.join(" | ")}`;
}).join("\n")}`;
    }

    let feedbackSection = "";
    if (acceptedHistory.length > 0) {
      feedbackSection += `\nPREVIOUSLY ACCEPTED (user liked these — find similar sonic qualities):
${acceptedHistory.map((s: any) => `- "${s.title}" by ${s.artist}`).join("\n")}`;
    }
    if (dismissedHistory.length > 0) {
      feedbackSection += `\nPREVIOUSLY DISMISSED (user rejected — AVOID similar artists/styles):
${dismissedHistory.map((s: any) => `- "${s.title}" by ${s.artist}`).join("\n")}`;
    }

    let profileSection = "";
    if (userTasteProfile) {
      profileSection = `\nTASTE PROFILE STATS:
- Preferred tempo: ${userTasteProfile.preferred_tempo_min || 60}–${userTasteProfile.preferred_tempo_max || 140} BPM
- Preferred energy: ${userTasteProfile.preferred_energy_min || 0.2}–${userTasteProfile.preferred_energy_max || 0.8}
- ${userTasteProfile.accepted_count || 0} accepted / ${userTasteProfile.dismissed_count || 0} dismissed overall`;
    }

    const playlistList = playlists.map((p: any) => `- "${p.name}" (${p.trackCount} tracks): ${p.description}`).join("\n");
    const knownExclude = knownSongs.slice(0, 400).map((s: any) => `"${s.title}" by ${s.artist}`).join(", ");

    const modeInstructions: Record<string, string> = {
      balanced: "Mix of close matches and slightly exploratory picks. 60% familiar sonic territory, 40% adjacent discovery.",
      "deep-cuts": "Focus on album tracks, B-sides, lesser-known catalog songs. Avoid singles and hits entirely. Prioritize deep-cut popularity tier.",
      underground: "Independent labels, unsigned artists, SoundCloud/Bandcamp discoveries. Maximum novelty. All picks should be deep-cuts.",
      exploratory: "Genre-adjacent discoveries. Songs from genres the user hasn't explored but that share sonic DNA with their library. Push boundaries while maintaining compatibility.",
      nostalgic: "Songs from similar eras to the user's library. Classic sounds, vintage production. Time-appropriate discoveries.",
      "new-releases": "Released in the last 12 months. Fresh but compatible with the user's taste.",
    };

    const systemPrompt = `You are Tempo's elite discovery AI — a deeply musical curator who has internalized this listener's entire sonic identity.

YOUR CORE MISSION: Surface songs the user has NEVER heard that feel like they were made for them.

CRITICAL RULES:
1. NEVER recommend any song from the exclusion list — these are songs the user already knows
2. NEVER recommend based on streaming popularity or chart position
3. NEVER recommend more than 1 song per artist across ALL categories
4. NEVER use generic explanations — every insight must reference concrete audio characteristics
5. Prefer album tracks over singles, B-sides over hits, deep catalog over greatest hits
6. Each recommendation must feel intentional and personally curated, not algorithmic
7. Maintain diversity: vary tempo, energy, mood, and era across recommendations
8. At least 40% of recommendations should be "deep-cut" popularity tier

DISCOVERY MODE: "${discoveryMode}" — ${modeInstructions[discoveryMode] || modeInstructions.balanced}

COMPATIBILITY SCORING WEIGHTS:
- Sonic texture & production similarity: 20%
- Mood / emotional tone alignment: 20%
- Tempo & rhythm compatibility: 15%
- Energy level fit: 15%
- Genre proximity (subgenre level): 10%
- Artist network / scene adjacency: 10%
- Novelty bonus (how fresh/unknown): 10%

EXPLANATION QUALITY:
Each aiExplanation must be 2-3 sentences that reference SPECIFIC musical qualities:
- Name exact BPM ranges, energy levels, production techniques
- Reference specific moods, textures, vocal qualities
- Connect to the user's actual listening patterns
- Example: "At 87 BPM with breathy vocals over reverb-drenched guitar, this mirrors the late-night atmospheric pocket in your library. The lo-fi tape saturation and minor-key progressions echo your strongest sonic cluster."
- NEVER say "fits your vibe" or "matches your taste" without specifics`;

    const userPrompt = `USER'S COMPLETE TASTE PROFILE:

${audioSection}

${tasteSection}
${clusterSection}
${vibeSection}
${sampleSection}
${feedbackSection}
${profileSection}

USER'S PLAYLISTS:
${playlistList || "No playlists yet"}

SONGS TO EXCLUDE (user already knows these — do NOT recommend any):
${knownExclude}

Generate discovery recommendations using the save_recommendations tool. Categories:
1. "best-for-you" — 3 songs perfectly matching taste DNA
2. "hidden-gems" — 3 underground/overlooked tracks matching sonic preferences
3. "sonic-neighbors" — 3 songs from artists/scenes adjacent to the user's taste
4. "perfect-for-your-playlists" — 3 songs, each targeting a specific existing playlist (set targetPlaylistId and targetPlaylistName)
5. "try-something-different" — 2 genre-adjacent surprises the user might love

Available playlist IDs: ${playlists.map((p: any) => `"${p.id}" (${p.name})`).join(", ") || "none"}`;

    const tools = [
      {
        type: "function",
        function: {
          name: "save_recommendations",
          description: "Save the curated discovery recommendations",
          parameters: {
            type: "object",
            properties: {
              categories: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    id: { type: "string" },
                    title: { type: "string" },
                    subtitle: { type: "string" },
                    recommendations: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          title: { type: "string" },
                          artist: { type: "string" },
                          album: { type: "string" },
                          year: { type: "integer" },
                          genre: { type: "string" },
                          tempo: { type: "number" },
                          energy: { type: "number" },
                          valence: { type: "number" },
                          danceability: { type: "number" },
                          acousticness: { type: "number" },
                          mood: { type: "string" },
                          matchScore: { type: "integer" },
                          reason: { type: "string" },
                          aiExplanation: { type: "string" },
                          moodTags: { type: "array", items: { type: "string" } },
                          popularityTier: { type: "string", enum: ["deep-cut", "mid", "well-known"] },
                          targetPlaylistId: { type: "string" },
                          targetPlaylistName: { type: "string" },
                          compatibilityBreakdown: {
                            type: "object",
                            properties: {
                              mood: { type: "integer" },
                              tempo: { type: "integer" },
                              energy: { type: "integer" },
                              genre: { type: "integer" },
                              production: { type: "integer" },
                              rhythm: { type: "integer" },
                              novelty: { type: "integer" },
                            },
                            required: ["mood", "tempo", "energy", "genre", "production", "rhythm", "novelty"],
                          },
                        },
                        required: ["title", "artist", "album", "matchScore", "reason", "aiExplanation", "moodTags", "popularityTier", "compatibilityBreakdown"],
                      },
                    },
                  },
                  required: ["id", "title", "subtitle", "recommendations"],
                },
              },
            },
            required: ["categories"],
          },
        },
      },
    ];

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
        tools,
        tool_choice: { type: "function", function: { name: "save_recommendations" } },
        temperature: 0.9,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      console.error("AI gateway error:", response.status, text);
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded. Please try again in a moment." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted. Please add funds." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      throw new Error(`AI gateway error: ${response.status}`);
    }

    const data = await response.json();
    
    // Extract from tool call
    let parsed: any;
    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
    if (toolCall?.function?.arguments) {
      try {
        parsed = typeof toolCall.function.arguments === "string"
          ? JSON.parse(toolCall.function.arguments)
          : toolCall.function.arguments;
      } catch {
        console.error("Failed to parse tool call args:", toolCall.function.arguments);
        throw new Error("Failed to parse AI tool call response");
      }
    } else {
      // Fallback to content parsing
      const content = data.choices?.[0]?.message?.content;
      if (!content) throw new Error("No content in AI response");
      try {
        parsed = JSON.parse(content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim());
      } catch {
        console.error("Failed to parse AI content:", content);
        throw new Error("Failed to parse AI recommendations");
      }
    }

    return new Response(JSON.stringify(parsed), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("discover-recommendations error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
