// The official list of life "moments" a song can belong to (client copy —
// the edge functions use supabase/functions/_shared/moments.ts).
export const MOMENTS = [
  "sunrise-drive", "slow-sunday-morning", "morning-coffee", "focus-work", "calm-study",
  "gym-push", "outdoor-run", "road-trip-singalong", "beach-day", "pool-party",
  "golden-hour-terrace", "sunset-drive", "dinner-with-friends", "deep-talk", "getting-ready",
  "pregame", "club-peak", "after-hours", "late-night-drive", "walk-home-alone",
  "rainy-day-home", "heartbreak", "falling-in-love", "slow-dance", "nostalgic-memories",
  "solo-reflection", "spiritual-uplift", "perreo-party", "carne-asada", "bohemia",
] as const;

export type Moment = (typeof MOMENTS)[number];

export interface TrackMoment { m: string; s: number }

/** Human label per moment (for chips). */
export const MOMENT_LABEL: Record<string, string> = {
  "sunrise-drive": "Sunrise drive",
  "slow-sunday-morning": "Slow Sunday morning",
  "morning-coffee": "Morning coffee",
  "focus-work": "Focus at work",
  "calm-study": "Calm study",
  "gym-push": "Gym push",
  "outdoor-run": "Outdoor run",
  "road-trip-singalong": "Road trip singalong",
  "beach-day": "Beach day",
  "pool-party": "Pool party",
  "golden-hour-terrace": "Golden hour terrace",
  "sunset-drive": "Sunset drive",
  "dinner-with-friends": "Dinner with friends",
  "deep-talk": "Deep talk",
  "getting-ready": "Getting ready",
  pregame: "Pregame",
  "club-peak": "Club peak",
  "after-hours": "After hours",
  "late-night-drive": "Late night drive",
  "walk-home-alone": "Walk home alone",
  "rainy-day-home": "Rainy day at home",
  heartbreak: "Heartbreak",
  "falling-in-love": "Falling in love",
  "slow-dance": "Slow dance",
  "nostalgic-memories": "Nostalgic memories",
  "solo-reflection": "Solo reflection",
  "spiritual-uplift": "Spiritual uplift",
  "perreo-party": "Perreo party",
  "carne-asada": "Carne asada",
  bohemia: "Bohemia",
};

/** One human phrase per moment — the playlist description. */
export const MOMENT_DESC: Record<string, string> = {
  "sunrise-drive": "For driving at sunrise, first light on the road, everything still quiet.",
  "slow-sunday-morning": "For slow Sunday mornings, coffee in hand, nowhere to be.",
  "morning-coffee": "For the first coffee of the day, easing into the morning.",
  "focus-work": "For working with focus, steady and distraction-free.",
  "calm-study": "For studying calm, soft background that never interrupts.",
  "gym-push": "For pushing through the last set, full power.",
  "outdoor-run": "For running outdoors, feet on the ground, mind clear.",
  "road-trip-singalong": "For long drives with the windows down, singing every word.",
  "beach-day": "For beach days, salt in the air, sun on the skin.",
  "pool-party": "For pool parties with friends, drinks cold, volume up.",
  "golden-hour-terrace": "For golden hour on a terrace, warm light and good company.",
  "sunset-drive": "For driving into the sunset, the day winding down.",
  "dinner-with-friends": "For dinner with friends, warm background to good conversation.",
  "deep-talk": "For those talks that last until 3 a.m.",
  "getting-ready": "For getting ready to go out, mirror check, feeling good.",
  pregame: "For the pregame, energy rising before the night starts.",
  "club-peak": "For the peak of the night, lights low, floor full.",
  "after-hours": "For after hours, when the party is over but nobody leaves.",
  "late-night-drive": "For driving home late, city lights, nothing to say.",
  "walk-home-alone": "For walking home alone at night, headphones on.",
  "rainy-day-home": "For rainy days at home, blanket and window watching.",
  heartbreak: "For when it hurts and you need to feel it.",
  "falling-in-love": "For falling in love, everything feels new.",
  "slow-dance": "For slow dancing close, the world on pause.",
  "nostalgic-memories": "For remembering what was, with a small smile.",
  "solo-reflection": "For being alone with your thoughts.",
  "spiritual-uplift": "For feeling lifted, something bigger than you.",
  "perreo-party": "For perreo until the floor gives up.",
  "carne-asada": "For the carne asada with the family, grill on, laughter loud.",
  bohemia: "For la bohemia, guitars and voices until late.",
};

