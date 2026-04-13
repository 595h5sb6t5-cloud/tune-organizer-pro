import AppLayout from "@/components/app/AppLayout";
import { type Recommendation } from "@/lib/sample-data";
import { Sparkles, Plus, X, Bookmark, Loader2, RefreshCw, Gem, TrendingUp, Music, Headphones } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import { useState, useEffect } from "react";
import { toast } from "sonner";
import { useDiscoverRecommendations } from "@/hooks/use-discover-recommendations";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";

const discoveryModes = [
  { id: "balanced", label: "Balanced" },
  { id: "deep-cuts", label: "Deep Cuts" },
  { id: "underground", label: "Underground" },
  { id: "nostalgic", label: "Nostalgic" },
  { id: "new-releases", label: "New Releases" },
  { id: "safe", label: "Safe Picks" },
  { id: "mainstream", label: "Mainstream" },
];

const tierConfig = {
  "deep-cut": { label: "Deep Cut", icon: Gem, className: "text-accent bg-accent/10" },
  "mid": { label: "Mid", icon: Music, className: "text-muted-foreground bg-secondary" },
  "well-known": { label: "Known", icon: TrendingUp, className: "text-warm bg-warm/10" },
};

const categoryEmoji: Record<string, string> = {
  "best-for-you": "🎯",
  "hidden-gems": "💎",
  "perfect-for-your-playlists": "🎵",
  "try-something-different": "🔮",
};

