import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function extractJson(raw: string): any {
  let cleaned = raw.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
  const start = cleaned.search(/[\{\[]/);
  if (start === -1) throw new Error("No JSON found");
  cleaned = cleaned.substring(start);

  const root = cleaned[0];
  const rootClose = root === "[" ? "]" : "}";
  let depth = 0, inStr = false, esc = false, end = -1;
  for (let i = 0; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (esc) { esc = false; continue; }
    if (ch === "\\") { esc = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === root) depth++;
    if (ch === rootClose) { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  if (end !== -1) cleaned = cleaned.slice(0, end);
  try { return JSON.parse(cleaned); } catch {}

  // repair truncated
  const opens = { "{": 0, "[": 0 };
  inStr = false; esc = false;
  for (const ch of cleaned) {
    if (esc) { esc = false; continue; }
    if (ch === "\\") { esc = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === "{") opens["{"]++;
    if (ch === "}") opens["{"]--;
    if (ch === "[") opens["["]++;
    if (ch === "]") opens["["]--;
  }
  if (inStr) cleaned += '"';
  cleaned = cleaned
    .replace(/,\s*"[^"]*"?\s*:?\s*"?[^"]*$/, "")
    .replace(/,\s*\{[^}]*$/, "")
    .replace(/,\s*\[[^\]]*$/, "")
    .replace(/,\s*$/, "");
  for (let i = 0; i < opens["["]; i++) cleaned += "]";
  for (let i = 0; i < opens["{"]; i++) cleaned += "}";
  cleaned = cleaned.replace(/,\s*}/g, "}").replace(/,\s*]/g, "]");
  return JSON.parse(cleaned);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const {
      description,
      selectedTracks = [],
      excludeTrackIds = [],
      count = 8,
    } = await req.json();

    if (!description || typeof description !== "string") {
      return new Response(JSON.stringify({ error: "description is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch user's liked songs for taste context (sample up to 80)
    const { data: likedSongs } = await supabase
      .from("liked_songs")
      .select("track_name, artist_name, genre_tags, mood, energy, groove_feel, sonic_texture, atmosphere, production_style")
      .eq("user_id", user.id)
      .not("analyzed_at", "is", null)
      .limit(80);

    // Fetch followed artists for extra context
    const { data: artists } = await supabase
      .from("spotify_followed_artists")
      .select("artist_name, genres")
      .eq("user_id", user.id)
      .limit(30);

    const tasteSignals = (likedSongs || []).map(s =>
      `"${s.track_name}" by ${s.artist_name} [${(s.genre_tags || []).join(",")}] mood:${s.mood || "?"} energy:${s.energy || "?"} groove:${s.groove_feel || "?"} texture:${s.sonic_texture || "?"} atmos:${s.atmosphere || "?"}`
    ).join("\n");

    const artistSignals = (artists || []).map(a =>
      `${a.artist_name} (${(a.genres || []).join(", ")})`
    ).join(", ");

    const selectedContext = selectedTracks.length > 0
      ? `\n\nSONGS ALREADY SELECTED FOR THIS PLAYLIST (build on this direction):\n${selectedTracks.map((t: any) => `- "${t.title}" by ${t.artist}`).join("\n")}`
      : "";

    const excludeContext = excludeTrackIds.length > 0
      ? `\nDO NOT recommend any tracks with these Spotify IDs: ${excludeTrackIds.join(", ")}`
      : "";

    const systemPrompt = `You are Tempo AI — an elite music curator building custom playlists for users.

The user will describe the playlist they want. Your job is to recommend ${count} songs that PERFECTLY match their vision while being informed by their actual music taste.

USER'S MUSIC TASTE (from their Spotify library — use as taste DNA, not as limitation):
${tasteSignals || "No analyzed songs available."}

FOLLOWED ARTISTS: ${artistSignals || "None available."}
${selectedContext}
${excludeContext}

RULES:
1. Every song must match the user's DESCRIPTION — that is the primary filter.
2. Use the taste signals to calibrate style, production, and sonic preferences — but explore beyond their library.
3. NEVER recommend songs the user already has in their library.
4. NEVER recommend more than 1 song per artist.
5. Mix well-known and discovery picks (3 recognizable, 3 mid-tier, 2 deep cuts).
6. For each song, explain WHY it fits the playlist description in 1-2 sentences.
7. Include a compatibility_score (70-99) based on how well it matches the description.
8. Detect the language implied by the description and match it. If the user writes in Spanish, recommend Spanish-language music unless the description says otherwise.

RESPOND with a JSON object:
{
  "recommendations": [
    {
      "title": "Song Name",
      "artist": "Artist Name",
      "album": "Album Name",
      "year": 2023,
      "genre": "genre",
      "reason": "Why this fits",
      "compatibility_score": 85,
      "mood": "contemplative",
      "energy": 0.6
    }
  ],
  "playlist_name_suggestion": "A creative name for this playlist",
  "playlist_mood_tags": ["tag1", "tag2", "tag3"]
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
          { role: "user", content: `Create a playlist: ${description}` },
        ],
      }),
    });

    if (!response.ok) {
      const status = response.status;
      if (status === 429) return new Response(JSON.stringify({ error: "Rate limited, try again shortly." }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      if (status === 402) return new Response(JSON.stringify({ error: "AI credits exhausted." }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      throw new Error(`AI gateway error: ${status}`);
    }

    const aiData = await response.json();
    const rawContent = aiData.choices?.[0]?.message?.content;

    // Try tool call first
    let parsed: any;
    const toolArgs = aiData.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
    if (toolArgs) {
      parsed = typeof toolArgs === "string" ? JSON.parse(toolArgs) : toolArgs;
    } else if (rawContent) {
      parsed = extractJson(rawContent);
    } else {
      throw new Error("Empty AI response");
    }

    const recommendations = parsed.recommendations || parsed.songs || [];

    return new Response(JSON.stringify({
      recommendations,
      playlist_name_suggestion: parsed.playlist_name_suggestion || "Custom Playlist",
      playlist_mood_tags: parsed.playlist_mood_tags || [],
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("custom-playlist-recommend error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
