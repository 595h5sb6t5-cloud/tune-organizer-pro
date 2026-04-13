import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Headphones, Loader2, Music, Sparkles, Heart, ListMusic } from "lucide-react";
import AppLayout from "@/components/app/AppLayout";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { useSpotify } from "@/hooks/use-spotify";
import { useSpotifyLibrary } from "@/hooks/use-spotify-library";
import { supabase } from "@/integrations/supabase/client";

type ImportedTrack = {
  id: string;
  track_name: string;
  artist_name: string;
  album_name: string | null;
  image_url: string | null;
};

const Dashboard = () => {
  const { user, profile } = useAuth();
  const { startAuth } = useSpotify();
  const spotifyConnected = profile?.spotify_connected ?? false;
  const { playlists, likedCount, loading: libraryLoading } = useSpotifyLibrary();
  const [trackCount, setTrackCount] = useState(0);
  const [recentTracks, setRecentTracks] = useState<ImportedTrack[]>([]);
  const [tracksLoading, setTracksLoading] = useState(false);

  const firstName = profile?.first_name || profile?.full_name?.split(" ")[0] || null;

  useEffect(() => {
    if (!user || !spotifyConnected) {
      setTrackCount(0);
      setRecentTracks([]);
      return;
    }

    let cancelled = false;
    setTracksLoading(true);

    Promise.all([
      supabase.from("imported_tracks").select("id", { count: "exact", head: true }).eq("user_id", user.id),
      supabase.from("imported_tracks").select("id, track_name, artist_name, album_name, image_url").eq("user_id", user.id).order("added_at", { ascending: false, nullsFirst: false }).limit(6),
    ]).then(([countRes, recentRes]) => {
      if (cancelled) return;
      setTrackCount(countRes.count ?? 0);
      setRecentTracks((recentRes.data as ImportedTrack[] | null) ?? []);
      setTracksLoading(false);
    });

    return () => { cancelled = true; };
  }, [spotifyConnected, user]);

  const isLoading = libraryLoading || tracksLoading;

  if (!spotifyConnected) {
    return (
      <AppLayout>
        <div className="max-w-xl mx-auto text-center py-20">
          <Headphones className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
          <h1 className="font-heading text-3xl mb-2">
            {firstName ? `Welcome, ${firstName}` : "Welcome to Tempo"}
          </h1>
          <p className="text-muted-foreground mb-6">
            Connect Spotify to import your real library before Tempo shows any music data.
          </p>
          <Button variant="hero" size="lg" onClick={() => void startAuth("/dashboard")}>
            Connect Spotify
          </Button>
          <p className="text-xs text-muted-foreground mt-4">Once Spotify is connected, your real tracks will appear here automatically.</p>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="max-w-5xl">
        <div className="mb-8">
          <h1 className="font-heading text-3xl mb-1">
            {firstName ? `Welcome back, ${firstName}` : "Welcome back"}
          </h1>
          <p className="text-muted-foreground">Your Spotify library inside Tempo.</p>
        </div>

        {/* Stats cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          <div className="p-6 rounded-2xl bg-surface-elevated border border-border/50">
            <Music className="w-5 h-5 text-muted-foreground mb-3" />
            <p className="font-heading text-3xl mb-1">{isLoading ? "…" : trackCount}</p>
            <p className="text-sm text-muted-foreground">Saved tracks</p>
          </div>
          <div className="p-6 rounded-2xl bg-surface-elevated border border-border/50">
            <Heart className="w-5 h-5 text-muted-foreground mb-3" />
            <p className="font-heading text-3xl mb-1">{isLoading ? "…" : likedCount}</p>
            <p className="text-sm text-muted-foreground">Liked songs</p>
          </div>
          <div className="p-6 rounded-2xl bg-surface-elevated border border-border/50">
            <ListMusic className="w-5 h-5 text-muted-foreground mb-3" />
            <p className="font-heading text-3xl mb-1">{isLoading ? "…" : playlists.length}</p>
            <p className="text-sm text-muted-foreground">Playlists</p>
          </div>
        </div>

        {isLoading ? (
          <div className="rounded-2xl bg-surface-elevated border border-border/50 p-10 text-center">
            <Loader2 className="w-8 h-8 text-accent animate-spin mx-auto mb-3" />
            <h2 className="font-heading text-xl mb-1">Loading your library</h2>
            <p className="text-sm text-muted-foreground">Tempo is loading your Spotify data.</p>
          </div>
        ) : trackCount === 0 ? (
          <div className="rounded-2xl bg-surface-elevated border border-border/50 p-10 text-center">
            <Headphones className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
            <h2 className="font-heading text-xl mb-1">Spotify connected</h2>
            <p className="text-sm text-muted-foreground">
              Your account is linked. If your Spotify library is empty, Tempo won&apos;t show placeholder music data.
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 className="font-heading text-2xl">Recently imported</h2>
                <p className="text-sm text-muted-foreground">From your Spotify saved songs.</p>
              </div>
              <div className="flex gap-2">
                <Button variant="hero-outline" size="sm" asChild>
                  <Link to="/playlists">
                    <ListMusic className="w-4 h-4 mr-2" />
                    Your Library
                  </Link>
                </Button>
                <Button variant="hero" size="sm" asChild>
                  <Link to="/discover">
                    <Sparkles className="w-4 h-4 mr-2" />
                    Discover
                  </Link>
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {recentTracks.map((track) => (
                <div key={track.id} className="p-4 rounded-2xl bg-surface-elevated border border-border/50 flex items-center gap-4">
                  {track.image_url ? (
                    <img src={track.image_url} alt="" className="w-14 h-14 rounded-xl object-cover" loading="lazy" />
                  ) : (
                    <div className="w-14 h-14 rounded-xl bg-secondary flex items-center justify-center">
                      <Music className="w-5 h-5 text-muted-foreground" />
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className="font-medium truncate">{track.track_name}</p>
                    <p className="text-sm text-muted-foreground truncate">{track.artist_name}</p>
                    {track.album_name && <p className="text-xs text-muted-foreground truncate">{track.album_name}</p>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  );
};

export default Dashboard;