const Discover = () => {
  const { user, profile } = useAuth();
  const spotifyConnected = profile?.spotify_connected ?? false;
  const [trackCount, setTrackCount] = useState<number | null>(null);

  const [activeMode, setActiveMode] = useState("balanced");
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());
  const [acceptedIds, setAcceptedIds] = useState<Set<string>>(new Set());
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());

  const { categories, loading, hasLoaded, generate, recordAccepted, recordDismissed } = useDiscoverRecommendations();

  // Check if user has imported tracks
  useEffect(() => {
    if (!user || !spotifyConnected) {
      setTrackCount(spotifyConnected ? null : 0);
      return;
    }
    let cancelled = false;
    supabase
      .from("imported_tracks")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .then(({ count }) => {
        if (!cancelled) setTrackCount(count ?? 0);
      });
    return () => { cancelled = true; };
  }, [user, spotifyConnected]);

  const hasData = trackCount !== null && trackCount > 0;

  useEffect(() => {
    if (hasData && !hasLoaded && !loading) {
      generate(activeMode);
    }
  }, [hasData, hasLoaded, loading]);

  const handleModeSwitch = (mode: string) => {
    if (mode === activeMode && hasLoaded) return;
    setActiveMode(mode);
    setDismissedIds(new Set());
    setAcceptedIds(new Set());
    generate(mode);
  };

  const handleRefresh = () => {
    setDismissedIds(new Set());
    setAcceptedIds(new Set());
    generate(activeMode);
  };

  const hiddenIds = new Set([...dismissedIds, ...acceptedIds]);

  const handleAdd = (rec: Recommendation) => {
    setAcceptedIds((prev) => new Set(prev).add(rec.id));
    recordAccepted(rec.track);
    toast.success(`Added "${rec.track.title}" to your library`);
  };

  const handleDismiss = (rec: Recommendation) => {
    setDismissedIds((prev) => new Set(prev).add(rec.id));
    recordDismissed(rec.track);
    toast("Dismissed", { description: `"${rec.track.title}" won't be suggested again.` });
  };

  const handleSave = (rec: Recommendation) => {
    setSavedIds((prev) => {
      const next = new Set(prev);
      if (next.has(rec.id)) {
        next.delete(rec.id);
        toast("Removed from saved");
        return next;
      }
      next.add(rec.id);
      toast.success(`Saved "${rec.track.title}" for later`);
      return next;
    });
  };

  const totalVisible = categories.reduce(
    (sum, cat) => sum + cat.recommendations.filter((r) => !hiddenIds.has(r.id)).length,
    0,
  );

  // Not connected state
  if (!spotifyConnected) {
    return (
      <AppLayout>
        <div className="max-w-5xl">
          <div className="mb-6">
            <h1 className="font-heading text-3xl mb-1">Discover</h1>
            <p className="text-muted-foreground">AI-curated songs tailored to your taste and playlists.</p>
          </div>
          <div className="rounded-2xl bg-surface-elevated border border-border/50 p-12 text-center">
            <Headphones className="w-10 h-10 text-muted-foreground mx-auto mb-4" />
            <h2 className="font-heading text-xl mb-2">Connect Spotify for personalized recommendations</h2>
            <p className="text-sm text-muted-foreground max-w-md mx-auto mb-6">
              Discover uses your real listening data to find songs that match your taste. Connect Spotify to unlock personalized AI recommendations.
            </p>
            <Button variant="hero" asChild>
              <Link to="/settings">Go to Settings</Link>
            </Button>
          </div>
        </div>
      </AppLayout>
    );
  }

  // Connected but no data yet
  if (trackCount !== null && trackCount === 0) {
    return (
      <AppLayout>
        <div className="max-w-5xl">
          <div className="mb-6">
            <h1 className="font-heading text-3xl mb-1">Discover</h1>
            <p className="text-muted-foreground">AI-curated songs tailored to your taste and playlists.</p>
          </div>
          <div className="rounded-2xl bg-surface-elevated border border-border/50 p-12 text-center">
            <Sparkles className="w-10 h-10 text-muted-foreground mx-auto mb-4" />
            <h2 className="font-heading text-xl mb-2">Waiting for your library</h2>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              Spotify is connected but no tracks have been imported yet. Once your library is imported, personalized recommendations will appear here.
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
            <h1 className="font-heading text-3xl mb-1">Discover</h1>
            <p className="text-muted-foreground">AI-curated songs tailored to your taste and playlists.</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 text-xs">
              <Sparkles className="w-4 h-4 text-accent" />
              <span className="text-muted-foreground">
                {loading ? "Analyzing your library…" : `${totalVisible} suggestions`}
              </span>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="rounded-lg gap-1 text-accent"
              onClick={handleRefresh}
              disabled={loading}
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
              {loading ? "Loading…" : "Refresh"}
            </Button>
          </div>
        </div>

        {/* Discovery mode */}
        <div className="flex gap-2 mb-8 flex-wrap">
          {discoveryModes.map((mode) => (
            <button
              key={mode.id}
              onClick={() => handleModeSwitch(mode.id)}
              disabled={loading}
              className={`px-4 py-2 rounded-xl text-sm transition-all ${
                activeMode === mode.id
                  ? "bg-primary text-primary-foreground"
                  : "bg-secondary text-muted-foreground hover:text-foreground"
              } ${loading ? "opacity-50" : ""}`}
            >
              {mode.label}
            </button>
          ))}
        </div>

        {/* Loading state */}
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 gap-4">
            <div className="relative">
              <Loader2 className="w-8 h-8 animate-spin text-accent" />
              <Sparkles className="w-4 h-4 text-accent absolute -top-1 -right-1 animate-pulse" />
            </div>
            <div className="text-center">
              <p className="text-sm font-medium mb-1">AI is analyzing your music DNA…</p>
              <p className="text-xs text-muted-foreground">Scanning genres, moods, tempos, and artist networks to find perfect matches</p>
            </div>
          </div>
        ) : hasLoaded && categories.length > 0 ? (
          <div className="space-y-10">
            {categories.map((cat) => {
              const visibleRecs = cat.recommendations.filter((r) => !hiddenIds.has(r.id));
              if (visibleRecs.length === 0) return null;

              return (
                <div key={cat.id}>
                  <div className="flex items-center gap-3 mb-1">
                    <span className="text-2xl">{categoryEmoji[cat.id] || "✨"}</span>
                    <h2 className="font-heading text-xl">{cat.title}</h2>
                  </div>
                  <p className="text-sm text-muted-foreground mb-4 ml-10">{cat.subtitle}</p>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {visibleRecs.map((rec) => (
                      <RecCard
                        key={rec.id}
                        rec={rec}
                        isSaved={savedIds.has(rec.id)}
                        onAdd={() => handleAdd(rec)}
                        onDismiss={() => handleDismiss(rec)}
                        onSave={() => handleSave(rec)}
                      />
                    ))}
                  </div>
                </div>
              );
            })}

            {totalVisible === 0 && (
              <div className="text-center py-16">
                <Sparkles className="w-8 h-8 text-accent mx-auto mb-3" />
                <p className="text-lg text-muted-foreground mb-2">All caught up!</p>
                <p className="text-sm text-muted-foreground mb-4">You've reviewed all current suggestions.</p>
                <Button variant="secondary" className="rounded-xl gap-2" onClick={handleRefresh}>
                  <RefreshCw className="w-4 h-4" />
                  Generate New Recommendations
                </Button>
              </div>
            )}
          </div>
        ) : hasLoaded ? (
          <div className="text-center py-16">
            <Sparkles className="w-8 h-8 text-accent mx-auto mb-3" />
            <p className="text-lg text-muted-foreground mb-2">No recommendations yet</p>
            <p className="text-sm text-muted-foreground mb-4">Click refresh to generate AI-powered recommendations based on your library.</p>
            <Button variant="hero" className="rounded-xl gap-2" onClick={handleRefresh}>
              <Sparkles className="w-4 h-4" />
              Generate Recommendations
            </Button>
          </div>
        ) : null}
      </div>
    </AppLayout>
  );
};

