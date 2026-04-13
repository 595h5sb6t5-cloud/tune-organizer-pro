import AppLayout from "@/components/app/AppLayout";
import { Button } from "@/components/ui/button";
import { samplePlaylists } from "@/lib/sample-data";
import { CheckCircle2, AlertCircle, Upload, RefreshCw } from "lucide-react";

const Sync = () => {
  return (
    <AppLayout>
      <div className="max-w-3xl">
        <div className="mb-8">
          <h1 className="font-heading text-3xl mb-1">Sync & Export</h1>
          <p className="text-muted-foreground">Manage your playlist exports to Spotify and Apple Music.</p>
        </div>

        {/* Connected platform */}
        <div className="space-y-3 mb-6">
          <div className="p-5 rounded-2xl bg-surface-elevated border border-border/50 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-[#1DB954]/10 flex items-center justify-center text-xl">
                🎵
              </div>
              <div>
                <p className="font-medium">Spotify</p>
                <p className="text-sm text-muted-foreground">Connected as jordan.d@email.com</p>
              </div>
            </div>
            <span className="inline-flex items-center gap-1 text-sm text-accent">
              <CheckCircle2 className="w-4 h-4" />
              Connected
            </span>
          </div>
          <div className="p-5 rounded-2xl bg-surface-elevated border border-border/50 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-[#FC3C44]/10 flex items-center justify-center text-xl">
                🍎
              </div>
              <div>
                <p className="font-medium">Apple Music</p>
                <p className="text-sm text-muted-foreground">Not connected</p>
              </div>
            </div>
            <Button variant="hero" size="sm" className="rounded-lg">Connect</Button>
          </div>
        </div>

        {/* Playlist sync list */}
        <div className="space-y-3">
          {samplePlaylists.map((pl) => (
            <div key={pl.id} className="p-5 rounded-2xl bg-surface-elevated border border-border/50 flex items-center justify-between">
              <div className="flex items-center gap-4">
                <span className="text-2xl">{pl.emoji}</span>
                <div>
                  <p className="font-medium">{pl.name}</p>
                  <p className="text-xs text-muted-foreground">{pl.trackCount} tracks · {pl.mood}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                {pl.syncStatus === "synced" ? (
                  <>
                    <span className="text-xs text-accent flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3" /> Synced
                    </span>
                    <Button variant="ghost" size="sm" className="rounded-lg gap-1">
                      <RefreshCw className="w-3.5 h-3.5" />
                      Refresh
                    </Button>
                  </>
                ) : pl.syncStatus === "failed" ? (
                  <>
                    <span className="text-xs text-destructive flex items-center gap-1">
                      <AlertCircle className="w-3 h-3" /> Failed
                    </span>
                    <Button variant="warm" size="sm" className="rounded-lg gap-1">
                      <Upload className="w-3.5 h-3.5" />
                      Retry
                    </Button>
                  </>
                ) : (
                  <Button variant="hero" size="sm" className="rounded-lg gap-1">
                    <Upload className="w-3.5 h-3.5" />
                    Export
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </AppLayout>
  );
};

export default Sync;
