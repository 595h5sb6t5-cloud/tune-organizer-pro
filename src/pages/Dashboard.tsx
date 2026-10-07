import { Link } from "react-router-dom";
import {
  Heart, ListMusic, Users, Disc3, RefreshCw, Sparkles, Brain,
  CheckCircle2, AlertCircle, Loader2, Music2,
} from "lucide-react";
import AppLayout from "@/components/app/AppLayout";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { useSpotifyLibrary } from "@/hooks/use-spotify-library";
import { toast } from "sonner";
import AnalysisProgressCard from "@/components/app/AnalysisProgressCard";

function StatCard({
  icon: Icon, label, value, to,
}: { icon: any; label: string; value: number | string; to?: string }) {
  const inner = (
    <div className="p-5 rounded-2xl bg-surface-elevated border border-border/50 hover:border-accent/40 transition-colors h-full">
      <div className="flex items-center gap-2 text-muted-foreground text-xs mb-3">
        <Icon className="w-4 h-4" /> {label}
      </div>
      <p className="font-heading text-3xl tracking-tight">{value}</p>
    </div>
  );
  return to ? <Link to={to}>{inner}</Link> : inner;
}

const Dashboard = () => {
  const { profile } = useAuth();
  const spotifyConnected = profile?.spotify_connected ?? false;
  const {
    likedCount, playlists, followedArtists, albumCount,
    syncing, lastSyncedLabel, syncMeta, resync,
  } = useSpotifyLibrary();

  const handleSync = async () => {
    try { await resync(false); }
    catch (e: any) { toast.error("Sync failed", { description: e.message }); }
  };

  const displayName = profile?.full_name || profile?.first_name || "there";

  return (
    <AppLayout>
      <div className="max-w-6xl space-y-8">
        <div>
          <h1 className="font-heading text-3xl mb-1">Welcome back, {displayName}</h1>
          <p className="text-muted-foreground">Your music intelligence at a glance.</p>
        </div>

        {/* Spotify connection card */}
        <div className="p-6 rounded-2xl bg-surface-elevated border border-border/50">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-accent/15 flex items-center justify-center">
                <Music2 className="w-5 h-5 text-accent" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <p className="font-medium">Spotify</p>
                  {spotifyConnected ? (
                    <span className="inline-flex items-center gap-1 text-xs text-accent">
                      <CheckCircle2 className="w-3.5 h-3.5" /> Connected
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-xs text-destructive">
                      <AlertCircle className="w-3.5 h-3.5" /> Not connected
                    </span>
                  )}
                </div>
                <p className="text-sm text-muted-foreground">
                  {spotifyConnected
                    ? lastSyncedLabel ? `Last synced ${lastSyncedLabel}` : "Ready to sync"
                    : "Connect to import your library"}
                  {syncMeta.syncError && ` · ${syncMeta.syncError}`}
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              {spotifyConnected ? (
                <Button variant="outline" size="sm" onClick={handleSync} disabled={syncing}>
                  {syncing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                  {syncing ? "Syncing…" : "Sync"}
                </Button>
              ) : (
                <Button variant="hero" size="sm" asChild>
                  <Link to="/settings">Connect Spotify</Link>
                </Button>
              )}
            </div>
          </div>
        </div>

        <AnalysisProgressCard />

        {/* Stats grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <StatCard icon={Heart} label="Liked Songs" value={likedCount} to="/liked-songs" />
          <StatCard icon={Users} label="Followed Artists" value={followedArtists.length} to="/library" />
          <StatCard icon={Disc3} label="Saved Albums" value={albumCount} to="/library" />
        </div>

        {/* Quick actions */}
        <div className="grid md:grid-cols-3 gap-4">
          <Link to="/library" className="p-6 rounded-2xl bg-primary text-primary-foreground hover:opacity-95 transition group">
            <RefreshCw className="w-5 h-5 mb-3 opacity-80" />
            <p className="font-heading text-lg mb-1">Sync Library</p>
            <p className="text-sm opacity-80">Bring your latest Spotify data into Tempo.</p>
          </Link>
          <Link to="/music-dna" className="p-6 rounded-2xl bg-accent text-accent-foreground hover:opacity-95 transition group">
            <Brain className="w-5 h-5 mb-3 opacity-80" />
            <p className="font-heading text-lg mb-1">Analyze Music</p>
            <p className="text-sm opacity-80">Discover the sonic DNA of your taste.</p>
          </Link>
          <Link to="/ai-playlists" className="p-6 rounded-2xl bg-surface-elevated border border-border/50 hover:border-accent/40 transition group">
            <Sparkles className="w-5 h-5 mb-3 text-accent" />
            <p className="font-heading text-lg mb-1">Create Playlists</p>
            <p className="text-sm text-muted-foreground">Generate playlists curated by AI.</p>
          </Link>
        </div>
      </div>
    </AppLayout>
  );
};

export default Dashboard;
