import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Loader2, CheckCircle2, AlertCircle, Music, LogIn } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useSpotify } from "@/hooks/use-spotify";
import { useAuth } from "@/hooks/use-auth";
import {
  SPOTIFY_OAUTH_DONE_KEY,
  SPOTIFY_OAUTH_ERROR_KEY,
  clearPendingSpotifyCallback,
  clearSpotifyReturnPath,
  getReturnPathFromSpotifyState,
  getSpotifyReturnPath,
  setSpotifyReturnPath,
  writePendingSpotifyCallback,
} from "@/lib/spotify-auth";

function logCallback(step: string, details: Record<string, unknown>) {
  console.info(`[SpotifyCallback] ${step}`, details);
}

const SpotifyCallback = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user, loading } = useAuth();
  const { status, error, importCount, handleCallback } = useSpotify();
  const [sessionMissing, setSessionMissing] = useState(false);

  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const authError = searchParams.get("error");
  const authErrorDescription = searchParams.get("error_description");

  const returnPath = useMemo(() => {
    const stateReturnPath = getReturnPathFromSpotifyState(state, "/dashboard");
    return getSpotifyReturnPath(stateReturnPath);
  }, [state]);

  useEffect(() => {
    setSpotifyReturnPath(returnPath);
  }, [returnPath]);

  useEffect(() => {
    if (loading || authError) return;

    if (code && !user) {
      logCallback("session_missing", {
        has_code: true,
        has_state: Boolean(state),
        failure_type: "missing_app_session",
      });

      writePendingSpotifyCallback({
        code,
        state,
        returnPath,
        savedAt: Date.now(),
      });

      setSessionMissing(true);
    }
  }, [loading, authError, code, state, user, returnPath]);

  useEffect(() => {
    if (loading || authError || !code || !user || status !== "idle") return;

    logCallback("session_found", { user_id: user.id, has_code: true });
    clearPendingSpotifyCallback();
    void handleCallback(code, state);
  }, [loading, authError, code, state, user, status, handleCallback]);

  useEffect(() => {
    if (status !== "complete") return;

    const payload = JSON.stringify({ importCount, completedAt: Date.now() });
    localStorage.setItem(SPOTIFY_OAUTH_DONE_KEY, payload);

    if (window.opener && !window.opener.closed) {
      window.opener.postMessage({ type: SPOTIFY_OAUTH_DONE_KEY, importCount }, window.location.origin);
      window.close();
      return;
    }

    const timer = window.setTimeout(() => {
      clearSpotifyReturnPath();
      navigate(returnPath, { replace: true });
    }, 1200);

    return () => window.clearTimeout(timer);
  }, [status, importCount, navigate, returnPath]);

  useEffect(() => {
    const message = authErrorDescription || authError || error;
    if (!message) return;

    localStorage.setItem(SPOTIFY_OAUTH_ERROR_KEY, JSON.stringify({ message, failedAt: Date.now() }));

    if (window.opener && !window.opener.closed) {
      window.opener.postMessage({ type: SPOTIFY_OAUTH_ERROR_KEY, message }, window.location.origin);
    }
  }, [authError, authErrorDescription, error]);

  const handleGoToLogin = () => {
    logCallback("redirect_to_login", {
      pending_callback_saved: true,
      return_after_login: "/spotify-callback",
    });
    navigate(`/auth?connect=spotify&redirect=${encodeURIComponent(returnPath)}`, { replace: true });
  };

  const handleBack = () => {
    clearPendingSpotifyCallback();
    clearSpotifyReturnPath();
    navigate(returnPath, { replace: true });
  };

  const displayError = authErrorDescription || authError || error || (
    !loading && !code
      ? "callback parsing — Spotify did not return an authorization code. Please try again."
      : null
  );

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-4">
      <div className="flex items-center gap-2 mb-6">
        <Music className="h-8 w-8 text-accent" />
        <h1 className="font-instrument-serif text-4xl text-foreground">Tempo</h1>
      </div>

      <Card className="w-full max-w-md border-border/60 shadow-lg">
        <CardContent className="p-8 text-center space-y-4">
          {sessionMissing && !user ? (
            <>
              <LogIn className="h-12 w-12 text-accent mx-auto" />
              <h2 className="font-instrument-serif text-xl">Sign in to finish connecting</h2>
              <p className="text-sm text-muted-foreground">
                Please sign in to Tempo first, then we&apos;ll finish connecting Spotify. Your Spotify approval has been saved.
              </p>
              <Button variant="hero" onClick={handleGoToLogin}>Sign in to Tempo</Button>
              <Button variant="ghost" size="sm" onClick={handleBack} className="text-muted-foreground">
                Cancel
              </Button>
            </>
          ) : displayError ? (
            <>
              <AlertCircle className="h-12 w-12 text-destructive mx-auto" />
              <h2 className="font-instrument-serif text-xl">Spotify Connection Failed</h2>
              <p className="text-sm text-muted-foreground">{displayError}</p>
              <Button variant="hero" onClick={handleBack}>Back to app</Button>
            </>
          ) : loading || status === "idle" || status === "authorizing" ? (
            <>
              <Loader2 className="h-12 w-12 text-accent mx-auto animate-spin" />
              <h2 className="font-instrument-serif text-xl">Authorizing Spotify…</h2>
              <p className="text-sm text-muted-foreground">
                We&apos;re validating your callback and securely finishing the Spotify connection.
              </p>
            </>
          ) : status === "connected" ? (
            <>
              <CheckCircle2 className="h-12 w-12 text-accent mx-auto" />
              <h2 className="font-instrument-serif text-xl">Spotify Connected</h2>
              <p className="text-sm text-muted-foreground">Your Spotify account is linked. Importing your library now.</p>
            </>
          ) : status === "importing" ? (
            <>
              <Loader2 className="h-12 w-12 text-accent mx-auto animate-spin" />
              <h2 className="font-instrument-serif text-xl">Importing songs…</h2>
              <p className="text-sm text-muted-foreground">We&apos;re importing your saved Spotify tracks into Tempo.</p>
            </>
          ) : status === "complete" ? (
            <>
              <CheckCircle2 className="h-12 w-12 text-accent mx-auto" />
              <h2 className="font-instrument-serif text-xl">Spotify connected successfully</h2>
              <p className="text-sm text-muted-foreground">
                {importCount > 0
                  ? `Imported ${importCount} saved songs from Spotify.`
                  : "Spotify is linked and ready in Tempo."}
              </p>
              <Button variant="hero" onClick={handleBack}>Continue</Button>
            </>
          ) : (
            <>
              <Loader2 className="h-12 w-12 text-accent mx-auto animate-spin" />
              <h2 className="font-instrument-serif text-xl">Processing…</h2>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default SpotifyCallback;
