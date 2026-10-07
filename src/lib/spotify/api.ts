// Spotify Web API client, written for the 2026 Development Mode rules:
// - no batch GET /artists → one request per artist (cached)
// - playlists are created with POST /me/playlists
// - tracks are added with POST /playlists/{id}/items
// - popularity and audio-features are NOT available

import { getAccessToken } from "./auth";

const API = "https://api.spotify.com/v1";

export class SpotifyAuthError extends Error {}
export class SpotifyQuotaError extends Error {}

export interface SpotifyArtistRef { id: string; name: string }
export interface SpotifyTrack {
  id: string;
  uri: string;
  name: string;
  explicit: boolean;
  duration_ms: number;
  is_local: boolean;
  artists: SpotifyArtistRef[];
  album: { id: string; name: string; release_date: string; images: { url: string }[] };
  external_ids?: { isrc?: string };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function spotifyFetch<T>(path: string, init: RequestInit = {}, attempt = 0): Promise<T> {
  const token = await getAccessToken(attempt > 0);
  if (!token) throw new SpotifyAuthError("Connect your Spotify account first.");

  const res = await fetch(path.startsWith("http") ? path : `${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });

  if (res.status === 401 && attempt === 0) return spotifyFetch<T>(path, init, 1);
  if (res.status === 401) throw new SpotifyAuthError("Your Spotify session expired. Connect again.");

  if (res.status === 429) {
    const body = await res.clone().json().catch(() => null);
    if (body?.error?.reason === "QUOTA_EXCEEDED") {
      throw new SpotifyQuotaError("Spotify's daily API limit was reached. Try again later.");
    }
    if (attempt < 6) {
      const retryAfter = Number(res.headers.get("Retry-After")) || 2 ** attempt;
      await sleep(retryAfter * 1000 + 250);
      return spotifyFetch<T>(path, init, attempt + 1);
    }
  }

  if (!res.ok) throw new Error(`Spotify error ${res.status}: ${await res.text()}`);
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export async function getMe() {
  return spotifyFetch<{ id: string; display_name: string | null; images?: { url: string }[] }>("/me");
}

/** Every Liked Song (paginates 50 at a time). Skips local files and removed tracks. */
export async function getAllLikedTracks(
  onProgress?: (loaded: number, total: number) => void,
): Promise<SpotifyTrack[]> {
  const tracks: SpotifyTrack[] = [];
  const seen = new Set<string>();
  let url: string | null = "/me/tracks?limit=50";

  while (url) {
    const page: { items: { track: SpotifyTrack | null }[]; next: string | null; total: number } =
      await spotifyFetch(url);
    for (const { track } of page.items) {
      if (!track || track.is_local || !track.id || seen.has(track.id)) continue;
      seen.add(track.id);
      tracks.push(track);
    }
    onProgress?.(tracks.length, page.total);
    url = page.next;
  }
  return tracks;
}

// ---------- Artist genres (cached, one request per artist) ----------

const GENRE_CACHE_KEY = "tempo.artistGenres.v1";

function readGenreCache(): Record<string, string[]> {
  try {
    return JSON.parse(localStorage.getItem(GENRE_CACHE_KEY) ?? "{}");
  } catch {
    return {};
  }
}

export async function getArtistGenres(
  artistIds: string[],
  onProgress?: (done: number, total: number) => void,
): Promise<Record<string, string[]>> {
  const cache = readGenreCache();
  const missing = [...new Set(artistIds)].filter((id) => !(id in cache));
  let done = 0;
  const CONCURRENCY = 3;

  async function worker(queue: string[]) {
    while (queue.length) {
      const id = queue.shift()!;
      try {
        const artist = await spotifyFetch<{ genres?: string[] }>(`/artists/${id}`);
        cache[id] = artist.genres ?? [];
      } catch (err) {
        if (err instanceof SpotifyAuthError || err instanceof SpotifyQuotaError) throw err;
        cache[id] = [];
      }
      done++;
      onProgress?.(done, missing.length);
      if (done % 25 === 0) localStorage.setItem(GENRE_CACHE_KEY, JSON.stringify(cache));
    }
  }

  const queue = [...missing];
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker(queue)));
  localStorage.setItem(GENRE_CACHE_KEY, JSON.stringify(cache));
  return cache;
}

// ---------- Playlists ----------

export async function createPlaylist(name: string, description: string, isPublic = false) {
  return spotifyFetch<{ id: string; external_urls: { spotify: string } }>("/me/playlists", {
    method: "POST",
    body: JSON.stringify({ name, description, public: isPublic }),
  });
}

/** Adds tracks in the given order (max 100 per request). */
export async function addTracksToPlaylist(playlistId: string, uris: string[]) {
  for (let i = 0; i < uris.length; i += 100) {
    await spotifyFetch(`/playlists/${playlistId}/items`, {
      method: "POST",
      body: JSON.stringify({ uris: uris.slice(i, i + 100) }),
    });
  }
}

