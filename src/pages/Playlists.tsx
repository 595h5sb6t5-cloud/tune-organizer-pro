import AppLayout from "@/components/app/AppLayout";
import { Button } from "@/components/ui/button";
import { ListMusic, Sparkles, Headphones, Music, RefreshCw, Loader2, Heart } from "lucide-react";
import { Link } from "react-router-dom";
import { useAuth } from "@/hooks/use-auth";
import { useSpotifyLibrary } from "@/hooks/use-spotify-library";
import { supabase } from "@/integrations/supabase/client";
import { useState } from "react";
import { toast } from "sonner";

const Playlists = () => {
  const { profile } = useAuth();
  const spotifyConnected = profile?.spotify_connected ?? false;
  const { playlists, likedSongs, likedCount, loading, refresh } = useSpotifyLibrary();
  const [syncing, setSyncing] = useState(false);

  const handleResync = async () => {
    setSyncing(true);
    try {
      const res = await supabase.functions.invoke("spotify-import-tracks");
      if (res.error) throw new Error(res.error.message);
      await refresh();
      toast.success("Library synced successfully");
    } catch (e: any) {
      toast.error("Sync failed", { description: e.message });
    } finally {
      setSyncing(false);
    }
  };

  if (!spotifyConnected) {
    return (
      <AppLayout>
        <div className="max-w-5xl">
          <div className="flex items-center justify-between mb-8">
            <div>
              <h1 className="font-heading text-3xl mb-1">Your Library</h1>
              <p className="text-muted-foreground">Playlists and liked songs from Spotify.</p>
            </div>
          </div>
          <div className="rounded-2xl bg-surface-elevated border border-border/50 p-12 text-center">
            <Headphones className="w-10 h-10 text-muted-foreground mx-auto mb-4" />
            <h2 className="font-heading text-xl mb-2">Connect Spotify first</h2>
            <p className="text-sm text-muted-foreground max-w-sm mx-auto mb-6">
              Your playlists and liked songs will appear here after you connect Spotify.
            </p>
            <Button variant="hero" asChild>
              <Link to="/settings">Go to Settings</Link>
            </Button>
          </div>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="max-w-5xl">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="font-heading text-3xl mb-1">Your Library</h1>
            <p className="text-muted-foreground">
              {playlists.length} playlists · {likedCount} liked songs
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="rounded-lg gap-1 text-accent"
            onClick={handleResync}
            disabled={syncing || loading}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${syncing ? "animate-spin" : ""}`} />
            {syncing ? "Syncing…" : "Re-sync"}
          </Button>
        </div>

        {loading ? (
          <div className="flex justify-center py-20">
            <Loader2 className="w-8 h-8 animate-spin text-accent" />
          </div>
        ) : (
          <div className="space-y-10">
            {/* Liked Songs section */}
            <div>
              <div className="flex items-center gap-3 mb-4">
                <Heart className="w-5 h-5 text-accent" />
                <h2 className="font-heading text-xl">Liked Songs</h2>
                <span className="text-sm text-muted-foreground">({likedCount})</span>
              </div>

              {likedSongs.length === 0 ? (
                <div className="rounded-2xl bg-surface-elevated border border-border/50 p-8 text-center">
                  <Heart className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
                  <p className="text-sm text-muted-foreground">No liked songs imported yet.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {likedSongs.slice(0, 10).map((song) => (
                    <div key={song.id} className="p-3 rounded-xl bg-surface-elevated border border-border/50 flex items-center gap-3">
                      {song.image_url ? (
                        <img src={song.image_url} alt="" className="w-10 h-10 rounded-lg object-cover" loading="lazy" />
                      ) : (
                        <div className="w-10 h-10 rounded-lg bg-secondary flex items-center justify-center">
                          <Music className="w-4 h-4 text-muted-foreground" />
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate">{song.track_name}</p>
                        <p className="text-xs text-muted-foreground truncate">{song.artist_name}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {likedCount > 10 && (
                <p className="text-xs text-muted-foreground mt-3 text-center">
                  Showing 10 of {likedCount} liked songs
                </p>
              )}
            </div>

            {/* Spotify Playlists section */}
            <div>
              <div className="flex items-center gap-3 mb-4">
                <ListMusic className="w-5 h-5 text-accent" />
                <h2 className="font-heading text-xl">Spotify Playlists</h2>
                <span className="text-sm text-muted-foreground">({playlists.length})</span>
              </div>

              {playlists.length === 0 ? (
                <div className="rounded-2xl bg-surface-elevated border border-border/50 p-8 text-center">
                  <ListMusic className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
                  <p className="text-sm text-muted-foreground">No playlists imported yet.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {playlists.map((pl) => (
                    <Link
                      key={pl.id}
                      to={`/playlists/${pl.id}`}
                      className="group rounded-2xl bg-surface-elevated border border-border/50 hover:border-accent/30 hover:shadow-sm transition-all overflow-hidden"
                    >
                      <div className="aspect-square bg-secondary relative overflow-hidden">
                        {pl.image_url ? (
                          <img src={pl.image_url} alt={pl.name} className="w-full h-full object-cover" loading="lazy" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            <ListMusic className="w-12 h-12 text-muted-foreground" />
                          </div>
                        )}
                        <div className="absolute top-2 right-2 flex flex-col gap-1 items-end">
                          {pl.is_owned_by_user && (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-accent/90 text-accent-foreground">
                              Created by you
                            </span>
                          )}
                          {pl.is_collaborative && (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-primary/80 text-primary-foreground">
                              Collaborative
                            </span>
                          )}
                          {!pl.is_owned_by_user && !pl.is_collaborative && (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-muted/80 text-muted-foreground">
                              Saved
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="p-4">
                        <p className="font-medium truncate group-hover:text-accent transition-colors">{pl.name}</p>
                        <p className="text-xs text-muted-foreground mt-1">
                          {pl.track_count} tracks{pl.owner_display_name && !pl.is_owned_by_user ? ` · by ${pl.owner_display_name}` : ""}
                        </p>
                        {pl.description && (
                          <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{pl.description}</p>
                        )}
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </div>

            {/* CTA */}
            <div className="text-center pt-4">
              <Button variant="hero" asChild>
                <Link to="/discover">
                  <Sparkles className="w-4 h-4 mr-2" />
                  Discover New Music
                </Link>
              </Button>
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  );
};

export default Playlists;
