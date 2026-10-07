import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { handleSpotifyCallback } from "@/lib/spotify/auth";

const SpotifyCallback = () => {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const ran = useRef(false); // the code can only be used once (React StrictMode runs effects twice)

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    handleSpotifyCallback(window.location.search)
      .then(() => navigate("/organize", { replace: true }))
      .catch((e: Error) => setError(e.message));
  }, [navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center px-6">
      {error ? (
        <div className="max-w-sm text-center space-y-4">
          <h1 className="font-heading text-3xl">Spotify isn't connected</h1>
          <p className="text-muted-foreground">{error}</p>
          <Button variant="hero" asChild>
            <Link to="/organize">Try again</Link>
          </Button>
        </div>
      ) : (
        <div className="flex items-center gap-3 text-muted-foreground">
          <Loader2 className="w-5 h-5 animate-spin" />
          Connecting your Spotify account…
        </div>
      )}
    </div>
  );
};

export default SpotifyCallback;
