import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./use-auth";

export interface DnaArtist {
  name: string;
  image_url: string | null;
  genres: string[];
}

export interface PlaylistConcept {
  id: string;
  name: string;
  tagline: string;
  description: string;
  match: number;
  filter: (s: AnalyzedTrack) => boolean;
}

interface AnalyzedTrack {
  energy: number | null;
  valence: number | null;
  tempo: number | null;
  tempoFeel?: string | null;
  danceFeel?: number | null;
  mood: string | null;
  energy_label: string | null;
  genres: string[];
}

export interface MusicDna {
  loading: boolean;
  totals: {
    liked: number;
    playlists: number;
    artists: number;
    albums: number;
    analyzed: number;
  };
  lastSyncAt: string | null;

  avgEnergy: number;
  avgValence: number;
  avgTempo: number;
  calmVsEnergetic: { calm: number; energetic: number };
  topMoods: { name: string; count: number; pct: number }[];
  topGenres: { name: string; count: number; pct: number }[];
  topVibes: { name: string; count: number }[];
  contexts: { name: string; count: number }[];
  topArtists: DnaArtist[];
  languageMix: { name: string; count: number; pct: number }[];
  patterns: string[];
  suggestions: PlaylistConcept[];
}

const CONCEPTS: Omit<PlaylistConcept, "match">[] = [
  { id: "late-night-drive", name: "Late Night Drive", tagline: "Headlights and basslines", description: "Mid-tempo, moody, atmospheric tracks for empty highways after midnight.", filter: (s) => (s.energy ?? 0) > 0.4 && (s.energy ?? 0) < 0.75 && (s.valence ?? 0) < 0.5 },
  { id: "tropical-sunset", name: "Tropical Sunset", tagline: "Salt air and golden light", description: "Warm, breezy grooves with a coastal pulse.", filter: (s) => (s.valence ?? 0) > 0.55 && (s.energy ?? 0) > 0.4 && (s.energy ?? 0) < 0.8 },
  { id: "soft-indie-mood", name: "Soft Indie Mood", tagline: "Gentle, intimate, honest", description: "Tender indie textures for slow afternoons.", filter: (s) => (s.energy ?? 0) < 0.5 && s.genres.some(g => g.includes("indie")) },
  { id: "poolside-grooves", name: "Poolside Grooves", tagline: "Light, easy, sun-soaked", description: "Smooth rhythms made for floating.", filter: (s) => (s.valence ?? 0) > 0.6 && (s.tempo ?? 0) > 95 && (s.tempo ?? 0) < 120 },
  { id: "old-school-soul", name: "Old School Soul", tagline: "Vinyl warmth, deep groove", description: "Classic soul, funk, and R&B with feeling.", filter: (s) => s.genres.some(g => /soul|funk|motown|r&b|rnb/.test(g)) },
  { id: "dance-clean-energy", name: "Dance Clean Energy", tagline: "Lift without the noise", description: "High-energy dance tracks with a bright, clean pulse.", filter: (s) => (s.energy ?? 0) > 0.7 && (s.valence ?? 0) > 0.5 },
  { id: "main-character-walk", name: "Main Character Walk", tagline: "Confidence soundtrack", description: "Bold, cinematic, swagger-filled tracks for your own movie.", filter: (s) => (s.energy ?? 0) > 0.65 && (s.tempo ?? 0) > 100 },
  { id: "sunday-morning-calm", name: "Sunday Morning Calm", tagline: "Slow start, soft light", description: "Quiet, unhurried songs for slow mornings.", filter: (s) => (s.energy ?? 0) < 0.4 && (s.valence ?? 0) > 0.3 },
  { id: "beach-club-chill", name: "Beach Club Chill", tagline: "Loungey, deep, sunlit", description: "Sun-drenched downtempo and deep house textures.", filter: (s) => s.genres.some(g => /house|chill|lounge|deep/.test(g)) || ((s.energy ?? 0) > 0.45 && (s.energy ?? 0) < 0.7 && (s.tempo ?? 0) > 100 && (s.tempo ?? 0) < 122) },
  { id: "golden-hour-grooves", name: "Golden Hour Grooves", tagline: "Warm, hazy, alive", description: "Mellow grooves with a hopeful glow.", filter: (s) => (s.valence ?? 0) > 0.55 && (s.energy ?? 0) > 0.45 && (s.energy ?? 0) < 0.75 },
];

function topN<T>(map: Map<string, number>, n: number): { name: string; count: number; pct: number }[] {
  const total = Array.from(map.values()).reduce((a, b) => a + b, 0) || 1;
  return Array.from(map.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([name, count]) => ({ name, count, pct: Math.round((count / total) * 100) }));
}

