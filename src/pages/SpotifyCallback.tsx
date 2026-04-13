import { useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useSpotify } from "@/hooks/use-spotify";
import { Loader2, CheckCircle2, AlertCircle, Music } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

const SpotifyCallback = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { status, error, importCount, handleCallback } = useSpotify();

  const code = searchParams.get("code");
  const authError = searchParams.get("error");

  useEffect(() => {
    if (authError) return;
    if (code && status === "idle") {
      handleCallback(code);
    }
  }, [code, authError, status, handleCallback]);

  const returnPath = sessionStorage.getItem("spotify_return_path") || "/settings";

  const handleContinue = () => {
    sessionStorage.removeItem("spotify_return_path");
    navigate(returnPath, { replace: true });
  };

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-4">
      <div className="flex items-center gap-2 mb-6">
        <Music className="h-8 w-8 text-accent" />
        <h1 className="font-instrument-serif text-4xl text-foreground">Tempo</h1>
      </div>

      <Card className="w-full max-w-md border-border/60 shadow-lg">
        <CardContent className="p-8 text-center space-y-4">
          {authError ? (
            <>
              <AlertCircle className="h-12 w-12 text-destructive mx-auto" />
              <h2 className="font-instrument-serif text-xl">Connection Failed</h2>
              <p className="text-sm text-muted-foreground">
                Spotify authorization was denied or an error occurred.
              </p>
              <Button variant="hero" onClick={handleContinue}>Go Back</Button>
            </>
          ) : status === "exchanging" ? (
            <>
              <Loader2 className="h-12 w-12 text-accent mx-auto animate-spin" />
              <h2 className="font-instrument-serif text-xl">Connecting Spotify…</h2>
              <p className="text-sm text-muted-foreground">Exchanging authorization tokens.</p>
            </>
          ) : status === "importing" ? (
            <>
              <Loader2 className="h-12 w-12 text-accent mx-auto animate-spin" />
              <h2 className="font-instrument-serif text-xl">Importing Your Library…</h2>
              <p className="text-sm text-muted-foreground">
                Fetching your saved songs from Spotify. This may take a moment.
              </p>
            </>
          ) : status === "done" ? (
            <>
              <CheckCircle2 className="h-12 w-12 text-accent mx-auto" />
              <h2 className="font-instrument-serif text-xl">Spotify Connected!</h2>
              <p className="text-sm text-muted-foreground">
                {importCount > 0
                  ? `Successfully imported ${importCount} songs from your library.`
                  : "Your account is linked. Songs will sync shortly."}
              </p>
              <Button variant="hero" onClick={handleContinue}>Continue</Button>
            </>
          ) : status === "error" ? (
            <>
              <AlertCircle className="h-12 w-12 text-destructive mx-auto" />
              <h2 className="font-instrument-serif text-xl">Something Went Wrong</h2>
              <p className="text-sm text-muted-foreground">{error}</p>
              <Button variant="hero" onClick={handleContinue}>Go Back</Button>
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
