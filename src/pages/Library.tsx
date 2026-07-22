import { useEffect, useRef, useState } from "react";
import AppLayout from "@/components/app/AppLayout";
import { Button } from "@/components/ui/button";
import { ListMusic, Sparkles, Headphones, Music, RefreshCw, Loader2, Heart, Users, CheckCircle2, AlertCircle, Circle, Disc3, ChevronRight, Info } from "lucide-react";
import { Link } from "react-router-dom";
import { useAuth } from "@/hooks/use-auth";
import { useSpotifyLibrary, type SyncStageState, type FollowedArtist } from "@/hooks/use-spotify-library";
import { HorizontalRow } from "@/components/app/HorizontalRow";
import { ArtistTracksDialog } from "@/components/app/ArtistTracksDialog";
import { toast } from "sonner";

function StageIcon({ status }: { status: SyncStageState["status"] }) {
  switch (status) {
    case "done":
      return <CheckCircle2 className="w-3.5 h-3.5 text-accent shrink-0" />;
    case "active":
      return <Loader2 className="w-3.5 h-3.5 text-accent animate-spin shrink-0" />;
    case "error":
      return <AlertCircle className="w-3.5 h-3.5 text-destructive shrink-0" />;
    case "skipped":
      return <Circle className="w-3.5 h-3.5 text-muted-foreground/40 shrink-0" />;
    default:
      return <Circle className="w-3.5 h-3.5 text-muted-foreground/30 shrink-0" />;
  }
}