function addWeighted(map: Map<string, number>, value: unknown, weight = 1) {
  if (typeof value !== "string") return;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return;
  map.set(normalized, (map.get(normalized) ?? 0) + weight);
}

function addArrayWeighted(map: Map<string, number>, values: unknown, weight = 1) {
  if (!Array.isArray(values)) return;
  for (const value of values) addWeighted(map, value, weight);
}

function brightnessFromAnalysis(row: any): number | null {
  if (typeof row?.darkness === "number" || typeof row?.dance_feel === "number" || typeof row?.softness === "number") {
    const darkness = typeof row.darkness === "number" ? row.darkness : 0.45;
    const dance = typeof row.dance_feel === "number" ? row.dance_feel : 0.5;
    const softness = typeof row.softness === "number" ? row.softness : 0.5;
    return Math.max(0, Math.min(1, (1 - darkness) * 0.65 + dance * 0.25 + softness * 0.1));
  }
  return null;
}

function tempoFromFeel(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const feel = value.toLowerCase();
  if (feel.includes("slow")) return 78;
  if (feel.includes("mid")) return 104;
  if (feel.includes("upbeat")) return 126;
  if (feel.includes("fast")) return 142;
  return null;
}

export function useMusicDna(): MusicDna & { refresh: () => Promise<void> } {
  const { user } = useAuth();
  const [state, setState] = useState<MusicDna>({
    loading: true,
    totals: { liked: 0, playlists: 0, artists: 0, albums: 0, analyzed: 0 },
    lastSyncAt: null,
    avgEnergy: 0, avgValence: 0, avgTempo: 0,
    calmVsEnergetic: { calm: 50, energetic: 50 },
    topMoods: [], topGenres: [], topVibes: [], contexts: [],
    topArtists: [], languageMix: [], patterns: [], suggestions: [],
  });

  const load = useCallback(async () => {
    if (!user) return;
    setState(s => ({ ...s, loading: true }));

    const PAGE = 1000;
    const liked: any[] = [];
    let off = 0;
    while (true) {
      const { data } = await supabase
        .from("liked_songs")
        .select("spotify_track_id,audio_energy,audio_valence,audio_tempo,mood,energy,genre_tags,sonic_texture,listening_context,atmosphere,artist_name")
        .eq("user_id", user.id)
        .eq("is_active", true)
        .eq("is_available", true)
        .range(off, off + PAGE - 1);
      if (!data || data.length === 0) break;
      liked.push(...data);
      if (data.length < PAGE) break;
      off += PAGE;
    }

    const [{ count: likedCount }, { count: plCount }, { count: artistsCount }, { count: albumsCount }, artistsRes, connRes] = await Promise.all([
      supabase.from("liked_songs").select("id", { count: "exact", head: true }).eq("user_id", user.id).eq("is_active", true).eq("is_available", true),
      supabase.from("spotify_playlists").select("id", { count: "exact", head: true }).eq("user_id", user.id),
      supabase.from("spotify_followed_artists").select("id", { count: "exact", head: true }).eq("user_id", user.id),
      supabase.from("spotify_saved_albums").select("id", { count: "exact", head: true }).eq("user_id", user.id),
      supabase.from("spotify_followed_artists").select("artist_name,image_url,genres,popularity").eq("user_id", user.id).order("popularity", { ascending: false }).limit(12),
      supabase.from("spotify_connections").select("last_full_sync_at,last_library_sync_at,last_incremental_sync_at").eq("user_id", user.id).maybeSingle(),
    ]);

    const ANALYSIS_COLUMNS = "spotify_track_id,analysis_version,main_genre,secondary_genres_v2,primary_genre,secondary_genres,main_mood,secondary_moods_v2,moods,sound_texture,tempo_feel,beat_style,energy_score,dance_feel,darkness,softness,bass_level,drum_intensity,vocal_intensity,melody_level,emotional_intensity,best_contexts_v2,best_contexts,compatible_playlist_types,language";
    const analysisRows: any[] = [];
    let aOff = 0;
    while (true) {
      const { data } = await supabase
        .from("ai_track_analysis")
        .select(ANALYSIS_COLUMNS)
        .eq("user_id", user.id)
        .order("updated_at", { ascending: false })
        .range(aOff, aOff + PAGE - 1);
      if (!data || data.length === 0) break;
      analysisRows.push(...data);
      if (data.length < PAGE) break;
      aOff += PAGE;
    }

    const moodMap = new Map<string, number>();
    const genreMap = new Map<string, number>();
    const vibeMap = new Map<string, number>();
    const ctxMap = new Map<string, number>();
    const langMap = new Map<string, number>();

    let energySum = 0, valenceSum = 0, tempoSum = 0, audioCount = 0;
    let analysisEnergySum = 0, analysisValenceSum = 0, analysisTempoSum = 0, analysisCount = 0, analysisTempoCount = 0;
    let danceSum = 0, darknessSum = 0, softnessSum = 0, bassSum = 0, drumsSum = 0, emotionSum = 0;
    let calm = 0, energetic = 0;
    const analysisBySpotifyId = new Map<string, any>();

    for (const t of liked) {
      if (typeof t.audio_energy === "number") {
        energySum += t.audio_energy;
        valenceSum += t.audio_valence ?? 0;
        tempoSum += t.audio_tempo ?? 0;
        audioCount++;
        if (t.audio_energy < 0.5) calm++; else energetic++;
      }
      if (t.mood) moodMap.set(t.mood, (moodMap.get(t.mood) ?? 0) + 1);
      for (const g of (t.genre_tags ?? []) as string[]) {
        if (g) genreMap.set(g, (genreMap.get(g) ?? 0) + 1);
      }
      if (t.atmosphere) vibeMap.set(t.atmosphere, (vibeMap.get(t.atmosphere) ?? 0) + 1);
      if (t.listening_context) ctxMap.set(t.listening_context, (ctxMap.get(t.listening_context) ?? 0) + 1);
    }

    // Pull genres from followed artists too
    for (const a of artistsRes.data ?? []) {
      for (const g of (a.genres ?? []) as string[]) {
        if (g) genreMap.set(g, (genreMap.get(g) ?? 0) + 1);
      }
    }

    for (const a of analysisRows) {
      const row = a as any;
      if (row.spotify_track_id && (!analysisBySpotifyId.has(row.spotify_track_id) || row.analysis_version === "v2")) {
        analysisBySpotifyId.set(row.spotify_track_id, row);
      }

      addWeighted(genreMap, row.main_genre, 2);
      addArrayWeighted(genreMap, row.secondary_genres_v2, 1);
      addWeighted(genreMap, row.primary_genre, 1);
      addArrayWeighted(genreMap, row.secondary_genres, 1);

      addWeighted(moodMap, row.main_mood, 2);
      addArrayWeighted(moodMap, row.secondary_moods_v2, 1);
      addArrayWeighted(moodMap, row.moods, 1);

      addWeighted(vibeMap, row.sound_texture, 2);
      addWeighted(vibeMap, row.tempo_feel, 1);
      addWeighted(vibeMap, row.beat_style, 1);
      addArrayWeighted(vibeMap, row.compatible_playlist_types, 1);

      addArrayWeighted(ctxMap, row.best_contexts_v2, 1);
      addArrayWeighted(ctxMap, row.best_contexts, 1);
      if (row.language) langMap.set(row.language, (langMap.get(row.language) ?? 0) + 1);

      if (typeof row.energy_score === "number") {
        analysisEnergySum += row.energy_score;
        analysisCount++;
        if (row.energy_score < 0.5) calm++; else energetic++;
      }
      const brightness = brightnessFromAnalysis(row);
      if (brightness != null) analysisValenceSum += brightness;
      const inferredTempo = tempoFromFeel(row.tempo_feel);
      if (inferredTempo != null) {
        analysisTempoSum += inferredTempo;
        analysisTempoCount++;
      }
      if (typeof row.dance_feel === "number") danceSum += row.dance_feel;
      if (typeof row.darkness === "number") darknessSum += row.darkness;
      if (typeof row.softness === "number") softnessSum += row.softness;
      if (typeof row.bass_level === "number") bassSum += row.bass_level;
      if (typeof row.drum_intensity === "number") drumsSum += row.drum_intensity;
      if (typeof row.emotional_intensity === "number") emotionSum += row.emotional_intensity;
    }

    const avgEnergy = analysisCount ? analysisEnergySum / analysisCount : audioCount ? energySum / audioCount : 0;
    const avgValence = analysisCount ? analysisValenceSum / analysisCount : audioCount ? valenceSum / audioCount : 0;
    const avgTempo = analysisTempoCount ? analysisTempoSum / analysisTempoCount : audioCount ? tempoSum / audioCount : 0;
    const totalCE = calm + energetic || 1;

    // Build analyzed track set for concept matching
    const analyzed: AnalyzedTrack[] = liked.map(t => ({
      energy: typeof analysisBySpotifyId.get(t.spotify_track_id)?.energy_score === "number" ? analysisBySpotifyId.get(t.spotify_track_id).energy_score : typeof t.audio_energy === "number" ? t.audio_energy : null,
      valence: brightnessFromAnalysis(analysisBySpotifyId.get(t.spotify_track_id)) ?? (typeof t.audio_valence === "number" ? t.audio_valence : null),
      tempo: tempoFromFeel(analysisBySpotifyId.get(t.spotify_track_id)?.tempo_feel) ?? (typeof t.audio_tempo === "number" ? t.audio_tempo : null),
      tempoFeel: analysisBySpotifyId.get(t.spotify_track_id)?.tempo_feel ?? null,
      danceFeel: analysisBySpotifyId.get(t.spotify_track_id)?.dance_feel ?? null,
      mood: analysisBySpotifyId.get(t.spotify_track_id)?.main_mood ?? t.mood ?? null,
      energy_label: t.energy ?? null,
      genres: [
        ...((t.genre_tags ?? []) as string[]),
        analysisBySpotifyId.get(t.spotify_track_id)?.main_genre,
        ...((analysisBySpotifyId.get(t.spotify_track_id)?.secondary_genres_v2 ?? []) as string[]),
      ].filter(Boolean).map(g => String(g).toLowerCase()),
    }));

    const suggestions = CONCEPTS.map(c => {
      const matches = analyzed.filter(c.filter).length;
      return { ...c, match: matches };
    })
      .filter(s => s.match >= 5 || analyzed.length < 20)
      .sort((a, b) => b.match - a.match)
      .slice(0, 6);

    const topGenresArr = topN(genreMap, 6);
    const topMoodsArr = topN(moodMap, 6);

    const patterns: string[] = [];
    const avgDance = analysisCount ? danceSum / analysisCount : 0;
    const avgDarkness = analysisCount ? darknessSum / analysisCount : 0;
    const avgSoftness = analysisCount ? softnessSum / analysisCount : 0;
    const avgBass = analysisCount ? bassSum / analysisCount : 0;
    const avgDrums = analysisCount ? drumsSum / analysisCount : 0;
    const avgEmotion = analysisCount ? emotionSum / analysisCount : 0;

    if (avgEnergy > 0.65) patterns.push("Tu biblioteca se inclina hacia tracks de alta energía.");
    if (avgEnergy > 0 && avgEnergy < 0.4) patterns.push("Predominan canciones tranquilas e introspectivas.");
    if (avgValence > 0.6) patterns.push("Tienes un sesgo claro hacia sonidos luminosos y abiertos.");
    if (avgDarkness > 0.55) patterns.push("Hay una corriente oscura y nocturna recurrente en tus likes.");
    if (avgSoftness > 0.62) patterns.push("Tu biblioteca favorece texturas suaves y envolventes.");
    if (avgBass > 0.62 || avgDrums > 0.62) patterns.push("El groove pesa mucho: bajo y percusión aparecen como señales fuertes.");
    if (avgDance > 0.65) patterns.push("Tu música tiende a moverse: hay un pulso bailable constante.");
    if (avgEmotion > 0.65) patterns.push("Buscas canciones con carga emocional marcada, no solo canciones de fondo.");
    if (avgTempo > 120) patterns.push("Tempo promedio alto: te mueves con ritmos rápidos.");
    if (topGenresArr.length && topGenresArr[0].pct > 25) patterns.push(`${topGenresArr[0].name} es tu ancla principal.`);
    if (calm > energetic * 1.5) patterns.push("Buscas refugio: priorizas música tranquila sobre la enérgica.");
    if (energetic > calm * 1.5) patterns.push("Eres alguien que usa la música como combustible.");

    setState({
      loading: false,
      totals: {
        liked: likedCount ?? 0,
        playlists: plCount ?? 0,
        artists: artistsCount ?? 0,
        albums: albumsCount ?? 0,
        analyzed: analysisBySpotifyId.size || analysisCount || audioCount,
      },
      lastSyncAt: connRes.data?.last_full_sync_at || connRes.data?.last_library_sync_at || connRes.data?.last_incremental_sync_at || null,
      avgEnergy, avgValence, avgTempo,
      calmVsEnergetic: { calm: Math.round((calm / totalCE) * 100), energetic: Math.round((energetic / totalCE) * 100) },
      topMoods: topMoodsArr,
      topGenres: topGenresArr,
      topVibes: topN(vibeMap, 8),
      contexts: topN(ctxMap, 6),
      topArtists: (artistsRes.data ?? []).map(a => ({ name: a.artist_name, image_url: a.image_url, genres: a.genres ?? [] })),
      languageMix: topN(langMap, 5),
      patterns,
      suggestions,
    });
  }, [user]);

  useEffect(() => { void load(); }, [load]);

  return { ...state, refresh: load };
}
