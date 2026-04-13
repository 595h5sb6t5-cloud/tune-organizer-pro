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

export interface Recommendation {
  id: string;
  track: Track;
  matchScore: number;
  reason: string;
  moodTags: string[];
  targetPlaylistId?: string;
  status: "pending" | "accepted" | "dismissed" | "saved";
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

// Recommendation tracks — songs the user does NOT already have
const recTracks: Track[] = [
  { id: "r1", title: "Space Song", artist: "Beach House", album: "Depression Cherry", year: 2015, genre: "Dream Pop", tempo: 98, energy: 0.45, valence: 0.4, danceability: 0.4, acousticness: 0.25, mood: "Dreamy" },
  { id: "r2", title: "Cigarettes After Sex", artist: "Cigarettes After Sex", album: "Cigarettes After Sex", year: 2017, genre: "Ambient Pop", tempo: 74, energy: 0.2, valence: 0.2, danceability: 0.3, acousticness: 0.8, mood: "Contemplative" },
  { id: "r3", title: "On Melancholy Hill", artist: "Gorillaz", album: "Plastic Beach", year: 2010, genre: "Alt Pop", tempo: 120, energy: 0.5, valence: 0.6, danceability: 0.6, acousticness: 0.15, mood: "Warm" },
  { id: "r4", title: "Dissolve", artist: "Absofacto", album: "Thousand Peaces", year: 2019, genre: "Indie Pop", tempo: 110, energy: 0.6, valence: 0.65, danceability: 0.7, acousticness: 0.1, mood: "Euphoric" },
  { id: "r5", title: "Something About Us", artist: "Daft Punk", album: "Discovery", year: 2001, genre: "Electronic", tempo: 100, energy: 0.4, valence: 0.5, danceability: 0.6, acousticness: 0.1, mood: "Romantic" },
  { id: "r6", title: "505", artist: "Arctic Monkeys", album: "Favourite Worst Nightmare", year: 2007, genre: "Indie Rock", tempo: 140, energy: 0.8, valence: 0.25, danceability: 0.5, acousticness: 0.1, mood: "Intense" },
  { id: "r7", title: "Lost in Yesterday", artist: "Tame Impala", album: "The Slow Rush", year: 2020, genre: "Psychedelic Pop", tempo: 103, energy: 0.6, valence: 0.55, danceability: 0.65, acousticness: 0.05, mood: "Nostalgic" },
  { id: "r8", title: "Tongue Tied", artist: "Grouplove", album: "Never Trust a Happy Song", year: 2011, genre: "Indie Pop", tempo: 130, energy: 0.85, valence: 0.9, danceability: 0.8, acousticness: 0.05, mood: "Euphoric" },
  { id: "r9", title: "Holocene", artist: "Bon Iver", album: "Bon Iver", year: 2011, genre: "Indie Folk", tempo: 68, energy: 0.25, valence: 0.18, danceability: 0.2, acousticness: 0.85, mood: "Contemplative" },
  { id: "r10", title: "Let It Happen", artist: "Tame Impala", album: "Currents", year: 2015, genre: "Psychedelic Pop", tempo: 118, energy: 0.75, valence: 0.6, danceability: 0.7, acousticness: 0.05, mood: "Euphoric" },
  { id: "r11", title: "Agnes", artist: "Glass Animals", album: "How to Be a Human Being", year: 2016, genre: "Indie Pop", tempo: 95, energy: 0.45, valence: 0.3, danceability: 0.5, acousticness: 0.2, mood: "Melancholic" },
  { id: "r12", title: "Rescue", artist: "Lauren Daigle", album: "Look Up Child", year: 2018, genre: "Pop", tempo: 76, energy: 0.35, valence: 0.35, danceability: 0.35, acousticness: 0.6, mood: "Warm" },
  { id: "r13", title: "Instant Crush", artist: "Daft Punk ft. Julian Casablancas", album: "Random Access Memories", year: 2013, genre: "Synth Rock", tempo: 108, energy: 0.6, valence: 0.4, danceability: 0.6, acousticness: 0.05, mood: "Bittersweet" },
  { id: "r14", title: "Line Without a Hook", artist: "Ricky Montgomery", album: "Montgomery Ricky", year: 2016, genre: "Indie Pop", tempo: 88, energy: 0.4, valence: 0.25, danceability: 0.45, acousticness: 0.4, mood: "Melancholic" },
  { id: "r15", title: "Retrograde", artist: "James Blake", album: "Overgrown", year: 2013, genre: "Electronic", tempo: 80, energy: 0.5, valence: 0.2, danceability: 0.4, acousticness: 0.3, mood: "Dark" },
  { id: "r16", title: "The Less I Know the Better", artist: "Tame Impala", album: "Currents", year: 2015, genre: "Psychedelic Pop", tempo: 116, energy: 0.7, valence: 0.65, danceability: 0.75, acousticness: 0.05, mood: "Groovy" },
];

export const sampleRecommendations: Recommendation[] = [
  // Soft Morning recs
  { id: "rec1", track: recTracks[1], matchScore: 94, reason: "Shares the quiet acoustic mood of your morning picks", moodTags: ["Quiet", "Acoustic", "Intimate"], targetPlaylistId: "pl1", status: "pending" },
  { id: "rec2", track: recTracks[8], matchScore: 91, reason: "Bon Iver's contemplative style matches your morning vibes", moodTags: ["Contemplative", "Acoustic", "Gentle"], targetPlaylistId: "pl1", status: "pending" },
  { id: "rec3", track: recTracks[11], matchScore: 87, reason: "Warm vocals and slow tempo align with soft morning energy", moodTags: ["Warm", "Soulful", "Calm"], targetPlaylistId: "pl1", status: "pending" },

  // Night Drive recs
  { id: "rec4", track: recTracks[14], matchScore: 92, reason: "Dark electronic atmosphere fits your night drive aesthetic", moodTags: ["Dark", "Electronic", "Moody"], targetPlaylistId: "pl2", status: "pending" },
  { id: "rec5", track: recTracks[5], matchScore: 90, reason: "Intense build-up mirrors the energy of your driving picks", moodTags: ["Intense", "Building", "Atmospheric"], targetPlaylistId: "pl2", status: "pending" },
  { id: "rec6", track: recTracks[4], matchScore: 88, reason: "Romantic electronic undertones match the late-night mood", moodTags: ["Romantic", "Electronic", "Smooth"], targetPlaylistId: "pl2", status: "accepted" },

  // Feel Good Classics recs
  { id: "rec7", track: recTracks[7], matchScore: 95, reason: "High-energy indie pop with euphoric chorus energy", moodTags: ["Euphoric", "Energetic", "Anthem"], targetPlaylistId: "pl3", status: "pending" },
  { id: "rec8", track: recTracks[9], matchScore: 93, reason: "Tame Impala's feel-good production complements your picks", moodTags: ["Euphoric", "Psychedelic", "Danceable"], targetPlaylistId: "pl3", status: "pending" },
  { id: "rec9", track: recTracks[15], matchScore: 91, reason: "Groovy bassline and infectious rhythm fit the feel-good vibe", moodTags: ["Groovy", "Danceable", "Fun"], targetPlaylistId: "pl3", status: "dismissed" },

  // Sad but Pretty recs
  { id: "rec10", track: recTracks[10], matchScore: 93, reason: "Melancholic beauty with cinematic emotional depth", moodTags: ["Melancholic", "Cinematic", "Beautiful"], targetPlaylistId: "pl4", status: "pending" },
  { id: "rec11", track: recTracks[13], matchScore: 90, reason: "Bittersweet indie vocals with a similar emotional weight", moodTags: ["Bittersweet", "Vulnerable", "Poetic"], targetPlaylistId: "pl4", status: "pending" },
  { id: "rec12", track: recTracks[12], matchScore: 88, reason: "Nostalgic synth-rock with melancholic undercurrents", moodTags: ["Bittersweet", "Nostalgic", "Synth"], targetPlaylistId: "pl4", status: "saved" },

  // New Vibe — doesn't fit existing playlists strongly
  { id: "rec13", track: recTracks[0], matchScore: 82, reason: "Dreamy soundscape introduces a new vibe to your library", moodTags: ["Dreamy", "Hazy", "Atmospheric"], status: "pending" },
  { id: "rec14", track: recTracks[2], matchScore: 80, reason: "Alt pop with warm tones — a fresh direction for you", moodTags: ["Warm", "Alt Pop", "Mellow"], status: "pending" },
  { id: "rec15", track: recTracks[3], matchScore: 78, reason: "Uplifting indie pop that opens a new feel-good angle", moodTags: ["Uplifting", "Fresh", "Indie"], status: "pending" },
  { id: "rec16", track: recTracks[6], matchScore: 85, reason: "Nostalgic psychedelic pop bridges your genres beautifully", moodTags: ["Nostalgic", "Psychedelic", "Vibey"], status: "pending" },
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

export const getRecommendationsForPlaylist = (playlistId: string) =>
  sampleRecommendations.filter((r) => r.targetPlaylistId === playlistId);

export const getNewVibeRecommendations = () =>
  sampleRecommendations.filter((r) => !r.targetPlaylistId);
