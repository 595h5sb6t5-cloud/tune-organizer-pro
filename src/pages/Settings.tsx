import AppLayout from "@/components/app/AppLayout";
import { Button } from "@/components/ui/button";

const Settings = () => {
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
                  <p className="text-xs text-muted-foreground">jordan.d@email.com</p>
                </div>
              </div>
              <Button variant="ghost" size="sm" className="rounded-lg text-destructive">Disconnect</Button>
            </div>
            <div className="flex items-center justify-between p-4 rounded-xl bg-secondary/50 mt-3">
              <div className="flex items-center gap-3">
                <span className="text-xl">🍎</span>
                <div>
                  <p className="text-sm font-medium">Apple Music</p>
                  <p className="text-xs text-muted-foreground">Not connected</p>
                </div>
              </div>
              <Button variant="hero" size="sm" className="rounded-lg">Connect</Button>
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
                <div className="w-10 h-6 rounded-full bg-secondary relative cursor-pointer">
                  <div className="w-4 h-4 rounded-full bg-muted-foreground absolute top-1 left-1 transition-all" />
                </div>
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Exclude Explicit</p>
                  <p className="text-xs text-muted-foreground">Skip explicit tracks from playlists</p>
                </div>
                <div className="w-10 h-6 rounded-full bg-secondary relative cursor-pointer">
                  <div className="w-4 h-4 rounded-full bg-muted-foreground absolute top-1 left-1 transition-all" />
                </div>
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Default Playlist Visibility</p>
                  <p className="text-xs text-muted-foreground">Set new playlists to private or public</p>
                </div>
                <span className="text-sm text-muted-foreground">Private</span>
              </div>
            </div>
          </div>

          {/* Subscription */}
          <div className="p-6 rounded-2xl bg-primary text-primary-foreground">
            <h3 className="font-heading text-lg mb-2">Premium Plan</h3>
            <p className="text-sm opacity-80 mb-4">Unlimited imports, playlists, and exports. Renews Jan 15, 2027.</p>
            <Button variant="warm" size="sm" className="rounded-lg">Manage Subscription</Button>
          </div>
        </div>
      </div>
    </AppLayout>
  );
};

export default Settings;