/** Elegant 2–3 word name pools per moment (never the genre, never a year). */
export const MOMENT_NAMES: Record<string, string[]> = {
  "sunrise-drive": ["First Light", "Early Miles", "Daybreak Road"],
  "slow-sunday-morning": ["Slow Sundays", "No Rush", "Easy Morning"],
  "morning-coffee": ["Morning Cup", "Quiet Start", "First Sip"],
  "focus-work": ["Deep Work", "In the Zone", "Head Down"],
  "calm-study": ["Study Hour", "Quiet Pages", "Soft Focus"],
  "gym-push": ["One More Set", "Full Send", "Heavy Lifts"],
  "outdoor-run": ["Open Stride", "Long Run", "Fresh Air"],
  "road-trip-singalong": ["Windows Down", "Sing Along", "Highway Chorus"],
  "beach-day": ["Salt Air", "Beach Towel", "Low Tide"],
  "pool-party": ["Poolside", "Cannonball", "Sun Splash"],
  "golden-hour-terrace": ["Golden Hour", "Terrace Light", "Warm Evening"],
  "sunset-drive": ["Sunset Drive", "Dusk Road", "Last Light"],
  "dinner-with-friends": ["Dinner Table", "Good Company", "Second Bottle"],
  "deep-talk": ["Three A.M.", "Real Talk", "Long Conversation"],
  "getting-ready": ["Going Out", "Mirror Check", "Tonight's the Night"],
  pregame: ["Warm Up", "First Round", "Before the Night"],
  "club-peak": ["Peak Hour", "Lights Low", "Hands Up"],
  "after-hours": ["After Hours", "One More", "Last Ones Standing"],
  "late-night-drive": ["Drive Home", "City Lights", "Night Streets"],
  "walk-home-alone": ["Walk Home", "Streetlights", "Headphones On"],
  "rainy-day-home": ["Rainy Windows", "Blanket Day", "Grey Sky"],
  heartbreak: ["Heavy Heart", "Let It Hurt", "Missing You"],
  "falling-in-love": ["Butterflies", "New Feeling", "First Spark"],
  "slow-dance": ["Slow Dance", "Hold Me Close", "Cheek to Cheek"],
  "nostalgic-memories": ["Old Photographs", "Back Then", "Sepia Days"],
  "solo-reflection": ["Quiet Mind", "Own Thoughts", "Still Water"],
  "spiritual-uplift": ["Lifted", "Higher Ground", "Grace"],
  "perreo-party": ["Hasta Abajo", "Perreo Night", "Sin Freno"],
  "carne-asada": ["Carne Asada", "La Parrilla", "Domingo Familiar"],
  bohemia: ["La Bohemia", "Guitarras de Noche", "Cantina"],
};

/** Energy curve per moment: rise (builds up), steady (flat), arc (warm up → peak → cool down). */
export const MOMENT_CURVE: Record<string, "rise" | "steady" | "arc"> = {
  pregame: "rise", "getting-ready": "rise", "gym-push": "rise", "club-peak": "rise", "outdoor-run": "rise", "pool-party": "rise", "perreo-party": "rise",
  "focus-work": "steady", "calm-study": "steady", "slow-sunday-morning": "steady", "late-night-drive": "steady",
  "dinner-with-friends": "steady", "morning-coffee": "steady", bohemia: "steady", "carne-asada": "steady", "after-hours": "steady",
};
