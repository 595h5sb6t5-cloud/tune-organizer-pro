import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const {
      playlistName,
      playlistMood,
      playlistDescription,
      tracks,
      discoveryMode = "balanced",
      acceptedSongs = [],
      dismissedSongs = [],
      existingLibrary = [],
      userTasteProfile = null,
      vibeContext = null,
      count = 8,
    } = await req.json();

    if (!playlistName || !tracks || !Array.isArray(tracks)) {
      return new Response(
        JSON.stringify({ error: "playlistName and tracks array are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const trackList = tracks.slice(0, 60).map((t: any, i: number) =>
      `${i + 1}. "${t.title}" by ${t.artist}`
    ).join("\n");

    const artists = [...new Set(tracks.map((t: any) => t.artist))].join(", ");

    // Build vibe context section — this is the real intelligence
    let vibeSection = "";
    if (vibeContext) {
      vibeSection = `
PLAYLIST IDENTITY (analyzed by Tempo AI — treat as ground truth):
Primary Identity: ${vibeContext.primaryVibe}
${vibeContext.secondaryVibes?.length ? `Sub-identities: ${vibeContext.secondaryVibes.join(", ")}` : ""}
${vibeContext.moodSummary ? `Emotional Landscape: ${vibeContext.moodSummary}` : ""}
${vibeContext.energySummary ? `Energy Profile: ${vibeContext.energySummary}` : ""}
${vibeContext.productionSummary ? `Production DNA: ${vibeContext.productionSummary}` : ""}
${vibeContext.structuralFlow ? `Playlist Arc: ${vibeContext.structuralFlow}` : ""}
${vibeContext.listeningContext ? `Listening Context: ${vibeContext.listeningContext}` : ""}
${vibeContext.whatBelongs ? `WHAT BELONGS HERE: ${vibeContext.whatBelongs}` : ""}
${vibeContext.whatBreaksIt ? `WHAT BREAKS IT (AVOID): ${vibeContext.whatBreaksIt}` : ""}
${vibeContext.cohesionDescription ? `Cohesion Thread: ${vibeContext.cohesionDescription}` : ""}
${vibeContext.sonicPalette?.length ? `Sonic Palette: ${vibeContext.sonicPalette.join(", ")}` : ""}
${vibeContext.emotionalKeywords?.length ? `Emotional Core: ${vibeContext.emotionalKeywords.join(", ")}` : ""}
${vibeContext.sonicDna ? `
Sonic DNA:
  - Key instruments: ${vibeContext.sonicDna.key_instruments?.join(", ") || "N/A"}
  - Vocal character: ${vibeContext.sonicDna.vocal_character || "N/A"}
  - Production school: ${vibeContext.sonicDna.production_school || "N/A"}
  - Spatial quality: ${vibeContext.sonicDna.spatial_quality || "N/A"}
  - Rhythmic identity: ${vibeContext.sonicDna.rhythmic_identity || "N/A"}` : ""}
${vibeContext.genreBlend ? `Genre DNA: ${JSON.stringify(vibeContext.genreBlend)}` : ""}
${vibeContext.emotionalArc?.length ? `Emotional Arc: ${vibeContext.emotionalArc.map((a: any) => `${a.segment}: energy ${a.energy}, ${a.mood}`).join(" → ")}` : ""}`;
    }

    let feedbackContext = "";
    if (acceptedSongs.length > 0) {
      feedbackContext += `\nPreviously ACCEPTED (lean into similar qualities):\n`;
      feedbackContext += acceptedSongs.map((s: any) => `- "${s.title}" by ${s.artist}`).join("\n");
    }
    if (dismissedSongs.length > 0) {
      feedbackContext += `\nPreviously DISMISSED (avoid these artists and similar styles):\n`;
      feedbackContext += dismissedSongs.map((s: any) => `- "${s.title}" by ${s.artist}`).join("\n");
    }

    let tasteContext = "";
    if (userTasteProfile) {
      tasteContext = `\nUSER TASTE PROFILE:
- Genres: ${(userTasteProfile.favorite_genres || []).join(", ") || "N/A"}
- Moods: ${(userTasteProfile.favorite_moods || []).join(", ") || "N/A"}
- Artists: ${(userTasteProfile.favorite_artists || []).join(", ") || "N/A"}
- Tempo: ${userTasteProfile.preferred_tempo_min || 60}–${userTasteProfile.preferred_tempo_max || 140} BPM
- Energy: ${userTasteProfile.preferred_energy_min || 0.2}–${userTasteProfile.preferred_energy_max || 0.8}`;
    }

    const excludeList = [
      ...tracks.map((t: any) => `"${t.title}" by ${t.artist}`),
      ...existingLibrary.slice(0, 300).map((t: any) => `ID:${t.spotifyId}`),
    ].join(", ");

    const discoveryInstructions: Record<string, string> = {
      "safe": "Lean toward recognizable songs that strongly match the playlist identity. 70% well-known, 30% mid-tier.",
      "balanced": "Mix: 2 well-known, 3 mid-tier discoveries, 3 deep cuts. Balance familiarity with surprise.",
      "deep-cuts": "80% deep cuts and underground tracks. The user wants to discover music they've genuinely never heard. Push boundaries while maintaining sonic coherence.",
      "underground": "100% independent and underground. Small labels, Bandcamp, cult favorites. Must still match the playlist's emotional and sonic identity.",
      "new-releases": "Focus on releases from the last 18 months. Emerging artists preferred. Must match the playlist's sonic DNA.",
    };

    const modeInstruction = discoveryInstructions[discoveryMode] || discoveryInstructions["balanced"];

    const systemPrompt = `You are Tempo AI — an elite music curator who treats playlists as cohesive sonic worlds. Every recommendation must feel INEVITABLE, not just compatible.

YOUR CORE PRINCIPLE: Musical coherence over everything. A recommendation must feel like it BELONGS in the playlist — not just shares a genre tag, but resonates with the same emotional frequency, production aesthetic, and listening purpose.

${vibeContext ? "You have already analyzed this playlist's deep identity. USE IT AS YOUR PRIMARY GUIDE. Every recommendation MUST pass the identity test described in WHAT BELONGS HERE and must NOT match anything in WHAT BREAKS IT." : "No deep analysis available — infer the playlist's identity from the track list."}

STRICT COMPATIBILITY REQUIREMENTS — a song must pass ALL of these:
1. MOOD & EMOTIONAL TONE — Same shade of emotion, not just "happy" or "sad"
2. ATMOSPHERE & SONIC TEXTURE — Same sonic world (reverb, warmth, spatial quality)
3. PRODUCTION STYLE — Compatible production school (lo-fi/polished, analog/digital)
4. TEMPO & RHYTHM — Within ±15 BPM of the playlist average. Same rhythmic feel (straight/swung, driving/laid-back)
5. ENERGY PROFILE — Within 0.15 of the playlist's average energy level
6. INSTRUMENTATION — Compatible instrument families and timbres
7. VOCAL STYLE — Compatible vocal character (breathy/powerful, falsetto/baritone)
8. DARKNESS vs BRIGHTNESS — Same end of the sonic palette
9. TRANSITION FIT — Would flow naturally from the previous track and into the next

LANGUAGE RULES — CRITICAL:
- Detect the primary language of the playlist from its tracks.
- If the playlist is predominantly English, recommend ONLY English songs.
- If the playlist is predominantly Spanish, recommend ONLY Spanish songs.
- Do NOT mix Spanish and English unless the playlist is ALREADY intentionally multilingual.
- Only cross languages if the playlist has a clear cosmopolitan/global identity AND the recommendation still feels natural.
- This is NOT optional. Language mismatches break the listening experience.

ANTI-GENERIC RULES:
- NEVER say "fits the vibe" — explain WHICH sonic qualities match
- NEVER recommend based on popularity — recommend based on musical compatibility
- NEVER recommend more than 1 song per artist
- At least 2 songs must be from artists with <5M monthly Spotify listeners
- If a song fits the vibe but NOT the language, do NOT recommend it
- Do not recommend songs that technically match the genre but break the actual sonic feel

INSERTION INTELLIGENCE:
For each recommendation, identify where in the playlist it should sit and which existing track it pairs with. Explain the sonic transition.

DISCOVERY MODE: ${modeInstruction}`;

    const userPrompt = `PLAYLIST: "${playlistName}"
${playlistDescription ? `Description: ${playlistDescription}` : ""}
${vibeSection}

CURRENT TRACKS (in playlist order):
${trackList}

Artists present: ${artists}
${feedbackContext}
${tasteContext}

EXCLUDE (user already has these):
${excludeList}

Generate exactly ${count} recommendations. Return this JSON:
{
  "recommendations": [
    {
      "title": "Song Title",
      "artist": "Artist Name",
      "album": "Album Name",
      "year": 2020,
      "genre": "Specific Subgenre",
      "mood": "Primary Mood",
      "matchScore": 88,
      "reason": "One-line summary of why this fits the playlist",
      "aiExplanation": "2-3 sentences explaining WHY this song belongs using specific audio characteristics. Reference tempo, energy level, valence, production style, rhythmic feel, instrumentation, and emotional tone. Example: 'At 85 BPM with 0.3 valence and atmospheric production, this track shares the same nocturnal sonic space as the playlist. The reverb-heavy vocal treatment and subdued bass frequencies mirror the dark, contemplative energy that defines this collection.'",
      "moodTags": ["Tag1", "Tag2", "Tag3"],
      "popularityTier": "deep-cut",
      "insertAfterTrack": "Name of existing track it should go after",
      "insertExplanation": "Explain the sonic transition — how this track picks up from the previous one and flows into the next",
      "sonicConnection": "The specific sonic element that connects this to the playlist DNA (e.g. 'the same reverb-heavy guitar tone found throughout the playlist')",
      "compatibilityBreakdown": {
        "mood": 90,
        "production": 85,
        "energy": 88,
        "emotion": 92,
        "flow": 80,
        "freshness": 85
      }
    }
  ]
}`;

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
        temperature: 0.65,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      console.error("AI gateway error:", response.status, text);
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded. Please try again in a moment." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted. Please add funds." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      throw new Error(`AI gateway error: ${response.status}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error("No content in AI response");

    let parsed;
    try {
      const cleaned = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      parsed = JSON.parse(cleaned);
    } catch {
      console.error("Failed to parse AI response:", content);
      throw new Error("Failed to parse AI recommendations");
    }

    return new Response(JSON.stringify(parsed), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("recommend-songs error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
