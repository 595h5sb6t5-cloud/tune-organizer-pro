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
    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
    if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not configured");

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

    const trackList = tracks.slice(0, 120).map((t: any, i: number) =>
      `${i + 1}. "${t.track_name}" by ${t.artist_name}${t.album_name ? ` (${t.album_name})` : ""}`
    ).join("\n");

    const systemPrompt = `You are Tempo AI — a world-class musicologist, curator, and sonic analyst. You don't classify playlists by genre. You decode their true identity: the emotional DNA, the sonic fingerprint, the invisible thread connecting every track.

You think about music the way a film director thinks about scenes — every track serves a purpose in the emotional arc. A playlist isn't a collection, it's a narrative.

YOUR ANALYSIS MUST COVER:

1. IDENTITY — What this playlist IS at its core, beyond genre labels. The feeling you'd have if this playlist were a room, a season, a memory.

2. EMOTIONAL ARC — How the playlist flows emotionally from start to finish. Map the journey: where does it build, where does it breathe, where does it peak?

3. SONIC DNA — The specific production signatures, instruments, vocal textures, and recording techniques that define this playlist's sound. Be precise: "tape-saturated lo-fi drums" not "chill beats".

4. TRACK HIGHLIGHTS — 3-5 tracks that are the pillars of this playlist's identity. Explain WHY each one is essential to the vibe.

5. ENERGY CURVE — Map the energy across the playlist in 5 segments (opening, early, middle, late, closing). Each segment gets a 0-100 energy score and a one-line description.

6. GENRE BLEND — Weighted breakdown of genres/subgenres present (e.g. {"neo-soul": 35, "alternative R&B": 25, "indie pop": 20, "ambient": 20}).

7. COHESION INTELLIGENCE — What holds this playlist together even if genres vary. What would BREAK it.

RULES:
- Be specific and evocative, never generic
- Reference actual sonic qualities, not vibes buzzwords
- A playlist can be cohesive across genres if the emotional thread connects
- Same artist can have tracks that fit AND tracks that don't — analyze at track level
- The primary_vibe should be a phrase you'd use to describe the playlist to a friend who knows music deeply`;

    const userPrompt = `Analyze this playlist with full depth:

Playlist: "${playlistName}"
${tracks.length} tracks (in order):

${trackList}

Return your analysis as a single JSON object with these exact fields:

{
  "primary_vibe": "A specific, evocative identity phrase (e.g. 'velvet midnight confessionals', 'sun-bleached coastal psychedelia')",
  "secondary_vibes": ["4-6 supporting sub-identities"],
  "mood_summary": "3-4 sentences — the emotional landscape, not just 'happy/sad' but the specific shade of emotion",
  "energy_summary": "How energy moves through this playlist — dynamics, intensity patterns, breathing room",
  "tempo_summary": "Rhythm character — not just BPM but groove feel, swing, pulse",
  "production_summary": "The sonic signature — specific instruments, production techniques, recording aesthetics",
  "era_summary": "When this playlist 'lives' — not just release dates but the sonic era it evokes",
  "language_summary": "Languages and cultural textures present",
  "listening_context": "The perfect scenario for this playlist — be vivid and specific",
  "structural_flow": "How the playlist arc works — opener to closer narrative",
  "user_intent": "What the curator was trying to create — the invisible purpose",
  "ai_explanation": "A rich 3-4 sentence identity statement — this is the playlist's autobiography",
  "cohesion_description": "The invisible thread connecting every track — what makes this coherent",
  "what_belongs": "Specific sonic/emotional qualities a new track needs to earn its place here",
  "what_breaks_it": "What would feel jarring — be specific about why",
  "vibe_color_hex": "A hex color capturing this playlist's essence",
  "sonic_palette": ["6-10 specific sonic descriptors, e.g. 'reverb-drenched guitars', '808 sub-bass', 'breathy falsetto', 'vinyl crackle'"],
  "emotional_keywords": ["5-8 precise emotional words, e.g. 'yearning', 'defiant', 'wistful', 'euphoric'"],
  "emotional_arc": [
    {"segment": "opening", "energy": 65, "mood": "contemplative warmth", "description": "The playlist opens with..."},
    {"segment": "early", "energy": 72, "mood": "...", "description": "..."},
    {"segment": "middle", "energy": 80, "mood": "...", "description": "..."},
    {"segment": "late", "energy": 70, "mood": "...", "description": "..."},
    {"segment": "closing", "energy": 55, "mood": "...", "description": "The playlist resolves with..."}
  ],
  "sonic_dna": {
    "key_instruments": ["list of defining instruments/sounds"],
    "vocal_character": "Description of vocal textures present",
    "production_school": "The production philosophy (e.g. 'Pharrell-era Neptunes crispness meets bedroom pop warmth')",
    "spatial_quality": "How the mix feels — intimate/wide/layered/sparse",
    "rhythmic_identity": "The groove DNA — swing, straight, syncopated, polyrhythmic"
  },
  "track_highlights": [
    {"track_name": "...", "artist_name": "...", "role": "Identity Anchor / Emotional Peak / Palette Setter / etc", "why": "Why this track is essential to the playlist's identity"},
    ...
  ],
  "genre_blend": {"subgenre1": 30, "subgenre2": 25, "subgenre3": 20, "subgenre4": 15, "subgenre5": 10}
}`;

    const aiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
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
        tools: [{
          type: "function",
          function: {
            name: "playlist_vibe_analysis",
            description: "Return the complete deep vibe analysis for a playlist",
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
                sonic_palette: { type: "array", items: { type: "string" } },
                emotional_keywords: { type: "array", items: { type: "string" } },
                emotional_arc: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      segment: { type: "string" },
                      energy: { type: "number" },
                      mood: { type: "string" },
                      description: { type: "string" },
                    },
                    required: ["segment", "energy", "mood", "description"],
                  },
                },
                sonic_dna: {
                  type: "object",
                  properties: {
                    key_instruments: { type: "array", items: { type: "string" } },
                    vocal_character: { type: "string" },
                    production_school: { type: "string" },
                    spatial_quality: { type: "string" },
                    rhythmic_identity: { type: "string" },
                  },
                  required: ["key_instruments", "vocal_character", "production_school", "spatial_quality", "rhythmic_identity"],
                },
                track_highlights: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      track_name: { type: "string" },
                      artist_name: { type: "string" },
                      role: { type: "string" },
                      why: { type: "string" },
                    },
                    required: ["track_name", "artist_name", "role", "why"],
                  },
                },
                genre_blend: { type: "object" },
              },
              required: [
                "primary_vibe", "secondary_vibes", "mood_summary", "energy_summary",
                "tempo_summary", "production_summary", "era_summary", "language_summary",
                "listening_context", "structural_flow", "user_intent", "ai_explanation",
                "cohesion_description", "what_belongs", "what_breaks_it", "vibe_color_hex",
                "sonic_palette", "emotional_keywords", "emotional_arc", "sonic_dna",
                "track_highlights", "genre_blend",
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

    // Upsert into DB
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
        sonic_palette: analysis.sonic_palette || [],
        emotional_keywords: analysis.emotional_keywords || [],
        emotional_arc: analysis.emotional_arc || [],
        sonic_dna: analysis.sonic_dna || {},
        track_highlights: analysis.track_highlights || [],
        genre_blend: analysis.genre_blend || {},
        energy_curve: analysis.emotional_arc || [],
        analysis_model: "gpt-4o-mini",
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
