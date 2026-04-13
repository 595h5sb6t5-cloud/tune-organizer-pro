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
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
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
      userTasteProfile = null,
      count = 6,
    } = await req.json();

    if (!playlistName || !tracks || !Array.isArray(tracks)) {
      return new Response(
        JSON.stringify({ error: "playlistName and tracks array are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const trackAnalysis = tracks
      .map((t: any) =>
        `- "${t.title}" by ${t.artist} | genre: ${t.genre} | mood: ${t.mood} | ${t.tempo} BPM | energy: ${t.energy} | valence: ${t.valence} | acousticness: ${t.acousticness} | danceability: ${t.danceability} | year: ${t.year}`
      )
      .join("\n");

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

    let feedbackContext = "";
    if (acceptedSongs.length > 0) {
      feedbackContext += `\n\nPreviously ACCEPTED recommendations (the user liked these — lean into similar sonic qualities, moods, artist networks, and production styles):\n`;
      feedbackContext += acceptedSongs.map((s: any) => `- "${s.title}" by ${s.artist}`).join("\n");
    }
    if (dismissedSongs.length > 0) {
      feedbackContext += `\n\nPreviously DISMISSED recommendations (the user rejected these — AVOID these artists entirely and avoid similar energy levels, moods, and production styles):\n`;
      feedbackContext += dismissedSongs.map((s: any) => `- "${s.title}" by ${s.artist}`).join("\n");
    }

    let tasteContext = "";
    if (userTasteProfile) {
      tasteContext = `\n\nUSER TASTE PROFILE (aggregated from all their listening behavior):
- Favorite genres: ${(userTasteProfile.favorite_genres || []).join(", ") || "not yet established"}
- Favorite moods: ${(userTasteProfile.favorite_moods || []).join(", ") || "not yet established"}
- Favorite artists: ${(userTasteProfile.favorite_artists || []).join(", ") || "not yet established"}
- Preferred tempo range: ${userTasteProfile.preferred_tempo_min || 60}–${userTasteProfile.preferred_tempo_max || 140} BPM
- Preferred energy range: ${userTasteProfile.preferred_energy_min || 0.2}–${userTasteProfile.preferred_energy_max || 0.8}
- Preferred eras: ${(userTasteProfile.preferred_eras || []).join(", ") || "mixed"}
- Total accepted: ${userTasteProfile.accepted_count || 0}, Total dismissed: ${userTasteProfile.dismissed_count || 0}
Use this profile to bias recommendations toward the user's demonstrated taste patterns.`;
    }

    const discoveryModeInstructions: Record<string, string> = {
      "safe": "Lean toward well-known songs that strongly match the playlist DNA. Prioritize recognizable artists within the playlist's genre ecosystem. Still avoid the absolute top 10 most obvious hits.",
      "balanced": "Mix 2 recognizable songs, 2 mid-popularity songs, and 2 deep cuts or hidden gems. Balance familiarity with discovery.",
      "deep-cuts": "Prioritize deep cuts, B-sides, lesser-known album tracks, and underground artists. Avoid any song that would appear on a 'best of' or 'top hits' playlist. The user wants to discover music they've never heard of.",
      "mainstream": "Include well-known songs but only if they truly match the playlist's mood and energy profile. Avoid the most overplayed hits. Prioritize songs that are popular but musically compatible.",
      "underground": "Focus exclusively on independent, underground, and lesser-known artists. No major label hits. Think small labels, Bandcamp artists, SoundCloud discoveries, and cult favorites.",
      "nostalgic": `Focus on songs from the era range ${yearRange.min}-${yearRange.max} or earlier. Prioritize songs that evoke nostalgia and match the emotional tone of the playlist. Include forgotten gems from that era.`,
      "new-releases": "Focus on songs released in the last 2 years. Prioritize emerging artists and recent releases that match the playlist's sonic profile.",
    };

    const modeInstruction = discoveryModeInstructions[discoveryMode] || discoveryModeInstructions["balanced"];

    const excludeList = [
      ...tracks.map((t: any) => `"${t.title}" by ${t.artist}`),
      ...existingLibrary.map((t: any) => `"${t.title}" by ${t.artist}`),
    ].join(", ");

    const systemPrompt = `You are a world-class music curator AI for Tempo, a premium music organization app. You have the deep knowledge of a veteran record store owner, the analytical precision of a musicologist, and the taste of a critically acclaimed music journalist.

YOUR CORE PHILOSOPHY:
You do NOT recommend based on popularity or streaming numbers. You recommend based on MUSICAL COMPATIBILITY — how well a song fits the sonic, emotional, and contextual DNA of the target playlist and the user's demonstrated taste.

You think like a trusted friend who has listened to thousands of albums and always knows exactly what song to play next.

ANTI-POPULARITY BIAS RULES:
1. NEVER default to the most streamed or most famous songs by an artist
2. NEVER recommend songs just because they're well-known or charting
3. Prefer album deep cuts over singles when the deep cut has better playlist fit
4. Consider B-sides, bonus tracks, lesser-known albums, live versions, and overlooked releases
5. If recommending a well-known artist, pick their less obvious but musically fitting track
6. At least 2 of ${count} recommendations MUST be from artists with fewer than 5 million monthly streams (estimate)
7. NEVER recommend more than 1 song from the same artist
8. Avoid songs that appear on generic "Top Hits" or "Best Of" playlists

MUSICAL COMPATIBILITY SCORING:
For each recommendation, calculate compatibility based on these weighted signals:
- Mood similarity (25%): emotional tone, lyrical themes, atmospheric quality, production mood
- Tempo compatibility (15%): BPM within ±15 of playlist average, rhythmic feel, groove pattern
- Energy alignment (15%): dynamic range, intensity level, production density, loudness profile
- Genre proximity (15%): subgenre accuracy, sonic palette, instrumentation overlap, production school
- Artist network (10%): collaboration history, shared producers, label connections, similar fanbases, influence chains
- Era compatibility (10%): production style of the era, cultural context, recording techniques
- Vocal/instrumental texture (10%): vocal style (falsetto, breathy, raspy, etc.), key instrumentation, production techniques, sonic signature

PLAYLIST FLOW INTELLIGENCE:
Consider how each recommendation would sit within the playlist's arc:
- Would it work as an opener, a middle track, or a closer?
- Does it complement the energy curve of existing tracks?
- Does it provide continuity or interesting contrast?

DIVERSITY RULES:
- Maximum 1 song per artist
- At least 3 different subgenres represented across ${count} songs
- Mix of eras unless the playlist is era-specific
- Vary the emotional arc (not all songs at the same intensity)
- Include at least 1 song from a completely different but sonically compatible genre (cross-pollination)

DISCOVERY MODE: ${modeInstruction}

IMPORTANT: Only return valid JSON. No markdown, no code fences, no explanation outside the JSON structure.`;

    const userPrompt = `PLAYLIST ANALYSIS:
Name: "${playlistName}"
Mood: ${playlistMood || "mixed"}
Description: ${playlistDescription || "N/A"}

PLAYLIST SONIC PROFILE:
- Average tempo: ${avgTempo.toFixed(0)} BPM (range: ${Math.min(...tracks.map((t: any) => t.tempo || 100))}–${Math.max(...tracks.map((t: any) => t.tempo || 100))})
- Average energy: ${avgEnergy.toFixed(2)} (range: ${Math.min(...tracks.map((t: any) => t.energy || 0.5)).toFixed(2)}–${Math.max(...tracks.map((t: any) => t.energy || 0.5)).toFixed(2)})
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
${tasteContext}

EXCLUDED SONGS (user already has these — do NOT recommend any of them):
${excludeList}

Generate exactly ${count} recommendations. For each, provide a detailed compatibility breakdown and a human-readable explanation of why this specific song fits this specific playlist.

The explanation should reference specific sonic qualities, not generic phrases. Example: "The reverb-heavy guitar tone and 84 BPM groove mirror the late-night atmosphere of your Night Drive tracks" — NOT "This song fits the vibe."

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
      "reason": "Detailed, specific explanation referencing sonic qualities",
      "moodTags": ["Tag1", "Tag2", "Tag3"],
      "popularityTier": "deep-cut | mid | well-known",
      "compatibilityBreakdown": {
        "mood": 90,
        "tempo": 85,
        "energy": 88,
        "genre": 82,
        "artistNetwork": 75,
        "era": 90
      },
      "insertPosition": "opener | early | middle | late | closer"
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
        temperature: 0.9,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      console.error("AI gateway error:", response.status, text);
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limit exceeded. Please try again in a moment." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: "AI credits exhausted. Please add funds." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      throw new Error(`AI gateway error: ${response.status}`);
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
