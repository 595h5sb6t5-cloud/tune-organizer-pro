// Supabase Edge Function: classify-tracks
// Estimates sung language, energy, mood, etc. for up to 50 songs per request.
// Secret needed:  supabase secrets set OPENAI_API_KEY=sk-...
// Deploy:         supabase functions deploy classify-tracks

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
- "lang": language the lyrics are SUNG in (not the title language). One of: "es","en","pt","fr","it","de","ko","ja","zh","instrumental","other". Mostly-Spanish songs with a few English words are "es".
- "energy": 0 to 1 (0 = very calm, 1 = very intense)
- "valence": 0 to 1 (0 = sad/dark, 1 = happy/bright)
- "danceability": 0 to 1
- "tempo": approximate BPM as a number
- "mood": one of "chill","melancholic","romantic","upbeat","party","intense","dreamy","empowering"
- "original_year": the year the song was FIRST released (not a remaster, compilation or reissue year). If you are not sure, return the album year you received.`;

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
    const { tracks } = (await req.json()) as { tracks: InputTrack[] };
    if (!Array.isArray(tracks) || tracks.length === 0 || tracks.length > 50) {
      return json({ error: "Send between 1 and 50 tracks." }, 400);
    }

    const apiKey = Deno.env.get("OPENAI_API_KEY");
    if (!apiKey) return json({ error: "OPENAI_API_KEY is not set." }, 500);

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
      return { ...r, original_year: Number.isInteger(y) && y >= 1900 && y <= maxYear ? y : null };
    });
    return json({ results });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : "Unknown error" }, 500);
  }
});
