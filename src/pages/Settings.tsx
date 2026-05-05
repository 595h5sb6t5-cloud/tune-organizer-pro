import { useMemo, useState } from "react";
import { CheckCircle2, Loader2, AlertCircle } from "lucide-react";
import AppLayout from "@/components/app/AppLayout";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { useSpotify, type SpotifyStatus } from "@/hooks/use-spotify";
import { useAuth } from "@/hooks/use-auth";
import { UsageCard } from "@/components/UsageCard";
import { PaywallDialog } from "@/components/PaywallDialog";

function getSpotifyStatusCopy(status: SpotifyStatus) {
  switch (status) {
    case "connecting":
      return { button: "Connecting…", helper: "Preparing secure Spotify authorization." };
    case "authorizing":
      return { button: "Authorizing…", helper: "Waiting for Spotify approval." };
    case "connected":
      return { button: "Connected", helper: "Spotify is linked. Starting your library import." };
    case "importing":
      return { button: "Importing songs…", helper: "Syncing your saved Spotify tracks." };
    case "complete":
      return { button: "Connected", helper: "Import complete. Your Spotify library is ready." };
    case "error":
      return { button: "Try again", helper: "Spotify connection failed. Review the message below and retry." };
    default:
      return { button: "Connect", helper: "Authorize Spotify to import saved songs and enable playlist creation." };
  }
}

const Settings = () => {
  const { startAuth: startSpotifyAuth, disconnect: disconnectSpotify, status: spotifyStatus, error: spotifyError } = useSpotify();
  const { profile } = useAuth();
  const [overlapMode, setOverlapMode] = useState(false);
  const [excludeExplicit, setExcludeExplicit] = useState(false);
  const [visibility, setVisibility] = useState<"Private" | "Public">("Private");
  const [paywallOpen, setPaywallOpen] = useState(false);

  const spotifyConnected = profile?.spotify_connected || spotifyStatus === "connected" || spotifyStatus === "complete";
  const spotifyBusy = useMemo(() => ["connecting", "authorizing", "importing"].includes(spotifyStatus), [spotifyStatus]);
  const spotifyCopy = getSpotifyStatusCopy(spotifyStatus);

  return (
    <AppLayout>
      <div className="max-w-2xl">
        <div className="mb-8">
          <h1 className="font-heading text-3xl mb-1">Settings</h1>
          <p className="text-muted-foreground">Manage your account and preferences.</p>
        </div>

        <div className="space-y-6">
          <div className="p-6 rounded-2xl bg-surface-elevated border border-border/50">
            <h3 className="font-heading text-lg mb-4">Connected Accounts</h3>

            <div className="p-4 rounded-xl bg-secondary/50 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="text-xl">🎵</span>
                  <div>
                    <p className="text-sm font-medium">Spotify</p>
                    <p className="text-xs text-muted-foreground">
                      {spotifyConnected ? "Connected" : spotifyCopy.helper}
                    </p>
                  </div>
                </div>
                {spotifyConnected ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="rounded-lg text-destructive"
                    onClick={async () => {
                      await disconnectSpotify();
                      toast("Spotify disconnected");
                    }}
                  >
                    Disconnect
                  </Button>
                ) : (
                  <Button
                    variant="hero"
                    size="sm"
                    className="rounded-lg"
                    onClick={() => void startSpotifyAuth("/settings")}
                    disabled={spotifyBusy}
                  >
                    {spotifyBusy ? (
                      <span className="inline-flex items-center gap-1">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        {spotifyCopy.button}
                      </span>
                    ) : (
                      spotifyCopy.button
                    )}
                  </Button>
                )}
              </div>

              {spotifyStatus === "complete" && (
                <p className="text-xs text-accent inline-flex items-center gap-1">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  <span>Spotify connected and library import finished.</span>
                </p>
              )}

              {spotifyError && (
                <p className="text-xs text-destructive inline-flex items-center gap-1">
                  <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                  <span>{spotifyError}</span>
                </p>
              )}
            </div>
          </div>

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

          <UsageCard onUpgrade={() => setPaywallOpen(true)} />
        </div>

        <PaywallDialog open={paywallOpen} onOpenChange={setPaywallOpen} />
      </div>
    </AppLayout>
  );
};

export default Settings;
