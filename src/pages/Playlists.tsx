import { useEffect, useRef } from "react";
import AppLayout from "@/components/app/AppLayout";
import { Button } from "@/components/ui/button";
import { ListMusic, Sparkles, Headphones, Music, RefreshCw, Loader2, Heart, Users, CheckCircle2, AlertCircle } from "lucide-react";
import { Link } from "react-router-dom";
import { useAuth } from "@/hooks/use-auth";
import { useSpotifyLibrary, type SyncPhase } from "@/hooks/use-spotify-library";
import { toast } from "sonner";

const SYNC_PHASE_LABELS: Record<SyncPhase, string> = {
  idle: "",
  starting: "Starting sync…",
  liked_songs: "Syncing liked songs…",
  playlists: "Updating playlists…",
  artists: "Importing followed artists…",
  complete: "Sync complete!",
  error: "Sync failed",
};

const Playlists = () => {
  const { profile } = useAuth();
  const spotifyConnected = profile?.spotify_connected ?? false;
  const {
    playlists,
    likedSongs,
    likedCount,
    followedArtists,
    loading,
    syncing,
    syncPhase,
    lastSyncResult,
    lastSyncedLabel,
    syncMeta,
    resync,
  } = useSpotifyLibrary();

  const handleResync = async (forceFullSync = false) => {
    try {
      await resync(forceFullSync);
    } catch (e: any) {
      toast.error("Sync failed", { description: e.message });
    }
  };

  // Show toast when sync completes
  const prevSyncPhase = useRef(syncPhase);
  useEffect(() => {
    if (prevSyncPhase.current !== "idle" && syncPhase === "idle" && lastSyncResult) {
      const r = lastSyncResult;
      const mode = r.sync_mode === "incremental" ? "Quick sync" : "Full sync";
      const parts: string[] = [];
      if (r.liked_songs_added > 0) parts.push(`+${r.liked_songs_added} songs`);
      if (r.liked_songs_removed > 0) parts.push(`-${r.liked_songs_removed} songs`);
      if (r.playlists_changed > 0) parts.push(`${r.playlists_changed} playlists updated`);
      if (r.playlists_removed > 0) parts.push(`${r.playlists_removed} playlists removed`);
      if (r.artists_added > 0) parts.push(`+${r.artists_added} artists`);
      if (r.artists_removed > 0) parts.push(`-${r.artists_removed} artists`);
      toast.success(`${mode} complete`, {
        description: parts.length > 0 ? parts.join(" · ") : "Everything is up to date",
      });
    }
    prevSyncPhase.current = syncPhase;
  }, [syncPhase, lastSyncResult]);

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

  const hasData = playlists.length > 0 || likedCount > 0;

  return (
    <AppLayout>
      <div className="max-w-5xl">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="font-heading text-3xl mb-1">Your Library</h1>
            <p className="text-muted-foreground">
              {playlists.length} playlists · {likedCount} liked songs
              {followedArtists.length > 0 && ` · ${followedArtists.length} artists`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {lastSyncedLabel && !syncing && (
              <span className="text-xs text-muted-foreground mr-1">Synced {lastSyncedLabel}</span>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="rounded-lg gap-1 text-accent"
              onClick={() => handleResync(false)}
              disabled={syncing || loading}
            >
              <RefreshCw className={`w-3.5 h-3.5 ${syncing ? "animate-spin" : ""}`} />
              {syncing ? "Syncing…" : "Quick sync"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="rounded-lg gap-1 text-muted-foreground"
              onClick={() => handleResync(true)}
              disabled={syncing || loading}
            >
              Full re-sync
            </Button>
          </div>
        </div>

        {/* Sync progress banner */}
        {syncing && syncPhase !== "idle" && (
          <div className="mb-6 p-3 rounded-xl bg-accent/10 border border-accent/20 flex items-center gap-3">
            {syncPhase === "complete" ? (
              <CheckCircle2 className="w-4 h-4 text-accent shrink-0" />
            ) : syncPhase === "error" ? (
              <AlertCircle className="w-4 h-4 text-destructive shrink-0" />
            ) : (
              <Loader2 className="w-4 h-4 text-accent animate-spin shrink-0" />
            )}
            <span className="text-sm font-medium">{SYNC_PHASE_LABELS[syncPhase]}</span>
          </div>
        )}

        {/* Show existing data while syncing, or show loading only on first load with no data */}
        {loading && !hasData ? (
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

            {/* Followed Artists section */}
            {followedArtists.length > 0 && (
              <div>
                <div className="flex items-center gap-3 mb-4">
                  <Users className="w-5 h-5 text-accent" />
                  <h2 className="font-heading text-xl">Followed Artists</h2>
                  <span className="text-sm text-muted-foreground">({followedArtists.length})</span>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
                  {followedArtists.slice(0, 18).map((artist) => (
                    <div key={artist.id} className="p-3 rounded-xl bg-surface-elevated border border-border/50 text-center">
                      {artist.image_url ? (
                        <img
                          src={artist.image_url}
                          alt={artist.artist_name}
                          className="w-16 h-16 rounded-full object-cover mx-auto mb-2"
                          loading="lazy"
                        />
                      ) : (
                        <div className="w-16 h-16 rounded-full bg-secondary flex items-center justify-center mx-auto mb-2">
                          <Users className="w-6 h-6 text-muted-foreground" />
                        </div>
                      )}
                      <p className="text-xs font-medium truncate">{artist.artist_name}</p>
                      {artist.genres.length > 0 && (
                        <p className="text-[10px] text-muted-foreground truncate mt-0.5">{artist.genres[0]}</p>
                      )}
                    </div>
                  ))}
                </div>
                {followedArtists.length > 18 && (
                  <p className="text-xs text-muted-foreground mt-3 text-center">
                    Showing 18 of {followedArtists.length} followed artists
                  </p>
                )}
              </div>
            )}

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
