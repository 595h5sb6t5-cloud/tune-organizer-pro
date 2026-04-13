import { useCallback, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./use-auth";

const SPOTIFY_AUTH_URL = "https://accounts.spotify.com/authorize";
const SCOPES = "user-library-read playlist-modify-private playlist-modify-public";

// PKCE helpers
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

  const startAuth = useCallback(async () => {
    setStatus("connecting");
    setError(null);

    try {
      // Fetch client ID from edge function
      const configRes = await supabase.functions.invoke("spotify-config");
      const clientId = configRes.data?.client_id;
      if (!clientId) {
        throw new Error("Spotify is not configured. Please contact support.");
      }

      const codeVerifier = generateRandomString(64);
      const hashed = await sha256(codeVerifier);
      const codeChallenge = base64encode(hashed);

      sessionStorage.setItem("spotify_code_verifier", codeVerifier);
      sessionStorage.setItem("spotify_return_path", window.location.pathname);

      const redirectUri = `${window.location.origin}/spotify-callback`;

      const params = new URLSearchParams({
        client_id: clientId,
        response_type: "code",
        redirect_uri: redirectUri,
        code_challenge_method: "S256",
        code_challenge: codeChallenge,
        scope: SCOPES,
        state: generateRandomString(16),
      });

      window.location.href = `${SPOTIFY_AUTH_URL}?${params.toString()}`;
    } catch (e: any) {
      setError(e.message);
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
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;

      const redirectUri = `${window.location.origin}/spotify-callback`;
      const res = await supabase.functions.invoke("spotify-auth-callback", {
        body: { code, code_verifier: codeVerifier, redirect_uri: redirectUri },
      });

      if (res.error || res.data?.error) {
        throw new Error(res.data?.error || res.error?.message || "Failed to exchange token");
      }

      sessionStorage.removeItem("spotify_code_verifier");

      // Now import tracks
      setStatus("importing");
      const importRes = await supabase.functions.invoke("spotify-import-tracks");

      if (importRes.error || importRes.data?.error) {
        // Connection succeeded but import failed — still mark as connected
        console.error("Import error:", importRes.data?.error || importRes.error?.message);
      } else {
        setImportCount(importRes.data?.imported || 0);
      }

      await refreshProfile();
      setStatus("done");
    } catch (e: any) {
      setError(e.message);
      setStatus("error");
    }
  }, [refreshProfile]);

  const disconnect = useCallback(async () => {
    if (!user) return;

    await supabase.from("spotify_connections").delete().eq("user_id", user.id);
    await supabase.from("profiles").update({ spotify_connected: false }).eq("user_id", user.id);
    await refreshProfile();
    setStatus("idle");
    setImportCount(0);
  }, [user, refreshProfile]);

  return { status, error, importCount, startAuth, handleCallback, disconnect };
}
