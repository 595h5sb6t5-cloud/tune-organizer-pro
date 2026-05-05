import { Compass, Sparkles } from "lucide-react";
import AppLayout from "@/components/app/AppLayout";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import { useAuth } from "@/hooks/use-auth";

const Discover = () => {
  const { profile } = useAuth();
  const spotifyConnected = profile?.spotify_connected ?? false;

  return (
    <AppLayout>
      <div className="max-w-5xl">
        <div className="mb-8">
          <h1 className="font-heading text-3xl mb-1">Discover</h1>
          <p className="text-muted-foreground">New music tuned to your taste — not just what's trending.</p>
        </div>

        <div className="rounded-3xl bg-surface-elevated border border-border/50 p-12 text-center">
          <div className="w-14 h-14 rounded-2xl bg-accent/15 flex items-center justify-center mx-auto mb-5">
            <Compass className="w-7 h-7 text-accent" />
          </div>
          <h2 className="font-heading text-2xl mb-2">No recommendations yet</h2>
          <p className="text-sm text-muted-foreground max-w-md mx-auto mb-6">
            {spotifyConnected
              ? "Once your Music DNA is built, Discover will surface deep, personalized recommendations across mood, rhythm, production and artist similarity."
              : "Connect Spotify and import your library to unlock personalized discovery."}
          </p>
          <Button variant="hero" asChild>
            <Link to={spotifyConnected ? "/music-dna" : "/settings"}>
              <Sparkles className="w-4 h-4 mr-2" />
              {spotifyConnected ? "Build my DNA" : "Connect Spotify"}
            </Link>
          </Button>
        </div>
      </div>
    </AppLayout>
  );
};

export default Discover;
