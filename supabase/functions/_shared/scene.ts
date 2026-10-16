// Scene pass: for electronic dance songs only, a stronger OpenAI model picks the sound
// scene and re-describes instruments/texture/warmth/scale, comparing songs of the same style.
import { INSTRUMENTS, sanitizeSound } from "./sound.ts";

export const SCENES = ["keinemusik-afro-organic","afterlife-melodic-techno","anjunadeep-emotional","innervisions-deep","diynamic-melodic","organic-downtempo","afro-house-south-african","tech-house-club","minimal-deep-tech","jazzy-soulful-house","nu-disco-french-touch","indie-dance-vocal","progressive-trance","big-room-festival"];
export const DANCE_STYLES = ["melodic-house","afro-house","deep-house","tech-house","indie-dance","nu-disco","techno","trance","drum-and-bass","edm-festival"];

// Strongest full (non-mini) model first; falls back if the key has no access to it.
const MODELS = ["gpt-5.2", "gpt-5.1", "gpt-5", "gpt-4.1"];
let chosen: string | null = null;

const SYSTEM = `You are an expert electronic music curator. For each song, describe its real SOUND.
"scene": choose the scene whose sound is closest to THIS specific song (not just the artist; if it is a remix, the remixer's scene). Think about labels, DJs and events associated with each. ONLY one of: ${SCENES.map((s) => `"${s}"`).join(",")}.
"instruments": 2 to 5 main sound elements, ONLY from: ${INSTRUMENTS.map((x) => `"${x}"`).join(",")} ("organic-percussion" = congas, bongos, shakers).
"texture": 0 = fully organic/acoustic, 1 = fully synthetic/electronic.
"warmth": 0 = cold/dark, 1 = warm/sunny.
"scale": 0 = intimate/minimal, 1 = epic/festival.
Compare the songs in the batch with each other. texture, warmth and scale must use the full 0–1 range to tell them apart; do not repeat the same value for all.
If you don't know a song, infer from the artist/remixer and the style, and list one instrument fewer.
Return ONLY JSON: {"results":[{"id":"<id>","scene":"...","instruments":[...],"texture":0.0,"warmth":0.0,"scale":0.0}]}`;

export async function classifyScenes(apiKey: string, style: string, songs: { id: string; line: string }[]) {
  const user = `All songs are style "${style}".\n` + songs.map((s, i) => `${i + 1}. id=${s.id} | ${s.line}`).join("\n");
  const models = chosen ? [chosen] : MODELS;
  for (const model of models) {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, response_format: { type: "json_object" }, messages: [{ role: "system", content: SYSTEM }, { role: "user", content: user }] }),
    });
    if ((res.status === 404 || res.status === 400 || res.status === 403) && !chosen) {
      console.log(`[scene] model ${model} unavailable (${res.status})`); continue;
    }
    if (!res.ok) return { status: res.status, rows: [] as any[] };
    chosen = model;
    const data = await res.json();
    let parsed: any = {};
    try { parsed = JSON.parse(String(data.choices?.[0]?.message?.content ?? "{}")); } catch { /* skip */ }
    const valid = new Set(songs.map((s) => s.id));
    const rows = (Array.isArray(parsed?.results) ? parsed.results : []).filter((r: any) => r && valid.has(r.id)).map((r: any) => {
      const snd = sanitizeSound(r);
      return {
        id: r.id as string,
        scene: SCENES.includes(r.scene) ? r.scene : null,
        instruments: snd.instruments, texture: snd.texture, warmth: snd.warmth, scale: snd.scale,
        scene_checked: true,
      };
    });
    return { status: 200, rows, model };
  }
  return { status: 404, rows: [] as any[] };
}
