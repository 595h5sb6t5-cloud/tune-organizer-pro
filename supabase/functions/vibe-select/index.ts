// Edge Function: vibe-select — scores candidate songs 0–10 against a vibe.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SYSTEM = `You are an expert music curator building a playlist for a specific vibe.
For each song, rate 0–10 how well it fits the vibe, thinking about whether a listener in that moment would SKIP it.
Use exactly this scale:
10 = could play right after the seed in the same DJ set or playlist: same style, same feeling.
9 = same style, very close energy and mood.
8 = same or neighbor style, compatible mood.
7 = same sonic world with one small difference (a bit darker, more energetic, or a nearby era); almost nobody would skip it.
6 or less = someone would probably skip it.
Without a seed, read "the seed" as the vibe described by the user.
Use your knowledge of the actual song when you know it.
Return ONLY JSON: {"results":[{"id":"<id>","score":<0-10>}, ...]} with one object per song.`;

interface Cand {
  id: string; name: string; artists: string[]; year: number | null;
  genres: string[]; energy: number | null; mood: string | null;
  style?: string | null; lang?: string | null; families?: string[];
  valence?: number | null; danceability?: number | null; tempo?: number | null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const { vibe, tracks, seeds } = (await req.json()) as { vibe?: string; tracks?: Cand[]; seeds?: Cand[] };
    const v = String(vibe ?? "").trim();
    const seedList = Array.isArray(seeds) ? seeds.slice(0, 3) : [];
    if (v.length > 300 || (!v && !seedList.length)) return json({ error: "Invalid vibe." }, 400);
    if (!Array.isArray(tracks) || tracks.length === 0 || tracks.length > 60) {
      return json({ error: "Send between 1 and 60 tracks." }, 400);
    }
    const apiKey = Deno.env.get("OPENAI_API_KEY");
    if (!apiKey) return json({ error: "OPENAI_API_KEY is not set." }, 500);

    const list = tracks.map((t, i) =>
      `${i + 1}. id=${String(t.id).slice(0, 64)} | "${String(t.name).slice(0, 200)}" by ${(t.artists ?? []).slice(0, 4).join(", ")} | original year: ${t.year ?? "?"} | style: ${t.style ?? "?"} | language: ${t.lang ?? "?"} | genres: ${(t.genres ?? []).slice(0, 5).join(", ") || "none"} | energy: ${t.energy ?? "?"} | mood: ${t.mood ?? "?"}`
    ).join("\n");

    const seedText = seedList.map((t) => `"${String(t.name).slice(0, 200)}" by ${(t.artists ?? []).slice(0, 4).join(", ")}`).join("; ");
    const seedRule = seedText
      ? `\n\nRate how well each song would flow in a playlist that starts with ${seedText}. Think about sound, production, energy, emotion and listening context. A song of the same genre but with a different energy or feeling is NOT an 8.\nSeed details:\n` +
        seedList.map((t) => `- "${t.name}" by ${(t.artists ?? []).slice(0, 4).join(", ")} | original year: ${t.year ?? "?"} | style: ${t.style ?? "?"} | language: ${t.lang ?? "?"} | families: ${(t.families ?? []).join(", ") || "?"} | genres: ${(t.genres ?? []).slice(0, 5).join(", ") || "none"} | energy: ${t.energy ?? "?"} | valence: ${t.valence ?? "?"} | danceability: ${t.danceability ?? "?"} | tempo: ${t.tempo ?? "?"} | mood: ${t.mood ?? "?"}`).join("\n")
      : "";
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: `Vibe: ${v || "(defined by the seed songs)"}${seedRule}\n\nSongs:\n${list}` },
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
