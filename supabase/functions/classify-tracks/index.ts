// Supabase Edge Function: classify-tracks
// Estimates sung language, energy, mood, etc. for up to 50 songs per request.
// Secret needed:  supabase secrets set OPENAI_API_KEY=sk-...
// Deploy:         supabase functions deploy classify-tracks

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { SOUND_PROMPT, sanitizeSound } from "../_shared/sound.ts";

const FAMILIES = ["regional-mexicano","urbano-latino","tropical","brasil","rock-en-espanol","latin-pop","k-pop","j-music","hip-hop","rnb-soul","electronic","metal","indie-alt","rock","folk-acoustic","jazz-blues","classical-score","pop"];
const STYLES = ["melodic-house","afro-house","deep-house","tech-house","indie-dance","nu-disco","classic-disco","techno","trance","edm-festival","drum-and-bass","ambient-electronic","classic-soul","funk","neo-soul","modern-rnb","alt-rnb","trap","boom-bap","conscious-rap","pop-rap","mainstream-pop","indie-pop","bedroom-pop","synth-pop","indie-rock","alt-rock","classic-rock","punk","metal","folk","country","jazz","blues","reggaeton","latin-trap","corridos","banda-norteno","cumbia","salsa","bachata","latin-pop","rock-en-espanol","mpb-bossa","k-pop","j-pop","classical","soundtrack","lo-fi"];
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SYSTEM = `You are a music analyst. For each song you receive, estimate how it SOUNDS so an app can build playlists that flow without skips.
Use your knowledge of the specific song when you know it; otherwise infer from the artist, album, year and genres.

Return ONLY JSON, no prose and no markdown fences, with this exact shape:
{"results": [ ...one object per song, same order... ]}

Each object has exactly these keys:
- "id": the id you received
- "lang": language the lyrics are SUNG in (not the title language). One of: "es","en","pt","fr","it","de","ko","ja","zh","instrumental","other". Mostly-Spanish songs with a few English words are "es". Use "instrumental" ONLY if the song has no vocals at all. If it has any vocals, even a few lines, a hook or a vocal sample, use the language of those vocals (e.g. a house track with a short English vocal is "en").
- "energy": 0 to 1 (0 = very calm, 1 = very intense)
- "valence": 0 to 1 (0 = sad/dark, 1 = happy/bright)
- "danceability": 0 to 1
- "tempo": approximate BPM as a number
- "mood": one of "chill","melancholic","romantic","upbeat","party","intense","dreamy","empowering"
- "original_year": the year the song was FIRST released (not a remaster, compilation or reissue year). If you are not sure, return the album year you received.
- "family": the song's genre family, ONLY one of: "regional-mexicano","urbano-latino","tropical","brasil","rock-en-espanol","latin-pop","k-pop","j-music","hip-hop","rnb-soul","electronic","metal","indie-alt","rock","folk-acoustic","jazz-blues","classical-score","pop"
- "style": how the song SOUNDS (production, rhythm, scene), not just the artist's genre. A house remix of a pop song is "melodic-house" or "afro-house", not "mainstream-pop". ONLY one of: "melodic-house","afro-house","deep-house","tech-house","indie-dance","nu-disco","classic-disco","techno","trance","edm-festival","drum-and-bass","ambient-electronic","classic-soul","funk","neo-soul","modern-rnb","alt-rnb","trap","boom-bap","conscious-rap","pop-rap","mainstream-pop","indie-pop","bedroom-pop","synth-pop","indie-rock","alt-rock","classic-rock","punk","metal","folk","country","jazz","blues","reggaeton","latin-trap","corridos","banda-norteno","cumbia","salsa","bachata","latin-pop","rock-en-espanol","mpb-bossa","k-pop","j-pop","classical","soundtrack","lo-fi"${SOUND_PROMPT}`;

interface InputTrack {
  id: string;
  name: string;
  artists: string[];
  album: string;
  year: number | null;
  genres: string[];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    const body = (await req.json()) as { tracks: InputTrack[] };
    let tracks = body.tracks;
    if (!Array.isArray(tracks) || tracks.length === 0 || tracks.length > 50) {
      return json({ error: "Send between 1 and 50 tracks." }, 400);
    }

    const apiKey = Deno.env.get("OPENAI_API_KEY");
    if (!apiKey) return json({ error: "OPENAI_API_KEY is not set." }, 500);

    // Songs any user already analyzed come from the shared table; only the rest go to the AI.
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: shared } = await admin.from("track_analysis_global")
      .select("spotify_track_id, lang, energy, valence, danceability, tempo, mood, original_year, family, style, instruments, texture, warmth, scale, groove")
      .in("spotify_track_id", tracks.map((t) => t.id)).eq("style_checked", true).not("lang", "is", null);
    const reused = (shared ?? []).map((r: any) => ({ ...r, id: r.spotify_track_id, shared: true }));
    const have = new Set(reused.map((r: any) => r.id));
    tracks = tracks.filter((t) => !have.has(t.id));
    if (!tracks.length) return json({ results: reused });

    const list = tracks
      .map((t, i) =>
        `${i + 1}. id=${t.id} | "${String(t.name).slice(0, 200)}" by ${t.artists.join(", ")} | album: ${t.album} | year: ${t.year ?? "?"} | genres: ${t.genres.join(", ") || "none"}`,
      )
      .join("\n");

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini", // fast and cheap, good enough for this task
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: list },
        ],
      }),
    });

    if (!res.ok) return json({ error: `AI request failed (${res.status})` }, 502);

    const data = await res.json();
    const text = String(data.choices?.[0]?.message?.content ?? "").trim();

    const parsed = JSON.parse(text);
    const validIds = new Set(tracks.map((t) => t.id));
    const arr = Array.isArray(parsed) ? parsed : parsed?.results;
    const maxYear = new Date().getFullYear();
    const results = (Array.isArray(arr) ? arr.filter((r) => r && validIds.has(r.id)) : []).map((r) => {
      const y = Number(r.original_year);
      return { ...r, original_year: Number.isInteger(y) && y >= 1900 && y <= maxYear ? y : null, family: FAMILIES.includes(r.family) ? r.family : null, style: STYLES.includes(r.style) ? r.style : null, ...sanitizeSound(r) };
    });
    return json({ results: [...reused, ...results] });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : "Unknown error" }, 500);
  }
});
