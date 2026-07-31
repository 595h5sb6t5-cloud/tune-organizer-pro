# Tempo AI Playlists

Build a premium AI music organization web app called Tempo that connects with Spotify and Apple Music and automatically turns a user’s liked songs or saved library into intelligent playlists, then writes those playlists back into the user’s own Spotify or Apple Music account.

Core idea:
Users save hundreds or thousands of songs, but those tracks stay inside one messy liked songs or favorites library. This app should organize that music automatically into highly coherent playlists based on rhythm, energy, mood, genre, era, and listening context.

Main promise:
The app should not only analyze and organize music internally.
It must also create real playlists inside the user’s connected Spotify or Apple Music account.

Main user flow:
The user lands on a premium minimal homepage.
The user connects either Spotify or Apple Music through OAuth or the proper platform authorization flow.
The app imports the user’s liked songs, saved tracks, or library songs.
The system analyzes each track using metadata, genre signals, release year, artist profile, mood labeling, and available audio features.
The app generates smart playlists automatically.
The user can preview the playlists, rename them, regenerate them, edit them, and then export or sync them directly into their Spotify or Apple Music account.
After export, the playlists must exist inside the user’s real music account, not only inside the app.

Platform behavior:
For Spotify:
Read user saved tracks
Create playlists in the user account
Add tracks to those playlists
Update or refresh playlists later
Allow public or private playlist creation

For Apple Music:
Read user library where permitted
Create or manage user library playlists
Add tracks into those playlists
Keep the export flow native and seamless

Core AI logic:
Analyze tracks by:
tempo
energy
danceability
valence
acousticness
genre
release year
artist patterns
mood
listening context

The AI must organize songs into playlists such as:
Soft Morning
Night Drive
Pool Sunset
Gym Energy
Sad but Pretty
Feel Good Classics
Late Night Chill
Indie Glow
Dinner Mood
Focus Flow

Each generated playlist must include:
playlist name
short AI description
dominant mood
dominant tempo
song count
cohesion score

Important product logic:
A song may belong to multiple internal mood clusters, but by default it should be assigned to one primary playlist unless overlap mode is enabled.
The app should prioritize playlist cohesion over quantity.
The app should intelligently sort songs within each playlist so the order feels natural and well curated.
The user should be able to regenerate based on options like:
more chill
more energetic
more elegant
more nostalgic
more underground
more mainstream

Export and sync features:
Create playlist directly in Spotify or Apple Music
Push songs into the created playlist automatically
Let the user choose whether playlists are private or public where supported
Let the user refresh an existing AI playlist instead of always making a new one
Show sync status clearly:
ready to export
exporting
synced successfully
sync failed
Allow users to delete the internal version without deleting the platform playlist
Allow users to resync after adding new liked songs

User controls:
Choose number of playlists to generate
Rename playlists
Drag songs between playlists
Pin favorite playlists
Hide unwanted genres
Exclude explicit tracks
Turn overlap mode on or off
Choose export destination
Choose whether to create new playlists or update previous synced playlists

Pages needed:
Landing page
Connect account page
Import progress page
Analysis dashboard
Generated playlists page
Playlist detail page
Sync and export page
Settings page
Subscription page

Dashboard requirements:
Show total imported songs
Show genre distribution
Show mood distribution
Show energy distribution
Show tempo distribution
Show a beautiful AI music profile summary
Show synced playlists status by platform

UI style:
Minimal and premium
Elegant music curation product
White, warm beige, soft gray, dark navy accents
Rounded cards
High-end typography
Very clean and serious
No playful or cheap visual style

Tech stack:
Use Supabase for auth, database, user storage, and edge functions
Use modular integrations for Spotify and Apple Music
Store imported tracks, normalized metadata, analysis results, playlist assignments, sync jobs, and export history
Build a sync queue system so playlist exports and refreshes are reliable
Design the schema so future recommendation learning is possible

Monetization:
Free plan:
connect one platform
import up to 300 songs
generate up to 3 playlists per month
export up to 2 playlists per month

Premium plan:
unlimited imports
unlimited playlist generation
unlimited exports
advanced vibe controls
refresh existing playlists
cross-platform support
playlist fine-tuning controls

Important compliance:
Do not claim to train on platform content
Use allowed user-authorized metadata and platform features only
Keep integrations production-ready and modular
Respect each platform’s authorization and library rules

Build realistic UI, polished empty states, polished loading states, real sample playlists, and a startup-quality product experience.

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://tune-organizer-pro.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/159079dd-d99f-4e32-b626-b73b50d600ec).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
