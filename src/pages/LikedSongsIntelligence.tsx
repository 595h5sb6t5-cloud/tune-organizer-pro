import { useState } from "react";
import { Link } from "react-router-dom";
import { Brain, Heart, Loader2, Music, RefreshCw, Sparkles, Headphones, ChevronDown, ChevronUp } from "lucide-react";
import AppLayout from "@/components/app/AppLayout";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { useLikedSongClusters, type LikedSongCluster } from "@/hooks/use-liked-song-clusters";
import { toast } from "sonner";

const LikedSongsIntelligence = () => {
  const { profile } = useAuth();
  const spotifyConnected = profile?.spotify_connected ?? false;
  const {
    clusters,
    loading,
    analyzing,
    hasAnalyzed,
    error,
    likedCount,
    runAnalysis,
  } = useLikedSongClusters();

  const handleAnalyze = async () => {
    toast.info("Starting deep analysis…", { description: "This may take 30-60 seconds." });
    await runAnalysis();
    if (!error) {
      toast.success("Analysis complete!", { description: `Created ${clusters.length} musical clusters.` });
    }
  };

  if (!spotifyConnected) {
    return (
      <AppLayout>
        <div className="max-w-5xl">
          <div className="mb-6">
            <h1 className="font-heading text-3xl mb-1">Liked Songs Intelligence</h1>
            <p className="text-muted-foreground">Deep AI analysis of your musical identity.</p>
          </div>
          <div className="rounded-2xl bg-surface-elevated border border-border/50 p-12 text-center">
            <Headphones className="w-10 h-10 text-muted-foreground mx-auto mb-4" />
            <h2 className="font-heading text-xl mb-2">Connect Spotify first</h2>
            <p className="text-sm text-muted-foreground max-w-md mx-auto mb-6">
              Connect Spotify and import your liked songs to unlock deep musical analysis.
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
            <h1 className="font-heading text-3xl mb-1">Liked Songs Intelligence</h1>
            <p className="text-muted-foreground">Deep AI analysis of your musical identity.</p>
          </div>
          <div className="rounded-2xl bg-surface-elevated border border-border/50 p-12 text-center">
            <Heart className="w-10 h-10 text-muted-foreground mx-auto mb-4" />
            <h2 className="font-heading text-xl mb-2">No liked songs yet</h2>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              Your Spotify liked songs need to be imported first. Go to your Library and re-sync.
            </p>
          </div>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="max-w-5xl">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Brain className="w-6 h-6 text-accent" />
              <h1 className="font-heading text-3xl">Liked Songs Intelligence</h1>
            </div>
            <p className="text-muted-foreground">
              {hasAnalyzed
                ? `${likedCount} songs organized into ${clusters.length} musical clusters`
                : `${likedCount} liked songs ready for deep analysis`}
            </p>
          </div>
          <Button
            variant={hasAnalyzed ? "ghost" : "hero"}
            size={hasAnalyzed ? "sm" : "lg"}
            className={hasAnalyzed ? "rounded-lg gap-1 text-accent" : ""}
            onClick={handleAnalyze}
            disabled={analyzing}
          >
            {analyzing ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Analyzing…
              </>
            ) : hasAnalyzed ? (
              <>
                <RefreshCw className="w-3.5 h-3.5" />
                Re-analyze
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4" />
                Analyze My Music
              </>
            )}
          </Button>
        </div>

        {error && (
          <div className="rounded-xl bg-destructive/10 border border-destructive/30 p-4 mb-6">
            <p className="text-sm text-destructive">{error}</p>
          </div>
        )}

        {/* Loading state */}
        {(loading || analyzing) && !hasAnalyzed && (
          <div className="flex flex-col items-center justify-center py-20 gap-4">
            <div className="relative">
              <Loader2 className="w-10 h-10 animate-spin text-accent" />
              <Brain className="w-5 h-5 text-accent absolute -top-1 -right-1 animate-pulse" />
            </div>
            <div className="text-center">
              <p className="font-heading text-lg mb-1">
                {analyzing ? "Deep analysis in progress…" : "Loading your clusters…"}
              </p>
              <p className="text-sm text-muted-foreground max-w-md">
                {analyzing
                  ? "Tempo AI is analyzing genre, mood, atmosphere, production style, era, energy, and more across all your liked songs."
                  : "Loading your musical identity map."}
              </p>
            </div>
          </div>
        )}

        {/* Not analyzed yet */}
        {!hasAnalyzed && !loading && !analyzing && (
          <div className="rounded-2xl bg-surface-elevated border border-border/50 p-12 text-center">
            <Brain className="w-12 h-12 text-accent mx-auto mb-4" />
            <h2 className="font-heading text-2xl mb-3">Discover your musical identity</h2>
            <p className="text-sm text-muted-foreground max-w-lg mx-auto mb-2">
              Tempo AI will analyze your {likedCount} liked songs across 15+ musical dimensions — genre, mood, atmosphere, production style, era, energy, and more — to create intelligent clusters that reveal the true shape of your taste.
            </p>
            <p className="text-xs text-muted-foreground max-w-lg mx-auto mb-6">
              Great playlists aren't just about genre. Two songs labeled "rap" can feel completely different. Tempo understands that.
            </p>
            <Button variant="hero" size="lg" onClick={handleAnalyze} disabled={analyzing}>
              <Sparkles className="w-4 h-4 mr-2" />
              Analyze My Music
            </Button>
          </div>
        )}

        {/* Clusters */}
        {hasAnalyzed && clusters.length > 0 && (
          <div className="space-y-6">
            {clusters.map((cluster) => (
              <ClusterCard key={cluster.id} cluster={cluster} />
            ))}
          </div>
        )}
      </div>
    </AppLayout>
  );
};

