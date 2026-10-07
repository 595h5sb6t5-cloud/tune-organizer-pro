// Supabase Edge Function: classify-tracks
// Estimates sung language, energy, mood, etc. for up to 50 songs per request.
// Secret needed:  supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
// Deploy:         supabase functions deploy classify-tracks

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SYSTEM = `You are a music analyst. For each song you receive, estimate how it SOUNDS so an app can build playlists that flow without skips.
Use your knowledge of the specific song when you know it; otherwise infer from the artist, album, year and genres.

Return ONLY a JSON array, no prose and no markdown fences. One object per song, same order, with exactly these keys:
- "id": the id you received
- "lang": language the lyrics are SUNG in (not the title language). One of: "es","en","pt","fr","it","de","ko","ja","zh","instrumental","other". Mostly-Spanish songs with a few English words are "es".
- "energy": 0 to 1 (0 = very calm, 1 = very intense)
- "valence": 0 to 1 (0 = sad/dark, 1 = happy/bright)
- "danceability": 0 to 1
- "tempo": approximate BPM as a number
- "mood": one of "chill","melancholic","romantic","upbeat","party","intense","dreamy","empowering"`;

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

    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) return json({ error: "ANTHROPIC_API_KEY is not set." }, 500);

    const list = tracks
      .map((t, i) =>
        `${i + 1}. id=${t.id} | "${String(t.name).slice(0, 200)}" by ${t.artists.join(", ")} | album: ${t.album} | year: ${t.year ?? "?"} | genres: ${t.genres.join(", ") || "none"}`,
      )
      .join("\n");

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001", // fast and cheap, good enough for this task
        max_tokens: 6000,
        system: SYSTEM,
        messages: [{ role: "user", content: list }],
      }),
    });

    if (!res.ok) return json({ error: `AI request failed (${res.status})` }, 502);

    const data = await res.json();
    const text = (data.content ?? [])
      .filter((b: { type: string }) => b.type === "text")
      .map((b: { text: string }) => b.text)
      .join("")
      .replace(/```json|```/g, "")
      .trim();

    const parsed = JSON.parse(text);
    const validIds = new Set(tracks.map((t) => t.id));
    const results = Array.isArray(parsed) ? parsed.filter((r) => r && validIds.has(r.id)) : [];
    return json({ results });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : "Unknown error" }, 500);
  }
});
