// Edge Function: vibe-spec — turns free vibe text (English or colloquial Mexican Spanish) into a strict playlist "recipe".
import { INSTRUMENTS } from "../_shared/sound.ts";

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
const FEELINGS = ["inspirational", "euphoric", "nostalgic", "melancholic", "introspective", "peaceful", "sensual", "groovy-carefree", "hypnotic", "dark-tense"];
const VOCALS = ["none", "sparse", "soft", "lead", "any"];
const LISTENING = ["background", "focused", "any"];
const MOMENTS = ["sunrise", "day", "golden-hour-sunset", "night", "late-night", "any"];

const SYSTEM = `You are an expert music curator and DJ. Interpret the user's free vibe description the way a seasoned curator would — the text may be in English, Spanish, or colloquial Mexican Spanish (e.g. "chill platica buena", "algo chido para la noche", "pregame"). Translate the SITUATION into how the music should SOUND: voices, instruments, energy, warmth, whether it is background music or for attentive listening.
Be STRICT with ranges: e.g. "late night drive" = medium-low energy (about 0.3–0.6), no party; "gym" = high energy (0.7–1); "sad" = low valence.
Return ONLY JSON with exactly these keys:
- "energy_min","energy_max","valence_min","valence_max": numbers 0–1
- "tempo_min","tempo_max": BPM numbers
- "moods_allowed","moods_excluded": arrays using ONLY: ${MOODS.join(", ")}
- "preferred_families","excluded_families": arrays using ONLY: ${FAMILIES.join(", ")}
- "language": one of ${LANGS.join(", ")} ONLY if the keywords imply it, otherwise null
- "era_min","era_max": years ONLY if the keywords imply an era, otherwise null
- "vocals": one of ${VOCALS.join(", ")} — "none" when the user asks for instrumental / no voices; "sparse" or "soft" when voices should not be protagonists (e.g. background music for talking); "lead" when the user wants songs with a singer up front; "any" when unspecified
- "listening": one of ${LISTENING.join(", ")} — "background" when the music accompanies an activity without distracting (talking, studying, dinner); with "background" the music must have STEADY energy, no sudden changes, no drops, no protagonist vocals. "focused" when the user will listen with attention; "any" when unspecified
- "moment": one of ${MOMENTS.join(", ")} — the time of day the description evokes ("sunset", "atardecer", "golden hour" → "golden-hour-sunset"; "late night", "madrugada" → "late-night"; "noche" → "night"); "any" when unspecified
- "instruments_preferred","instruments_excluded": arrays using ONLY items from: ${INSTRUMENTS.join(", ")}
- "warmth_min","warmth_max","texture_min","texture_max","percussive_drive_min","percussive_drive_max","melodic_focus_min","melodic_focus_max": numbers 0–1 (use the full 0–1 range when the description says nothing about them)
- "feelings_allowed": array using ONLY: ${FEELINGS.join(", ")} — the feelings (main or secondary) a song may have; empty array when unspecified
- "clarify": null, or {"question": "...", "options": ["...", "..."]} — ONLY when the description is so ambiguous that a curator could not choose a sound (e.g. "algo chido para la noche"): ONE short question in the user's language with 2–3 short answer options (e.g. "¿Para bailar o para relajarte?"). When the description is clear enough, null.
- "name": 2 or 3 words, simple and elegant, evoking the feeling or the moment — never the genre (e.g. "Golden Hour", "Velvet Nights", "Slow Sundays", "Midnight Blue", "Sunday Soul", "Open Roads"). Do NOT copy the keywords literally. FORBIDDEN: "Vibes", "Flow", "Grooves", "Mix", middle dots (·), genre or scene names, years or decades, song titles.
Examples of how to think:
- "chill platica buena" → background, vocals sparse/soft, steady mid-low energy, warm, no drops or sudden changes.
- "full instrumental sunset" → vocals none, warm and golden, mid energy coming down, melodic.
- "sunset inspirational instruments" → melodic, lifting instruments (piano, strings, synths), warm, emotional build.
- "pregame" → high rising energy, to get hyped, vocals and choruses welcome.
- "late night drive" → nocturnal, hypnotic or introspective, steady mid energy, spacious.
If SEED SONGS are given: the recipe must describe the sound and feeling of the seeds; the keywords only adjust it and must never contradict the seeds. Center the ranges on the seeds' values: energy within ±0.15 of the seeds, tempo within ±12 BPM of the seeds (half/double time counts as the same feel). "language" = the seeds' language (null if instrumental). The name must reflect the seeds' sound and feeling (style, instruments, feeling, arc) plus the keywords and must NEVER contain a seed's title or artist.
If USER CORRECTIONS are given: they show how this user corrected past interpretations (phrase → corrected recipe). Apply the same preferences when the new description is similar.`;

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
const one = (v: unknown, allowed: string[], d: string) => (typeof v === "string" && allowed.includes(v) ? v : d);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const body = (await req.json()) as { vibe?: string; seeds?: any[]; corrections?: any[]; warm?: boolean };
    if (body.warm) return json({ ok: true });
    const { vibe, seeds } = body;
    const text = String(vibe ?? "").trim();
    const seedList = Array.isArray(seeds) ? seeds.slice(0, 3) : [];
    if (text.length > 300 || (!text && !seedList.length)) return json({ error: "Write between 1 and 300 characters." }, 400);
    const seedText = seedList.map((t, i) =>
      `${i + 1}. "${String(t.name).slice(0, 200)}" by ${(t.artists ?? []).slice(0, 4).join(", ")} | year: ${t.year ?? "?"} | genres: ${(t.genres ?? []).slice(0, 6).join(", ") || "none"} | language: ${t.lang ?? "?"} | energy: ${t.energy ?? "?"} | valence: ${t.valence ?? "?"} | danceability: ${t.danceability ?? "?"} | tempo: ${t.tempo ?? "?"} | mood: ${t.mood ?? "?"} | style: ${t.style ?? "?"} | scene: ${t.scene ?? "?"} | instruments: ${(t.instruments ?? []).slice(0, 6).join(", ") || "?"} | feeling: ${t.feeling ?? "?"}${t.feeling_2 ? ` / ${t.feeling_2}` : ""} | arc: ${t.arc ?? "?"} | melodic_focus: ${t.melodic_focus ?? "?"}`
    ).join("\n");
    const corrections = (Array.isArray(body.corrections) ? body.corrections : []).slice(0, 10)
      .map((c: any) => `- "${String(c?.phrase ?? "").slice(0, 120)}" → ${JSON.stringify(c?.spec ?? {}).slice(0, 400)}`)
      .filter((s: string) => s.length > 10);
    const userMsg = `Vibe keywords: ${text || "(none — use only the seeds)"}`
      + (seedText ? `\n\nSEED SONGS:\n${seedText}` : "")
      + (corrections.length ? `\n\nUSER CORRECTIONS:\n${corrections.join("\n")}` : "");

    const apiKey = Deno.env.get("OPENAI_API_KEY");
    if (!apiKey) return json({ error: "OPENAI_API_KEY is not set." }, 500);

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        response_format: { type: "json_object" },
        messages: [{ role: "system", content: SYSTEM }, { role: "user", content: userMsg }],
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
    const range = (lo: unknown, hi: unknown): [number, number] => {
      let a = clamp01(lo, 0), b = clamp01(hi, 1);
      if (a > b) [a, b] = [b, a];
      return [a, b];
    };
    const [wMin, wMax] = range(r.warmth_min, r.warmth_max);
    const [xMin, xMax] = range(r.texture_min, r.texture_max);
    const [dMin, dMax] = range(r.percussive_drive_min, r.percussive_drive_max);
    const [fMin, fMax] = range(r.melodic_focus_min, r.melodic_focus_max);
    const clarify = r.clarify && typeof r.clarify === "object" && typeof r.clarify.question === "string" && Array.isArray(r.clarify.options)
      ? { question: String(r.clarify.question).slice(0, 200), options: r.clarify.options.map(String).slice(0, 3) }
      : null;

    return json({
      energy_min: eMin, energy_max: eMax, valence_min: vMin, valence_max: vMax,
      tempo_min: tMin, tempo_max: tMax,
      moods_allowed: pick(r.moods_allowed, MOODS),
      moods_excluded: pick(r.moods_excluded, MOODS),
      preferred_families: pick(r.preferred_families, FAMILIES),
      excluded_families: pick(r.excluded_families, FAMILIES),
      language: LANGS.includes(r.language) ? r.language : null,
      era_min: year(r.era_min), era_max: year(r.era_max),
      vocals: one(r.vocals, VOCALS, "any"),
      listening: one(r.listening, LISTENING, "any"),
      moment: one(r.moment, MOMENTS, "any"),
      instruments_preferred: pick(r.instruments_preferred, INSTRUMENTS),
      instruments_excluded: pick(r.instruments_excluded, INSTRUMENTS),
      warmth_min: wMin, warmth_max: wMax,
      texture_min: xMin, texture_max: xMax,
      percussive_drive_min: dMin, percussive_drive_max: dMax,
      melodic_focus_min: fMin, melodic_focus_max: fMax,
      feelings_allowed: pick(r.feelings_allowed, FEELINGS),
      clarify,
      name: String(r.name ?? "").trim().slice(0, 60) || "Your vibe",
    });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : "Unknown error" }, 500);
  }
});
