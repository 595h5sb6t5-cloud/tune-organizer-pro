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
    if (escape) { escape = false; continue; }
    if (ch === "\\") { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === root) depth++;
    if (ch === rootClose) { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  if (end !== -1) cleaned = cleaned.slice(0, end);

  try { return JSON.parse(cleaned); } catch { /* repair mode */ }

  const opens = { "{": 0, "[": 0 };
  inString = false; escape = false;
  for (const ch of cleaned) {
    if (escape) { escape = false; continue; }
    if (ch === "\\") { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
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
  cleaned = cleaned.replace(/[\x00-\x1F\x7F]/g, " ").replace(/,\s*}/g, "}").replace(/,\s*]/g, "]");
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

function sanitizeRecs(recs: any[]): any[] {
  return recs.filter((r: any) => r && typeof r === "object" && r.title && r.artist);
}

function sanitizeCategories(categories: any[]): any[] {
  return categories
    .filter((c: any) => c && typeof c === "object")
    .map((c: any, i: number) => ({
      id: typeof c.id === "string" && c.id.trim() ? c.id : `category-${i + 1}`,
      title: typeof c.title === "string" && c.title.trim() ? c.title : `Recommendations ${i + 1}`,
      subtitle: typeof c.subtitle === "string" ? c.subtitle : "",
      recommendations: Array.isArray(c.recommendations) ? sanitizeRecs(c.recommendations) : [],
    }));
}

function normalizePayload(parsed: any): { categories: any[] } | null {
  if (Array.isArray(parsed)) return { categories: sanitizeCategories(parsed) };
  const candidates = [parsed, parsed?.arguments, parsed?.data, parsed?.result];
  for (const c of candidates) {
    if (!c || typeof c !== "object") continue;
    if (Array.isArray(c.categories)) return { categories: sanitizeCategories(c.categories) };
    if (Array.isArray(c.recommendations)) {
      return { categories: sanitizeCategories([{ id: "for-you", title: "For You", subtitle: "", recommendations: c.recommendations }]) };
    }
  }
  return null;
}

// ── Category definitions ──
interface CategoryDef {
  id: string;
  title: string;
  subtitle: string;
  promptInstruction: string;
  songCount: number;
  condition?: (ctx: any) => boolean;
}

function getCategoryBatches(ctx: any): CategoryDef[][] {
  const allCategories: CategoryDef[] = [
    {
      id: "taste-dna-match",
      title: "Your Taste DNA",
      subtitle: "Songs that match your exact sonic fingerprint across mood, groove, and production",
      promptInstruction: "Recommend songs that perfectly match this listener's overall taste DNA. Consider ALL dimensions: mood, groove, production, texture, energy, vocal style. These should feel like undiscovered favorites.",
      songCount: 20,
    },
    {
      id: "hidden-gems",
      title: "Hidden Gems",
      subtitle: "Underground and overlooked tracks that match your sonic world",
      promptInstruction: "Recommend deep-cut, underground, overlooked tracks. Avoid anything that charted or has >50M streams. Focus on album tracks, B-sides, independent releases. ALL picks must be 'deep-cut' popularity tier.",
      songCount: 20,
    },
    {
      id: "artist-discovery",
      title: "Artists You'll Love",
      subtitle: "New artists with sonic DNA similar to your favorites",
      promptInstruction: "Recommend songs from ARTISTS the user hasn't heard yet but who share sonic DNA with their most-listened artists. Focus on artist similarity: production choices, vocal delivery, songwriting style, genre blend. Include a mix of established and emerging artists.",
      songCount: 15,
    },
    {
      id: "mood-match-new-artists",
      title: "Same Mood, New Artists",
      subtitle: "Your favorite moods explored through artists you haven't discovered",
      promptInstruction: "Match the user's top moods and emotional tones, but ONLY from artists not in their library. The emotional shade must be specific and precise, not broad categories.",
      songCount: 15,
    },
    {
      id: "genre-different-sound",
      title: "Same Genre, Different Sound",
      subtitle: "Familiar genres approached from unexpected angles",
      promptInstruction: "Stay within the user's preferred genres but find artists/tracks with distinctly different production, vocal style, or sonic texture. Same genre roots, fresh sonic identity.",
      songCount: 15,
    },
    {
      id: "high-energy",
      title: "High Energy Discoveries",
      subtitle: "Upbeat, driving, and energetic tracks matching your taste",
      promptInstruction: "Focus on HIGH ENERGY tracks (energy > 0.7). Driving rhythms, powerful production, intense vocal delivery. Must still match the user's genre/mood preferences but at elevated intensity.",
      songCount: 15,
    },
    {
      id: "chill-discoveries",
      title: "Chill Discoveries",
      subtitle: "Laid-back, atmospheric, and relaxing tracks in your sonic world",
      promptInstruction: "Focus on LOW ENERGY, CHILL tracks (energy < 0.4). Ambient textures, gentle production, intimate vocals. Must match the user's sonic preferences but at reduced intensity.",
      songCount: 15,
    },
    {
      id: "playlist-perfect",
      title: "Perfect for Your Playlists",
      subtitle: "Songs handpicked to fit specific playlists in your library",
      promptInstruction: "For EACH recommendation, target a specific playlist from the user's library. Set targetPlaylistName. The song must match that playlist's vibe, energy, mood, and sonic identity perfectly.",
      songCount: 18,
      condition: (ctx) => ctx.playlists.length > 0,
    },
    {
      id: "electronic",
      title: "Electronic Discoveries",
      subtitle: "Electronic, synth-driven, and digitally produced tracks for you",
      promptInstruction: "Focus on electronic, synth-heavy, digitally produced music. Include house, techno, ambient electronic, synth-pop, IDM, downtempo, etc. Must align with the user's energy and mood preferences.",
      songCount: 15,
      condition: (ctx) => {
        const genres = ctx.tasteSignals?.topGenres || [];
        return genres.some((g: string) => /electro|synth|house|techno|edm|ambient|idm|drum.?bass/i.test(g));
      },
    },
    {
      id: "indie",
      title: "Indie Discoveries",
      subtitle: "Independent and alternative tracks matching your sensibility",
      promptInstruction: "Focus on indie, alternative, and independent music. Prioritize artistic authenticity, unique production, unconventional song structures. Match the user's mood and sonic texture preferences.",
      songCount: 15,
      condition: (ctx) => {
        const genres = ctx.tasteSignals?.topGenres || [];
        return genres.some((g: string) => /indie|alternative|lo-?fi|shoegaze|dream.?pop/i.test(g));
      },
    },
    {
      id: "funk-soul-disco",
      title: "Funk / Soul / Disco",
      subtitle: "Groovy, soulful discoveries with rhythmic depth",
      promptInstruction: "Focus on funk, soul, disco, R&B, and groove-driven music. Prioritize rhythmic feel, basslines, horn sections, vocal soul. Include both classic and modern interpretations.",
      songCount: 15,
      condition: (ctx) => {
        const genres = ctx.tasteSignals?.topGenres || [];
        return genres.some((g: string) => /funk|soul|disco|r&b|motown|groove/i.test(g));
      },
    },
    {
      id: "spanish-sonic",
      title: "Spanish-Language Sonic Matches",
      subtitle: "Spanish-language tracks selected for sonic compatibility, not just language",
      promptInstruction: "Recommend Spanish-language tracks that match the user's SONIC preferences (mood, energy, production, groove). Do NOT recommend based on language alone — the sonic world must align. Include Latin alternative, indie, electronic, rock, and experimental alongside mainstream genres.",
      songCount: 15,
      condition: (ctx) => {
        const genres = ctx.tasteSignals?.topGenres || [];
        const artists = ctx.tasteSignals?.topArtists || [];
        return genres.some((g: string) => /latin|reggaeton|bachata|salsa|cumbia|spanish/i.test(g)) ||
          artists.some((a: string) => /bad bunny|rosalía|j balvin|karol g|peso pluma|rauw alejandro/i.test(a));
      },
    },
    {
      id: "sonic-explorers",
      title: "Sonic Explorers",
      subtitle: "Genre-adjacent surprises that push your boundaries",
      promptInstruction: "Recommend songs from genres the user hasn't explored much, but that share sonic DNA with their library. Push boundaries while maintaining compatibility. These are the 'you'd never search for this but you'll love it' picks.",
      songCount: 15,
    },
  ];

  // Filter by conditions
  const active = allCategories.filter(c => !c.condition || c.condition(ctx));

  // Split into batches of 3 categories each for parallel API calls
  const batches: CategoryDef[][] = [];
  for (let i = 0; i < active.length; i += 3) {
    batches.push(active.slice(i, i + 3));
  }
  return batches;
}

// ── Build shared taste context string ──
function buildTasteContext(body: any): string {
  const {
    audioProfile, tasteSignals, clusters = [], playlistVibes = [],
    sampleTracks = [], acceptedHistory = [], dismissedHistory = [],
    userTasteProfile, playlists = [], savedAlbums = [], knownSongs = [],
  } = body;

  let audioSection = "No Spotify audio features available yet.";
  if (audioProfile) {
    audioSection = `AUDIO FINGERPRINT (from ${audioProfile.count} tracks):
- Avg BPM: ${audioProfile.avgTempo} (${audioProfile.tempoRange[0]}–${audioProfile.tempoRange[1]})
- Avg Energy: ${audioProfile.avgEnergy} (${audioProfile.energyRange[0]}–${audioProfile.energyRange[1]})
- Avg Valence: ${audioProfile.avgValence}, Danceability: ${audioProfile.avgDanceability}
- Avg Acousticness: ${audioProfile.avgAcousticness}, Instrumentalness: ${audioProfile.avgInstrumentalness}
- Avg Loudness: ${audioProfile.avgLoudness} dB
PROFILE: ${audioProfile.avgEnergy > 0.65 ? "High-energy" : audioProfile.avgEnergy < 0.35 ? "Low-energy/ambient" : "Mid-energy"}. ${audioProfile.avgValence > 0.6 ? "Upbeat/positive" : audioProfile.avgValence < 0.35 ? "Melancholic/dark" : "Balanced emotional"}. ${audioProfile.avgDanceability > 0.65 ? "Strong rhythmic preference" : "Varied rhythmic"}. ${audioProfile.avgAcousticness > 0.5 ? "Acoustic/organic lean" : "Electronic/produced lean"}.`;
  }

  let tasteSection = "";
  if (tasteSignals) {
    tasteSection = `TASTE DNA:
- Genres: ${tasteSignals.topGenres?.join(", ") || "unknown"}
- Moods: ${tasteSignals.topMoods?.join(", ") || "unknown"}
- Atmospheres: ${tasteSignals.topAtmospheres?.join(", ") || "unknown"}
- Production: ${tasteSignals.topProductionStyles?.join(", ") || "unknown"}
- Eras: ${tasteSignals.topEras?.join(", ") || "mixed"}
- Top Artists: ${tasteSignals.topArtists?.join(", ") || "unknown"}
SONIC IDENTITY:
- Groove: ${tasteSignals.topGrooveFeels?.join(", ") || "n/a"}
- Vocal: ${tasteSignals.topVocalStyles?.join(", ") || "n/a"}
- Brightness: ${tasteSignals.topSonicBrightness?.join(", ") || "n/a"}
- Spatial: ${tasteSignals.topSpatialQualities?.join(", ") || "n/a"}
- Rhythm: ${tasteSignals.topRhythmicIdentities?.join(", ") || "n/a"}
- Texture: ${tasteSignals.topSonicTextures?.join(", ") || "n/a"}`;
  }

  let clusterSection = "";
  if (clusters.length > 0) {
    clusterSection = `\nSONIC CLUSTERS:\n${clusters.map((c: any) =>
      `- "${c.name}" — ${c.vibe || ""} | E:${c.energy || "?"} T:${c.tempo || "?"} Era:${c.era || "?"} (${c.trackCount} tracks) Moods:${(c.moods || []).join(",")}`
    ).join("\n")}`;
  }

  let vibeSection = "";
  if (playlistVibes.length > 0) {
    vibeSection = `\nPLAYLIST VIBES:\n${playlistVibes.map((v: any) =>
      `- "${v.primaryVibe}" | Mood:${v.moodSummary || "?"} Energy:${v.energySummary || "?"} Prod:${v.productionSummary || "?"} Context:${v.listeningContext || "?"}`
    ).join("\n")}`;
  }

  let sampleSection = "";
  if (sampleTracks.length > 0) {
    sampleSection = `\nSAMPLE TRACKS:\n${sampleTracks.slice(0, 30).map((t: any) => {
      const p = [`"${t.title}" by ${t.artist}`];
      if (t.mood) p.push(`mood:"${t.mood}"`);
      if (t.grooveFeel) p.push(`groove:"${t.grooveFeel}"`);
      if (t.production) p.push(`prod:"${t.production}"`);
      if (t.vocalStyle) p.push(`vocal:"${t.vocalStyle}"`);
      if (t.sonicTexture) p.push(`texture:"${t.sonicTexture}"`);
      if (t.atmosphere) p.push(`atm:"${t.atmosphere}"`);
      if (t.tempo) p.push(`${t.tempo}BPM`);
      if (t.audioEnergy != null) p.push(`E:${t.audioEnergy}`);
      return `- ${p.join(" | ")}`;
    }).join("\n")}`;
  }

  let feedbackSection = "";
  if (acceptedHistory.length > 0) {
    feedbackSection += `\nACCEPTED:\n${acceptedHistory.map((s: any) => `- "${s.title}" by ${s.artist}`).join("\n")}`;
  }
  if (dismissedHistory.length > 0) {
    feedbackSection += `\nDISMISSED (avoid similar):\n${dismissedHistory.map((s: any) => `- "${s.title}" by ${s.artist}`).join("\n")}`;
  }

  let profileSection = "";
  if (userTasteProfile) {
    profileSection = `\nTASTE STATS: Tempo ${userTasteProfile.preferred_tempo_min||60}–${userTasteProfile.preferred_tempo_max||140} BPM, Energy ${userTasteProfile.preferred_energy_min||0.2}–${userTasteProfile.preferred_energy_max||0.8}, ${userTasteProfile.accepted_count||0} accepted/${userTasteProfile.dismissed_count||0} dismissed`;
  }

  const playlistList = playlists.map((p: any) => `- "${p.name}" (${p.trackCount} tracks): ${p.description}`).join("\n");
  const knownExclude = knownSongs.slice(0, 500).map((s: any) => `"${s.title}" by ${s.artist}`).join(", ");

  return `${audioSection}\n\n${tasteSection}${clusterSection}${vibeSection}${sampleSection}${feedbackSection}${profileSection}\n\nPLAYLISTS:\n${playlistList || "None"}\n\nEXCLUDE (user already knows):\n${knownExclude}`;
}

const SYSTEM_PROMPT = `You are Tempo's elite discovery AI — a deeply musical curator.

CORE MISSION: Surface songs the user has NEVER heard that feel like they were made for them.

CRITICAL RULES:
1. NEVER recommend any song from the exclusion list
2. NEVER recommend based on streaming popularity or chart position
3. NEVER recommend more than 1 song per artist in your response
4. Each recommendation must feel intentional and personally curated
5. Maintain diversity: vary tempo, energy, mood, era, and artist across recommendations
6. At least 40% should be "deep-cut" popularity tier
7. Prefer album tracks over singles, B-sides over hits

SONIC WORLD COMPATIBILITY (PRIMARY scoring):
1. Groove & rhythmic feel — Same groove pocket, swing, rhythmic density
2. Production identity — Same philosophy (lo-fi/hi-fi, analog/digital, warm/cold)
3. Sonic texture & brightness — Same tonal palette
4. Spatial quality — Same scale (intimate/wide, close/reverberant)
5. Mood & emotional shade — Same SPECIFIC emotional tone
6. Vocal texture — Compatible vocal delivery and treatment
7. Tension behavior — Similar tension/release patterns
8. Atmosphere — Same environmental/spatial feeling
9. Listening context — Would work in the same listening moment

LANGUAGE RULES:
- Match the user's primary listening language(s)
- Do NOT casually mix languages unless library is multilingual
- NEVER recommend by language similarity alone — sonic world must align

EXPLANATION QUALITY:
Each aiExplanation must be 2-3 sentences referencing SPECIFIC musical qualities.
Name groove feel, production techniques, spatial qualities, vocal textures.
NEVER say "fits your vibe" without naming the exact sonic dimension.`;

async function callOpenAI(
  apiKey: string,
  tasteContext: string,
  batch: CategoryDef[],
  discoveryMode: string,
  previousArtists: string[],
): Promise<any[]> {
  const modeInstructions: Record<string, string> = {
    balanced: "60% familiar sonic territory, 40% adjacent discovery.",
    "deep-cuts": "Focus on album tracks, B-sides, lesser-known catalog. All deep-cuts.",
    underground: "Independent labels, unsigned artists. Maximum novelty.",
    exploratory: "Genre-adjacent discoveries sharing sonic DNA. Push boundaries.",
    nostalgic: "Classic sounds, vintage production, time-appropriate discoveries.",
    "new-releases": "Released in the last 12 months. Fresh but taste-compatible.",
  };

  const categoryInstructions = batch.map(c =>
    `Category "${c.id}" (title: "${c.title}"): Generate exactly ${c.songCount} songs.\nInstruction: ${c.promptInstruction}`
  ).join("\n\n");

  const artistExclusion = previousArtists.length > 0
    ? `\nARTISTS ALREADY USED IN OTHER BATCHES (do NOT reuse): ${previousArtists.join(", ")}`
    : "";

  const userPrompt = `USER'S TASTE PROFILE:\n${tasteContext}${artistExclusion}

DISCOVERY MODE: "${discoveryMode}" — ${modeInstructions[discoveryMode] || modeInstructions.balanced}

Generate recommendations for these categories:
${categoryInstructions}

Call the save_recommendations function with your results. Do NOT respond with text.`;

  const tools = [{
    type: "function",
    function: {
      name: "save_recommendations",
      description: "Save discovery recommendations",
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
                          groove: { type: "integer" },
                          energy: { type: "integer" },
                          production: { type: "integer" },
                          atmosphere: { type: "integer" },
                          rhythm: { type: "integer" },
                          novelty: { type: "integer" },
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
  }];

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      tools,
      tool_choice: { type: "function", function: { name: "save_recommendations" } },
      temperature: 0.75,
      max_tokens: 16000,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    console.error("OpenAI error:", response.status, text.slice(0, 200));
    throw new Error(`AI error: ${response.status}`);
  }

  const data = await response.json();
  const message = data.choices?.[0]?.message ?? {};
  const toolArgs = message.tool_calls?.[0]?.function?.arguments;
  const content = typeof message.content === "string" ? message.content : "";

  for (const source of [toolArgs, content]) {
    if (!source) continue;
    try {
      const result = normalizePayload(parseJsonLike(source));
      if (result) return result.categories;
    } catch (e) {
      console.warn("Parse failed for batch:", e);
    }
  }

  return [];
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
    if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not configured");

    const body = await req.json();
    const { discoveryMode = "balanced" } = body;

    const tasteContext = buildTasteContext(body);
    const batches = getCategoryBatches(body);

    console.log(`Discover: ${batches.length} batches, ${batches.reduce((s, b) => s + b.length, 0)} categories`);

    // Run batches in parallel (max 3 concurrent to avoid rate limits)
    const allCategories: any[] = [];
    const usedArtists: string[] = [];

    // Process in waves of up to 3 parallel batches
    for (let w = 0; w < batches.length; w += 3) {
      const wave = batches.slice(w, w + 3);
      const results = await Promise.all(
        wave.map(batch => callOpenAI(OPENAI_API_KEY, tasteContext, batch, discoveryMode, usedArtists))
      );

      for (const cats of results) {
        for (const cat of cats) {
          // Collect artists for dedup across batches
          for (const r of cat.recommendations || []) {
            if (r.artist) usedArtists.push(r.artist);
          }
          allCategories.push(cat);
        }
      }
    }

    // Final deduplication: remove duplicate songs across categories
    const seenSongs = new Set<string>();
    for (const cat of allCategories) {
      cat.recommendations = (cat.recommendations || []).filter((r: any) => {
        const key = `${r.title}|||${r.artist}`.toLowerCase();
        if (seenSongs.has(key)) return false;
        seenSongs.add(key);
        return true;
      });
    }

    // Remove empty categories
    const finalCategories = allCategories.filter(c => c.recommendations.length > 0);

    console.log(`Discover complete: ${finalCategories.length} categories, ${finalCategories.reduce((s, c) => s + c.recommendations.length, 0)} total songs`);

    return new Response(JSON.stringify({ categories: finalCategories }), {
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
