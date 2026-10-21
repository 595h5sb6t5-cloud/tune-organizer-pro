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
La instrumentación es lo que más define si una canción encaja. Dos canciones del mismo estilo pero con paletas de instrumentos distintas NO encajan. Ejemplo: con 'Forms Of Love' (house orgánico, cálido, percusión orgánica, groove relajado) NO encajan 'Dune – Moonwalk' (sintetizadores épicos y oscuros, estilo Afterlife) ni 'calvera – fyodor, Apéro' (instrumentación de jazz), aunque tengan energía y mood parecidos. Quita cualquier canción cuya paleta de instrumentos no se parezca a la de la semilla.
Canciones de escenas distintas no encajan aunque compartan estilo, salvo que sean escenas vecinas.
La pregunta clave es: ¿el oyente seguiría sintiendo lo mismo? Si la semilla te hace sentir inspirado por la melodía y los instrumentos, una canción de groove repetitivo rompe ese sentimiento aunque sea de la misma escena; quítala. Ejemplo: 'Forms Of Love' (piano tranquilo que crece hasta un clímax melódico e inspiracional) no encaja con house de groove percusivo.
Quita todo lo que no pase la prueba. Es mejor una playlist de 15 canciones perfecta que una de 40 con 3 skips. El nombre: 2 o 3 palabras, simple y elegante, que evoque el sentimiento o el momento (ej. 'Golden Hour', 'Velvet Nights', 'Slow Sundays', 'Midnight Blue', 'Sunday Soul', 'Open Roads'). PROHIBIDO: 'Vibes', 'Flow', 'Grooves', 'Mix', 'Classics', 'Luminous', 'Timeless', 'Reflections', 'Moods', 'Echoes', 'Layers', 'Pulse', 'Bliss', puntos medios (·), nombres de géneros o escenas (house, soul, rock…), años o décadas, nombres de artistas y títulos de canciones.

Responde SOLO JSON con esta forma exacta:
{"remove": [{"id": "<id>", "reason": "<razón corta>"}], "name": "<nombre en inglés>"}`;

const NAME_SYSTEM = `Eres un curador musical. Las canciones ya fueron elegidas; NO quites ninguna. Solo ponle a la playlist un nombre de 2 o 3 palabras, simple y elegante, que evoque el sentimiento o el momento (ej. 'Golden Hour', 'Velvet Nights', 'Slow Sundays', 'Midnight Blue', 'Sunday Soul', 'Open Roads'). PROHIBIDO: 'Vibes', 'Flow', 'Grooves', 'Mix', 'Classics', 'Luminous', 'Timeless', 'Reflections', 'Moods', 'Echoes', 'Layers', 'Pulse', 'Bliss', puntos medios (·), nombres de géneros o escenas, años o décadas, nombres de artistas y títulos de canciones.
Responde SOLO JSON: {"remove": [], "name": "<nombre>"}`;

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
    if (body?.warm) return json({ ok: true });
    const tracks = Array.isArray(body?.tracks) ? body.tracks : null;
    if (!tracks || tracks.length < 1 || tracks.length > 120 || tracks.some((t: any) => typeof t?.id !== "string")) {
      return json({ error: "Send between 1 and 120 tracks." }, 400);
    }
    const vibe = typeof body.vibe === "string" ? body.vibe.slice(0, 500) : "";
    const nameOnly = body.nameOnly === true;
    const seedStr = (s: any) => typeof s === "string" ? s.slice(0, 200)
      : `"${String(s?.name ?? "").slice(0, 200)}" – ${(Array.isArray(s?.artists) ? s.artists : []).slice(0, 4).join(", ")} | año original: ${s?.year ?? "?"} | style: ${s?.style ?? "?"} | idioma: ${s?.lang ?? "?"} | families: ${(s?.families ?? []).join(", ") || "?"} | genres: ${(s?.genres ?? []).slice(0, 5).join(", ") || "?"} | energy: ${s?.energy ?? "?"} | valence: ${s?.valence ?? "?"} | tempo: ${s?.tempo ?? "?"} | mood: ${s?.mood ?? "?"} | instruments: ${(s?.instruments ?? []).join(", ") || "?"} | texture: ${s?.texture ?? "?"} | warmth: ${s?.warmth ?? "?"} | scale: ${s?.scale ?? "?"} | groove: ${s?.groove ?? "?"} | scene: ${s?.scene ?? "?"} | feeling: ${s?.feeling ?? "?"} | melodic_focus: ${s?.melodic_focus ?? "?"} | arc: ${s?.arc ?? "?"}`;
    const seeds = Array.isArray(body.seeds) ? body.seeds.slice(0, 3).map(seedStr) : [];

    const keySrc = JSON.stringify({ v: 6, nameOnly, ids: tracks.map((t: any) => t.id).sort(), vibe, seeds });
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(keySrc));
    const key = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
    const { data: cached } = await sb.from("curator_cache").select("result").eq("user_id", user.id).eq("cache_key", key).maybeSingle();
    if (cached?.result) return json({ ...cached.result, cached: true });

    const apiKey = Deno.env.get("OPENAI_API_KEY");
    if (!apiKey) return json({ error: "OPENAI_API_KEY is not set." }, 500);

    const list = tracks.map((t: any, i: number) =>
      `${i + 1}. id=${t.id} | "${String(t.name ?? "").slice(0, 200)}" – ${(t.artists ?? []).join(", ")} | año original: ${t.year ?? "?"} | style: ${t.style ?? "?"} | idioma: ${t.lang ?? "?"} | energy: ${t.energy ?? "?"} | mood: ${t.mood ?? "?"} | instruments: ${(t.instruments ?? []).join(", ") || "?"} | texture: ${t.texture ?? "?"} | warmth: ${t.warmth ?? "?"} | scale: ${t.scale ?? "?"} | groove: ${t.groove ?? "?"} | scene: ${t.scene ?? "?"} | feeling: ${t.feeling ?? "?"} | melodic_focus: ${t.melodic_focus ?? "?"} | arc: ${t.arc ?? "?"}`).join("\n");
    const context = vibe || seeds.length
      ? `Vibe pedido por el usuario: "${vibe}"${seeds.length ? `\nCanciones semilla (deben quedarse, todo debe encajar con ellas):\n${seeds.map((x: string) => `- ${x}`).join("\n")}` : ""}\n\n`
      : "";

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        response_format: { type: "json_object" },
        ...(nameOnly ? { max_tokens: 60 } : {}),
        messages: [{ role: "system", content: nameOnly ? NAME_SYSTEM : SYSTEM }, { role: "user", content: `${context}Playlist:\n${list}` }],
      }),
    });
    if (!res.ok) return json({ error: `AI request failed (${res.status})` }, res.status === 429 ? 429 : 502);
    const data = await res.json();
    const parsed = JSON.parse(String(data.choices?.[0]?.message?.content ?? "{}"));
    const valid = new Set(tracks.map((t: any) => t.id));
    const remove = nameOnly ? [] : (Array.isArray(parsed?.remove) ? parsed.remove : [])
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
