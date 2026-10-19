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
La instrumentación es lo que más define si una canción encaja. Dos canciones del mismo estilo pero con paletas de instrumentos distintas NO encajan. Ejemplo: con 'Forms Of Love' (house orgánico, cálido, percusión orgánica, groove relajado) NO encajan 'Dune – Moonwalk' (sintetizadores épicos y oscuros, estilo Afterlife) ni 'calvera – fyodor, Apéro' (instrumentación de jazz), aunque tengan energía y mood parecidos. Califica con 6 o menos cualquier canción cuya paleta de instrumentos no se parezca a la de la semilla.
Canciones de escenas distintas no encajan aunque compartan estilo, salvo que sean escenas vecinas.
La pregunta clave es: ¿el oyente seguiría sintiendo lo mismo? Si la semilla te hace sentir inspirado por la melodía y los instrumentos, una canción de groove repetitivo rompe ese sentimiento aunque sea de la misma escena; califícala con 6 o menos. Ejemplo: 'Forms Of Love' (piano tranquilo que crece hasta un clímax melódico e inspiracional) no encaja con house de groove percusivo.
Use your knowledge of the actual song when you know it.
Return ONLY JSON: {"results":[{"n":<song number>,"s":<score 0-10>}, ...]} with one object per song.`;

interface Cand {
  id: string; name: string; artists: string[]; year: number | null;
  genres: string[]; energy: number | null; mood: string | null;
  style?: string | null; lang?: string | null; families?: string[];
  valence?: number | null; danceability?: number | null; tempo?: number | null;
  instruments?: string[]; texture?: number | null; warmth?: number | null; scale?: number | null; groove?: string | null; scene?: string | null; feeling?: string | null; melodic_focus?: number | null; arc?: string | null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const body = (await req.json()) as { vibe?: string; tracks?: Cand[]; seeds?: Cand[]; warm?: boolean };
    if (body.warm) return json({ ok: true });
    const { vibe, tracks, seeds } = body;
    const v = String(vibe ?? "").trim();
    const seedList = Array.isArray(seeds) ? seeds.slice(0, 3) : [];
    if (v.length > 300 || (!v && !seedList.length)) return json({ error: "Invalid vibe." }, 400);
    if (!Array.isArray(tracks) || tracks.length === 0 || tracks.length > 60) {
      return json({ error: "Send between 1 and 60 tracks." }, 400);
    }
    const apiKey = Deno.env.get("OPENAI_API_KEY");
    if (!apiKey) return json({ error: "OPENAI_API_KEY is not set." }, 500);

    const list = tracks.map((t, i) =>
      `${i + 1}. "${String(t.name).slice(0, 200)}" by ${(t.artists ?? []).slice(0, 4).join(", ")} | original year: ${t.year ?? "?"} | style: ${t.style ?? "?"} | language: ${t.lang ?? "?"} | genres: ${(t.genres ?? []).slice(0, 5).join(", ") || "none"} | energy: ${t.energy ?? "?"} | mood: ${t.mood ?? "?"} | instruments: ${(t.instruments ?? []).join(", ") || "?"} | texture: ${t.texture ?? "?"} | warmth: ${t.warmth ?? "?"} | scale: ${t.scale ?? "?"} | groove: ${t.groove ?? "?"} | scene: ${t.scene ?? "?"} | feeling: ${t.feeling ?? "?"} | melodic_focus: ${t.melodic_focus ?? "?"} | arc: ${t.arc ?? "?"}`
    ).join("\n");

    const seedText = seedList.map((t) => `"${String(t.name).slice(0, 200)}" by ${(t.artists ?? []).slice(0, 4).join(", ")}`).join("; ");
    const seedRule = seedText
      ? `\n\nRate how well each song would flow in a playlist that starts with ${seedText}. Think about sound, production, energy, emotion and listening context. A song of the same genre but with a different energy or feeling is NOT an 8.\nSeed details:\n` +
        seedList.map((t) => `- "${t.name}" by ${(t.artists ?? []).slice(0, 4).join(", ")} | original year: ${t.year ?? "?"} | style: ${t.style ?? "?"} | language: ${t.lang ?? "?"} | families: ${(t.families ?? []).join(", ") || "?"} | genres: ${(t.genres ?? []).slice(0, 5).join(", ") || "none"} | energy: ${t.energy ?? "?"} | valence: ${t.valence ?? "?"} | danceability: ${t.danceability ?? "?"} | tempo: ${t.tempo ?? "?"} | mood: ${t.mood ?? "?"} | instruments: ${(t.instruments ?? []).join(", ") || "?"} | texture: ${t.texture ?? "?"} | warmth: ${t.warmth ?? "?"} | scale: ${t.scale ?? "?"} | groove: ${t.groove ?? "?"} | scene: ${t.scene ?? "?"} | feeling: ${t.feeling ?? "?"} | melodic_focus: ${t.melodic_focus ?? "?"} | arc: ${t.arc ?? "?"}`).join("\n")
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
      .map((r: any) => ({ id: r?.id ?? tracks[Number(r?.n) - 1]?.id, score: Number(r?.s ?? r?.score) }))
      .filter((r: any) => r.id && valid.has(r.id) && Number.isFinite(r.score))
      .map((r: any) => ({ id: r.id, score: Math.min(10, Math.max(0, r.score)) }));
    return json({ results });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : "Unknown error" }, 500);
  }
});
