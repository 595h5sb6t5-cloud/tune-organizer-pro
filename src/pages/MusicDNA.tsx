import { Brain, Sparkles } from "lucide-react";
import AppLayout from "@/components/app/AppLayout";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import { useAuth } from "@/hooks/use-auth";
import { useSpotifyLibrary } from "@/hooks/use-spotify-library";

const MusicDNA = () => {
  const { profile } = useAuth();
  const spotifyConnected = profile?.spotify_connected ?? false;
  const { likedCount } = useSpotifyLibrary();

  return (
    <AppLayout>
      <div className="max-w-5xl">
        <div className="mb-8">
          <h1 className="font-heading text-3xl mb-1">Music DNA</h1>
          <p className="text-muted-foreground">A deep, immersive read on your sonic identity.</p>
        </div>

        <div className="rounded-3xl bg-gradient-to-br from-accent/15 via-primary/10 to-background border border-border/50 p-12 text-center">
          <div className="w-14 h-14 rounded-2xl bg-accent/20 flex items-center justify-center mx-auto mb-5">
            <Brain className="w-7 h-7 text-accent" />
          </div>
          <h2 className="font-heading text-2xl mb-2">Your DNA is not ready yet</h2>
          <p className="text-sm text-muted-foreground max-w-md mx-auto mb-6">
            {!spotifyConnected
              ? "Connect Spotify to begin building your Music DNA."
              : likedCount === 0
                ? "Sync your library so we have something to analyze."
                : "Run the analysis to generate your sonic profile across mood, energy, era, rhythm and more."}
          </p>
          <Button variant="hero" asChild>
            <Link to={spotifyConnected ? "/ai-playlists" : "/settings"}>
              <Sparkles className="w-4 h-4 mr-2" />
              {spotifyConnected ? "Run Analysis" : "Connect Spotify"}
            </Link>
          </Button>
        </div>
      </div>
    </AppLayout>
  );
};

export default MusicDNA;
