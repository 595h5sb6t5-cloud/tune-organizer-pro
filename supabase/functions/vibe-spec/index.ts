// Edge Function: vibe-spec — turns vibe keywords into a strict playlist "recipe".
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MOODS = ["chill", "melancholic", "romantic", "upbeat", "party", "intense", "dreamy", "empowering"];
const FAMILIES = [
  "regional-mexicano", "urbano-latino", "tropical", "brasil", "rock-en-espanol", "latin-pop", "k-pop", "j-music",
  "hip-hop", "rnb-soul", "electronic", "metal", "indie-alt", "rock", "folk-acoustic", "jazz-blues", "classical-score", "pop",
];
const LANGS = ["es", "en", "pt", "fr", "it", "de", "ko", "ja", "zh", "instrumental"];

const SYSTEM = `You are an expert music curator. Interpret the user's vibe keywords the way a seasoned curator would and turn them into a STRICT recipe for a playlist.
Be STRICT with ranges: e.g. "late night drive" = medium-low energy (about 0.3–0.6), no party; "gym" = high energy (0.7–1); "sad" = low valence.
Return ONLY JSON with exactly these keys:
- "energy_min","energy_max","valence_min","valence_max": numbers 0–1
- "tempo_min","tempo_max": BPM numbers
- "moods_allowed","moods_excluded": arrays using ONLY: ${MOODS.join(", ")}
- "preferred_families","excluded_families": arrays using ONLY: ${FAMILIES.join(", ")}
- "language": one of ${LANGS.join(", ")} ONLY if the keywords imply it, otherwise null
- "era_min","era_max": years ONLY if the keywords imply an era, otherwise null
- "name": a short, beautiful playlist name (2–5 words) that captures the vibe. Do NOT copy the keywords literally.`;

const clamp01 = (n: unknown, d: number) => {
  const v = Number(n);
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : d;
};
const pick = (a: unknown, allowed: string[]) =>
  Array.isArray(a) ? [...new Set(a.map(String).filter((x) => allowed.includes(x)))] : [];
const year = (n: unknown) => {
  const v = Number(n);
  return Number.isInteger(v) && v >= 1900 && v <= 2100 ? v : null;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const { vibe } = (await req.json()) as { vibe?: string };
    const text = String(vibe ?? "").trim();
    if (!text || text.length > 300) return json({ error: "Write between 1 and 300 characters." }, 400);

    const apiKey = Deno.env.get("OPENAI_API_KEY");
    if (!apiKey) return json({ error: "OPENAI_API_KEY is not set." }, 500);

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        response_format: { type: "json_object" },
        messages: [{ role: "system", content: SYSTEM }, { role: "user", content: `Vibe: ${text}` }],
      }),
    });
    if (!res.ok) return json({ error: `AI request failed (${res.status})` }, 502);
    const data = await res.json();
    const r = JSON.parse(String(data.choices?.[0]?.message?.content ?? "{}"));

    let eMin = clamp01(r.energy_min, 0), eMax = clamp01(r.energy_max, 1);
    if (eMin > eMax) [eMin, eMax] = [eMax, eMin];
    let vMin = clamp01(r.valence_min, 0), vMax = clamp01(r.valence_max, 1);
    if (vMin > vMax) [vMin, vMax] = [vMax, vMin];
    let tMin = Number(r.tempo_min) || 50, tMax = Number(r.tempo_max) || 200;
    if (tMin > tMax) [tMin, tMax] = [tMax, tMin];

    return json({
      energy_min: eMin, energy_max: eMax, valence_min: vMin, valence_max: vMax,
      tempo_min: tMin, tempo_max: tMax,
      moods_allowed: pick(r.moods_allowed, MOODS),
      moods_excluded: pick(r.moods_excluded, MOODS),
      preferred_families: pick(r.preferred_families, FAMILIES),
      excluded_families: pick(r.excluded_families, FAMILIES),
      language: LANGS.includes(r.language) ? r.language : null,
      era_min: year(r.era_min), era_max: year(r.era_max),
      name: String(r.name ?? "").trim().slice(0, 60) || "Your vibe",
    });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : "Unknown error" }, 500);
  }
});
