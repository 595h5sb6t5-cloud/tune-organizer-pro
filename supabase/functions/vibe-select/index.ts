// Edge Function: vibe-select — scores candidate songs 0–10 against a vibe.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SYSTEM = `You are an expert music curator building a playlist for a specific vibe.
For each song, rate 0–10 how well it fits the vibe, thinking about whether a listener in that moment would SKIP it.
Be demanding: a song that only half fits is a 5. Give 8 or more ONLY if it clearly fits the feeling, the energy and the context.
Use your knowledge of the actual song when you know it.
Return ONLY JSON: {"results":[{"id":"<id>","score":<0-10>}, ...]} with one object per song.`;

interface Cand {
  id: string; name: string; artists: string[]; year: number | null;
  genres: string[]; energy: number | null; mood: string | null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const { vibe, tracks } = (await req.json()) as { vibe?: string; tracks?: Cand[] };
    const v = String(vibe ?? "").trim();
    if (!v || v.length > 300) return json({ error: "Invalid vibe." }, 400);
    if (!Array.isArray(tracks) || tracks.length === 0 || tracks.length > 60) {
      return json({ error: "Send between 1 and 60 tracks." }, 400);
    }
    const apiKey = Deno.env.get("OPENAI_API_KEY");
    if (!apiKey) return json({ error: "OPENAI_API_KEY is not set." }, 500);

    const list = tracks.map((t, i) =>
      `${i + 1}. id=${String(t.id).slice(0, 64)} | "${String(t.name).slice(0, 200)}" by ${(t.artists ?? []).slice(0, 4).join(", ")} | year: ${t.year ?? "?"} | genres: ${(t.genres ?? []).slice(0, 5).join(", ") || "none"} | energy: ${t.energy ?? "?"} | mood: ${t.mood ?? "?"}`
    ).join("\n");

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: `Vibe: ${v}\n\nSongs:\n${list}` },
        ],
      }),
    });
    if (!res.ok) return json({ error: `AI request failed (${res.status})` }, 502);
    const data = await res.json();
    const parsed = JSON.parse(String(data.choices?.[0]?.message?.content ?? "{}"));
    const valid = new Set(tracks.map((t) => t.id));
    const results = (Array.isArray(parsed?.results) ? parsed.results : [])
      .filter((r: any) => r && valid.has(r.id) && Number.isFinite(Number(r.score)))
      .map((r: any) => ({ id: r.id, score: Math.min(10, Math.max(0, Number(r.score))) }));
    return json({ results });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : "Unknown error" }, 500);
  }
});