function ClusterCard({ cluster }: { cluster: LikedSongCluster }) {
  const [expanded, setExpanded] = useState(false);
  const displayTracks = expanded ? cluster.tracks : cluster.tracks.slice(0, 4);

  return (
    <div className="rounded-2xl bg-surface-elevated border border-border/50 overflow-hidden">
      {/* Header */}
      <div
        className="p-5 cursor-pointer hover:bg-secondary/30 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-start gap-4">
          {/* Color dot */}
          <div
            className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5"
            style={{ backgroundColor: `${cluster.color_hex}20` }}
          >
            <div
              className="w-5 h-5 rounded-full"
              style={{ backgroundColor: cluster.color_hex }}
            />
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <h3 className="font-heading text-lg truncate">{cluster.name}</h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {cluster.track_count} songs · {cluster.energy_level} energy · {cluster.tempo_range} · {cluster.era_range}
                </p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                {expanded ? (
                  <ChevronUp className="w-4 h-4 text-muted-foreground" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-muted-foreground" />
                )}
              </div>
            </div>

            {cluster.vibe_description && (
              <p className="text-sm text-muted-foreground mt-2 italic">"{cluster.vibe_description}"</p>
            )}

            {/* Mood tags */}
            <div className="flex gap-1.5 flex-wrap mt-3">
              {cluster.mood_tags.map((tag) => (
                <span
                  key={tag}
                  className="px-2.5 py-0.5 rounded-full text-[11px] font-medium"
                  style={{
                    backgroundColor: `${cluster.color_hex}15`,
                    color: cluster.color_hex,
                  }}
                >
                  {tag}
                </span>
              ))}
            </div>
          </div>
        </div>

        {cluster.description && (
          <p className="text-sm text-muted-foreground mt-3 ml-16">{cluster.description}</p>
        )}
      </div>

      {/* Tracks */}
      <div className="border-t border-border/30">
        <div className="divide-y divide-border/20">
          {displayTracks.map((track, idx) => (
            <div key={track.id} className="flex items-center gap-3 px-5 py-2.5 hover:bg-secondary/20 transition-colors">
              <span className="text-xs text-muted-foreground w-5 text-right">{idx + 1}</span>
              {track.image_url ? (
                <img src={track.image_url} alt="" className="w-9 h-9 rounded-lg object-cover" loading="lazy" />
              ) : (
                <div className="w-9 h-9 rounded-lg bg-secondary flex items-center justify-center">
                  <Music className="w-3.5 h-3.5 text-muted-foreground" />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">{track.track_name}</p>
                <p className="text-xs text-muted-foreground truncate">{track.artist_name}</p>
              </div>
              <div className="flex gap-1.5 flex-shrink-0 hidden md:flex">
                {track.mood && (
                  <span className="px-2 py-0.5 rounded-full text-[10px] bg-secondary text-muted-foreground">{track.mood}</span>
                )}
                {track.atmosphere && (
                  <span className="px-2 py-0.5 rounded-full text-[10px] bg-secondary text-muted-foreground">{track.atmosphere}</span>
                )}
              </div>
            </div>
          ))}
        </div>

        {cluster.tracks.length > 4 && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="w-full py-2.5 text-xs text-accent hover:bg-secondary/20 transition-colors"
          >
            {expanded ? "Show less" : `Show all ${cluster.tracks.length} songs`}
          </button>
        )}
      </div>
    </div>
  );
}

export default LikedSongsIntelligence;
