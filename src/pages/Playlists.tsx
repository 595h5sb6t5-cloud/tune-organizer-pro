import AppLayout from "@/components/app/AppLayout";
import { Button } from "@/components/ui/button";
import { ListMusic, Sparkles, Headphones } from "lucide-react";
import { Link } from "react-router-dom";
import { useAuth } from "@/hooks/use-auth";

const Playlists = () => {
  const { profile } = useAuth();
  const spotifyConnected = profile?.spotify_connected ?? false;

  return (
    <AppLayout>
      <div className="max-w-5xl">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="font-heading text-3xl mb-1">Your Playlists</h1>
            <p className="text-muted-foreground">AI-generated playlists based on your library.</p>
          </div>
        </div>

        {!spotifyConnected ? (
          <div className="rounded-2xl bg-surface-elevated border border-border/50 p-12 text-center">
            <Headphones className="w-10 h-10 text-muted-foreground mx-auto mb-4" />
            <h2 className="font-heading text-xl mb-2">Connect Spotify first</h2>
            <p className="text-sm text-muted-foreground max-w-sm mx-auto mb-6">
              Your playlists will appear here after you connect Spotify and import your library.
            </p>
            <Button variant="hero" asChild>
              <Link to="/settings">Go to Settings</Link>
            </Button>
          </div>
        ) : (
          <div className="rounded-2xl bg-surface-elevated border border-border/50 p-12 text-center">
            <ListMusic className="w-10 h-10 text-muted-foreground mx-auto mb-4" />
            <h2 className="font-heading text-xl mb-2">No playlists yet</h2>
            <p className="text-sm text-muted-foreground max-w-sm mx-auto mb-6">
              AI-generated playlists will appear here once Tempo analyzes your imported library. Head to Discover to start exploring.
            </p>
            <Button variant="hero" asChild>
              <Link to="/discover">
                <Sparkles className="w-4 h-4 mr-2" />
                Open Discover
              </Link>
            </Button>
          </div>
        )}
      </div>
    </AppLayout>
  );
};

export default Playlists;
