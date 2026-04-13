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
      allPlaylists,
      allTracks,
      knownSongs = [],
      discoveryMode = "balanced",
      acceptedSongs = [],
      dismissedSongs = [],
      userTasteProfile = null,
    } = await req.json();

    if (!allPlaylists || !allTracks) {
      return new Response(
        JSON.stringify({ error: "allPlaylists and allTracks are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Build library summary
    const genreCounts: Record<string, number> = {};
    const moodCounts: Record<string, number> = {};
    const artistCounts: Record<string, number> = {};
    const eraCounts: Record<string, number> = {};
    let totalTempo = 0;
    let totalEnergy = 0;
    let totalValence = 0;

    allTracks.forEach((t: any) => {
      genreCounts[t.genre] = (genreCounts[t.genre] || 0) + 1;
      moodCounts[t.mood] = (moodCounts[t.mood] || 0) + 1;
      artistCounts[t.artist] = (artistCounts[t.artist] || 0) + 1;
      const decade = `${Math.floor((t.year || 2020) / 10) * 10}s`;
      eraCounts[decade] = (eraCounts[decade] || 0) + 1;
      totalTempo += t.tempo || 100;
      totalEnergy += t.energy || 0.5;
      totalValence += t.valence || 0.5;
    });

    const n = allTracks.length || 1;
    const topGenres = Object.entries(genreCounts).sort((a, b) => b[1] - a[1]).slice(0, 5).map(e => `${e[0]} (${e[1]})`).join(", ");
    const topMoods = Object.entries(moodCounts).sort((a, b) => b[1] - a[1]).slice(0, 5).map(e => `${e[0]} (${e[1]})`).join(", ");
    const topArtists = Object.entries(artistCounts).sort((a, b) => b[1] - a[1]).slice(0, 8).map(e => e[0]).join(", ");
    const topEras = Object.entries(eraCounts).sort((a, b) => b[1] - a[1]).slice(0, 3).map(e => `${e[0]} (${e[1]})`).join(", ");

    const playlistSummaries = allPlaylists.map((pl: any) => 
      `- "${pl.name}" (${pl.mood}, ${pl.avgTempo} BPM avg, ${pl.tracks?.length || 0} tracks): ${pl.description}`
    ).join("\n");

    const excludeList = allTracks.map((t: any) => `"${t.title}" by ${t.artist}`).join(", ");

    // Build extended exclusion from all known songs
    const knownExcludeList = knownSongs.slice(0, 300).map((s: any) => `"${s.title}" by ${s.artist}`).join(", ");

    let feedbackContext = "";
    if (acceptedSongs.length > 0) {
      feedbackContext += `\n\nPreviously ACCEPTED recommendations (user liked these — recommend similar sonic qualities):\n`;
      feedbackContext += acceptedSongs.slice(-10).map((s: any) => `- "${s.title}" by ${s.artist}`).join("\n");
    }
    if (dismissedSongs.length > 0) {
      feedbackContext += `\n\nPreviously DISMISSED recommendations (user rejected these — AVOID similar artists and styles):\n`;
      feedbackContext += dismissedSongs.slice(-10).map((s: any) => `- "${s.title}" by ${s.artist}`).join("\n");
    }

    let tasteContext = "";
    if (userTasteProfile) {
      tasteContext = `\n\nUSER TASTE PROFILE:
- Favorite genres: ${(userTasteProfile.favorite_genres || []).join(", ") || "not established"}
- Favorite moods: ${(userTasteProfile.favorite_moods || []).join(", ") || "not established"}
- Favorite artists: ${(userTasteProfile.favorite_artists || []).join(", ") || "not established"}
- Preferred tempo: ${userTasteProfile.preferred_tempo_min || 60}–${userTasteProfile.preferred_tempo_max || 140} BPM
- Preferred energy: ${userTasteProfile.preferred_energy_min || 0.2}–${userTasteProfile.preferred_energy_max || 0.8}
- Preferred eras: ${(userTasteProfile.preferred_eras || []).join(", ") || "mixed"}
- Acceptance rate context: ${userTasteProfile.accepted_count || 0} accepted, ${userTasteProfile.dismissed_count || 0} dismissed`;
    }

    const systemPrompt = `You are an elite music discovery AI for Tempo. You function as a deeply knowledgeable personal music curator who has internalized the user's entire music library and taste profile.

YOUR MISSION: Generate personalized discovery recommendations organized into intelligent categories that feel like they were hand-picked by someone who truly knows this listener.

ANTI-POPULARITY RULES:
1. NEVER recommend based on streaming numbers or chart position
2. For every category, include at least 1 deep cut or hidden gem
3. NEVER recommend more than 1 song from the same artist across ALL categories
4. Avoid songs from generic "Top Hits" playlists
5. Prefer album tracks over singles when they fit better

DISCOVERY CATEGORIES TO GENERATE:
1. "Best For You" (3 songs) — Songs that perfectly match the user's overall taste DNA based on their library analysis
2. "Hidden Gems" (3 songs) — Underground, overlooked, or underrated tracks that match the user's sonic preferences
3. "Perfect For Your Playlists" (4 songs) — Each song should specify which existing playlist it fits best and why
4. "Try Something Different" (2 songs) — Songs from adjacent genres or unexpected artists that the user might love based on taste patterns

COMPATIBILITY SCORING (apply to every recommendation):
- Mood similarity (25%)
- Tempo compatibility (15%)
- Energy alignment (15%)
- Genre proximity (15%)
- Artist network (10%)
- Era compatibility (10%)
- Vocal/instrumental texture (10%)

Each explanation must reference SPECIFIC sonic qualities: "The lo-fi tape hiss and 78 BPM downtempo groove echo the contemplative space in your Soft Morning playlist" — NOT "This song fits the vibe."

Return ONLY valid JSON. No markdown fences.`;

    const userPrompt = `USER'S MUSIC LIBRARY ANALYSIS:

LIBRARY STATISTICS:
- Total tracks: ${n}
- Top genres: ${topGenres}
- Top moods: ${topMoods}
- Most listened artists: ${topArtists}
- Era distribution: ${topEras}
- Average tempo: ${(totalTempo / n).toFixed(0)} BPM
- Average energy: ${(totalEnergy / n).toFixed(2)}
- Average valence: ${(totalValence / n).toFixed(2)}

EXISTING PLAYLISTS:
${playlistSummaries}

ALL TRACKS (sample — the user's full library):
${allTracks.slice(0, 20).map((t: any) => `- "${t.title}" by ${t.artist} (${t.genre}, ${t.mood}, ${t.tempo} BPM, energy: ${t.energy})`).join("\n")}
${feedbackContext}
${tasteContext}

EXCLUDED (do NOT recommend any of these — these are songs the user already knows):
${excludeList}

ADDITIONAL KNOWN SONGS (also exclude — from liked songs, playlists, and recommendation history):
${knownExcludeList}

DISCOVERY MODE: ${discoveryMode}

Return this exact JSON:
{
  "categories": [
    {
      "id": "best-for-you",
      "title": "Best For You",
      "subtitle": "Songs that match your unique taste DNA",
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
          "matchScore": 92,
          "reason": "One-line summary of why this fits",
          "aiExplanation": "2-3 sentence deep explanation referencing specific audio characteristics (tempo, energy, valence, production style, rhythmic feel, emotional tone). Explain WHY this song matches the user's taste or playlist using concrete musical details. Example: 'At 92 BPM with 0.7 energy and low valence, this track mirrors the dark atmospheric production found across your library. The reverb-heavy vocal layering and subdued synth pads share the same sonic space as your most-played songs.'",
          "moodTags": ["Tag1", "Tag2"],
          "popularityTier": "deep-cut | mid | well-known",
          "targetPlaylistId": null,
          "targetPlaylistName": null,
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
    }
  ]
}

For "Perfect For Your Playlists" category, set targetPlaylistId to the playlist id and targetPlaylistName to the playlist name.
Playlist IDs available: ${allPlaylists.map((p: any) => `"${p.id}" (${p.name})`).join(", ")}`;

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
    console.error("discover-recommendations error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
