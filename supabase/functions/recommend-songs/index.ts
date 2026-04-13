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
    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
    if (!OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY is not configured");
    }

    const {
      playlistName,
      playlistMood,
      playlistDescription,
      tracks,
      discoveryMode = "balanced",
      acceptedSongs = [],
      dismissedSongs = [],
      existingLibrary = [],
    } = await req.json();

    if (!playlistName || !tracks || !Array.isArray(tracks)) {
      return new Response(
        JSON.stringify({ error: "playlistName and tracks array are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Build rich track analysis
    const trackAnalysis = tracks
      .map((t: any) =>
        `- "${t.title}" by ${t.artist} | genre: ${t.genre} | mood: ${t.mood} | ${t.tempo} BPM | energy: ${t.energy} | valence: ${t.valence} | acousticness: ${t.acousticness} | danceability: ${t.danceability} | year: ${t.year}`
      )
      .join("\n");

    // Compute playlist profile
    const avgTempo = tracks.reduce((s: number, t: any) => s + (t.tempo || 100), 0) / tracks.length;
    const avgEnergy = tracks.reduce((s: number, t: any) => s + (t.energy || 0.5), 0) / tracks.length;
    const avgValence = tracks.reduce((s: number, t: any) => s + (t.valence || 0.5), 0) / tracks.length;
    const avgAcousticness = tracks.reduce((s: number, t: any) => s + (t.acousticness || 0.3), 0) / tracks.length;
    const avgDanceability = tracks.reduce((s: number, t: any) => s + (t.danceability || 0.5), 0) / tracks.length;
    const genres = [...new Set(tracks.map((t: any) => t.genre))].join(", ");
    const moods = [...new Set(tracks.map((t: any) => t.mood))].join(", ");
    const artists = [...new Set(tracks.map((t: any) => t.artist))].join(", ");
    const yearRange = {
      min: Math.min(...tracks.map((t: any) => t.year || 2000)),
      max: Math.max(...tracks.map((t: any) => t.year || 2024)),
    };

    // Build feedback context
    let feedbackContext = "";
    if (acceptedSongs.length > 0) {
      feedbackContext += `\n\nPreviously ACCEPTED recommendations (the user liked these — recommend similar artists, moods, and styles):\n`;
      feedbackContext += acceptedSongs.map((s: any) => `- "${s.title}" by ${s.artist}`).join("\n");
    }
    if (dismissedSongs.length > 0) {
      feedbackContext += `\n\nPreviously DISMISSED recommendations (the user rejected these — AVOID similar artists, styles, and energy levels):\n`;
      feedbackContext += dismissedSongs.map((s: any) => `- "${s.title}" by ${s.artist}`).join("\n");
    }

    // Discovery mode instructions
    const discoveryModeInstructions: Record<string, string> = {
      "safe": "Lean toward well-known songs that strongly match the playlist DNA. Prioritize recognizable artists within the playlist's genre ecosystem. Still avoid the absolute top 10 most obvious hits.",
      "balanced": "Mix 1 recognizable song, 2 mid-popularity songs, and 1 deep cut or hidden gem. Balance familiarity with discovery.",
      "deep-cuts": "Prioritize deep cuts, B-sides, lesser-known album tracks, and underground artists. Avoid any song that would appear on a 'best of' or 'top hits' playlist. The user wants to discover music they've never heard of.",
      "mainstream": "Include well-known songs but only if they truly match the playlist's mood and energy profile. Avoid the most overplayed hits. Prioritize songs that are popular but musically compatible.",
      "underground": "Focus exclusively on independent, underground, and lesser-known artists. No major label hits. Think small labels, Bandcamp artists, SoundCloud discoveries, and cult favorites.",
      "nostalgic": `Focus on songs from the era range ${yearRange.min}-${yearRange.max} or earlier. Prioritize songs that evoke nostalgia and match the emotional tone of the playlist. Include forgotten gems from that era.`,
      "new-releases": "Focus on songs released in the last 2 years. Prioritize emerging artists and recent releases that match the playlist's sonic profile.",
    };

    const modeInstruction = discoveryModeInstructions[discoveryMode] || discoveryModeInstructions["balanced"];

    // Exclude list
    const excludeList = [
      ...tracks.map((t: any) => `"${t.title}" by ${t.artist}`),
      ...existingLibrary.map((t: any) => `"${t.title}" by ${t.artist}`),
    ].join(", ");

    const systemPrompt = `You are a world-class music curator AI for Tempo, a premium music organization app. You have the taste level of a veteran music journalist combined with the analytical precision of a musicologist.

YOUR CORE PHILOSOPHY:
You do NOT recommend based on popularity. You recommend based on MUSICAL COMPATIBILITY.
You think like a record store owner who knows every customer's taste intimately and pulls albums from deep in the stacks that they'll love.

ANTI-POPULARITY BIAS RULES:
1. NEVER default to the most streamed or most famous songs by an artist
2. NEVER recommend songs just because they're well-known
3. Prefer album deep cuts over singles when the deep cut has better playlist fit
4. Consider B-sides, bonus tracks, lesser-known albums, and overlooked releases
5. If recommending a well-known artist, pick their less obvious but musically fitting track
6. At least 2 of 6 recommendations MUST be from artists with fewer than 5 million monthly streams (estimate)
7. NEVER recommend more than 1 song from the same artist

MUSICAL COMPATIBILITY SCORING:
For each recommendation, calculate compatibility based on these weighted signals:
- Mood similarity (25%): emotional tone, lyrical themes, atmospheric quality
- Tempo compatibility (15%): BPM within ±15 of playlist average, rhythmic feel
- Energy alignment (15%): dynamic range, intensity level, production density
- Genre proximity (15%): subgenre accuracy, sonic palette, instrumentation overlap
- Artist network (10%): collaboration history, shared producers, label connections, similar fanbases
- Era compatibility (10%): production style of the era, cultural context
- Vocal/instrumental texture (10%): vocal style, key instrumentation, production techniques

DIVERSITY RULES:
- Maximum 1 song per artist
- At least 2 different subgenres represented
- Mix of eras unless the playlist is era-specific
- Vary the emotional arc (not all songs at the same intensity)

DISCOVERY MODE: ${modeInstruction}

Return ONLY valid JSON, no markdown fences, no explanation outside the JSON.`;

    const userPrompt = `PLAYLIST ANALYSIS:
Name: "${playlistName}"
Mood: ${playlistMood || "mixed"}
Description: ${playlistDescription || "N/A"}

PLAYLIST SONIC PROFILE:
- Average tempo: ${avgTempo.toFixed(0)} BPM
- Average energy: ${avgEnergy.toFixed(2)}
- Average valence: ${avgValence.toFixed(2)}
- Average acousticness: ${avgAcousticness.toFixed(2)}
- Average danceability: ${avgDanceability.toFixed(2)}
- Genres present: ${genres}
- Moods present: ${moods}
- Artists present: ${artists}
- Era range: ${yearRange.min}–${yearRange.max}

CURRENT TRACKS IN PLAYLIST:
${trackAnalysis}
${feedbackContext}

EXCLUDED SONGS (user already has these — do NOT recommend):
${excludeList}

Generate exactly 6 recommendations. For each, provide a detailed compatibility breakdown.

Return this exact JSON format:
{
  "recommendations": [
    {
      "title": "Song Title",
      "artist": "Artist Name",
      "album": "Album Name",
      "year": 2020,
      "genre": "Specific Subgenre",
      "tempo": 100,
      "energy": 0.6,
      "valence": 0.5,
      "danceability": 0.5,
      "acousticness": 0.3,
      "mood": "Primary Mood",
      "matchScore": 88,
      "reason": "Detailed explanation of why this song fits: mention specific sonic qualities, mood alignment, artist connections, or production similarities",
      "moodTags": ["Tag1", "Tag2", "Tag3"],
      "popularityTier": "deep-cut | mid | well-known",
      "compatibilityBreakdown": {
        "mood": 90,
        "tempo": 85,
        "energy": 88,
        "genre": 82,
        "artistNetwork": 75,
        "era": 90
      }
    }
  ]
}`;

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
        temperature: 0.9,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      console.error("OpenAI error:", response.status, text);
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limit exceeded. Please try again in a moment." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      throw new Error(`OpenAI API error: ${response.status}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;

    if (!content) {
      throw new Error("No content in AI response");
    }

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
