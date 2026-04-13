import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./use-auth";
import {
  SPOTIFY_OAUTH_DONE_KEY,
  SPOTIFY_OAUTH_ERROR_KEY,
  clearPendingSpotifyCallback,
  clearPendingSpotifyConnect,
  clearSpotifyReturnPath,
  setSpotifyReturnPath,
  writePendingSpotifyConnect,
} from "@/lib/spotify-auth";

const SPOTIFY_AUTH_POPUP_NAME = "spotify-auth";

const SPOTIFY_STEP_LABELS: Record<string, string> = {
  auth_validation: "Tempo session",
  user_session: "Tempo session",
  runtime_config: "runtime config",
  callback_parsing: "callback parsing",
  state_validation: "state validation",
  state_generation: "state generation",
  token_exchange: "token exchange",
  spotify_profile_fetch: "profile fetch",
  load_connection: "connection lookup",
  refresh_access_token: "saved tracks import",
  saved_tracks_fetch: "saved tracks import",
  database_write_connection: "database write",
  database_write_connection_refresh: "database write",
  database_write_profile: "database write",
  database_write_tracks: "database write",
};

type SpotifyFunctionPayload = {
  authorization_url?: string | null;
  return_path?: string | null;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function logSpotifyOAuth(step: string, details: Record<string, unknown>) {
  console.info(`[Spotify OAuth] ${step}`, details);
}

function formatSpotifyStep(step: string | null | undefined) {
  if (!step) return null;
  return SPOTIFY_STEP_LABELS[step] ?? step.replace(/_/g, " ");
}

function formatSpotifyFailure(payload: SpotifyErrorPayload | null, fallback: string) {
  if (!payload) return fallback;

  return [
    formatSpotifyStep(payload.step),
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
  const responseContext = isRecord(error) ? error.context : null;

  if (responseContext instanceof Response) {
    const bodyText = await responseContext.clone().text();

    if (!bodyText) {
      const payload: SpotifyErrorPayload = { status: responseContext.status, error: fallback };
      return { message: formatSpotifyFailure(payload, fallback), payload };
    }

    try {
      const payload = JSON.parse(bodyText) as SpotifyErrorPayload;
      payload.status = payload.status ?? responseContext.status;
      return {
        message: formatSpotifyFailure(payload, fallback),
        payload,
      };
    } catch {
      const payload: SpotifyErrorPayload = { status: responseContext.status, error: bodyText };
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
      if (!event.data?.type) return;

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
    setSpotifyReturnPath(returnPath);
    localStorage.removeItem(SPOTIFY_OAUTH_DONE_KEY);
    localStorage.removeItem(SPOTIFY_OAUTH_ERROR_KEY);

    if (!user) {
      writePendingSpotifyConnect({ returnPath, savedAt: Date.now() });
      logSpotifyOAuth("missing_app_session", {
        failure_type: "missing_app_session",
        action: "redirect_to_login",
        return_path: returnPath,
      });
      window.location.assign("/auth?connect=spotify");
      return;
    }

    setStatus("connecting");
    setError(null);
    clearPendingSpotifyConnect();
    clearPendingSpotifyCallback();

    try {
      // Verify session is still valid before calling the edge function
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      if (sessionError || !sessionData.session?.access_token) {
        logSpotifyOAuth("session_expired_before_start", {
          failure_type: "expired_app_session",
          error: sessionError?.message ?? "No active session",
        });
        writePendingSpotifyConnect({ returnPath, savedAt: Date.now() });
        window.location.assign("/auth?connect=spotify");
        return;
      }

      const configRes = await supabase.functions.invoke("spotify-auth-start", {
        body: { return_path: returnPath, origin: window.location.origin },
      });

      if (configRes.error) {
        const failure = await getFunctionFailure(configRes.error, "Unable to start Spotify authorization.");
        logSpotifyOAuth("authorization_start_error", {
          message: failure.message,
          diagnostics: failure.payload ?? null,
        });
        throw new Error(failure.message);
      }

      const payload = (configRes.data ?? {}) as SpotifyFunctionPayload;
      if (payload.error) {
        const failure = normalizeSpotifyPayload(payload, "Unable to start Spotify authorization.");
        logSpotifyOAuth("authorization_start_error", {
          message: failure.message,
          diagnostics: failure.payload ?? null,
        });
        throw new Error(failure.message);
      }

      const authorizationUrl = payload.authorization_url?.trim();
      const resolvedReturnPath = payload.return_path?.trim() || returnPath;

      if (!authorizationUrl) {
        throw new Error("Spotify authorization URL was not returned by the backend.");
      }

      setSpotifyReturnPath(resolvedReturnPath);
      logSpotifyOAuth("authorization_request", {
        return_path: resolvedReturnPath,
        authorization_url_present: true,
      });
      setStatus("authorizing");

      if (window.self !== window.top) {
        const popup = window.open(authorizationUrl, SPOTIFY_AUTH_POPUP_NAME, "popup=yes,width=520,height=760");

        if (!popup) {
          logSpotifyOAuth("popup_blocked_fallback", { authorization_url_present: true });
          window.location.assign(authorizationUrl);
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

      window.location.assign(authorizationUrl);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Spotify connection failed.";
      logSpotifyOAuth("start_auth_failure", { message });
      setError(message);
      setStatus("error");
    }
  }, [user]);

  const handleCallback = useCallback(async (code: string, returnedState: string | null) => {
    logSpotifyOAuth("callback_received", {
      has_code: Boolean(code),
      has_state: Boolean(returnedState),
    });

    if (!returnedState) {
      setError("state validation — Missing Spotify authorization state.");
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
        throw new Error("Tempo session — Your app session expired before Spotify could finish connecting.");
      }

      if (!sessionData.session?.access_token) {
        logSpotifyOAuth("session_check_failed", {
          failure_type: "missing_app_session",
          has_session: Boolean(sessionData.session),
        });
        throw new Error("Tempo session — No Tempo session found. Please sign in first.");
      }

      const callbackRes = await supabase.functions.invoke("spotify-auth-callback", {
        body: { code, state: returnedState },
      });

      if (callbackRes.error) {
        const failure = await getFunctionFailure(callbackRes.error, "Failed to finish Spotify connection.");
        logSpotifyOAuth("callback_backend_error", {
          message: failure.message,
          diagnostics: failure.payload ?? null,
        });
        throw new Error(failure.message);
      }

      const callbackPayload = (callbackRes.data ?? {}) as SpotifyFunctionPayload;
      if (callbackPayload.error) {
        const failure = normalizeSpotifyPayload(callbackPayload, "Failed to finish Spotify connection.");
        logSpotifyOAuth("callback_backend_error", {
          message: failure.message,
          diagnostics: failure.payload ?? null,
        });
        throw new Error(failure.message);
      }

      if (callbackPayload.return_path) {
        setSpotifyReturnPath(callbackPayload.return_path);
      }

      logSpotifyOAuth("token_exchange_success", {
        diagnostics: callbackPayload.diagnostics ?? null,
      });

      setStatus("connected");
      await refreshProfile();

      setStatus("importing");
      const importRes = await supabase.functions.invoke("spotify-import-tracks");

      if (importRes.error) {
        const failure = await getFunctionFailure(importRes.error, "Spotify connected but the library import failed.");
        logSpotifyOAuth("import_error", {
          message: failure.message,
          diagnostics: failure.payload ?? null,
        });
        throw new Error(failure.message);
      }

      if (importRes.data?.error) {
        const failure = normalizeSpotifyPayload(importRes.data, "Spotify connected but the library import failed.");
        logSpotifyOAuth("import_error", {
          message: failure.message,
          diagnostics: failure.payload ?? null,
        });
        throw new Error(failure.message);
      }

      setImportCount(importRes.data?.imported || 0);
      await refreshProfile();
      clearPendingSpotifyCallback();
      clearPendingSpotifyConnect();
      setStatus("complete");
    } catch (e) {
      const message = e instanceof Error ? e.message : "Spotify connection failed.";
      logSpotifyOAuth("callback_failure", { message });
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
    clearPendingSpotifyCallback();
    clearPendingSpotifyConnect();
    clearSpotifyReturnPath();
    localStorage.removeItem(SPOTIFY_OAUTH_DONE_KEY);
    localStorage.removeItem(SPOTIFY_OAUTH_ERROR_KEY);
  }, [user, refreshProfile]);

  return { status, error, importCount, startAuth, handleCallback, disconnect };
}
