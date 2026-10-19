// AI enrichment. Spotify no longer exposes audio features (energy, tempo,
// valence…), so Tempo fills them from:
//   1. the Deep Analysis already stored for the song (ai_track_analysis), or
//   2. a previous classify-tracks result stored in track_ai_classification, or
//   3. a new classify-tracks call (batches of 40), whose results are stored.
// If anything fails, the songs keep their heuristic values.

import { supabase } from "@/integrations/supabase/client";
import type { Lang, Mood, TrackProfile } from "./features";


export interface AiTrackInfo {
  id: string;
  lang: Lang;
  energy: number;
  valence: number;
  danceability: number;
  tempo: number;
  mood: Mood;
  original_year?: number | null;
  year_checked?: boolean;
  family?: string | null;
  style?: string | null;
  instruments?: string[] | null;
  texture?: number | null; warmth?: number | null; scale?: number | null;
  groove?: string | null;
  scene?: string | null;
  feeling?: string | null; feeling_2?: string | null; melodic_focus?: number | null; arc?: string | null; confidence?: number | null;
  manual_sound?: ManualSound | null;
}

export interface ManualSound {
  scene?: string | null; instruments?: string[];
  feeling?: string | null; feeling_2?: string | null; melodic_focus?: number | null; arc?: string | null; texture?: number | null; warmth?: number | null; scale?: number | null;
}

const LANGS: Lang[] = ["es", "en", "pt", "fr", "it", "de", "ko", "ja", "zh", "instrumental", "other"];
const MOODS: Mood[] = ["chill", "melancholic", "romantic", "upbeat", "party", "intense", "dreamy", "empowering"];
const LANG_NAMES: Record<string, Lang> = {
  english: "en", spanish: "es", portuguese: "pt", french: "fr", italian: "it", german: "de",
  korean: "ko", japanese: "ja", chinese: "zh", instrumental: "instrumental",
};
const TEMPO_BPM: Record<string, number> = { slow: 75, mid: 105, driving: 122, fast: 140 };

export const isAiEnabled = () => true;

function clamp01(n: unknown): number {
  const v = Number(n);
  return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0.5;
}

function validYear(n: unknown): number | null {
  const y = Number(n);
  return Number.isInteger(y) && y >= 1900 && y <= new Date().getFullYear() ? y : null;
}

function sanitize(raw: any): AiTrackInfo | null {
  if (!raw || typeof raw.id !== "string") return null;
  const tempo = Number(raw.tempo);
  return {
    id: raw.id,
    lang: LANGS.includes(raw.lang) ? raw.lang : "other",
    energy: clamp01(raw.energy),
    valence: clamp01(raw.valence),
    danceability: clamp01(raw.danceability),
    tempo: Number.isFinite(tempo) && tempo >= 50 && tempo <= 220 ? tempo : 110,
    mood: MOODS.includes(raw.mood) ? raw.mood : "chill",
    original_year: validYear(raw.original_year),
    year_checked: !!raw.year_checked,
    family: typeof raw.family === "string" ? raw.family : null,
    style: typeof raw.style === "string" ? raw.style : null,
    instruments: Array.isArray(raw.instruments) ? raw.instruments : null,
    texture: typeof raw.texture === "number" ? raw.texture : null,
    warmth: typeof raw.warmth === "number" ? raw.warmth : null,
    scale: typeof raw.scale === "number" ? raw.scale : null,
    groove: typeof raw.groove === "string" ? raw.groove : null,
    scene: typeof raw.scene === "string" ? raw.scene : null,
    feeling: typeof raw.feeling === "string" ? raw.feeling : null,
    feeling_2: typeof raw.feeling_2 === "string" ? raw.feeling_2 : null,
    melodic_focus: typeof raw.melodic_focus === "number" ? raw.melodic_focus : null,
    arc: typeof raw.arc === "string" ? raw.arc : null,
    confidence: typeof raw.confidence === "number" ? raw.confidence : null,
    manual_sound: raw.manual_sound && typeof raw.manual_sound === "object" ? raw.manual_sound : null,
  };
}

async function fetchAll<T>(build: (from: number, to: number) => any): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(from, from + 999);
    if (error) return out;
    out.push(...(data ?? []));
    if (!data || data.length < 1000) return out;
  }
}

function toLang(raw: unknown): Lang | null {
  const s = String(raw ?? "").toLowerCase().trim();
  if (!s) return null;
  if (LANGS.includes(s as Lang)) return s as Lang;
  return LANG_NAMES[s] ?? null;
}

function toMood(raw: unknown): Mood | null {
  const s = String(raw ?? "").toLowerCase();
  return MOODS.find((m) => s.includes(m)) ?? null;
}

type Partial3 = Partial<Omit<AiTrackInfo, "id">>;

