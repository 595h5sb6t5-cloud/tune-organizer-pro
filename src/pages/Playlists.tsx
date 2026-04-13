import { useState } from "react";
import { Link } from "react-router-dom";
import { Brain, Heart, Loader2, Music, RefreshCw, Sparkles, Headphones, Play, ListMusic, ExternalLink, Check, Upload, Plus } from "lucide-react";
import AppLayout from "@/components/app/AppLayout";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useAuth } from "@/hooks/use-auth";
import { useLikedSongClusters, type LikedSongCluster } from "@/hooks/use-liked-song-clusters";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import CreatePlaylistDialog from "@/components/app/CreatePlaylistDialog";

const Playlists = () => {
  const { profile } = useAuth();
  const spotifyConnected = profile?.spotify_connected ?? false;
  const {
    clusters,
    loading,
    analyzing,
    hasAnalyzed,
    error,
    likedCount,
    progress,
    runAnalysis,
    refresh,
  } = useLikedSongClusters();

  const [selectedCluster, setSelectedCluster] = useState<LikedSongCluster | null>(null);
  const [exportingId, setExportingId] = useState<string | null>(null);

  const handleAnalyze = async () => {
    toast.info("Curating your playlists…", { description: "This may take 30-60 seconds." });
    await runAnalysis();
    if (!error) {
      toast.success("Playlists ready!", { description: `Created ${clusters.length} curated playlists.` });
    }
  };

  const handleRebuildAll = async () => {
    toast.info("Deep rebuild started…", { description: "Re-analyzing every track. This may take several minutes." });
    await runAnalysis({ forceRetag: true });
    if (!error) {
      toast.success("Rebuild complete!", { description: `Rebuilt ${clusters.length} playlists with deep sonic analysis.` });
    }
  };

  const handleExportToSpotify = async (cluster: LikedSongCluster) => {
    setExportingId(cluster.id);
    try {
      const res = await supabase.functions.invoke("spotify-export-playlist", {
        body: {
          cluster_id: cluster.id,
          name: cluster.name,
          description: cluster.vibe_description || cluster.description || `Curated by Tempo AI — ${cluster.mood_tags.join(", ")}`,
          track_ids: cluster.tracks.map(t => t.spotify_track_id),
        },
      });
      if (res.error) throw new Error(res.error.message);
      if (res.data?.error) throw new Error(res.data.error);

      toast.success("Exported to Spotify!", {
        description: `"${cluster.name}" is now in your Spotify library.`,
      });
      await refresh();
    } catch (e: any) {
      toast.error("Export failed", { description: e.message });
    } finally {
      setExportingId(null);
    }
  };

  if (!spotifyConnected) {
    return (
      <AppLayout>
        <div className="max-w-5xl">
          <div className="mb-6">
            <h1 className="font-heading text-3xl mb-1">Playlists</h1>
            <p className="text-muted-foreground">AI-curated playlists from your music library.</p>
          </div>
          <div className="rounded-2xl bg-surface-elevated border border-border/50 p-12 text-center">
            <Headphones className="w-10 h-10 text-muted-foreground mx-auto mb-4" />
            <h2 className="font-heading text-xl mb-2">Connect Spotify first</h2>
            <p className="text-sm text-muted-foreground max-w-md mx-auto mb-6">
              Connect Spotify and import your library to create AI-curated playlists.
            </p>
            <Button variant="hero" asChild>
              <Link to="/settings">Go to Settings</Link>
            </Button>
          </div>
        </div>
      </AppLayout>
    );
  }

  if (likedCount === 0 && !loading) {
    return (
      <AppLayout>
        <div className="max-w-5xl">
          <div className="mb-6">
            <h1 className="font-heading text-3xl mb-1">Playlists</h1>
            <p className="text-muted-foreground">AI-curated playlists from your music library.</p>
          </div>
          <div className="rounded-2xl bg-surface-elevated border border-border/50 p-12 text-center">
            <Heart className="w-10 h-10 text-muted-foreground mx-auto mb-4" />
            <h2 className="font-heading text-xl mb-2">No liked songs yet</h2>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              Import your Spotify library first. Go to your Library and sync.
            </p>
            <Button variant="outline" className="mt-4" asChild>
              <Link to="/library">Go to Library</Link>
            </Button>
          </div>
        </div>
      </AppLayout>
    );
  }

  // Detail view for a selected playlist
  if (selectedCluster) {
    const isExported = !!selectedCluster.spotify_playlist_id;
    return (
      <AppLayout>
        <div className="max-w-4xl">
          <button
            onClick={() => setSelectedCluster(null)}
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-6"
          >
            ← Back to playlists
          </button>

          {/* Playlist header */}
          <div className="flex gap-6 mb-8">
            <PlaylistCover cluster={selectedCluster} size="lg" />
            <div className="flex-1 min-w-0 flex flex-col justify-end">
              <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Tempo Playlist</p>
              <h1 className="font-heading text-3xl md:text-4xl mb-2">{selectedCluster.name}</h1>
              {selectedCluster.vibe_description && (
                <p className="text-muted-foreground text-sm mb-3">{selectedCluster.vibe_description}</p>
              )}
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span>{selectedCluster.track_count} songs</span>
                {selectedCluster.energy_level && <><span>·</span><span>{selectedCluster.energy_level} energy</span></>}
                {selectedCluster.era_range && <><span>·</span><span>{selectedCluster.era_range}</span></>}
              </div>
              <div className="flex gap-1.5 flex-wrap mt-3">
                {selectedCluster.mood_tags.map((tag) => (
                  <span
                    key={tag}
                    className="px-2.5 py-0.5 rounded-full text-[11px] font-medium"
                    style={{ backgroundColor: `${selectedCluster.color_hex}15`, color: selectedCluster.color_hex }}
                  >
                    {tag}
                  </span>
                ))}
              </div>

              {/* Export buttons */}
              <div className="flex gap-2 mt-4">
                <Button
                  variant={isExported ? "outline" : "hero"}
                  size="sm"
                  className="rounded-lg gap-1.5"
                  onClick={() => handleExportToSpotify(selectedCluster)}
                  disabled={exportingId === selectedCluster.id}
                >
                  {exportingId === selectedCluster.id ? (
                    <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Exporting…</>
                  ) : isExported ? (
                    <><RefreshCw className="w-3.5 h-3.5" /> Update in Spotify</>
                  ) : (
                    <><Upload className="w-3.5 h-3.5" /> Export to Spotify</>
                  )}
                </Button>
                {isExported && selectedCluster.spotify_playlist_url && (
                  <Button variant="ghost" size="sm" className="rounded-lg gap-1.5 text-accent" asChild>
                    <a href={selectedCluster.spotify_playlist_url} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="w-3.5 h-3.5" /> Open in Spotify
                    </a>
                  </Button>
                )}
              </div>
            </div>
          </div>

          {/* AI Explanation */}
          {selectedCluster.ai_explanation && (
            <div className="rounded-xl bg-surface-elevated border border-border/50 p-5 mb-6">
              <div className="flex items-center gap-2 mb-2">
                <Brain className="w-4 h-4 text-accent" />
                <span className="text-xs font-medium text-accent uppercase tracking-wider">Why these songs belong together</span>
              </div>
              <p className="text-sm text-muted-foreground leading-relaxed">{selectedCluster.ai_explanation}</p>
            </div>
          )}

          {/* Track list */}
          <div className="rounded-xl bg-surface-elevated border border-border/50 overflow-hidden">
            <div className="divide-y divide-border/20">
              {selectedCluster.tracks.map((track, idx) => (
                <div key={track.id} className="flex items-center gap-3 px-5 py-3 hover:bg-secondary/20 transition-colors">
                  <span className="text-xs text-muted-foreground w-6 text-right">{idx + 1}</span>
                  {track.image_url ? (
                    <img src={track.image_url} alt="" className="w-10 h-10 rounded-lg object-cover" loading="lazy" />
                  ) : (
                    <div className="w-10 h-10 rounded-lg bg-secondary flex items-center justify-center">
                      <Music className="w-4 h-4 text-muted-foreground" />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{track.track_name}</p>
                    <p className="text-xs text-muted-foreground truncate">{track.artist_name}{track.album_name ? ` · ${track.album_name}` : ""}</p>
                  </div>
                  <div className="flex gap-1.5 flex-shrink-0 hidden md:flex">
                    {track.mood && <span className="px-2 py-0.5 rounded-full text-[10px] bg-secondary text-muted-foreground">{track.mood}</span>}
                    {track.energy && <span className="px-2 py-0.5 rounded-full text-[10px] bg-secondary text-muted-foreground">{track.energy}</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="max-w-5xl">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <ListMusic className="w-6 h-6 text-accent" />
              <h1 className="font-heading text-3xl">Playlists</h1>
            </div>
            <p className="text-muted-foreground">
              {hasAnalyzed
                ? `${clusters.length} AI-curated playlists from ${likedCount} songs`
                : `${likedCount} liked songs ready for AI curation`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {hasAnalyzed && (
              <Button variant="outline" size="sm" className="rounded-lg gap-1 text-xs" onClick={handleRebuildAll} disabled={analyzing}>
                {analyzing ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Rebuilding…</> : <><RefreshCw className="w-3.5 h-3.5" /> Rebuild All</>}
              </Button>
            )}
            <Button
              variant={hasAnalyzed ? "ghost" : "hero"}
              size={hasAnalyzed ? "sm" : "lg"}
              className={hasAnalyzed ? "rounded-lg gap-1 text-accent" : ""}
              onClick={handleAnalyze}
              disabled={analyzing}
            >
              {analyzing ? <><Loader2 className="w-4 h-4 animate-spin" /> Curating…</> : hasAnalyzed ? <><RefreshCw className="w-3.5 h-3.5" /> Re-generate</> : <><Sparkles className="w-4 h-4" /> Generate Playlists</>}
            </Button>
          </div>
        </div>

        {error && (
          <div className="rounded-xl bg-destructive/10 border border-destructive/30 p-4 mb-6">
            <p className="text-sm text-destructive">{error}</p>
          </div>
        )}

        {/* Loading / Analyzing with progress */}
        {(loading || analyzing) && !hasAnalyzed && (
          <div className="flex flex-col items-center justify-center py-20 gap-4">
            <div className="relative">
              <Loader2 className="w-10 h-10 animate-spin text-accent" />
              <Sparkles className="w-5 h-5 text-accent absolute -top-1 -right-1 animate-pulse" />
            </div>
            <div className="text-center">
              <p className="font-heading text-lg mb-1">
                {analyzing
                  ? progress.phase === "clustering" ? "Clustering your library…"
                  : progress.phase === "tagging" ? "Analyzing songs…"
                  : "Curating your playlists…"
                  : "Loading playlists…"}
              </p>
              {analyzing && progress.totalSongs > 0 && (
                <div className="max-w-xs mx-auto mt-3 space-y-2">
                  <Progress value={progress.totalSongs > 0 ? (progress.totalAnalyzed / progress.totalSongs) * 100 : 0} className="h-2" />
                  <p className="text-sm font-medium text-accent">{progress.totalAnalyzed} of {progress.totalSongs} songs analyzed</p>
                </div>
              )}
              <p className="text-sm text-muted-foreground max-w-md mt-2">
                {analyzing ? "Tempo AI is analyzing mood, atmosphere, energy, and sonic identity to build perfectly curated playlists." : "Loading your curated playlists."}
              </p>
            </div>
          </div>
        )}

        {/* Not analyzed yet */}
        {!hasAnalyzed && !loading && !analyzing && (
          <div className="rounded-2xl bg-surface-elevated border border-border/50 p-12 text-center">
            <Sparkles className="w-12 h-12 text-accent mx-auto mb-4" />
            <h2 className="font-heading text-2xl mb-3">Transform your liked songs into playlists</h2>
            <p className="text-sm text-muted-foreground max-w-lg mx-auto mb-2">
              Tempo AI will analyze your {likedCount} liked songs across 15+ musical dimensions and organize them into beautifully curated playlists — each with a clear identity, vibe, and purpose.
            </p>
            <p className="text-xs text-muted-foreground max-w-lg mx-auto mb-6">
              Songs are grouped by real musical compatibility, not just genre labels. You can then export every playlist directly to your Spotify account.
            </p>
            <Button variant="hero" size="lg" onClick={handleAnalyze} disabled={analyzing}>
              <Sparkles className="w-4 h-4 mr-2" />
              Generate Playlists
            </Button>
          </div>
        )}

        {/* Playlist grid */}
        {hasAnalyzed && clusters.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {clusters.map((cluster) => (
              <PlaylistCard
                key={cluster.id}
                cluster={cluster}
                onClick={() => setSelectedCluster(cluster)}
                onExport={() => handleExportToSpotify(cluster)}
                exporting={exportingId === cluster.id}
              />
            ))}
          </div>
        )}
      </div>
    </AppLayout>
  );
};

function PlaylistCover({ cluster, size = "md" }: { cluster: LikedSongCluster; size?: "md" | "lg" }) {
  const covers = cluster.cover_tracks || [];
  const dim = size === "lg" ? "w-40 h-40 md:w-48 md:h-48" : "w-full aspect-square";

  if (covers.length >= 4) {
    return (
      <div className={`${dim} rounded-xl overflow-hidden grid grid-cols-2 grid-rows-2 flex-shrink-0`}>
        {covers.slice(0, 4).map((c, i) => (
          <img key={i} src={c.image_url} alt="" className="w-full h-full object-cover" loading="lazy" />
        ))}
      </div>
    );
  }
  if (covers.length >= 1) {
    return (
      <div className={`${dim} rounded-xl overflow-hidden flex-shrink-0`}>
        <img src={covers[0].image_url} alt="" className="w-full h-full object-cover" loading="lazy" />
      </div>
    );
  }
  return (
    <div className={`${dim} rounded-xl flex items-center justify-center flex-shrink-0`} style={{ backgroundColor: `${cluster.color_hex}20` }}>
      <Music className="w-8 h-8" style={{ color: cluster.color_hex }} />
    </div>
  );
}

function PlaylistCard({ cluster, onClick, onExport, exporting }: { cluster: LikedSongCluster; onClick: () => void; onExport: () => void; exporting: boolean }) {
  const isExported = !!cluster.spotify_playlist_id;
  return (
    <div className="group rounded-2xl bg-surface-elevated border border-border/50 overflow-hidden hover:border-border transition-all hover:shadow-lg">
      <button onClick={onClick} className="text-left w-full">
        <div className="relative">
          <PlaylistCover cluster={cluster} size="md" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end justify-end p-3">
            <div className="w-10 h-10 rounded-full bg-accent flex items-center justify-center shadow-lg">
              <Play className="w-4 h-4 text-accent-foreground ml-0.5" />
            </div>
          </div>
          {isExported && (
            <span className="absolute top-2 left-2 flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-green-500/90 text-white">
              <Check className="w-2.5 h-2.5" /> On Spotify
            </span>
          )}
        </div>
        <div className="p-4 pb-2">
          <h3 className="font-heading text-base mb-1 truncate">{cluster.name}</h3>
          {cluster.vibe_description && (
            <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed mb-2">{cluster.vibe_description}</p>
          )}
          <span className="text-[11px] text-muted-foreground">{cluster.track_count} songs</span>
        </div>
      </button>
      <div className="px-4 pb-3">
        <Button
          variant="ghost"
          size="sm"
          className="w-full rounded-lg gap-1.5 text-xs"
          onClick={(e) => { e.stopPropagation(); onExport(); }}
          disabled={exporting}
        >
          {exporting ? (
            <><Loader2 className="w-3 h-3 animate-spin" /> Exporting…</>
          ) : isExported ? (
            <><RefreshCw className="w-3 h-3" /> Update in Spotify</>
          ) : (
            <><Upload className="w-3 h-3" /> Export to Spotify</>
          )}
        </Button>
      </div>
    </div>
  );
}

export default Playlists;
