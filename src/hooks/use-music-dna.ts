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

export function useMusicDna(): MusicDna & { refresh: () => Promise<void> } {
  const { user } = useAuth();
  const [state, setState] = useState<MusicDna>({
    loading: true,
    totals: { liked: 0, playlists: 0, artists: 0, albums: 0, analyzed: 0 },
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
        .select("audio_energy,audio_valence,audio_tempo,mood,energy,genre_tags,sonic_texture,listening_context,atmosphere,artist_name")
        .eq("user_id", user.id)
        .range(off, off + PAGE - 1);
      if (!data || data.length === 0) break;
      liked.push(...data);
      if (data.length < PAGE) break;
      off += PAGE;
    }

    const [{ count: likedCount }, { count: plCount }, { count: artistsCount }, { count: albumsCount }, artistsRes, analysisRes] = await Promise.all([
      supabase.from("liked_songs").select("id", { count: "exact", head: true }).eq("user_id", user.id),
      supabase.from("spotify_playlists").select("id", { count: "exact", head: true }).eq("user_id", user.id),
      supabase.from("spotify_followed_artists").select("id", { count: "exact", head: true }).eq("user_id", user.id),
      supabase.from("spotify_saved_albums").select("id", { count: "exact", head: true }).eq("user_id", user.id),
      supabase.from("spotify_followed_artists").select("artist_name,image_url,genres,popularity").eq("user_id", user.id).order("popularity", { ascending: false }).limit(12),
      supabase.from("ai_track_analysis").select("language,vibe_tags,moods,best_contexts").eq("user_id", user.id).limit(2000),
    ]);

    const moodMap = new Map<string, number>();
    const genreMap = new Map<string, number>();
    const vibeMap = new Map<string, number>();
    const ctxMap = new Map<string, number>();
    const langMap = new Map<string, number>();

    let energySum = 0, valenceSum = 0, tempoSum = 0, audioCount = 0;
    let calm = 0, energetic = 0;

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

    for (const a of analysisRes.data ?? []) {
      if (a.language) langMap.set(a.language, (langMap.get(a.language) ?? 0) + 1);
      for (const v of (a.vibe_tags ?? []) as string[]) vibeMap.set(v, (vibeMap.get(v) ?? 0) + 1);
      for (const m of (a.moods ?? []) as string[]) moodMap.set(m, (moodMap.get(m) ?? 0) + 1);
      for (const c of (a.best_contexts ?? []) as string[]) ctxMap.set(c, (ctxMap.get(c) ?? 0) + 1);
    }

    const avgEnergy = audioCount ? energySum / audioCount : 0;
    const avgValence = audioCount ? valenceSum / audioCount : 0;
    const avgTempo = audioCount ? tempoSum / audioCount : 0;
    const totalCE = calm + energetic || 1;

    // Build analyzed track set for concept matching
    const analyzed: AnalyzedTrack[] = liked.map(t => ({
      energy: typeof t.audio_energy === "number" ? t.audio_energy : null,
      valence: typeof t.audio_valence === "number" ? t.audio_valence : null,
      tempo: typeof t.audio_tempo === "number" ? t.audio_tempo : null,
      mood: t.mood ?? null,
      energy_label: t.energy ?? null,
      genres: ((t.genre_tags ?? []) as string[]).map(g => g.toLowerCase()),
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
    if (avgEnergy > 0.65) patterns.push("Tu biblioteca se inclina hacia tracks de alta energía.");
    if (avgEnergy > 0 && avgEnergy < 0.4) patterns.push("Predominan canciones tranquilas e introspectivas.");
    if (avgValence > 0.6) patterns.push("Tienes un sesgo claro hacia sonidos luminosos y positivos.");
    if (avgValence > 0 && avgValence < 0.35) patterns.push("Hay una corriente melancólica recurrente en tus likes.");
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
        analyzed: audioCount,
      },
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
