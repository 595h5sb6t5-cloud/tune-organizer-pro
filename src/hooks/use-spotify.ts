import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./use-auth";

const SPOTIFY_AUTH_URL = "https://accounts.spotify.com/authorize";
const SCOPES = "user-library-read playlist-modify-private playlist-modify-public";
const SPOTIFY_OAUTH_DONE_KEY = "spotify-oauth-complete";
const SPOTIFY_OAUTH_ERROR_KEY = "spotify-oauth-error";

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

export type SpotifyStatus = "idle" | "connecting" | "exchanging" | "importing" | "done" | "error";

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
          setStatus("done");
          await refreshProfile();
          localStorage.removeItem(SPOTIFY_OAUTH_DONE_KEY);
        } catch {
          setStatus("done");
          await refreshProfile();
        }
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
        setStatus("done");
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

  const startAuth = useCallback(async () => {
    setStatus("connecting");
    setError(null);

    try {
      const configRes = await supabase.functions.invoke("spotify-config");
      const clientId = configRes.data?.client_id;

      if (!clientId) {
        throw new Error("Spotify is not configured. Please contact support.");
      }

      const codeVerifier = generateRandomString(64);
      const hashed = await sha256(codeVerifier);
      const codeChallenge = base64encode(hashed);
      const redirectUri = `${window.location.origin}/spotify-callback`;

      sessionStorage.setItem("spotify_code_verifier", codeVerifier);
      sessionStorage.setItem("spotify_return_path", window.location.pathname);

      const params = new URLSearchParams({
        client_id: clientId,
        response_type: "code",
        redirect_uri: redirectUri,
        code_challenge_method: "S256",
        code_challenge: codeChallenge,
        scope: SCOPES,
        state: generateRandomString(16),
      });

      const authUrl = `${SPOTIFY_AUTH_URL}?${params.toString()}`;
      const isEmbeddedPreview = window.self !== window.top;

      if (isEmbeddedPreview) {
        const popup = window.open(authUrl, "spotify-auth", "popup=yes,width=520,height=760");

        if (popup) {
          const watcher = window.setInterval(() => {
            if (popup.closed) {
              window.clearInterval(watcher);
              setStatus((current) => (current === "connecting" ? "idle" : current));
            }
          }, 500);
          return;
        }

        window.open(authUrl, "_blank", "noopener,noreferrer");
        setStatus("idle");
        return;
      }

      window.location.assign(authUrl);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Spotify connection failed.";
      setError(message);
      setStatus("error");
    }
  }, []);

  const handleCallback = useCallback(async (code: string) => {
    const codeVerifier = sessionStorage.getItem("spotify_code_verifier");

    if (!codeVerifier) {
      setError("Missing code verifier. Please try again.");
      setStatus("error");
      return;
    }

    setStatus("exchanging");
    setError(null);

    try {
      const redirectUri = `${window.location.origin}/spotify-callback`;
      const res = await supabase.functions.invoke("spotify-auth-callback", {
        body: { code, code_verifier: codeVerifier, redirect_uri: redirectUri },
      });

      if (res.error || res.data?.error) {
        throw new Error(res.data?.error || res.error?.message || "Failed to exchange token");
      }

      sessionStorage.removeItem("spotify_code_verifier");
      setStatus("importing");

      const importRes = await supabase.functions.invoke("spotify-import-tracks");
      const imported = !importRes.error && !importRes.data?.error ? importRes.data?.imported || 0 : 0;

      if (importRes.error || importRes.data?.error) {
        console.error("Import error:", importRes.data?.error || importRes.error?.message);
      }

      setImportCount(imported);
      await refreshProfile();
      setStatus("done");
    } catch (e) {
      const message = e instanceof Error ? e.message : "Spotify connection failed.";
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
    localStorage.removeItem(SPOTIFY_OAUTH_DONE_KEY);
    localStorage.removeItem(SPOTIFY_OAUTH_ERROR_KEY);
  }, [user, refreshProfile]);

  return { status, error, importCount, startAuth, handleCallback, disconnect };
}
