import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: userErr } = await supabase.auth.getUser();
    if (userErr || !user) {
      return new Response(JSON.stringify({ error: "Invalid session" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { playlistId, playlistName, tracks } = await req.json();
    if (!playlistId || !playlistName || !tracks?.length) {
      return new Response(JSON.stringify({ error: "playlistId, playlistName, and tracks required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const trackList = tracks.slice(0, 100).map((t: any, i: number) =>
      `${i + 1}. "${t.track_name}" by ${t.artist_name}${t.album_name ? ` (${t.album_name})` : ""}`
    ).join("\n");

    const systemPrompt = `You are Tempo AI, a world-class music curator with deep knowledge of every genre, subgenre, production style, era, and cultural movement in music history.

Your task: Analyze a playlist's true identity — not just its genre. Understand mood, atmosphere, emotional arc, production DNA, rhythm profile, and listening purpose.

IMPORTANT RULES:
- Do NOT reduce playlists to simple genre labels
- A playlist with songs from the same genre can still be incoherent
- A playlist with songs from multiple genres can still be perfectly cohesive
- Analyze at the TRACK level, not artist level — same artist can fit different vibes
- Be specific and evocative, not generic

Return a JSON object with EXACTLY these fields:
{
  "primary_vibe": "A specific, evocative label (e.g. 'dark atmospheric late-night rap', 'warm nostalgic sunset drive', 'elegant dinner jazz fusion')",
  "secondary_vibes": ["3-5 supporting sub-vibes"],
  "mood_summary": "2-3 sentences about the emotional landscape",
  "energy_summary": "Energy profile description (intensity, dynamics, peaks/valleys)",
  "tempo_summary": "Rhythm and tempo character",
  "production_summary": "Production style, instrumentation, sonic texture",
  "era_summary": "Temporal character and era influences",
  "language_summary": "Languages present and cultural context if relevant, or 'Primarily English' etc",
  "listening_context": "What this playlist is for (driving, studying, dinner, etc.)",
  "structural_flow": "How the playlist behaves over time (steady, builds, arcs, contrasts)",
  "user_intent": "The inferred purpose/occasion",
  "ai_explanation": "A rich 2-3 sentence description of the playlist's identity as a whole",
  "cohesion_description": "What makes this playlist feel cohesive",
  "what_belongs": "What kind of songs would fit perfectly",
  "what_breaks_it": "What kind of songs would break the vibe",
  "vibe_color_hex": "A hex color that represents this playlist's mood (e.g. #1a1a2e for dark moody, #f0d78c for warm golden)"
}`;

    const userPrompt = `Analyze this playlist deeply:

Playlist name: "${playlistName}"
Track count: ${tracks.length}

Tracks (in order):
${trackList}

Provide your analysis as a single JSON object. Be musically literate, emotionally intelligent, and specific. Avoid generic labels.`;

    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
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
        tools: [{
          type: "function",
          function: {
            name: "playlist_vibe_analysis",
            description: "Return the complete vibe analysis for a playlist",
            parameters: {
              type: "object",
              properties: {
                primary_vibe: { type: "string" },
                secondary_vibes: { type: "array", items: { type: "string" } },
                mood_summary: { type: "string" },
                energy_summary: { type: "string" },
                tempo_summary: { type: "string" },
                production_summary: { type: "string" },
                era_summary: { type: "string" },
                language_summary: { type: "string" },
                listening_context: { type: "string" },
                structural_flow: { type: "string" },
                user_intent: { type: "string" },
                ai_explanation: { type: "string" },
                cohesion_description: { type: "string" },
                what_belongs: { type: "string" },
                what_breaks_it: { type: "string" },
                vibe_color_hex: { type: "string" },
              },
              required: [
                "primary_vibe", "secondary_vibes", "mood_summary", "energy_summary",
                "tempo_summary", "production_summary", "era_summary", "language_summary",
                "listening_context", "structural_flow", "user_intent", "ai_explanation",
                "cohesion_description", "what_belongs", "what_breaks_it", "vibe_color_hex",
              ],
              additionalProperties: false,
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "playlist_vibe_analysis" } },
      }),
    });

    if (!aiResponse.ok) {
      const errText = await aiResponse.text();
      console.error("AI gateway error:", aiResponse.status, errText);
      if (aiResponse.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded, please try again later." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (aiResponse.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted. Please add funds." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw new Error(`AI error: ${aiResponse.status}`);
    }

    const aiData = await aiResponse.json();
    const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall?.function?.arguments) {
      throw new Error("No analysis returned from AI");
    }

    const analysis = JSON.parse(toolCall.function.arguments);

    // Upsert into DB using service role
    const serviceClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { error: upsertErr } = await serviceClient
      .from("playlist_vibe_analysis")
      .upsert({
        user_id: user.id,
        playlist_id: playlistId,
        primary_vibe: analysis.primary_vibe,
        secondary_vibes: analysis.secondary_vibes || [],
        mood_summary: analysis.mood_summary,
        energy_summary: analysis.energy_summary,
        tempo_summary: analysis.tempo_summary,
        production_summary: analysis.production_summary,
        era_summary: analysis.era_summary,
        language_summary: analysis.language_summary,
        listening_context: analysis.listening_context,
        structural_flow: analysis.structural_flow,
        user_intent: analysis.user_intent,
        ai_explanation: analysis.ai_explanation,
        cohesion_description: analysis.cohesion_description,
        what_belongs: analysis.what_belongs,
        what_breaks_it: analysis.what_breaks_it,
        vibe_color_hex: analysis.vibe_color_hex || "#6366f1",
        analysis_model: "google/gemini-2.5-flash",
        updated_at: new Date().toISOString(),
      }, { onConflict: "user_id,playlist_id" });

    if (upsertErr) {
      console.error("Upsert error:", upsertErr);
      throw new Error("Failed to save analysis");
    }

    return new Response(JSON.stringify({ success: true, analysis }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("analyze-playlist-vibe error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