/** Deep Analysis values already stored for the user's songs. */
async function loadDeepAnalysis(userId: string): Promise<Map<string, Partial3>> {
  const rows = await fetchAll<any>((a, b) =>
    supabase.from("ai_track_analysis")
      .select("spotify_track_id, language, energy_score, dance_feel, main_mood, tempo_feel, darkness")
      .eq("user_id", userId).range(a, b));
  const map = new Map<string, Partial3>();
  for (const r of rows) {
    if (!r.spotify_track_id) continue;
    map.set(r.spotify_track_id, {
      lang: toLang(r.language) ?? undefined,
      energy: typeof r.energy_score === "number" ? r.energy_score : undefined,
      mood: toMood(r.main_mood) ?? undefined,
      danceability: typeof r.dance_feel === "number" ? r.dance_feel : undefined,
      valence: typeof r.darkness === "number" ? clamp01(1 - r.darkness) : undefined,
      tempo: r.tempo_feel ? TEMPO_BPM[r.tempo_feel] : undefined,
    });
  }
  return map;
}

async function loadStoredClassifications(userId: string): Promise<Map<string, AiTrackInfo>> {
  const rows = await fetchAll<any>((a, b) =>
    supabase.from("track_ai_classification")
      .select("spotify_track_id, lang, energy, valence, danceability, tempo, mood, original_year, year_checked, family, style, instruments, texture, warmth, scale, groove, scene, feeling, feeling_2, melodic_focus, arc, confidence, manual_sound")
      .eq("user_id", userId).range(a, b));
  const map = new Map<string, AiTrackInfo>();
  for (const r of rows) {
    const info = sanitize({ ...r, id: r.spotify_track_id });
    if (info) map.set(info.id, info);
  }
  return map;
}

function apply(p: TrackProfile, info: Partial3, fromAi: boolean): TrackProfile {
  const lang = info.lang
    ? fromAi && p.langConfidence >= 0.85 && info.lang !== "instrumental" ? p.lang : info.lang
    : p.lang;
  return {
    ...p,
    lang,
    langConfidence: info.lang ? Math.max(p.langConfidence, 0.8) : p.langConfidence,
    energy: info.energy ?? p.energy,
    valence: info.valence ?? p.valence,
    danceability: info.danceability ?? p.danceability,
    tempo: info.tempo ?? p.tempo,
    mood: info.mood ?? p.mood,
  };
}

/** Sound heard from public previews (shared per song). Replaces the text-based sound fields. */
async function loadAudio(ids: string[]): Promise<Map<string, any>> {
  const map = new Map<string, any>();
  for (let i = 0; i < ids.length; i += 300) {
    const { data } = await supabase.from("track_audio_analysis")
      .select("spotify_track_id, source, instruments, melodic_focus, percussive_drive, texture, warmth, scale, groove, confidence")
      .in("spotify_track_id", ids.slice(i, i + 300));
    for (const r of data ?? []) map.set(r.spotify_track_id, r);
  }
  return map;
}

export function applyAudio(p: TrackProfile, a: any): TrackProfile {
  if (!a) return p;
  const heard = a.source !== "none";
  return {
    ...p, audioSource: a.source,
    percussiveDrive: a.percussive_drive ?? p.percussiveDrive ?? null,
    // Without a preview the text values stay; only fill gaps.
    instruments: heard && a.instruments?.length ? a.instruments : p.instruments.length ? p.instruments : a.instruments ?? [],
    texture: heard ? a.texture ?? p.texture : p.texture ?? a.texture,
    warmth: heard ? a.warmth ?? p.warmth : p.warmth ?? a.warmth,
    scale: heard ? a.scale ?? p.scale : p.scale ?? a.scale,
    groove: heard ? a.groove ?? p.groove : p.groove ?? a.groove,
    melodicFocus: heard ? a.melodic_focus ?? p.melodicFocus : p.melodicFocus ?? a.melodic_focus,
    // "Sin audio": lower confidence.
    confidence: heard ? p.confidence : Math.min(p.confidence ?? 0.4, 0.4),
  };
}

