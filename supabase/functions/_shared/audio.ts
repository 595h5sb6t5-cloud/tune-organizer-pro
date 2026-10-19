// Public 30 s previews (Deezer first, then iTunes) heard by Gemini.
// NOTE: Revisar términos de Deezer antes de lanzar al público (testing only, ≤5 users).
// The audio is only held in memory for the request and is NEVER stored.

export const AUDIO_MODEL = "google/gemini-3.8-flash";
const GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";

const norm = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/\(.*?\)|\[.*?\]/g, " ").split(" - ")[0].replace(/[^a-z0-9]/g, "");

export interface PreviewRef { url: string; source: "deezer" | "itunes" }

export async function findPreview(isrc: string | null, name: string, artist: string): Promise<PreviewRef | null> {
  if (isrc) {
    try {
      const d = await (await fetch(`https://api.deezer.com/track/isrc:${encodeURIComponent(isrc)}`)).json();
      if (d?.preview) return { url: d.preview, source: "deezer" };
    } catch { /* try iTunes */ }
    try {
      const j = await (await fetch(`https://itunes.apple.com/lookup?isrc=${encodeURIComponent(isrc)}&entity=song`)).json();
      const hit = (j?.results ?? []).find((x: any) => x.previewUrl);
      if (hit) return { url: hit.previewUrl, source: "itunes" };
    } catch { /* search */ }
  }
  try {
    const first = artist.split(",")[0].trim();
    const j = await (await fetch(`https://itunes.apple.com/search?entity=song&limit=10&term=${encodeURIComponent(`${name} ${first}`)}`)).json();
    // Title and artist must match, so we never hear the wrong song.
    const hit = (j?.results ?? []).find((x: any) => x.previewUrl && norm(x.trackName ?? "") === norm(name) &&
      String(x.artistName ?? "").toLowerCase().includes(first.toLowerCase()));
    if (hit) return { url: hit.previewUrl, source: "itunes" };
  } catch { /* none */ }
  return null;
}

export async function fetchAudioB64(url: string): Promise<string | null> {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const buf = new Uint8Array(await r.arrayBuffer());
    let bin = "";
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return btoa(bin);
  } catch { return null; }
}

export class GatewayStop extends Error { constructor(public status: number, msg: string) { super(msg); } }
export class GatewayRetry extends Error { constructor(public waitMs: number) { super("rate limited"); } }

export async function gemini(content: any[], runId?: string): Promise<any> {
  const key = Deno.env.get("LOVABLE_API_KEY");
  if (!key) throw new GatewayStop(401, "LOVABLE_API_KEY is not set.");
  const headers: Record<string, string> = { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "X-Lovable-AIG-SDK": "fetch" };
  if (runId) headers["X-Lovable-AIG-Run-ID"] = runId;
  const res = await fetch(GATEWAY, {
    method: "POST", headers,
    body: JSON.stringify({ model: AUDIO_MODEL, response_format: { type: "json_object" }, messages: [{ role: "user", content }] }),
  });
  if (res.status === 429 || res.status >= 500) {
    const ra = Number(res.headers.get("retry-after"));
    throw new GatewayRetry(Number.isFinite(ra) && ra > 0 ? ra * 1000 : 20_000);
  }
  if (!res.ok) {
    let msg = `AI request failed (${res.status})`;
    try { const j = await res.json(); msg = j?.error?.message ?? j?.message ?? msg; } catch { /* keep */ }
    throw new GatewayStop(res.status, msg);
  }
  const j = await res.json();
  return JSON.parse(String(j.choices?.[0]?.message?.content ?? "{}"));
}

const SOUND_KEYS = `{"instruments":[up to 6 lowercase instruments you hear, e.g. "piano","synth pad","log drum","saxophone","guitar","strings","vocal chops","808"],
"piano":true|false,
"melodic_focus":0-1 (0 = driven by rhythm/groove, 1 = driven by melody/harmony),
"percussive_drive":0-1 (0 = barely any drums, 1 = drums/percussion push everything),
"texture":0-1 (0 organic/acoustic, 1 synthetic/electronic),
"warmth":0-1 (0 cold/dark, 1 warm/sunny),
"scale":0-1 (0 intimate, 1 epic),
"groove":"straight"|"swung"|"broken"|"half-time"}`;

export const audioPrompt = (name: string, artist: string) =>
  `Listen to this 30-second preview of "${name}" by ${artist}. Describe ONLY the SOUND you hear (not the emotion). Return JSON exactly:\n${SOUND_KEYS}`;
export const textPrompt = (name: string, artist: string) =>
  `No audio is available for "${name}" by ${artist}. From what you know of this exact recording, describe its SOUND. Return JSON exactly:\n${SOUND_KEYS}`;

const c01 = (n: unknown) => { const v = Number(n); return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : null; };
const GROOVES = ["straight", "swung", "broken", "half-time"];
export function cleanSound(r: any) {
  return {
    instruments: Array.isArray(r?.instruments) ? r.instruments.map((x: unknown) => String(x).toLowerCase().slice(0, 30)).slice(0, 6) : null,
    piano: typeof r?.piano === "boolean" ? r.piano : null,
    melodic_focus: c01(r?.melodic_focus), percussive_drive: c01(r?.percussive_drive),
    texture: c01(r?.texture), warmth: c01(r?.warmth), scale: c01(r?.scale),
    groove: GROOVES.includes(r?.groove) ? r.groove : null,
  };
}
