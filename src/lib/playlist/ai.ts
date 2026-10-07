// Optional AI enrichment. Spotify no longer exposes audio features (energy, tempo,
// valence…) to new apps, so we ask an LLM, through YOUR backend, to estimate them
// and to confirm the language the song is actually sung in.
// If VITE_CLASSIFY_ENDPOINT is not set, this step is skipped and Tempo uses heuristics only.

import type { Lang, Mood, TrackProfile } from "./features";

const ENDPOINT = import.meta.env.VITE_CLASSIFY_ENDPOINT as string | undefined;
const ENDPOINT_KEY = import.meta.env.VITE_CLASSIFY_API_KEY as string | undefined;
const CACHE_KEY = "tempo.aiTrackInfo.v1";
const BATCH_SIZE = 40;

export interface AiTrackInfo {
  id: string;
  lang: Lang;
  energy: number;
  valence: number;
  danceability: number;
  tempo: number;
  mood: Mood;
}

const LANGS: Lang[] = ["es", "en", "pt", "fr", "it", "de", "ko", "ja", "zh", "instrumental", "other"];
const MOODS: Mood[] = ["chill", "melancholic", "romantic", "upbeat", "party", "intense", "dreamy", "empowering"];

export const isAiEnabled = () => Boolean(ENDPOINT);

function clamp01(n: unknown): number {
  const v = Number(n);
  return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0.5;
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
  };
}

function readCache(): Record<string, AiTrackInfo> {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY) ?? "{}");
  } catch {
    return {};
  }
}

export async function enrichWithAI(
  profiles: TrackProfile[],
  onProgress?: (done: number, total: number) => void,
): Promise<TrackProfile[]> {
  if (!ENDPOINT) return profiles;

  const cache = readCache();
  const missing = profiles.filter((p) => !cache[p.id]);
  let done = 0;

  for (let i = 0; i < missing.length; i += BATCH_SIZE) {
    const batch = missing.slice(i, i + BATCH_SIZE);
    try {
      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(ENDPOINT_KEY ? { Authorization: `Bearer ${ENDPOINT_KEY}`, apikey: ENDPOINT_KEY } : {}),
        },
        body: JSON.stringify({
          tracks: batch.map((p) => ({
            id: p.id,
            name: p.name,
            artists: p.artists,
            album: p.album,
            year: p.year,
            genres: p.genres.slice(0, 6),
          })),
        }),
      });
      if (res.ok) {
        const { results } = await res.json();
        for (const r of results ?? []) {
          const info = sanitize(r);
          if (info) cache[info.id] = info;
        }
        localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
      }
    } catch {
      // A failed batch just falls back to heuristics for those songs.
    }
    done += batch.length;
    onProgress?.(done, missing.length);
  }

  return profiles.map((p) => {
    const ai = cache[p.id];
    if (!ai) return p;
    return {
      ...p,
      // The AI knows the sung language better than a title heuristic,
      // unless the heuristic is very sure (e.g. Korean script in the title).
      lang: p.langConfidence >= 0.85 && ai.lang !== "instrumental" ? p.lang : ai.lang,
      langConfidence: Math.max(p.langConfidence, 0.8),
      energy: ai.energy,
      valence: ai.valence,
      danceability: ai.danceability,
      tempo: ai.tempo,
      mood: ai.mood,
    };
  });
}
