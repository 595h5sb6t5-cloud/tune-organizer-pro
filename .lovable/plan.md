# Speed: deep analysis that never makes the user wait

Goals: AI Playlists opens instantly; a vibe is created in under 20 seconds.

## 1. Shared song analysis (global, by Spotify id)
- New table `track_analysis_global` keyed by Spotify track id: style, family, scene, feeling, melodic_focus, arc, instruments, texture, warmth, scale, groove, original_year, energy, mood, confidence, listener evidence summary, plus model/version and timestamps.
- Readable by any signed-in user; written only by background functions.
- All analyzers (classify-tracks, library-enrich, listener-tags) check this table first and only call the AI for ids that are missing; results are written once to the global table.
- One-time backfill from existing per-user analysis.
- "Edit sound" corrections (`manual_sound`) and removal feedback stay per user and still override the global values.

## 2. Priority on connect
- Analysis queue order: 200 most recent Liked Songs, then songs by the artists with the most Liked Songs, then the rest.
- When the priority set is done, a first set of playlists is built in the background; later rounds rebuild them automatically.

## 3. Parallelism
- Up to 5 AI batches at once in the analyzers (with the existing pause on 402/403/repeated 429).
- Last.fm throttled to 4 requests/second.
- YouTube unchanged: only seeds and songs with confidence < 0.6, existing daily cap.

## 4. Pre-built AI Playlists
- The playlist engine moves to a shared folder usable both by the app and by background functions, so there is still exactly one engine (organize.ts / vibe.ts logic unchanged).
- New background function `prebuild-playlists`: runs when analysis finishes or when a meaningful change happens (e.g. at least 5% of songs newly analyzed or re-described). Saves results as drafts with a "prebuilt" marker; replaces the previous prebuilt set but never touches exported or user-edited playlists.
- AI Playlists reads the saved set immediately; a "Rebuild now" button keeps the manual option.
- Dashboard shows "Your playlists are ready" when a new set is saved (dismissible).

## 5. Fast vibe
- Candidate review capped at the 60 most compatible with the seed, sent to vibe-select in 3 parallel batches of 20.
- vibe-select and the naming call use the fast mini model; the strong model only analyzes songs.
- If the seed has no analysis, it is analyzed first (the only step that may take a few seconds).
- Step-by-step progress: "Reading the vibe…", "Finding songs that feel the same…", "Putting them in order…", "Naming your playlist…".
- Rules (8+/7 fill, confidence < 0.5 needs 8+, seed coherence, feedback) unchanged.

## 6. Timing
- Each vibe run records duration of: recipe (vibe-spec), filter, vibe-select, order, name, and total; stored with the run and logged.
- After building, run 3 different vibes on your account and report per-step times.

## Technical notes
- Engine relocation: pure TS under `supabase/functions/_shared/playlist/`, re-exported from `src/lib/playlist/*` so imports in the app don't change; AGENTS.md rule updated.
- Prebuild job follows background-job rules: lease lock, bounded work per run, paused-state guard.
- Global table: RLS select for authenticated, writes via service role only.
