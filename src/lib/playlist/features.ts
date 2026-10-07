// Builds a "profile" for every track using what Spotify still gives us in 2026
// (title, artists, album, release year, explicit flag, ISRC, artist genres).
// Energy / mood / tempo come later from the optional AI step (ai.ts).

import type { SpotifyTrack } from "../spotify/api";

export type Lang =
  | "es" | "en" | "pt" | "fr" | "it" | "de" | "ko" | "ja" | "zh"
  | "instrumental" | "other" | "unknown";

export type Mood =
  | "chill" | "melancholic" | "romantic" | "upbeat"
  | "party" | "intense" | "dreamy" | "empowering";

export interface TrackProfile {
  id: string;
  uri: string;
  name: string;
  artists: string[];
  artistIds: string[];
  album: string;
  albumId: string;
  image: string | null;
  year: number | null;
  explicit: boolean;
  durationMs: number;
  genres: string[];
  families: string[];
  lang: Lang;
  langConfidence: number; // 0–1
  // Filled by the AI step (null = unknown)
  energy: number | null; // 0–1
  valence: number | null; // 0–1 (sad → happy)
  danceability: number | null; // 0–1
  tempo: number | null; // approx. BPM
  mood: Mood | null;
}

// ---------- Genre families ----------
// Order matters: specific families first, generic ones ("pop", "rock") last.
const FAMILY_RULES: [string, RegExp][] = [
  ["regional-mexicano", /corrido|banda|norte[ñn]|grupero|mariachi|ranchera|sierre[ñn]|regional mexican|tumbado|duranguense/],
  ["urbano-latino", /reggaeton|urbano latino|trap latino|latin trap|latin hip hop|dembow|perreo|trap argentino|rkt/],
  ["tropical", /salsa|bachata|merengue|cumbia|vallenato|tropical|son cubano/],
  ["brasil", /brazil|brasil|mpb|sertanejo|funk carioca|pagode|forr[oó]|axé|bossa nova/],
  ["rock-en-espanol", /rock en espa|latin rock|rock mexicano|rock argentino|rock chileno|rock urbano/],
  ["latin-pop", /latin pop|pop latino|pop mexicano|pop en espa|latin|bolero|balada/],
  ["k-pop", /k-pop|k-rap|k-indie|korean/],
  ["j-music", /j-pop|j-rock|anime|japanese|city pop|vocaloid/],
  ["hip-hop", /hip hop|rap|trap|drill|grime|boom bap/],
  ["rnb-soul", /r&b|soul|funk|motown/],
  ["electronic", /house|techno|edm|electro|trance|dubstep|drum and bass|dnb|disco|synthwave|hyperpop|garage/],
  ["metal", /metal|metalcore|deathcore|hardcore/],
  ["indie-alt", /indie|alternative|shoegaze|dream pop|bedroom pop|lo-fi|post-punk|emo|slowcore/],
  ["rock", /rock|punk|grunge/],
  ["folk-acoustic", /folk|singer-songwriter|acoustic|country|americana/],
  ["jazz-blues", /jazz|blues|swing/],
  ["classical-score", /classical|orchestra|soundtrack|score|neoclassical|ambient|piano/],
  ["pop", /pop/],
];

export function genreFamilies(genres: string[]): string[] {
  const out = new Set<string>();
  for (const g of genres) {
    const genre = g.toLowerCase();
    const hit = FAMILY_RULES.find(([, re]) => re.test(genre));
    if (hit) out.add(hit[0]);
  }
  return [...out];
}

export const FAMILY_LABEL: Record<string, string> = {
  "regional-mexicano": "Regional Mexicano",
  "urbano-latino": "Urbano Latino",
  tropical: "Tropical",
  brasil: "Brasil",
  "rock-en-espanol": "Rock en Español",
  "latin-pop": "Pop Latino",
  "k-pop": "K-Pop",
  "j-music": "J-Music",
  "hip-hop": "Hip-Hop",
  "rnb-soul": "R&B / Soul",
  electronic: "Electronic",
  metal: "Metal",
  "indie-alt": "Indie / Alt",
  rock: "Rock",
  "folk-acoustic": "Folk & Acoustic",
  "jazz-blues": "Jazz & Blues",
  "classical-score": "Instrumental",
  pop: "Pop",
};

// ---------- Language detection (heuristic, the AI step can override it) ----------

const STOPWORDS: Partial<Record<Lang, string[]>> = {
  es: ["el", "la", "los", "las", "de", "que", "y", "mi", "tu", "te", "me", "no", "en", "un", "una", "por", "para", "con", "amor", "corazón", "quiero", "eres", "sin", "vida", "noche", "contigo", "nada", "todo", "otra", "vez", "mía", "solo", "como"],
  en: ["the", "you", "me", "my", "i", "i'm", "love", "don't", "your", "of", "and", "we", "it", "to", "on", "night", "baby", "heart", "all", "be", "with", "what", "this", "can't", "want"],
  pt: ["você", "não", "eu", "meu", "minha", "saudade", "coração", "pra", "do", "da", "uma", "sem", "tudo", "mais"],
  fr: ["je", "tu", "le", "les", "des", "et", "pas", "mon", "ma", "amour", "toi", "moi", "c'est", "sur", "dans"],
  it: ["il", "di", "che", "non", "per", "sei", "mio", "amore", "ti", "della", "sono", "tutto"],
  de: ["ich", "du", "und", "nicht", "die", "der", "das", "mein", "liebe", "ist", "auf"],
};

