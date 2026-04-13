import AppLayout from "@/components/app/AppLayout";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { CheckCircle2, Loader2 } from "lucide-react";
import { useConnections } from "@/hooks/use-connections";
import { useSpotify } from "@/hooks/use-spotify";
import { useAuth } from "@/hooks/use-auth";
import { useState } from "react";

const Settings = () => {
  const { connections, connectSpotify, disconnectSpotify, connectApple, disconnectApple, connectingSpotify, connectingApple } = useConnections();
  const { startAuth: startSpotifyAuth, disconnect: disconnectSpotifyReal, status: spotifyAuthStatus } = useSpotify();
  const { profile } = useAuth();
  const [overlapMode, setOverlapMode] = useState(false);
  const [excludeExplicit, setExcludeExplicit] = useState(false);
  const [visibility, setVisibility] = useState<"Private" | "Public">("Private");

  return (
    <AppLayout>
      <div className="max-w-2xl">
        <div className="mb-8">
          <h1 className="font-heading text-3xl mb-1">Settings</h1>
          <p className="text-muted-foreground">Manage your account and preferences.</p>
        </div>

        <div className="space-y-6">
          {/* Connected accounts */}
          <div className="p-6 rounded-2xl bg-surface-elevated border border-border/50">
            <h3 className="font-heading text-lg mb-4">Connected Accounts</h3>
            <div className="flex items-center justify-between p-4 rounded-xl bg-secondary/50">
              <div className="flex items-center gap-3">
                <span className="text-xl">🎵</span>
                <div>
                  <p className="text-sm font-medium">Spotify</p>
                  <p className="text-xs text-muted-foreground">
                    {connections.spotify.connected ? connections.spotify.email : "Not connected"}
                  </p>
                </div>
              </div>
              {connections.spotify.connected ? (
                <Button variant="ghost" size="sm" className="rounded-lg text-destructive" onClick={() => { disconnectSpotify(); toast("Spotify disconnected"); }}>
                  Disconnect
                </Button>
              ) : (
                <Button variant="hero" size="sm" className="rounded-lg" onClick={() => connectSpotify().then(() => toast.success("Spotify connected!"))} disabled={connectingSpotify}>
                  {connectingSpotify ? "Connecting…" : "Connect"}
                </Button>
              )}
            </div>
            <div className="flex items-center justify-between p-4 rounded-xl bg-secondary/50 mt-3">
              <div className="flex items-center gap-3">
                <span className="text-xl">🍎</span>
                <div>
                  <p className="text-sm font-medium">Apple Music</p>
                  <p className="text-xs text-muted-foreground">
                    {connections.apple.connected ? connections.apple.email : "Not connected"}
                  </p>
                </div>
              </div>
              {connections.apple.connected ? (
                <Button variant="ghost" size="sm" className="rounded-lg text-destructive" onClick={() => { disconnectApple(); toast("Apple Music disconnected"); }}>
                  Disconnect
                </Button>
              ) : (
                <Button variant="hero" size="sm" className="rounded-lg" onClick={() => connectApple().then(() => toast.success("Apple Music connected!"))} disabled={connectingApple}>
                  {connectingApple ? "Connecting…" : "Connect"}
                </Button>
              )}
            </div>
          </div>

          {/* Playlist preferences */}
          <div className="p-6 rounded-2xl bg-surface-elevated border border-border/50">
            <h3 className="font-heading text-lg mb-4">Playlist Preferences</h3>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Overlap Mode</p>
                  <p className="text-xs text-muted-foreground">Allow songs in multiple playlists</p>
                </div>
                <button onClick={() => { setOverlapMode(!overlapMode); toast(overlapMode ? "Overlap mode disabled" : "Overlap mode enabled"); }} className={`w-10 h-6 rounded-full relative cursor-pointer transition-colors ${overlapMode ? "bg-accent" : "bg-secondary"}`} role="switch" aria-checked={overlapMode}>
                  <div className={`w-4 h-4 rounded-full bg-primary-foreground absolute top-1 transition-all ${overlapMode ? "left-5" : "left-1"}`} />
                </button>
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Exclude Explicit</p>
                  <p className="text-xs text-muted-foreground">Skip explicit tracks from playlists</p>
                </div>
                <button onClick={() => { setExcludeExplicit(!excludeExplicit); toast(excludeExplicit ? "Explicit tracks included" : "Explicit tracks excluded"); }} className={`w-10 h-6 rounded-full relative cursor-pointer transition-colors ${excludeExplicit ? "bg-accent" : "bg-secondary"}`} role="switch" aria-checked={excludeExplicit}>
                  <div className={`w-4 h-4 rounded-full bg-primary-foreground absolute top-1 transition-all ${excludeExplicit ? "left-5" : "left-1"}`} />
                </button>
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Default Playlist Visibility</p>
                  <p className="text-xs text-muted-foreground">Set new playlists to private or public</p>
                </div>
                <button onClick={() => { const next = visibility === "Private" ? "Public" : "Private"; setVisibility(next); toast(`Default visibility: ${next}`); }} className="text-sm text-accent hover:underline cursor-pointer">
                  {visibility}
                </button>
              </div>
            </div>
          </div>

          {/* Subscription */}
          <div className="p-6 rounded-2xl bg-primary text-primary-foreground">
            <div className="flex items-center gap-2 mb-2">
              <h3 className="font-heading text-lg">Premium Plan</h3>
              <CheckCircle2 className="w-4 h-4 text-accent" />
            </div>
            <p className="text-sm opacity-80 mb-4">Unlimited imports, playlists, and exports. Renews Jan 15, 2027.</p>
            <Button variant="warm" size="sm" className="rounded-lg opacity-60 cursor-not-allowed" disabled>
              Manage Subscription — Coming Soon
            </Button>
          </div>
        </div>
      </div>
    </AppLayout>
  );
};

export default Settings;