function RecCard({
  rec,
  isSaved,
  onAdd,
  onDismiss,
  onSave,
}: {
  rec: Recommendation;
  isSaved: boolean;
  onAdd: () => void;
  onDismiss: () => void;
  onSave: () => void;
}) {
  const tier = tierConfig[rec.popularityTier || "mid"];
  const TierIcon = tier.icon;
  const [showDetails, setShowDetails] = useState(false);
  const breakdown = rec.compatibilityBreakdown;

  return (
    <div className="rounded-2xl bg-surface-elevated border border-border/50 hover:border-accent/30 hover:shadow-sm transition-all overflow-hidden">
      <div className="group flex gap-4 p-4">
        <div className="w-12 h-12 rounded-xl bg-secondary flex items-center justify-center text-lg flex-shrink-0">
          🎵
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2 mb-0.5">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <p className="text-sm font-medium truncate">{rec.track.title}</p>
                <span className="text-xs font-medium text-accent flex-shrink-0">{rec.matchScore}%</span>
                <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${tier.className} flex-shrink-0`}>
                  <TierIcon className="w-2.5 h-2.5" />
                  {tier.label}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">{rec.track.artist} · {rec.track.album} ({rec.track.year})</p>
            </div>
          </div>
          <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{rec.reason}</p>

          <div className="flex items-center justify-between mt-2">
            <div className="flex gap-1 flex-wrap">
              {rec.moodTags.slice(0, 3).map((tag) => (
                <span key={tag} className="px-2 py-0.5 rounded-full text-[10px] bg-secondary text-muted-foreground">{tag}</span>
              ))}
              {rec.targetPlaylistName && (
                <span className="px-2 py-0.5 rounded-full text-[10px] bg-accent/10 text-accent">→ {rec.targetPlaylistName}</span>
              )}
            </div>
            <div className="flex items-center gap-1">
              {breakdown && (
                <button
                  onClick={() => setShowDetails(!showDetails)}
                  className="text-[10px] text-accent hover:underline mr-1"
                >
                  {showDetails ? "Hide" : "Details"}
                </button>
              )}
              <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button className="w-7 h-7 rounded-lg inline-flex items-center justify-center text-accent hover:bg-accent/10 transition-colors" title="Add to playlist" onClick={onAdd}>
                  <Plus className="w-3.5 h-3.5" />
                </button>
                <button className={`w-7 h-7 rounded-lg inline-flex items-center justify-center hover:bg-secondary transition-colors ${isSaved ? "text-warm" : "text-muted-foreground"}`} title="Save for later" onClick={onSave}>
                  <Bookmark className={`w-3.5 h-3.5 ${isSaved ? "fill-current" : ""}`} />
                </button>
                <button className="w-7 h-7 rounded-lg inline-flex items-center justify-center text-muted-foreground hover:bg-secondary transition-colors" title="Dismiss" onClick={onDismiss}>
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {showDetails && breakdown && (
        <div className="px-4 pb-4 pt-0 border-t border-border/30">
          <div className="grid grid-cols-3 gap-3 pt-3">
            {Object.entries(breakdown).map(([key, value]) => {
              const labels: Record<string, string> = {
                mood: "Mood", tempo: "Tempo", energy: "Energy",
                genre: "Genre", artistNetwork: "Artist Network", era: "Era",
              };
              const numValue = Number(value);
              return (
                <div key={key}>
                  <div className="flex justify-between text-[11px] mb-1">
                    <span className="text-muted-foreground">{labels[key] || key}</span>
                    <span className="font-medium">{numValue}%</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${numValue >= 85 ? "bg-accent" : numValue >= 70 ? "bg-warm" : "bg-muted-foreground/40"}`}
                      style={{ width: `${numValue}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export default Discover;
