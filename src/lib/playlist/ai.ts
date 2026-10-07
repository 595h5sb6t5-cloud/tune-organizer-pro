// AI enrichment. Spotify no longer exposes audio features (energy, tempo,
// valence…), so Tempo fills them from:
//   1. the Deep Analysis already stored for the song (ai_track_analysis), or
//   2. a previous classify-tracks result stored in track_ai_classification, or
//   3. a new classify-tracks call (batches of 40), whose results are stored.
// If anything fails, the songs keep their heuristic values.

import { supabase } from "@/integrations/supabase/client";
import type { Lang, Mood, TrackProfile } from "./features";

const BATCH_SIZE = 40;

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
      .select("spotify_track_id, lang, energy, valence, danceability, tempo, mood, original_year, year_checked")
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

export async function enrichWithAI(
  profiles: TrackProfile[],
  onProgress?: (done: number, total: number) => void,
): Promise<TrackProfile[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return profiles;

  const [deep, stored] = await Promise.all([loadDeepAnalysis(user.id), loadStoredClassifications(user.id)]);
  const complete = (d?: Partial3) => !!d && !!d.lang && d.energy != null && !!d.mood;

  // Songs never classified, or classified before original_year existed, go to the AI once.
  const missing = profiles.filter((p) => !stored.get(p.id)?.year_checked);
  let done = 0;

  for (let i = 0; i < missing.length; i += BATCH_SIZE) {
    const batch = missing.slice(i, i + BATCH_SIZE);
    try {
      const { data, error } = await supabase.functions.invoke("classify-tracks", {
        body: {
          tracks: batch.map((p) => ({
            id: p.id,
            name: p.name,
            artists: p.artists,
            album: p.album,
            year: p.year,
            genres: p.genres.slice(0, 6),
          })),
        },
      });
      if (!error && Array.isArray(data?.results)) {
        const rows = [];
        for (const r of data.results) {
          const info = sanitize({ ...r, year_checked: true });
          if (!info) continue;
          stored.set(info.id, info);
          rows.push({
            user_id: user.id, spotify_track_id: info.id, lang: info.lang, energy: info.energy,
            valence: info.valence, danceability: info.danceability, tempo: info.tempo, mood: info.mood,
            original_year: info.original_year ?? null, year_checked: true,
          });
        }
        if (rows.length) {
          await supabase.from("track_ai_classification").upsert(rows, { onConflict: "user_id,spotify_track_id" });
        }
      }
    } catch {
      // A failed batch just falls back to heuristics for those songs.
    }
    done += batch.length;
    onProgress?.(done, missing.length);
  }

  return profiles.map((p) => {
    const d = deep.get(p.id);
    const ai = stored.get(p.id);
    let out = p;
    if (ai) out = apply(out, ai, true);
    if (d) out = apply(out, d, false); // Deep Analysis wins where present
    if (ai?.original_year) out = { ...out, year: ai.original_year };
    return out;
  });
}