const LibraryPage = () => {
  const { profile } = useAuth();
  const spotifyConnected = profile?.spotify_connected ?? false;
  const [openArtist, setOpenArtist] = useState<FollowedArtist | null>(null);
  const {
    playlists,
    likedSongs,
    likedCount,
    followedArtists,
    savedAlbums,
    albumCount,
    loading,
    syncing,
    syncStages,
    allDone,
    lastSyncResult,
    syncError,
    lastSyncedLabel,
    resync,
  } = useSpotifyLibrary();

  const handleResync = async (forceFullSync = false) => {
    try {
      await resync(forceFullSync);
    } catch (e: any) {
      toast.error("Sync failed", { description: e.message });
    }
  };

  const prevSyncing = useRef(syncing);
  useEffect(() => {
    if (prevSyncing.current && !syncing && lastSyncResult) {
      const r = lastSyncResult;
      const mode = r.sync_mode === "incremental" ? "Quick sync" : "Full sync";
      const parts: string[] = [];
      if (r.liked_songs_added > 0) parts.push(`+${r.liked_songs_added} songs`);
      if (r.liked_songs_removed > 0) parts.push(`-${r.liked_songs_removed} songs`);
      if (r.albums_added > 0) parts.push(`+${r.albums_added} albums`);
      if (r.albums_removed > 0) parts.push(`-${r.albums_removed} albums`);
      if (r.playlists_changed > 0) parts.push(`${r.playlists_changed} playlists updated`);
      if (r.playlists_removed > 0) parts.push(`${r.playlists_removed} playlists removed`);
      if (r.artists_added > 0) parts.push(`+${r.artists_added} artists`);
      if (r.artists_removed > 0) parts.push(`-${r.artists_removed} artists`);
      toast.success(`${mode} complete`, {
        description: parts.length > 0 ? parts.join(" · ") : "Everything is up to date",
      });
    }
    prevSyncing.current = syncing;
  }, [syncing, lastSyncResult]);

  if (!spotifyConnected) {
    return (
      <AppLayout>
        <div className="max-w-6xl">
          <div className="flex items-center justify-between mb-8">
            <div>
              <h1 className="font-heading text-3xl mb-1">Your Library</h1>
              <p className="text-muted-foreground">Your full Spotify library — songs, albums, playlists, and artists.</p>
            </div>
          </div>
          <div className="rounded-2xl bg-surface-elevated border border-border/50 p-12 text-center">
            <Headphones className="w-10 h-10 text-muted-foreground mx-auto mb-4" />
            <h2 className="font-heading text-xl mb-2">Connect Spotify first</h2>
            <p className="text-sm text-muted-foreground max-w-sm mx-auto mb-6">
              Your full library will appear here after you connect Spotify.
            </p>
            <Button variant="hero" asChild>
              <Link to="/settings">Go to Settings</Link>
            </Button>
          </div>
        </div>
      </AppLayout>
    );
  }

  const hasData = likedCount > 0 || followedArtists.length > 0 || albumCount > 0;
  const hasAnySyncActivity = syncStages.some(s => s.status !== "pending");

  return (
    <AppLayout>
      <div className="max-w-6xl">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="font-heading text-3xl mb-1">Your Library</h1>
            <p className="text-muted-foreground">
              {likedCount} liked songs
              {albumCount > 0 && ` · ${albumCount} albums`}
              {followedArtists.length > 0 && ` · ${followedArtists.length} artists`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {lastSyncedLabel && !syncing && (
              <span className="text-xs text-muted-foreground mr-1">Synced {lastSyncedLabel}</span>
            )}
            <Button variant="ghost" size="sm" className="rounded-lg gap-1 text-accent" onClick={() => handleResync(false)} disabled={syncing || loading}>
              <RefreshCw className={`w-3.5 h-3.5 ${syncing ? "animate-spin" : ""}`} />
              {syncing ? "Syncing…" : "Quick sync"}
            </Button>
            <Button variant="ghost" size="sm" className="rounded-lg gap-1 text-muted-foreground" onClick={() => handleResync(true)} disabled={syncing || loading}>
              Full re-sync
            </Button>
          </div>
        </div>

        {/* Sync progress banner */}
        {(syncing || syncError || (allDone && hasAnySyncActivity)) && (
          <div className="mb-6 p-4 rounded-xl bg-accent/5 border border-accent/15 space-y-3">
            <div className="flex items-center gap-2">
              {syncing ? <Loader2 className="w-4 h-4 text-accent animate-spin" /> : syncError ? <AlertCircle className="w-4 h-4 text-destructive" /> : <CheckCircle2 className="w-4 h-4 text-accent" />}
              <span className="text-sm font-medium">{syncing ? "Syncing your Spotify library…" : syncError ? "Sync needs attention" : "Sync complete"}</span>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
              {syncStages.map((s) => (
                <div key={s.stage} className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs transition-all ${s.status === "active" ? "bg-accent/10 text-foreground font-medium" : s.status === "done" ? "bg-accent/5 text-foreground" : s.status === "error" ? "bg-destructive/10 text-destructive" : "text-muted-foreground/60"}`}>
                  <StageIcon status={s.status} />
                  <span className="truncate">{s.label}</span>
                  {s.detail && (s.status === "done" || s.status === "active" || s.status === "error") && <span className="text-muted-foreground ml-auto text-[10px] shrink-0">{s.detail}</span>}
                </div>
              ))}
            </div>
            {syncError && (
              <div className="flex items-start gap-3 p-3 rounded-lg bg-background/60 border border-border/50 text-sm text-muted-foreground">
                <Info className="w-4 h-4 text-accent shrink-0 mt-0.5" />
                <span className="leading-relaxed">{syncError}</span>
              </div>
            )}
          </div>
        )}

        {loading && !hasData ? (
          <div className="flex justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-accent" /></div>
        ) : (
          <div className="space-y-10">

            {/* Liked Songs — preview card */}
            <div>
              <div className="flex items-center gap-3 mb-4">
                <Heart className="w-5 h-5 text-accent" />
                <h2 className="font-heading text-xl">Liked Songs</h2>
                <span className="text-sm text-muted-foreground">({likedCount})</span>
              </div>
              <Link to="/liked-songs" className="block group">
                <div className="rounded-2xl bg-gradient-to-br from-accent/20 to-accent/5 border border-accent/20 p-6 hover:border-accent/40 transition-all">
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <p className="text-2xl font-heading">{likedCount}</p>
                      <p className="text-sm text-muted-foreground">songs in your library</p>
                    </div>
                    <ChevronRight className="w-5 h-5 text-muted-foreground group-hover:text-accent transition-colors" />
                  </div>
                  {likedSongs.length > 0 && (
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                      {likedSongs.slice(0, 4).map((s) => (
                        <div key={s.id} className="flex items-center gap-2 p-2 rounded-lg bg-background/50">
                          {s.image_url ? (
                            <img src={s.image_url} alt="" className="w-8 h-8 rounded object-cover" loading="lazy" />
                          ) : (
                            <div className="w-8 h-8 rounded bg-secondary flex items-center justify-center"><Music className="w-3 h-3 text-muted-foreground" /></div>
                          )}
                          <div className="min-w-0">
                            <p className="text-xs font-medium truncate">{s.track_name}</p>
                            <p className="text-[10px] text-muted-foreground truncate">{s.artist_name}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </Link>
            </div>

            {/* Saved Albums — horizontal scroll */}
            {savedAlbums.length > 0 && (
              <HorizontalRow title="Saved Albums" icon={<Disc3 className="w-5 h-5 text-accent" />} count={albumCount}>
                {savedAlbums.map((album) => (
                  <div key={album.id} className="shrink-0 w-40 snap-start group">
                    <div className="aspect-square rounded-xl bg-secondary overflow-hidden mb-2 relative">
                      {album.image_url ? (
                        <img src={album.image_url} alt={album.album_name} className="w-full h-full object-cover" loading="lazy" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center"><Disc3 className="w-10 h-10 text-muted-foreground" /></div>
                      )}
                    </div>
                    <p className="text-sm font-medium truncate">{album.album_name}</p>
                    <p className="text-xs text-muted-foreground truncate">{album.artist_name}</p>
                  </div>
                ))}
              </HorizontalRow>
            )}

            {/* Saved playlists hidden: Spotify Development Mode blocks reading playlist tracks (403).
                Liked Songs, Saved Albums and Followed Artists are used as AI material instead. */}


            {/* Followed Artists — horizontal scroll */}
            {followedArtists.length > 0 && (
              <HorizontalRow title="Followed Artists" icon={<Users className="w-5 h-5 text-accent" />} count={followedArtists.length}>
                {followedArtists.map((artist) => {
                  const pending = (artist.top_tracks_count ?? 0) === 0 && !artist.top_tracks_synced_at;
                  return (
                    <button
                      key={artist.id}
                      type="button"
                      onClick={() => setOpenArtist(artist)}
                      className="shrink-0 w-32 snap-start text-center group focus:outline-none"
                    >
                      {artist.image_url ? (
                        <img src={artist.image_url} alt={artist.artist_name} className="w-24 h-24 rounded-full object-cover mx-auto mb-2 group-hover:ring-2 group-hover:ring-accent transition" loading="lazy" />
                      ) : (
                        <div className="w-24 h-24 rounded-full bg-secondary flex items-center justify-center mx-auto mb-2">
                          <Users className="w-8 h-8 text-muted-foreground" />
                        </div>
                      )}
                      <p className="text-xs font-medium truncate group-hover:text-accent">{artist.artist_name}</p>
                      <p className="text-[10px] text-muted-foreground truncate">
                        {pending
                          ? "tracks pending import"
                          : `${artist.top_tracks_count ?? 0} top tracks`}
                      </p>
                    </button>
                  );
                })}
              </HorizontalRow>
            )}

            <ArtistTracksDialog
              open={!!openArtist}
              onOpenChange={(o) => !o && setOpenArtist(null)}
              artist={openArtist}
            />

            {/* CTA */}
            <div className="text-center pt-4">
              <Button variant="hero" asChild>
                <Link to="/playlists"><Sparkles className="w-4 h-4 mr-2" /> Generate AI Playlists</Link>
              </Button>
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  );
};

export default LibraryPage;
