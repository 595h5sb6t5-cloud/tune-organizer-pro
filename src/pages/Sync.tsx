import AppLayout from "@/components/app/AppLayout";
import { Button } from "@/components/ui/button";
import { samplePlaylists, type Playlist } from "@/lib/sample-data";
import { CheckCircle2, AlertCircle, Upload, RefreshCw, Loader2 } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { useConnections } from "@/hooks/use-connections";

type SyncState = Record<string, Playlist["syncStatus"]>;

const Sync = () => {
  const { connections, connectSpotify, connectApple, disconnectSpotify, disconnectApple, connectingSpotify, connectingApple } = useConnections();
  const [syncStates, setSyncStates] = useState<SyncState>(
    Object.fromEntries(samplePlaylists.map((pl) => [pl.id, pl.syncStatus]))
  );
  const [activeExports, setActiveExports] = useState<Set<string>>(new Set());

  const handleExport = (pl: Playlist) => {
    if (activeExports.has(pl.id)) return;
    setActiveExports((prev) => new Set(prev).add(pl.id));
    setSyncStates((prev) => ({ ...prev, [pl.id]: "exporting" }));
    toast.loading(`Exporting "${pl.name}"…`, { id: `export-${pl.id}` });
    setTimeout(() => {
      setSyncStates((prev) => ({ ...prev, [pl.id]: "synced" }));
      setActiveExports((prev) => { const next = new Set(prev); next.delete(pl.id); return next; });
      toast.dismiss(`export-${pl.id}`);
      toast.success(`"${pl.name}" exported!`);
    }, 2000);
  };

  const handleRefresh = (pl: Playlist) => {
    if (activeExports.has(pl.id)) return;
    setActiveExports((prev) => new Set(prev).add(pl.id));
    setSyncStates((prev) => ({ ...prev, [pl.id]: "exporting" }));
    setTimeout(() => {
      setSyncStates((prev) => ({ ...prev, [pl.id]: "synced" }));
      setActiveExports((prev) => { const next = new Set(prev); next.delete(pl.id); return next; });
      toast.success(`"${pl.name}" refreshed!`);
    }, 1500);
  };

  const noExportPlatform = !connections.spotify.connected && !connections.apple.connected;

  return (
    <AppLayout>
      <div className="max-w-3xl">
        <div className="mb-8">
          <h1 className="font-heading text-3xl mb-1">Sync & Export</h1>
          <p className="text-muted-foreground">Manage your playlist exports to Spotify and Apple Music.</p>
        </div>

        {/* Connected platforms */}
        <div className="space-y-3 mb-6">
          <div className="p-5 rounded-2xl bg-surface-elevated border border-border/50 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-[#1DB954]/10 flex items-center justify-center text-xl">🎵</div>
              <div>
                <p className="font-medium">Spotify</p>
                <p className="text-sm text-muted-foreground">{connections.spotify.connected ? `Connected as ${connections.spotify.email}` : "Not connected"}</p>
              </div>
            </div>
            {connections.spotify.connected ? (
              <div className="flex items-center gap-3">
                <span className="inline-flex items-center gap-1 text-sm text-accent"><CheckCircle2 className="w-4 h-4" /> Connected</span>
                <Button variant="ghost" size="sm" className="rounded-lg text-destructive" onClick={() => { disconnectSpotify(); toast("Spotify disconnected"); }}>
                  Disconnect
                </Button>
              </div>
            ) : (
              <Button variant="hero" size="sm" className="rounded-lg" onClick={() => connectSpotify().then(() => toast.success("Spotify connected!"))} disabled={connectingSpotify}>
                {connectingSpotify ? "Connecting…" : "Connect"}
              </Button>
            )}
          </div>
          <div className="p-5 rounded-2xl bg-surface-elevated border border-border/50 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-[#FC3C44]/10 flex items-center justify-center text-xl">🍎</div>
              <div>
                <p className="font-medium">Apple Music</p>
                <p className="text-sm text-muted-foreground">{connections.apple.connected ? `Connected as ${connections.apple.email}` : "Not connected"}</p>
              </div>
            </div>
            {connections.apple.connected ? (
              <div className="flex items-center gap-3">
                <span className="inline-flex items-center gap-1 text-sm text-accent"><CheckCircle2 className="w-4 h-4" /> Connected</span>
                <Button variant="ghost" size="sm" className="rounded-lg text-destructive" onClick={() => { disconnectApple(); toast("Apple Music disconnected"); }}>
                  Disconnect
                </Button>
              </div>
            ) : (
              <Button variant="hero" size="sm" className="rounded-lg" onClick={() => connectApple().then(() => toast.success("Apple Music connected!"))} disabled={connectingApple}>
                {connectingApple ? "Connecting…" : "Connect"}
              </Button>
            )}
          </div>
        </div>

        {noExportPlatform && (
          <div className="p-4 rounded-xl bg-destructive/10 text-destructive text-sm mb-6 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            <span>No platform connected. <Link to="/settings" className="underline font-medium">Go to Settings</Link> or connect above to export playlists.</span>
          </div>
        )}

        {/* Playlist sync list */}
        <div className="space-y-3">
          {samplePlaylists.map((pl) => {
            const status = syncStates[pl.id];
            const isExporting = activeExports.has(pl.id);
            return (
              <div key={pl.id} className="p-5 rounded-2xl bg-surface-elevated border border-border/50 flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <Link to={`/playlists/${pl.id}`} className="text-2xl hover:scale-110 transition-transform">{pl.emoji}</Link>
                  <div>
                    <Link to={`/playlists/${pl.id}`} className="font-medium hover:text-accent transition-colors">{pl.name}</Link>
                    <p className="text-xs text-muted-foreground">{pl.trackCount} tracks · {pl.mood}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {status === "synced" && !isExporting ? (
                    <>
                      <span className="text-xs text-accent flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> Synced</span>
                      <Button variant="ghost" size="sm" className="rounded-lg gap-1" onClick={() => handleRefresh(pl)} disabled={noExportPlatform}>
                        <RefreshCw className="w-3.5 h-3.5" /> Refresh
                      </Button>
                    </>
                  ) : status === "exporting" || isExporting ? (
                    <span className="text-xs text-warm flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> Exporting…</span>
                  ) : status === "failed" ? (
                    <>
                      <span className="text-xs text-destructive flex items-center gap-1"><AlertCircle className="w-3 h-3" /> Failed</span>
                      <Button variant="warm" size="sm" className="rounded-lg gap-1" onClick={() => handleExport(pl)} disabled={noExportPlatform}>
                        <Upload className="w-3.5 h-3.5" /> Retry
                      </Button>
                    </>
                  ) : (
                    <Button variant="hero" size="sm" className="rounded-lg gap-1" onClick={() => handleExport(pl)} disabled={noExportPlatform}>
                      <Upload className="w-3.5 h-3.5" /> Export
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </AppLayout>
  );
};

export default Sync;
