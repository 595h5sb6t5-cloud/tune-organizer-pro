import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function extractJson(raw: string): any {
  let cleaned = raw.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
  const start = cleaned.search(/[\{\[]/);
  if (start === -1) throw new Error("No JSON found in response");
  cleaned = cleaned.substring(start);

  const root = cleaned[0];
  const rootClose = root === "[" ? "]" : "}";
  let depth = 0;
  let inString = false;
  let escape = false;
  let end = -1;

  for (let i = 0; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === "\\") {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === root) depth++;
    if (ch === rootClose) {
      depth--;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }

  if (end !== -1) {
    cleaned = cleaned.slice(0, end);
  }

  try {
    return JSON.parse(cleaned);
  } catch {
    // Continue into repair mode for truncated / malformed JSON.
  }

  const opens = { "{": 0, "[": 0 };
  inString = false;
  escape = false;

  for (const ch of cleaned) {
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === "\\") {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === "{") opens["{"]++;
    if (ch === "}") opens["{"]--;
    if (ch === "[") opens["["]++;
    if (ch === "]") opens["["]--;
  }

  if (inString) cleaned += '"';

  cleaned = cleaned
    .replace(/,\s*"[^"]*"?\s*:?\s*"?[^"]*$/, "")
    .replace(/,\s*\{[^}]*$/, "")
    .replace(/,\s*\[[^\]]*$/, "")
    .replace(/,\s*$/, "");

  for (let i = 0; i < opens["["]; i++) cleaned += "]";
  for (let i = 0; i < opens["{"]; i++) cleaned += "}";

  cleaned = cleaned
    .replace(/[\x00-\x1F\x7F]/g, " ")
    .replace(/,\s*}/g, "}")
    .replace(/,\s*]/g, "]");

  return JSON.parse(cleaned);
}

function parseJsonLike(value: unknown): any {
  if (value == null) throw new Error("AI response was empty");
  if (typeof value !== "string") return value;

  const trimmed = value.trim();
  if (!trimmed) throw new Error("AI response was empty");

  try {
    const parsed = JSON.parse(trimmed);
    return typeof parsed === "string" ? parseJsonLike(parsed) : parsed;
  } catch {
    return extractJson(trimmed);
  }
}

function sanitizeCategories(categories: any[]): any[] {
  return categories
    .filter((category: any) => category && typeof category === "object")
    .map((category: any, index: number) => ({
      id: typeof category.id === "string" && category.id.trim() ? category.id : `category-${index + 1}`,
      title: typeof category.title === "string" && category.title.trim() ? category.title : `Recommendations ${index + 1}`,
      subtitle: typeof category.subtitle === "string" ? category.subtitle : "",
      recommendations: Array.isArray(category.recommendations)
        ? category.recommendations.filter((recommendation: any) => recommendation && typeof recommendation === "object")
        : [],
    }));
}

function normalizeRecommendationsPayload(parsed: any): { categories: any[] } | null {
  if (Array.isArray(parsed)) {
    return { categories: sanitizeCategories(parsed) };
  }

  const candidates = [parsed, parsed?.arguments, parsed?.data, parsed?.result];
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "object") continue;

    if (Array.isArray(candidate.categories)) {
      return { categories: sanitizeCategories(candidate.categories) };
    }

    if (Array.isArray(candidate.recommendations)) {
      return {
        categories: sanitizeCategories([{
          id: typeof candidate.id === "string" ? candidate.id : "for-you",
          title: typeof candidate.title === "string" ? candidate.title : "For You",
          subtitle: typeof candidate.subtitle === "string" ? candidate.subtitle : "Fresh picks selected for your taste",
          recommendations: candidate.recommendations,
        }]),
      };
    }
  }

  return null;
}

