// Spotify OAuth — Authorization Code with PKCE.
// No client secret is needed in the browser, so it's safe for a Vite/React app.

const CLIENT_ID = import.meta.env.VITE_SPOTIFY_CLIENT_ID as string;
const REDIRECT_URI =
  (import.meta.env.VITE_SPOTIFY_REDIRECT_URI as string | undefined) ??
  `${window.location.origin}/callback`;

const SCOPES = [
  "user-library-read", // read Liked Songs
  "playlist-modify-private", // create private playlists
  "playlist-modify-public",
];

const TOKEN_KEY = "tempo.spotify.token";
const VERIFIER_KEY = "tempo.spotify.verifier";
const STATE_KEY = "tempo.spotify.state";

interface StoredToken {
  access_token: string;
  refresh_token: string;
  expires_at: number; // ms epoch
  scope: string;
}

function randomString(length: number): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const values = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(values, (v) => chars[v % chars.length]).join("");
}

async function codeChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function readToken(): StoredToken | null {
  try {
    const raw = localStorage.getItem(TOKEN_KEY);
    return raw ? (JSON.parse(raw) as StoredToken) : null;
  } catch {
    return null;
  }
}

function saveToken(data: {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope: string;
}, previousRefresh?: string) {
  const token: StoredToken = {
    access_token: data.access_token,
    // Spotify may or may not rotate the refresh token; keep the old one if absent.
    refresh_token: data.refresh_token ?? previousRefresh ?? "",
    expires_at: Date.now() + data.expires_in * 1000,
    scope: data.scope,
  };
  localStorage.setItem(TOKEN_KEY, JSON.stringify(token));
}

export async function loginWithSpotify(): Promise<void> {
  if (!CLIENT_ID) throw new Error("Missing VITE_SPOTIFY_CLIENT_ID in your .env");

  const verifier = randomString(64);
  const state = randomString(16);
  sessionStorage.setItem(VERIFIER_KEY, verifier);
  sessionStorage.setItem(STATE_KEY, state);

  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: "code",
    redirect_uri: REDIRECT_URI,
    code_challenge_method: "S256",
    code_challenge: await codeChallenge(verifier),
    scope: SCOPES.join(" "),
    state,
  });

  window.location.assign(`https://accounts.spotify.com/authorize?${params}`);
}

/** Call once on the /callback route. Returns true when the account is connected. */
export async function handleSpotifyCallback(search: string): Promise<void> {
  const params = new URLSearchParams(search);
  const error = params.get("error");
  if (error) throw new Error(error === "access_denied" ? "You cancelled the Spotify connection." : error);

  const code = params.get("code");
  const state = params.get("state");
  const verifier = sessionStorage.getItem(VERIFIER_KEY);

  if (!code || !verifier) throw new Error("The Spotify login link expired. Try connecting again.");
  if (state !== sessionStorage.getItem(STATE_KEY)) throw new Error("Security check failed. Try connecting again.");

  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      grant_type: "authorization_code",
      code,
      redirect_uri: REDIRECT_URI,
      code_verifier: verifier,
    }),
  });

  if (!res.ok) throw new Error(`Spotify rejected the login (${res.status}).`);
  saveToken(await res.json());
  sessionStorage.removeItem(VERIFIER_KEY);
  sessionStorage.removeItem(STATE_KEY);
}

let refreshing: Promise<string | null> | null = null;

async function refreshAccessToken(current: StoredToken): Promise<string | null> {
  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: current.refresh_token,
      client_id: CLIENT_ID,
    }),
  });
  if (!res.ok) {
    disconnectSpotify();
    return null;
  }
  const data = await res.json();
  saveToken(data, current.refresh_token);
  return data.access_token as string;
}

/** Returns a valid access token, refreshing it if needed. Null = not connected. */
export async function getAccessToken(forceRefresh = false): Promise<string | null> {
  const token = readToken();
  if (!token) return null;
  if (!forceRefresh && token.expires_at - 60_000 > Date.now()) return token.access_token;

  // Avoid several parallel requests refreshing at the same time.
  refreshing ??= refreshAccessToken(token).finally(() => {
    refreshing = null;
  });
  return refreshing;
}

export function isSpotifyConnected(): boolean {
  return readToken() !== null;
}

export function disconnectSpotify(): void {
  localStorage.removeItem(TOKEN_KEY);
}
