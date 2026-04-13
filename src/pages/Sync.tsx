import AppLayout from "@/components/app/AppLayout";
import { Button } from "@/components/ui/button";
import { CheckCircle2, AlertCircle, Headphones, RefreshCw } from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { useConnections } from "@/hooks/use-connections";
import { useSpotify } from "@/hooks/use-spotify";

const Sync = () => {
  const { connections } = useConnections();
  const { startAuth, disconnect } = useSpotify();

  const spotifyConnected = connections.spotify.connected;

  return (
    <AppLayout>
      <div className="max-w-3xl">
        <div className="mb-8">
          <h1 className="font-heading text-3xl mb-1">Sync & Export</h1>
          <p className="text-muted-foreground">Manage your playlist exports to Spotify.</p>
        </div>

        {/* Spotify connection card */}
        <div className="p-5 rounded-2xl bg-surface-elevated border border-border/50 flex items-center justify-between mb-6">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-accent/10 flex items-center justify-center text-xl">🎵</div>
            <div>
              <p className="font-medium">Spotify</p>
              <p className="text-sm text-muted-foreground">
                {spotifyConnected ? `Connected as ${connections.spotify.email}` : "Not connected"}
              </p>
            </div>
          </div>
          {spotifyConnected ? (
            <div className="flex items-center gap-3">
              <span className="inline-flex items-center gap-1 text-sm text-accent">
                <CheckCircle2 className="w-4 h-4" /> Connected
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="rounded-lg text-destructive"
                onClick={async () => {
                  await disconnect();
                  toast("Spotify disconnected");
                }}
              >
                Disconnect
              </Button>
            </div>
          ) : (
            <Button variant="hero" size="sm" className="rounded-lg" onClick={() => void startAuth("/sync")}>
              Connect
            </Button>
          )}
        </div>

        {/* Content */}
        {!spotifyConnected ? (
          <div className="rounded-2xl bg-surface-elevated border border-border/50 p-12 text-center">
            <Headphones className="w-10 h-10 text-muted-foreground mx-auto mb-4" />
            <h2 className="font-heading text-xl mb-2">Connect Spotify to enable sync</h2>
            <p className="text-sm text-muted-foreground max-w-sm mx-auto">
              Once Spotify is connected and you have generated playlists, you'll be able to export and sync them here.
            </p>
          </div>
        ) : (
          <div className="rounded-2xl bg-surface-elevated border border-border/50 p-12 text-center">
            <RefreshCw className="w-10 h-10 text-muted-foreground mx-auto mb-4" />
            <h2 className="font-heading text-xl mb-2">No playlists to sync</h2>
            <p className="text-sm text-muted-foreground max-w-sm mx-auto mb-6">
              Generate playlists from your imported library first, then come back here to export them to Spotify.
            </p>
            <Button variant="hero" asChild>
              <Link to="/discover">Open Discover</Link>
            </Button>
          </div>
        )}
      </div>
    </AppLayout>
  );
};

export default Sync;