function previewValue(value: unknown): string {
  if (typeof value === "string") return value.slice(0, 300);
  try {
    return JSON.stringify(value).slice(0, 300);
  } catch {
    return String(value).slice(0, 300);
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
    if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not configured");

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
- Most listened artists: ${tasteSignals.topArtists?.join(", ") || "unknown"}

DEEP SONIC IDENTITY:
- Top groove feels: ${tasteSignals.topGrooveFeels?.join(", ") || "not analyzed yet"}
- Top vocal styles: ${tasteSignals.topVocalStyles?.join(", ") || "not analyzed yet"}
- Sonic brightness preference: ${tasteSignals.topSonicBrightness?.join(", ") || "not analyzed yet"}
- Spatial quality preference: ${tasteSignals.topSpatialQualities?.join(", ") || "not analyzed yet"}
- Rhythmic identity: ${tasteSignals.topRhythmicIdentities?.join(", ") || "not analyzed yet"}
- Sonic textures: ${tasteSignals.topSonicTextures?.join(", ") || "not analyzed yet"}`;
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
      sampleSection = `\nSAMPLE TRACKS FROM LIBRARY (with audio features + deep sonic analysis):
${sampleTracks.slice(0, 25).map((t: any) => {
  const parts = [`"${t.title}" by ${t.artist}`];
  if (t.mood) parts.push(`mood:"${t.mood}"`);
  if (t.grooveFeel) parts.push(`groove:"${t.grooveFeel}"`);
  if (t.sonicBrightness) parts.push(`brightness:${t.sonicBrightness}`);
  if (t.spatialQuality) parts.push(`space:"${t.spatialQuality}"`);
  if (t.rhythmicIdentity) parts.push(`rhythm:"${t.rhythmicIdentity}"`);
  if (t.production) parts.push(`prod:"${t.production}"`);
  if (t.vocalStyle) parts.push(`vocal:"${t.vocalStyle}"`);
  if (t.sonicTexture) parts.push(`texture:"${t.sonicTexture}"`);
  if (t.atmosphere) parts.push(`atm:"${t.atmosphere}"`);
  if (t.listeningContext) parts.push(`context:"${t.listeningContext}"`);
  if (t.intimacyScale) parts.push(`scale:"${t.intimacyScale}"`);
  if (t.tensionLevel) parts.push(`tension:"${t.tensionLevel}"`);
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

YOUR CORE MISSION: Surface songs the user has NEVER heard that feel like they were made for them. Every recommendation must pass strict multi-dimensional SONIC WORLD compatibility checks.

═══════════════════════════════════════════════════════
CRITICAL RULES:
═══════════════════════════════════════════════════════
1. NEVER recommend any song from the exclusion list — these are songs the user already knows
2. NEVER recommend based on streaming popularity or chart position
3. NEVER recommend more than 1 song per artist across ALL categories
4. NEVER use generic explanations — every insight must reference concrete sonic qualities
5. Prefer album tracks over singles, B-sides over hits, deep catalog over greatest hits
6. Each recommendation must feel intentional and personally curated, not algorithmic
7. Maintain diversity: vary tempo, energy, mood, and era across recommendations
8. At least 40% of recommendations should be "deep-cut" popularity tier

═══════════════════════════════════════════════════════
SONIC WORLD COMPATIBILITY (PRIMARY — not genre/BPM):
═══════════════════════════════════════════════════════
Every recommendation must share the same SONIC WORLD as the user's taste. This means:
1. **Groove & rhythmic feel** — Same groove pocket, swing character, rhythmic density. NOT just similar BPM.
2. **Production identity** — Same production philosophy (lo-fi/hi-fi, analog/digital, warm/cold, raw/polished)
3. **Sonic texture & brightness** — Same tonal palette (dark/bright, warm/cold, gritty/clean)
4. **Spatial quality** — Same spatial scale (intimate/wide, close/reverberant, dense/sparse)
5. **Mood & emotional shade** — Same SPECIFIC emotional tone, not broad categories
6. **Vocal texture** — Compatible vocal delivery and treatment
7. **Tension behavior** — Similar tension/release patterns
8. **Atmosphere** — Same environmental/spatial feeling
9. **Listening context** — Would work in the same listening moment

Genre and BPM are WEAK supporting signals — they must NEVER override sonic world compatibility.

═══════════════════════════════════════════════════════
LANGUAGE RULES — CRITICAL:
═══════════════════════════════════════════════════════
- Analyze the user's library to detect their primary listening language(s).
- If the user primarily listens in English, recommend English songs by default.
- If the user primarily listens in Spanish, recommend Spanish songs by default.
- Do NOT casually mix languages unless the user's library is already multilingual.
- For "perfect-for-your-playlists", MATCH the language of the target playlist.
- For "try-something-different", you may cross languages only if the sonic world is compelling.

═══════════════════════════════════════════════════════
DISCOVERY MODE: "${discoveryMode}" — ${modeInstructions[discoveryMode] || modeInstructions.balanced}
═══════════════════════════════════════════════════════

COMPATIBILITY SCORING WEIGHTS:
- Groove & rhythmic feel: 20%
- Production identity & sonic texture: 20%
- Mood & emotional tone alignment: 20%
- Spatial quality & atmosphere: 10%
- Energy & tension behavior: 10%
- Language compatibility: 10%
- Novelty bonus (how fresh/unknown): 10%
- Genre proximity: 0% (genre is NOT scored — it's a byproduct of sonic compatibility)

EXPLANATION QUALITY:
Each aiExplanation must be 2-3 sentences that reference SPECIFIC musical qualities:
- Name groove feel, production techniques, spatial qualities, vocal textures
- Reference specific moods, atmospheres, sonic worlds
- Connect to the user's actual listening patterns
- NEVER say "fits your vibe" or "matches your taste" without naming the exact sonic dimension`;

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
${playlists.length > 0 ? `4. "perfect-for-your-playlists" — 3 songs, each targeting a specific existing playlist (set targetPlaylistId and targetPlaylistName)\n5. "try-something-different" — 2 genre-adjacent surprises the user might love\n\nAvailable playlist IDs: ${playlists.map((p: any) => `"${p.id}" (${p.name})`).join(", ")}` : `4. "try-something-different" — 3 genre-adjacent surprises the user might love`}

IMPORTANT: You MUST call the save_recommendations function with your results. Do NOT respond with text.`;

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
                              mood: { type: "integer", description: "Emotional tone alignment 0-100" },
                              groove: { type: "integer", description: "Rhythmic feel & groove compatibility 0-100" },
                              energy: { type: "integer", description: "Energy & tension behavior fit 0-100" },
                              production: { type: "integer", description: "Production identity & sonic texture 0-100" },
                              atmosphere: { type: "integer", description: "Spatial quality & atmosphere 0-100" },
                              rhythm: { type: "integer", description: "Rhythmic identity compatibility 0-100" },
                              novelty: { type: "integer", description: "How fresh/unknown this pick is 0-100" },
                            },
                            required: ["mood", "groove", "energy", "production", "atmosphere", "rhythm", "novelty"],
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

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        tools,
        tool_choice: { type: "function", function: { name: "save_recommendations" } },
        temperature: 0.7,
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

    const message = data.choices?.[0]?.message ?? {};
    const toolArgs = message.tool_calls?.[0]?.function?.arguments;
    const content = typeof message.content === "string"
      ? message.content
      : Array.isArray(message.content)
        ? message.content
            .map((part: any) => typeof part?.text === "string" ? part.text : "")
            .join("\n")
        : "";

    let parsed: { categories: any[] } | null = null;
    for (const source of [toolArgs, content]) {
      if (!source) continue;

      try {
        const candidate = normalizeRecommendationsPayload(parseJsonLike(source));
        if (candidate) {
          parsed = candidate;
          break;
        }
      } catch (error) {
        console.warn("Failed to parse AI recommendation payload source:", {
          sourceType: typeof source,
          preview: previewValue(source),
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (!parsed) {
      console.warn("Unable to parse AI recommendations; returning empty categories", {
        hasToolCall: Boolean(toolArgs),
        hasContent: Boolean(content),
        finishReason: data.choices?.[0]?.finish_reason ?? null,
      });
      parsed = { categories: [] };
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