const SCRIPTS: [RegExp, Lang][] = [
  [/[\uac00-\ud7af]/, "ko"],
  [/[\u3040-\u30ff]/, "ja"],
  [/[\u4e00-\u9fff]/, "zh"],
  [/[\u0400-\u04ff\u0600-\u06ff\u0590-\u05ff\u0e00-\u0e7f\u0900-\u097f]/, "other"],
];

const FAMILY_LANG: Record<string, Lang> = {
  "regional-mexicano": "es",
  "urbano-latino": "es",
  tropical: "es",
  "rock-en-espanol": "es",
  "latin-pop": "es",
  brasil: "pt",
  "k-pop": "ko",
  "j-music": "ja",
};

const GENRE_LANG: [RegExp, Lang][] = [
  [/french|chanson|variété française|rap français/, "fr"],
  [/italian|cantautor/, "it"],
  [/german|deutsch|schlager/, "de"],
];

const ISRC_LANG: Record<string, Lang> = {
  MX: "es", ES: "es", AR: "es", CO: "es", CL: "es", PE: "es", VE: "es", UY: "es", EC: "es",
  BR: "pt", PT: "pt", KR: "ko", JP: "ja", FR: "fr", IT: "it", DE: "de", AT: "de",
  US: "en", GB: "en", AU: "en", CA: "en", IE: "en",
};

/** Removes "(feat. X)", "[Live]", " - Remastered 2011", etc. */
export function cleanTitle(title: string): string {
  return title
    .replace(/\s*[([].*?[)\]]/g, "")
    .replace(/\s+-\s+.*(remaster|live|version|mix|edit|acoustic|en vivo|remix|sped up|slowed).*$/i, "")
    .trim();
}

function scoreText(text: string, scores: Partial<Record<Lang, number>>, weight: number) {
  const lower = text.toLowerCase();
  for (const [re, lang] of SCRIPTS) if (re.test(text)) scores[lang] = (scores[lang] ?? 0) + 3 * weight;
  if (/[ñ¿¡]/.test(lower)) scores.es = (scores.es ?? 0) + 1.5 * weight;
  if (/[ãõ]/.test(lower)) scores.pt = (scores.pt ?? 0) + 1.5 * weight;

  const words = lower.split(/[^\p{L}']+/u).filter(Boolean);
  for (const [lang, list] of Object.entries(STOPWORDS) as [Lang, string[]][]) {
    const hits = words.filter((w) => list.includes(w)).length;
    if (hits) scores[lang] = (scores[lang] ?? 0) + Math.min(hits, 3) * weight;
  }
}

export function detectLanguage(
  title: string,
  album: string,
  families: string[],
  genres: string[],
  isrc?: string,
): { lang: Lang; confidence: number } {
  const scores: Partial<Record<Lang, number>> = {};

  scoreText(cleanTitle(title), scores, 1);
  scoreText(cleanTitle(album), scores, 0.5);

  for (const f of families) {
    const lang = FAMILY_LANG[f];
    if (lang) scores[lang] = (scores[lang] ?? 0) + 2;
  }
  const genreText = genres.join(" ").toLowerCase();
  for (const [re, lang] of GENRE_LANG) if (re.test(genreText)) scores[lang] = (scores[lang] ?? 0) + 2;

  const country = isrc?.slice(0, 2).toUpperCase();
  if (country && ISRC_LANG[country]) {
    const lang = ISRC_LANG[country];
    scores[lang] = (scores[lang] ?? 0) + 0.75;
  }

  const ranked = (Object.entries(scores) as [Lang, number][]).sort((a, b) => b[1] - a[1]);
  if (!ranked.length) return { lang: "unknown", confidence: 0 };

  const total = ranked.reduce((s, [, v]) => s + v, 0);
  const [best, bestScore] = ranked[0];
  const confidence = Math.min(1, (bestScore / (total + 1)) * Math.min(1, bestScore / 2.5));
  return confidence < 0.3 ? { lang: "unknown", confidence } : { lang: best, confidence };
}

export function buildProfiles(
  tracks: SpotifyTrack[],
  artistGenres: Record<string, string[]>,
): TrackProfile[] {
  return tracks.map((t) => {
    const genres = [...new Set(t.artists.flatMap((a) => artistGenres[a.id] ?? []))];
    const families = genreFamilies(genres);
    const { lang, confidence } = detectLanguage(t.name, t.album.name, families, genres, t.external_ids?.isrc);
    const year = parseInt(t.album.release_date?.slice(0, 4) ?? "", 10);

    return {
      id: t.id,
      uri: t.uri,
      name: t.name,
      artists: t.artists.map((a) => a.name),
      artistIds: t.artists.map((a) => a.id),
      album: t.album.name,
      albumId: t.album.id,
      image: t.album.images?.at(-1)?.url ?? t.album.images?.[0]?.url ?? null,
      year: Number.isFinite(year) ? year : null,
      explicit: t.explicit,
      durationMs: t.duration_ms,
      genres,
      families,
      lang,
      langConfidence: confidence,
      energy: null,
      valence: null,
      danceability: null,
      tempo: null,
      mood: null,
    };
  });
}
