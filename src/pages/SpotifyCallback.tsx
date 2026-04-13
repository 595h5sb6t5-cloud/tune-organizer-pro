import { useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Loader2, CheckCircle2, AlertCircle, Music } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useSpotify } from "@/hooks/use-spotify";
import { useAuth } from "@/hooks/use-auth";

const SPOTIFY_OAUTH_DONE_KEY = "spotify-oauth-complete";
const SPOTIFY_OAUTH_ERROR_KEY = "spotify-oauth-error";
const SPOTIFY_RETURN_PATH_KEY = "spotify-return-path";

const SpotifyCallback = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user, loading } = useAuth();
  const { status, error, importCount, handleCallback, startAuth } = useSpotify();

  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const authError = searchParams.get("error");
  const authErrorDescription = searchParams.get("error_description");
  const initiate = searchParams.get("init") === "1";
  const requestedReturnPath = searchParams.get("returnPath");
  const returnPath = localStorage.getItem(SPOTIFY_RETURN_PATH_KEY) || requestedReturnPath || "/settings";

  useEffect(() => {
    if (!requestedReturnPath) return;
    localStorage.setItem(SPOTIFY_RETURN_PATH_KEY, requestedReturnPath);
  }, [requestedReturnPath]);

  useEffect(() => {
    if (loading || authError || initiate || !code || !user || status !== "idle") return;
    void handleCallback(code, state);
  }, [loading, authError, initiate, code, state, user, status, handleCallback]);

  useEffect(() => {
    if (!initiate || loading || authError || code || !user || status !== "idle") return;
    void startAuth(requestedReturnPath || returnPath);
  }, [initiate, loading, authError, code, user, status, startAuth, requestedReturnPath, returnPath]);

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
      localStorage.removeItem(SPOTIFY_RETURN_PATH_KEY);
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

  const handleBack = () => {
    localStorage.removeItem(SPOTIFY_RETURN_PATH_KEY);
    navigate(returnPath, { replace: true });
  };

  const displayError = authErrorDescription || authError || error || (!loading && !user
    ? "You need to be signed in to finish connecting Spotify."
    : !loading && !code
      ? "Spotify did not return an authorization code. Please try again."
      : null);

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-4">
      <div className="flex items-center gap-2 mb-6">
        <Music className="h-8 w-8 text-accent" />
        <h1 className="font-instrument-serif text-4xl text-foreground">Tempo</h1>
      </div>

      <Card className="w-full max-w-md border-border/60 shadow-lg">
        <CardContent className="p-8 text-center space-y-4">
          {displayError ? (
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
                {initiate
                  ? "Preparing the exact Spotify callback domain and secure PKCE redirect."
                  : "Validating your callback and exchanging your authorization code."}
              </p>
            </>
          ) : status === "connected" ? (
            <>
              <CheckCircle2 className="h-12 w-12 text-accent mx-auto" />
              <h2 className="font-instrument-serif text-xl">Spotify Connected</h2>
              <p className="text-sm text-muted-foreground">Your account is linked. Starting your library import now.</p>
            </>
          ) : status === "importing" ? (
            <>
              <Loader2 className="h-12 w-12 text-accent mx-auto animate-spin" />
              <h2 className="font-instrument-serif text-xl">Importing songs…</h2>
              <p className="text-sm text-muted-foreground">We’re bringing in your saved Spotify tracks for recommendations and playlist creation.</p>
            </>
          ) : status === "complete" ? (
            <>
              <CheckCircle2 className="h-12 w-12 text-accent mx-auto" />
              <h2 className="font-instrument-serif text-xl">Import complete</h2>
              <p className="text-sm text-muted-foreground">
                {importCount > 0
                  ? `Imported ${importCount} saved songs from Spotify.`
                  : "Spotify connected successfully. Your library is ready to sync."}
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
