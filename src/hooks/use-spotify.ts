import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./use-auth";

const SPOTIFY_AUTH_URL = "https://accounts.spotify.com/authorize";
const EXACT_SPOTIFY_REDIRECT_URI = "https://159079dd-d99f-4e32-b626-b73b50d600ec.lovableproject.com/spotify-callback";
const SCOPES = "user-library-read playlist-modify-private playlist-modify-public";

const SPOTIFY_OAUTH_DONE_KEY = "spotify-oauth-complete";
const SPOTIFY_OAUTH_ERROR_KEY = "spotify-oauth-error";
const SPOTIFY_PKCE_VERIFIER_KEY = "spotify-pkce-verifier";
const SPOTIFY_PKCE_STATE_KEY = "spotify-pkce-state";
const SPOTIFY_REDIRECT_URI_KEY = "spotify-redirect-uri";
const SPOTIFY_RETURN_PATH_KEY = "spotify-return-path";

type SpotifyConfig = {
  client_id?: string | null;
  redirect_uri?: string | null;
  error?: string | null;
  step?: string | null;
  status?: number | null;
  diagnostics?: Record<string, unknown> | null;
  spotify_status?: number | null;
  spotify_body?: unknown;
};

type SpotifyErrorPayload = {
  error?: string | null;
  step?: string | null;
  status?: number | null;
  diagnostics?: Record<string, unknown> | null;
  spotify_status?: number | null;
  spotify_body?: unknown;
};

type SpotifyFailure = {
  message: string;
  payload: SpotifyErrorPayload | null;
};

function generateRandomString(length: number) {
  const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const values = crypto.getRandomValues(new Uint8Array(length));
  return values.reduce((acc, x) => acc + possible[x % possible.length], "");
}

async function sha256(plain: string) {
  const encoder = new TextEncoder();
  const data = encoder.encode(plain);
  return window.crypto.subtle.digest("SHA-256", data);
}

