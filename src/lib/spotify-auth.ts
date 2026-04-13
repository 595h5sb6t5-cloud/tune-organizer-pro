export const SPOTIFY_OAUTH_DONE_KEY = "spotify-oauth-complete";
export const SPOTIFY_OAUTH_ERROR_KEY = "spotify-oauth-error";
export const SPOTIFY_PENDING_CALLBACK_KEY = "spotify-pending-callback";
export const SPOTIFY_PENDING_CONNECT_KEY = "spotify-pending-connect";
export const SPOTIFY_RETURN_PATH_KEY = "spotify-return-path";
export const PENDING_SPOTIFY_MAX_AGE_MS = 10 * 60 * 1000;

export type PendingSpotifyCallback = {
  code: string;
  state: string | null;
  returnPath: string;
  savedAt: number;
};

export type PendingSpotifyConnect = {
  returnPath: string;
  savedAt: number;
};

export type DecodedSpotifyStatePayload = {
  user_id?: string;
  return_path?: string;
  redirect_uri?: string;
  issued_at?: number;
  expires_at?: number;
};

function canUseStorage() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function sanitizeReturnPath(path: string | null | undefined, fallback = "/dashboard") {
  if (!path || !path.startsWith("/") || path.startsWith("//")) return fallback;
  return path;
}

function parseStoredJson<T>(key: string): T | null {
  if (!canUseStorage()) return null;

  const raw = localStorage.getItem(key);
  if (!raw) return null;

  try {
    return JSON.parse(raw) as T;
  } catch {
    localStorage.removeItem(key);
    return null;
  }
}

function decodeBase64Url(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return atob(padded);
}

export function setSpotifyReturnPath(returnPath: string) {
  if (!canUseStorage()) return;
  localStorage.setItem(SPOTIFY_RETURN_PATH_KEY, sanitizeReturnPath(returnPath));
}

export function getSpotifyReturnPath(fallback = "/dashboard") {
  if (!canUseStorage()) return fallback;
  return sanitizeReturnPath(localStorage.getItem(SPOTIFY_RETURN_PATH_KEY), fallback);
}

export function clearSpotifyReturnPath() {
  if (!canUseStorage()) return;
  localStorage.removeItem(SPOTIFY_RETURN_PATH_KEY);
}

export function writePendingSpotifyCallback(payload: PendingSpotifyCallback) {
  if (!canUseStorage()) return;
  localStorage.setItem(
    SPOTIFY_PENDING_CALLBACK_KEY,
    JSON.stringify({
      ...payload,
      returnPath: sanitizeReturnPath(payload.returnPath),
    }),
  );
}

export function readPendingSpotifyCallback() {
  const pending = parseStoredJson<PendingSpotifyCallback>(SPOTIFY_PENDING_CALLBACK_KEY);
  if (!pending) return null;

  const ageMs = Date.now() - (pending.savedAt || 0);
  if (!pending.code || ageMs > PENDING_SPOTIFY_MAX_AGE_MS) {
    clearPendingSpotifyCallback();
    return null;
  }

  return {
    ...pending,
    returnPath: sanitizeReturnPath(pending.returnPath),
  };
}

export function clearPendingSpotifyCallback() {
  if (!canUseStorage()) return;
  localStorage.removeItem(SPOTIFY_PENDING_CALLBACK_KEY);
}

export function writePendingSpotifyConnect(payload: PendingSpotifyConnect) {
  if (!canUseStorage()) return;
  localStorage.setItem(
    SPOTIFY_PENDING_CONNECT_KEY,
    JSON.stringify({
      ...payload,
      returnPath: sanitizeReturnPath(payload.returnPath),
    }),
  );
}

export function readPendingSpotifyConnect() {
  const pending = parseStoredJson<PendingSpotifyConnect>(SPOTIFY_PENDING_CONNECT_KEY);
  if (!pending) return null;

  const ageMs = Date.now() - (pending.savedAt || 0);
  if (ageMs > PENDING_SPOTIFY_MAX_AGE_MS) {
    clearPendingSpotifyConnect();
    return null;
  }

  return {
    ...pending,
    returnPath: sanitizeReturnPath(pending.returnPath),
  };
}

export function clearPendingSpotifyConnect() {
  if (!canUseStorage()) return;
  localStorage.removeItem(SPOTIFY_PENDING_CONNECT_KEY);
}

export function decodeSpotifyStatePayload(state: string | null): DecodedSpotifyStatePayload | null {
  if (!state) return null;

  const [payloadSegment] = state.split(".");
  if (!payloadSegment) return null;

  try {
    const payloadText = decodeBase64Url(payloadSegment);
    return JSON.parse(payloadText) as DecodedSpotifyStatePayload;
  } catch {
    return null;
  }
}

export function getReturnPathFromSpotifyState(state: string | null, fallback = "/dashboard") {
  const payload = decodeSpotifyStatePayload(state);
  return sanitizeReturnPath(payload?.return_path, fallback);
}
