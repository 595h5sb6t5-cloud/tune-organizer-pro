// Sound profile fields shared by classify-tracks and library-enrich.
export const INSTRUMENTS = ["analog-synth-pads","arpeggiated-synths","epic-synth-leads","acid-synth","sub-bass","electric-bass","upright-bass","808","four-on-the-floor-kick","broken-beat-drums","live-drums","organic-percussion","afro-percussion","marimba-kalimba","acoustic-guitar","electric-guitar","piano","rhodes-keys","organ","saxophone","trumpet-brass","strings","flute-ethnic-winds","vocal-chops","lead-vocals","choir"];
export const SCENES = ["keinemusik-afro-organic","afterlife-melodic-techno","anjunadeep-emotional","innervisions-deep","diynamic-melodic","organic-downtempo","afro-house-south-african","tech-house-club","minimal-deep-tech","jazzy-soulful-house","nu-disco-french-touch","indie-dance-vocal","progressive-trance","big-room-festival"];
export const DANCE_STYLES = ["melodic-house","afro-house","deep-house","tech-house","indie-dance","nu-disco","techno","trance","drum-and-bass","edm-festival"];
// Non-dance styles close to melodic electronic: also get the strong feeling pass.
export const FEEL_EXTRA_STYLES = ["ambient-electronic","indie-dance","nu-disco","synth-pop","indie-pop","lo-fi","soundtrack","classical"];
export const FEELINGS = ["inspirational","euphoric","nostalgic","melancholic","introspective","peaceful","sensual","groovy-carefree","hypnotic","dark-tense"];
export const ARCS = ["steady-groove","slow-build-climax","peaks-and-drops","floating-ambient"];
export const GROOVES = ["straight","swung","broken","half-time"];

export const SOUND_PROMPT = `
- "instruments": 2 to 5 main sound elements of THIS specific song, ONLY from: ${INSTRUMENTS.map((x) => `"${x}"`).join(",")} ("organic-percussion" = congas, bongos, shakers)
- "texture": 0 to 1 (0 = fully organic/acoustic, 1 = fully synthetic/electronic)
- "warmth": 0 to 1 (0 = cold/dark, 1 = warm/sunny)
- "scale": 0 to 1 (0 = intimate/minimal, 1 = epic/festival)
- "groove": one of "straight","swung","broken","half-time"
- "scene": ONLY if style is one of ${DANCE_STYLES.join(", ")}: the scene whose sound is closest to this specific song (not just the artist; for a remix, the remixer's). Think about labels, DJs and events. One of: ${SCENES.join(", ")}. Otherwise null.
For these sound fields: describe the real instrumentation and sound of this specific song (not just the artist). If it is a remix, describe the remix. If you don't know the song, infer from the artist and the style, and list one instrument fewer.`;

const c01 = (n: unknown) => { const v = Number(n); return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : null; };

export function sanitizeSound(r: any) {
  const inst = Array.isArray(r?.instruments) ? [...new Set(r.instruments.filter((x: unknown) => INSTRUMENTS.includes(String(x))))].slice(0, 5) as string[] : [];
  return {
    instruments: inst.length ? inst : null,
    texture: c01(r?.texture), warmth: c01(r?.warmth), scale: c01(r?.scale),
    groove: GROOVES.includes(r?.groove) ? r.groove : null,
    scene: SCENES.includes(r?.scene) ? r.scene : null,
    sound_checked: true,
  };
}
