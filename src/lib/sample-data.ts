export interface Track {
  id: string;
  title: string;
  artist: string;
  album: string;
  year: number;
  genre: string;
  tempo: number;
  energy: number;
  valence: number;
  danceability: number;
  acousticness: number;
  mood: string;
  coverUrl?: string;
}

export interface Playlist {
  id: string;
  name: string;
  description: string;
  mood: string;
  avgTempo: number;
  cohesionScore: number;
  trackCount: number;
  tracks: Track[];
  syncStatus: "ready" | "exporting" | "synced" | "failed";
  emoji: string;
}

export const sampleTracks: Track[] = [
  { id: "1", title: "Nights", artist: "Frank Ocean", album: "Blonde", year: 2016, genre: "R&B", tempo: 90, energy: 0.5, valence: 0.3, danceability: 0.6, acousticness: 0.2, mood: "Melancholic" },
  { id: "2", title: "Electric Feel", artist: "MGMT", album: "Oracular Spectacular", year: 2007, genre: "Indie", tempo: 120, energy: 0.7, valence: 0.8, danceability: 0.75, acousticness: 0.1, mood: "Euphoric" },
  { id: "3", title: "Roslyn", artist: "Bon Iver", album: "Blood Bank", year: 2009, genre: "Indie Folk", tempo: 72, energy: 0.2, valence: 0.15, danceability: 0.2, acousticness: 0.9, mood: "Contemplative" },
  { id: "4", title: "Redbone", artist: "Childish Gambino", album: "Awaken, My Love!", year: 2016, genre: "Funk", tempo: 82, energy: 0.55, valence: 0.55, danceability: 0.7, acousticness: 0.3, mood: "Groovy" },
  { id: "5", title: "Motion Sickness", artist: "Phoebe Bridgers", album: "Stranger in the Alps", year: 2017, genre: "Indie", tempo: 110, energy: 0.45, valence: 0.25, danceability: 0.4, acousticness: 0.5, mood: "Bittersweet" },
  { id: "6", title: "Midnight City", artist: "M83", album: "Hurry Up, We're Dreaming", year: 2011, genre: "Synth Pop", tempo: 105, energy: 0.8, valence: 0.7, danceability: 0.65, acousticness: 0.05, mood: "Euphoric" },
  { id: "7", title: "Ivy", artist: "Frank Ocean", album: "Blonde", year: 2016, genre: "R&B", tempo: 86, energy: 0.4, valence: 0.35, danceability: 0.5, acousticness: 0.3, mood: "Nostalgic" },
  { id: "8", title: "Skinny Love", artist: "Bon Iver", album: "For Emma, Forever Ago", year: 2007, genre: "Indie Folk", tempo: 76, energy: 0.3, valence: 0.2, danceability: 0.25, acousticness: 0.85, mood: "Contemplative" },
  { id: "9", title: "Get Lucky", artist: "Daft Punk", album: "Random Access Memories", year: 2013, genre: "Disco", tempo: 116, energy: 0.75, valence: 0.85, danceability: 0.8, acousticness: 0.05, mood: "Feel Good" },
  { id: "10", title: "Pink + White", artist: "Frank Ocean", album: "Blonde", year: 2016, genre: "R&B", tempo: 80, energy: 0.35, valence: 0.45, danceability: 0.55, acousticness: 0.4, mood: "Warm" },
  { id: "11", title: "Do I Wanna Know?", artist: "Arctic Monkeys", album: "AM", year: 2013, genre: "Rock", tempo: 85, energy: 0.65, valence: 0.3, danceability: 0.55, acousticness: 0.1, mood: "Dark" },
  { id: "12", title: "Myth", artist: "Beach House", album: "Bloom", year: 2012, genre: "Dream Pop", tempo: 100, energy: 0.5, valence: 0.5, danceability: 0.45, acousticness: 0.3, mood: "Dreamy" },
];

export const samplePlaylists: Playlist[] = [
  {
    id: "pl1",
    name: "Soft Morning",
    description: "Gentle acoustic tones and warm vocals to ease into the day.",
    mood: "Contemplative",
    avgTempo: 78,
    cohesionScore: 92,
    trackCount: 3,
    emoji: "🌅",
    syncStatus: "ready",
    tracks: [sampleTracks[2], sampleTracks[7], sampleTracks[9]],
  },
  {
    id: "pl2",
    name: "Night Drive",
    description: "Moody rhythms and atmospheric synths for late-night cruising.",
    mood: "Dark & Moody",
    avgTempo: 90,
    cohesionScore: 88,
    trackCount: 3,
    emoji: "🌙",
    syncStatus: "synced",
    tracks: [sampleTracks[0], sampleTracks[6], sampleTracks[10]],
  },
  {
    id: "pl3",
    name: "Feel Good Classics",
    description: "High-energy bangers and feel-good anthems to lift your spirits.",
    mood: "Euphoric",
    avgTempo: 114,
    cohesionScore: 95,
    trackCount: 3,
    emoji: "✨",
    syncStatus: "ready",
    tracks: [sampleTracks[1], sampleTracks[5], sampleTracks[8]],
  },
  {
    id: "pl4",
    name: "Sad but Pretty",
    description: "Beautifully melancholic tracks that make sadness feel cinematic.",
    mood: "Bittersweet",
    avgTempo: 92,
    cohesionScore: 90,
    trackCount: 3,
    emoji: "🥀",
    syncStatus: "failed",
    tracks: [sampleTracks[4], sampleTracks[11], sampleTracks[3]],
  },
];
