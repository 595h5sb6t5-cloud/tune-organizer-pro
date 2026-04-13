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

    const { playlistName, playlistMood, playlistDescription, tracks } = await req.json();

    if (!playlistName || !tracks || !Array.isArray(tracks)) {
      return new Response(
        JSON.stringify({ error: "playlistName and tracks array are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const trackSummary = tracks
      .map((t: any) => `"${t.title}" by ${t.artist} (${t.genre}, ${t.mood}, ${t.tempo} BPM, energy ${t.energy})`)
      .join("\n");

    const systemPrompt = `You are a premium music recommendation AI for an app called Tempo. You analyze playlist tracks and recommend new songs the user likely does NOT already have.

Rules:
- Recommend exactly 4 songs that would fit naturally in this playlist
- Each song must be a REAL song by a REAL artist
- Do NOT recommend songs already in the playlist
- Prioritize cohesion: matching mood, tempo range, energy, and genre
- Give a specific reason why each song fits THIS playlist
- Assign a match score from 75-98 (be realistic, not always 95+)
- Assign 2-3 mood tags per song

Return ONLY valid JSON, no markdown, no explanation.`;

    const userPrompt = `Playlist: "${playlistName}"
Mood: ${playlistMood || "mixed"}
Description: ${playlistDescription || "N/A"}

Current tracks:
${trackSummary}

Return JSON in this exact format:
{
  "recommendations": [
    {
      "title": "Song Title",
      "artist": "Artist Name",
      "album": "Album Name",
      "year": 2020,
      "genre": "Genre",
      "tempo": 100,
      "energy": 0.6,
      "valence": 0.5,
      "danceability": 0.5,
      "acousticness": 0.3,
      "mood": "Mood",
      "matchScore": 88,
      "reason": "Why this fits the playlist",
      "moodTags": ["Tag1", "Tag2"]
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
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limit exceeded. Please try again in a moment." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: "AI credits exhausted. Add funds in Settings > Workspace > Usage." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const text = await response.text();
      console.error("AI gateway error:", response.status, text);
      throw new Error(`AI gateway error: ${response.status}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;

    if (!content) {
      throw new Error("No content in AI response");
    }

    // Parse JSON from response (handle potential markdown wrapping)
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