export async function enrichWithAI(
  profiles: TrackProfile[],
  onProgress?: (done: number, total: number) => void,
): Promise<TrackProfile[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return profiles;

  const [deep, stored, audio] = await Promise.all([loadDeepAnalysis(user.id), loadStoredClassifications(user.id), loadAudio(profiles.map((p) => p.id))]);

  // Missing songs are classified in the background (library-enrich); use stored data now.
  onProgress?.(0, 0);

  return profiles.map((p) => {
    const d = deep.get(p.id);
    const ai = stored.get(p.id);
    let out = p;
    if (ai) out = apply(out, ai, true);
    // Deep Analysis wins where present, except language: the newer classifier
    // only says "instrumental" when there are no vocals at all.
    if (d) out = apply(out, ai ? { ...d, lang: undefined } : d, false);
    if (ai?.style) out = { ...out, style: ai.style };
    if (ai) out = {
      ...out, instruments: ai.instruments ?? [], texture: ai.texture ?? null,
      warmth: ai.warmth ?? null, scale: ai.scale ?? null, groove: ai.groove ?? null, scene: ai.scene ?? null,
      feeling: ai.feeling ?? null, feeling2: ai.feeling_2 ?? null, melodicFocus: ai.melodic_focus ?? null, arc: ai.arc ?? null, confidence: ai.confidence ?? null,
    };
    // Heard sound replaces text sound; feeling/arc stay with listeners.
    out = applyAudio(out, audio.get(p.id));
    // Hand corrections always win over AI values.
    if (ai?.manual_sound) out = applyManualSound(out, ai.manual_sound);
    if (ai?.original_year) out = { ...out, year: ai.original_year };
    // Artists with no stored genres: use the AI's genre family for the song.
    if (!out.families.length && ai?.family) out = { ...out, families: [ai.family] };
    return out;
  });
}

export function applyManualSound(p: TrackProfile, m: ManualSound): TrackProfile {
  return {
    ...p, soundEdited: true,
    scene: m.scene !== undefined ? m.scene : p.scene,
    instruments: m.instruments ?? p.instruments,
    texture: m.texture ?? p.texture, warmth: m.warmth ?? p.warmth, scale: m.scale ?? p.scale,
    feeling: m.feeling !== undefined ? m.feeling : p.feeling,
    feeling2: m.feeling_2 !== undefined ? m.feeling_2 : p.feeling2,
    melodicFocus: m.melodic_focus ?? p.melodicFocus,
    arc: m.arc !== undefined ? m.arc : p.arc,
    confidence: 1,
  };
}

/** Saves a hand correction. The AI never writes manual_sound, so it is never overwritten. */
export async function saveManualSound(p: TrackProfile, m: ManualSound): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Please sign in again.");
  const { data, error } = await supabase.from("track_ai_classification")
    .update({ manual_sound: m as any }).eq("user_id", user.id).eq("spotify_track_id", p.id).select("spotify_track_id");
  if (error) throw new Error(error.message);
  if (!data?.length) {
    const { error: e2 } = await supabase.from("track_ai_classification").insert({
      user_id: user.id, spotify_track_id: p.id, lang: p.lang, energy: p.energy ?? 0.5, valence: p.valence ?? 0.5,
      danceability: p.danceability ?? 0.5, tempo: p.tempo ?? 110, mood: p.mood ?? "chill", manual_sound: m as any,
    });
    if (e2) throw new Error(e2.message);
  }
}

/** Makes sure seeds have a listener-feeling description (strong model), then returns updated seeds. */
/** Seeds with no heard sound yet: Gemini listens to their preview now (a few seconds). */
export async function ensureSeedAudio(seeds: TrackProfile[]): Promise<TrackProfile[]> {
  const missing = seeds.filter((s) => !s.audioSource && !s.soundEdited);
  if (!missing.length) return seeds;
  await supabase.functions.invoke("audio-analyze", { body: { ids: missing.map((s) => s.id) } }).catch(() => null);
  const audio = await loadAudio(missing.map((s) => s.id));
  return seeds.map((s) => (audio.has(s.id) && !s.soundEdited ? applyAudio(s, audio.get(s.id)) : s));
}

export async function ensureSeedFeeling(seeds: TrackProfile[]): Promise<TrackProfile[]> {
  const missing = seeds.filter((s) => (!s.feeling || !s.style) && !s.soundEdited);
  if (!missing.length) return seeds;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return seeds;
  await supabase.functions.invoke("library-enrich", { body: { feel_ids: missing.map((s) => s.id) } }).catch(() => null);
  const { data } = await supabase.from("track_ai_classification")
    .select("spotify_track_id, lang, energy, valence, danceability, tempo, mood, style, family, original_year, scene, instruments, texture, warmth, scale, feeling, feeling_2, melodic_focus, arc, confidence")
    .eq("user_id", user.id).in("spotify_track_id", missing.map((s) => s.id));
  return seeds.map((s) => {
    const r: any = data?.find((x) => x.spotify_track_id === s.id);
    if (!r) return s;
    const base = s.style ? s : apply(s, sanitize({ ...r, id: s.id }) ?? {}, true);
    return {
      ...base, style: r.style ?? s.style, year: r.original_year ?? s.year,
      families: s.families.length ? s.families : r.family ? [r.family] : [],
      scene: r.scene ?? s.scene, instruments: r.instruments ?? s.instruments,
      texture: r.texture ?? s.texture, warmth: r.warmth ?? s.warmth, scale: r.scale ?? s.scale,
      feeling: r.feeling, feeling2: r.feeling_2, melodicFocus: r.melodic_focus, arc: r.arc, confidence: r.confidence,
    };
  });
}