function base64encode(input: ArrayBuffer) {
  return btoa(String.fromCharCode(...new Uint8Array(input)))
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function clearTransientSpotifyKeys() {
  localStorage.removeItem(SPOTIFY_PKCE_VERIFIER_KEY);
  localStorage.removeItem(SPOTIFY_PKCE_STATE_KEY);
  localStorage.removeItem(SPOTIFY_REDIRECT_URI_KEY);
}

function logSpotifyOAuth(step: string, details: Record<string, unknown>) {
  console.info(`[Spotify OAuth] ${step}`, details);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function formatSpotifyFailure(payload: SpotifyErrorPayload | null, fallback: string) {
  if (!payload) return fallback;

  return [
    payload.step ? `Step ${payload.step}` : null,
    payload.status ? `HTTP ${payload.status}` : null,
    payload.error ?? fallback,
  ]
    .filter(Boolean)
    .join(" — ");
}

function normalizeSpotifyPayload(payload: unknown, fallback: string): SpotifyFailure {
  if (!isRecord(payload)) {
    return { message: fallback, payload: null };
  }

  const normalized: SpotifyErrorPayload = {
    error: typeof payload.error === "string" ? payload.error : fallback,
    step: typeof payload.step === "string" ? payload.step : null,
    status: typeof payload.status === "number" ? payload.status : null,
    diagnostics: isRecord(payload.diagnostics) ? payload.diagnostics : null,
    spotify_status: typeof payload.spotify_status === "number" ? payload.spotify_status : null,
    spotify_body: "spotify_body" in payload ? payload.spotify_body : undefined,
  };

  return {
    message: formatSpotifyFailure(normalized, fallback),
    payload: normalized,
  };
}

async function getFunctionFailure(error: unknown, fallback: string): Promise<SpotifyFailure> {
  if (isRecord(error) && "context" in error && error.context instanceof Response) {
    const response = error.context;
    const bodyText = await response.clone().text();

    if (!bodyText) {
      const payload: SpotifyErrorPayload = { status: response.status, error: fallback };
      return { message: formatSpotifyFailure(payload, fallback), payload };
    }

    try {
      const payload = JSON.parse(bodyText) as SpotifyErrorPayload;
      payload.status = payload.status ?? response.status;
      return {
        message: formatSpotifyFailure(payload, fallback),
        payload,
      };
    } catch {
      const payload: SpotifyErrorPayload = { status: response.status, error: bodyText };
      return { message: formatSpotifyFailure(payload, fallback), payload };
    }
  }

  return {
    message: error instanceof Error ? error.message : fallback,
    payload: null,
  };
}

export type SpotifyStatus =
  | "idle"
  | "connecting"
  | "authorizing"
  | "connected"
  | "importing"
  | "complete"
  | "error";

export function useSpotify() {
  const { user, refreshProfile } = useAuth();
  const [status, setStatus] = useState<SpotifyStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [importCount, setImportCount] = useState(0);

  useEffect(() => {
    const handleStorage = async (event: StorageEvent) => {
      if (event.key === SPOTIFY_OAUTH_DONE_KEY && event.newValue) {
        try {
          const payload = JSON.parse(event.newValue) as { importCount?: number };
          setImportCount(payload.importCount ?? 0);
          setError(null);
          setStatus("complete");
          await refreshProfile();
        } catch {
          setStatus("complete");
          await refreshProfile();
        }

        localStorage.removeItem(SPOTIFY_OAUTH_DONE_KEY);
      }

      if (event.key === SPOTIFY_OAUTH_ERROR_KEY && event.newValue) {
        try {
          const payload = JSON.parse(event.newValue) as { message?: string };
          setError(payload.message ?? "Spotify connection failed.");
        } catch {
          setError("Spotify connection failed.");
        }

        setStatus("error");
        localStorage.removeItem(SPOTIFY_OAUTH_ERROR_KEY);
      }
    };

    const handleMessage = async (event: MessageEvent) => {
      if (event.origin !== window.location.origin || !event.data?.type) return;

      if (event.data.type === SPOTIFY_OAUTH_DONE_KEY) {
        setImportCount(event.data.importCount ?? 0);
        setError(null);
        setStatus("complete");
        await refreshProfile();
      }

      if (event.data.type === SPOTIFY_OAUTH_ERROR_KEY) {
        setError(event.data.message ?? "Spotify connection failed.");
        setStatus("error");
      }
    };

    window.addEventListener("storage", handleStorage);
    window.addEventListener("message", handleMessage);

    return () => {
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener("message", handleMessage);
    };
  }, [refreshProfile]);

  const startAuth = useCallback(async (returnPath = window.location.pathname) => {
    if (!user) {
      setError("Please log in before connecting Spotify.");
      setStatus("error");
      return;
    }

    setStatus("connecting");
    setError(null);
    localStorage.removeItem(SPOTIFY_OAUTH_DONE_KEY);
    localStorage.removeItem(SPOTIFY_OAUTH_ERROR_KEY);
    localStorage.removeItem(SPOTIFY_REDIRECT_URI_KEY);

    try {
      const configRes = await supabase.functions.invoke("spotify-config");
      if (configRes.error) {
        const failure = await getFunctionFailure(configRes.error, "Unable to load Spotify configuration.");
        logSpotifyOAuth("config_error", {
          message: failure.message,
          diagnostics: failure.payload ?? null,
        });
        throw new Error(failure.message);
      }

      const config = (configRes.data ?? {}) as SpotifyConfig;
      if (config.error) {
        const failure = normalizeSpotifyPayload(config, "Unable to load Spotify configuration.");
        logSpotifyOAuth("config_error", {
          message: failure.message,
          diagnostics: failure.payload ?? null,
        });
        throw new Error(failure.message);
      }

      const clientId = config.client_id?.trim();
      const redirectUri = config.redirect_uri?.trim();

      logSpotifyOAuth("runtime_config", {
        current_origin: window.location.origin,
        configured_redirect_uri: redirectUri ?? null,
        exact_redirect_uri: EXACT_SPOTIFY_REDIRECT_URI,
        redirect_uri_matches_exact: redirectUri === EXACT_SPOTIFY_REDIRECT_URI,
        has_client_id: Boolean(clientId),
      });

      if (!clientId) {
        throw new Error("Spotify is not fully configured. Missing client ID.");
      }

      if (redirectUri !== EXACT_SPOTIFY_REDIRECT_URI) {
        throw new Error(`Spotify redirect URI mismatch. Expected ${EXACT_SPOTIFY_REDIRECT_URI} but got ${redirectUri || "empty"}.`);
      }

      const redirectOrigin = new URL(redirectUri).origin;
      if (redirectOrigin !== window.location.origin) {
        const handoffUrl = new URL(EXACT_SPOTIFY_REDIRECT_URI);
        handoffUrl.searchParams.set("init", "1");
        handoffUrl.searchParams.set("returnPath", returnPath);

        logSpotifyOAuth("origin_handoff", {
          current_origin: window.location.origin,
          redirect_origin: redirectOrigin,
          redirect_uri: EXACT_SPOTIFY_REDIRECT_URI,
          handoff_url: handoffUrl.toString(),
        });
        window.location.assign(handoffUrl.toString());
        return;
      }

      const state = generateRandomString(24);
      const codeVerifier = generateRandomString(64);
      const hashed = await sha256(codeVerifier);
      const codeChallenge = base64encode(hashed);

      localStorage.setItem(SPOTIFY_PKCE_VERIFIER_KEY, codeVerifier);
      localStorage.setItem(SPOTIFY_PKCE_STATE_KEY, state);
      localStorage.setItem(SPOTIFY_REDIRECT_URI_KEY, EXACT_SPOTIFY_REDIRECT_URI);
      localStorage.setItem(SPOTIFY_RETURN_PATH_KEY, returnPath);

      logSpotifyOAuth("pkce_generated", {
        redirect_uri: EXACT_SPOTIFY_REDIRECT_URI,
        has_code_verifier: true,
        code_verifier_length: codeVerifier.length,
        has_state: Boolean(state),
        return_path: returnPath,
      });

      const params = new URLSearchParams({
        response_type: "code",
        client_id: clientId,
        redirect_uri: EXACT_SPOTIFY_REDIRECT_URI,
        scope: SCOPES,
        code_challenge_method: "S256",
        code_challenge: codeChallenge,
        state,
      });

      const authUrl = `${SPOTIFY_AUTH_URL}?${params.toString()}`;
      logSpotifyOAuth("authorization_request", {
        current_origin: window.location.origin,
        redirect_uri: EXACT_SPOTIFY_REDIRECT_URI,
        authorization_url: authUrl,
      });
      setStatus("authorizing");

      if (window.self !== window.top) {
        const popup = window.open(authUrl, "spotify-auth", "popup=yes,width=520,height=760");

        if (!popup) {
          logSpotifyOAuth("popup_blocked_fallback", {
            redirect_uri: EXACT_SPOTIFY_REDIRECT_URI,
            authorization_url: authUrl,
          });
          window.open(authUrl, "_blank");
          return;
        }

        const watcher = window.setInterval(() => {
          if (popup.closed) {
            window.clearInterval(watcher);
            setStatus((current) => (current === "authorizing" ? "idle" : current));
          }
        }, 500);

        return;
      }

      window.location.assign(authUrl);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Spotify connection failed.";
      logSpotifyOAuth("start_auth_failure", { message });
      clearTransientSpotifyKeys();
      setError(message);
      setStatus("error");
    }
  }, [user]);

  const handleCallback = useCallback(async (code: string, returnedState: string | null) => {
    const codeVerifier = localStorage.getItem(SPOTIFY_PKCE_VERIFIER_KEY);
    const storedState = localStorage.getItem(SPOTIFY_PKCE_STATE_KEY);
    const storedRedirectUri = localStorage.getItem(SPOTIFY_REDIRECT_URI_KEY);

    logSpotifyOAuth("callback_received", {
      has_code: Boolean(code),
      has_code_verifier: Boolean(codeVerifier),
      code_verifier_length: codeVerifier?.length ?? 0,
      has_stored_state: Boolean(storedState),
      returned_state_present: Boolean(returnedState),
      state_matches: Boolean(returnedState && storedState && returnedState === storedState),
      stored_redirect_uri: storedRedirectUri,
      exact_redirect_uri: EXACT_SPOTIFY_REDIRECT_URI,
      redirect_uri_matches: storedRedirectUri === EXACT_SPOTIFY_REDIRECT_URI,
    });

    if (!codeVerifier || !storedState || !storedRedirectUri) {
      setError("Missing Spotify authorization data. Please start the connection again.");
      setStatus("error");
      return;
    }

    if (storedRedirectUri !== EXACT_SPOTIFY_REDIRECT_URI) {
      clearTransientSpotifyKeys();
      setError(`Spotify redirect URI mismatch. Expected ${EXACT_SPOTIFY_REDIRECT_URI} but got ${storedRedirectUri}.`);
      setStatus("error");
      return;
    }

    if (!returnedState || returnedState !== storedState) {
      clearTransientSpotifyKeys();
      setError("Spotify state validation failed. Please try connecting again.");
      setStatus("error");
      return;
    }

    setStatus("authorizing");
    setError(null);

    try {
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();

      if (sessionError) {
        logSpotifyOAuth("session_check_failed", {
          failure_type: "expired_app_session",
          error: sessionError.message,
        });
        throw new Error("Your app session has expired. Please sign in again to finish connecting Spotify.");
      }

      if (!sessionData.session?.access_token) {
        logSpotifyOAuth("session_check_failed", {
          failure_type: "missing_app_session",
          has_session: Boolean(sessionData.session),
          has_access_token: Boolean(sessionData.session?.access_token),
        });
        throw new Error("No active session found. Please sign in to Tempo first, then retry Spotify.");
      }

      logSpotifyOAuth("session_valid", {
        user_id: sessionData.session.user?.id,
        expires_at: sessionData.session.expires_at,
      });

      logSpotifyOAuth("token_exchange_request", {
        redirect_uri: EXACT_SPOTIFY_REDIRECT_URI,
        has_code: Boolean(code),
      });

      const res = await supabase.functions.invoke("spotify-auth-callback", {
        body: { code, code_verifier: codeVerifier, redirect_uri: EXACT_SPOTIFY_REDIRECT_URI },
      });

      if (res.error) {
        const failure = await getFunctionFailure(res.error, "Failed to exchange Spotify authorization code.");
        logSpotifyOAuth("token_exchange_error", {
          message: failure.message,
          diagnostics: failure.payload ?? null,
        });
        throw new Error(failure.message);
      }

      if (res.data?.error) {
        const failure = normalizeSpotifyPayload(res.data, "Failed to exchange Spotify authorization code.");
        logSpotifyOAuth("token_exchange_error", {
          message: failure.message,
          diagnostics: failure.payload ?? null,
        });
        throw new Error(failure.message);
      }

      logSpotifyOAuth("token_exchange_success", {
        diagnostics: isRecord(res.data) ? res.data : { success: true },
      });

      setStatus("connected");
      await refreshProfile();

      setStatus("importing");
      const importRes = await supabase.functions.invoke("spotify-import-tracks");
      if (importRes.error) {
        const failure = await getFunctionFailure(importRes.error, "Spotify connected but song import failed.");
        logSpotifyOAuth("import_error", {
          message: failure.message,
          diagnostics: failure.payload ?? null,
        });
        throw new Error(failure.message);
      }

      if (importRes.data?.error) {
        const failure = normalizeSpotifyPayload(importRes.data, "Spotify connected but song import failed.");
        logSpotifyOAuth("import_error", {
          message: failure.message,
          diagnostics: failure.payload ?? null,
        });
        throw new Error(failure.message);
      }

      setImportCount(importRes.data?.imported || 0);
      logSpotifyOAuth("import_success", {
        diagnostics: isRecord(importRes.data) ? importRes.data : { imported: importRes.data?.imported ?? 0 },
      });
      await refreshProfile();
      clearTransientSpotifyKeys();
      setStatus("complete");
    } catch (e) {
      const message = e instanceof Error ? e.message : "Spotify connection failed.";
      logSpotifyOAuth("callback_failure", { message });
      clearTransientSpotifyKeys();
      setError(message);
      setStatus("error");
    }
  }, [refreshProfile]);

  const disconnect = useCallback(async () => {
    if (!user) return;

    await supabase.from("spotify_connections").delete().eq("user_id", user.id);
    await supabase.from("profiles").update({ spotify_connected: false }).eq("user_id", user.id);
    await refreshProfile();
    setStatus("idle");
    setError(null);
    setImportCount(0);
    clearTransientSpotifyKeys();
    localStorage.removeItem(SPOTIFY_OAUTH_DONE_KEY);
    localStorage.removeItem(SPOTIFY_OAUTH_ERROR_KEY);
    localStorage.removeItem(SPOTIFY_RETURN_PATH_KEY);
  }, [user, refreshProfile]);

  return { status, error, importCount, startAuth, handleCallback, disconnect };
}
