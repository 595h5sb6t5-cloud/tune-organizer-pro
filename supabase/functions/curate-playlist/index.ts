// curate-playlist: final AI "skip test" for one playlist. Returns songs to remove + a name.
// Results are cached per user + exact playlist contents (curator_cache).
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SYSTEM = `Eres un curador musical exigente. Aplica la prueba del skip: si alguien está escuchando esta playlist y le llega esta canción, ¿la dejaría sonar o la saltaría? Una playlist buena vive en un solo mundo sonoro: mismo estilo o estilos vecinos, producción y época compatibles, y el mismo sentimiento. La energía puede variar un poco; el mundo sonoro no.
EJEMPLO BUENO (el usuario la armó a mano): Let's Straighten It Out – O.V. Wright; Inner City Blues – Marvin Gaye; Just The Way You Are – Barry White; Can't Get Enough Of Your Love, Babe – Barry White; Ain't No Love In The Heart Of The City – Bobby "Blue" Bland; Everybody Loves The Sunshine – Roy Ayers Ubiquity; Let's Stay Together – Al Green; Love T.K.O. – Teddy Pendergrass; Love, Love, Love – Donny Hathaway; Walk On By – Dionne Warwick; Grandma's Hands – Bill Withers. Funciona porque todo es soul/R&B de los 60s–70s, producción cálida y analógica, sentimiento romántico y soulful, aunque el tempo varíe.
EJEMPLO MALO: una playlist de house melódico/afro house (WhoMadeWho, Mochakk, RÜFÜS DU SOL, ANOTR, Adriatique) que incluye 'Sunny' de Marvin Gaye, 'Down In Atlanta' de Pharrell y Travis Scott y 'Who You Foolin' de Gunna. Esas tres se deben quitar aunque tengan la misma energía, porque son de otro mundo sonoro.
Quita todo lo que no pase la prueba. Es mejor una playlist de 15 canciones perfecta que una de 40 con 3 skips. El nombre debe ser corto, evocador y describir el mundo sonoro (ej. 'Velvet Soul Sundays', 'Desert Sunrise House'), sin usar 'Mix'.

Responde SOLO JSON con esta forma exacta:
{"remove": [{"id": "<id>", "reason": "<razón corta>"}], "name": "<nombre en inglés>"}`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const json = (b: unknown, status = 200) =>
    new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await sb.auth.getUser(authHeader.replace("Bearer ", ""));
    if (!user) return json({ error: "Unauthorized" }, 401);

    const body = await req.json();
    const tracks = Array.isArray(body?.tracks) ? body.tracks : null;
    if (!tracks || tracks.length < 1 || tracks.length > 120 || tracks.some((t: any) => typeof t?.id !== "string")) {
      return json({ error: "Send between 1 and 120 tracks." }, 400);
    }
    const vibe = typeof body.vibe === "string" ? body.vibe.slice(0, 500) : "";
    const seeds = Array.isArray(body.seeds) ? body.seeds.slice(0, 3).map((s: any) => String(s).slice(0, 200)) : [];

    const keySrc = JSON.stringify({ v: 1, ids: tracks.map((t: any) => t.id).sort(), vibe, seeds });
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(keySrc));
    const key = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
    const { data: cached } = await sb.from("curator_cache").select("result").eq("user_id", user.id).eq("cache_key", key).maybeSingle();
    if (cached?.result) return json({ ...cached.result, cached: true });

    const apiKey = Deno.env.get("OPENAI_API_KEY");
    if (!apiKey) return json({ error: "OPENAI_API_KEY is not set." }, 500);

    const list = tracks.map((t: any, i: number) =>
      `${i + 1}. id=${t.id} | "${String(t.name ?? "").slice(0, 200)}" – ${(t.artists ?? []).join(", ")} | año: ${t.year ?? "?"} | style: ${t.style ?? "?"} | energy: ${t.energy ?? "?"} | mood: ${t.mood ?? "?"}`).join("\n");
    const context = vibe || seeds.length
      ? `Vibe pedido por el usuario: "${vibe}"${seeds.length ? `\nCanciones semilla (deben quedarse, todo debe encajar con ellas): ${seeds.join("; ")}` : ""}\n\n`
      : "";

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        response_format: { type: "json_object" },
        messages: [{ role: "system", content: SYSTEM }, { role: "user", content: `${context}Playlist:\n${list}` }],
      }),
    });
    if (!res.ok) return json({ error: `AI request failed (${res.status})` }, res.status === 429 ? 429 : 502);
    const data = await res.json();
    const parsed = JSON.parse(String(data.choices?.[0]?.message?.content ?? "{}"));
    const valid = new Set(tracks.map((t: any) => t.id));
    const remove = (Array.isArray(parsed?.remove) ? parsed.remove : [])
      .filter((r: any) => r && valid.has(r.id))
      .map((r: any) => ({ id: r.id, reason: String(r.reason ?? "").slice(0, 160) }));
    const name = typeof parsed?.name === "string" ? parsed.name.replace(/\bmix\b/gi, "").trim().slice(0, 80) : "";
    const result = { remove, name };
    await sb.from("curator_cache").upsert({ user_id: user.id, cache_key: key, result }, { onConflict: "user_id,cache_key" });
    return json(result);
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : "Unknown error" }, 500);
  }
});
