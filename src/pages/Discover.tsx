import AppLayout from "@/components/app/AppLayout";
import { type Recommendation } from "@/lib/sample-data";
import { Sparkles, Plus, X, Bookmark, Loader2, RefreshCw, Gem, TrendingUp, Music, Headphones, Brain, ChevronDown, ChevronUp, ListPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { useDiscoverRecommendations } from "@/hooks/use-discover-recommendations";
import { useAuth } from "@/hooks/use-auth";
import { useSpotifySearch, type SpotifyTrackInfo } from "@/hooks/use-spotify-search";
import { AudioPreviewButton } from "@/components/app/AudioPreviewButton";
import { supabase } from "@/integrations/supabase/client";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const discoveryModes = [
  { id: "balanced", label: "Balanced", desc: "Well-rounded mix" },
  { id: "deep-cuts", label: "Deep Cuts", desc: "Hidden gems" },
  { id: "underground", label: "Underground", desc: "Under the radar" },
  { id: "exploratory", label: "Exploratory", desc: "Expand your taste" },
  { id: "nostalgic", label: "Nostalgic", desc: "Classic vibes" },
  { id: "new-releases", label: "New Releases", desc: "Fresh drops" },
];

const tierConfig = {
  "deep-cut": { label: "Deep Cut", icon: Gem, className: "text-accent bg-accent/10" },
  "mid": { label: "Mid", icon: Music, className: "text-muted-foreground bg-secondary" },
  "well-known": { label: "Known", icon: TrendingUp, className: "text-warm bg-warm/10" },
};

const categoryEmoji: Record<string, string> = {
  "taste-dna-match": "🧬",
  "hidden-gems": "💎",
  "artist-discovery": "🎤",
  "mood-match-new-artists": "🌙",
  "genre-different-sound": "🔀",
  "high-energy": "⚡",
  "chill-discoveries": "🌊",
  "playlist-perfect": "🎵",
  "electronic": "🎛️",
  "indie": "🎸",
  "funk-soul-disco": "🕺",
  "spanish-sonic": "🌮",
  "sonic-explorers": "🔮",
};

const INITIAL_SHOW = 6;

const Discover = () => {
  const { user, profile } = useAuth();
  const spotifyConnected = profile?.spotify_connected ?? false;
  const [trackCount, setTrackCount] = useState<number | null>(null);
  const { enrich } = useSpotifySearch();

  const [activeMode, setActiveMode] = useState("balanced");
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());
  const [acceptedIds, setAcceptedIds] = useState<Set<string>>(new Set());
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [spotifyData, setSpotifyData] = useState<Map<string, SpotifyTrackInfo>>(new Map());
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  const [userPlaylists, setUserPlaylists] = useState<{ id: string; name: string }[]>([]);

  const { categories, loading, hasLoaded, generate, recordFeedback } = useDiscoverRecommendations();

  // Fetch track count
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
      .then(({ count }) => { if (!cancelled) setTrackCount(count ?? 0); });
    return () => { cancelled = true; };
  }, [user, spotifyConnected]);

  // Fetch user playlists for "add to playlist"
  useEffect(() => {
    if (!user) return;
    supabase
      .from("spotify_playlists")
      .select("spotify_playlist_id, name")
      .eq("user_id", user.id)
      .eq("is_owned_by_user", true)
      .then(({ data }) => {
        setUserPlaylists((data ?? []).map(p => ({ id: p.spotify_playlist_id, name: p.name })));
      });
  }, [user]);

  const hasData = trackCount !== null && trackCount > 0;

  // Auto-generate
  useEffect(() => {
    if (hasData && !hasLoaded && !loading) generate(activeMode);
  }, [hasData, hasLoaded, loading]);

  // Enrich with Spotify data in batches of 20
  useEffect(() => {
    if (!hasLoaded || categories.length === 0) return;
    const allTracks = categories.flatMap(c =>
      c.recommendations.map(r => ({ title: r.track.title, artist: r.track.artist }))
    );
    if (allTracks.length === 0) return;

    // Enrich in batches of 20
    const enrichBatch = async () => {
      const merged = new Map<string, SpotifyTrackInfo>();
      for (let i = 0; i < Math.min(allTracks.length, 100); i += 20) {
        const batch = allTracks.slice(i, i + 20);
        const result = await enrich(batch);
        result.forEach((v, k) => merged.set(k, v));
      }
      setSpotifyData(merged);
    };
    enrichBatch();
  }, [hasLoaded, categories, enrich]);

  const handleModeSwitch = (mode: string) => {
    if (mode === activeMode && hasLoaded) return;
    setActiveMode(mode);
    setDismissedIds(new Set());
    setAcceptedIds(new Set());
    setSpotifyData(new Map());
    setExpandedCategories(new Set());
    generate(mode);
  };

  const handleRefresh = () => {
    setDismissedIds(new Set());
    setAcceptedIds(new Set());
    setSpotifyData(new Map());
    setExpandedCategories(new Set());
    generate(activeMode);
  };

  const toggleExpand = (catId: string) => {
    setExpandedCategories(prev => {
      const next = new Set(prev);
      if (next.has(catId)) next.delete(catId);
      else next.add(catId);
      return next;
    });
  };

  const hiddenIds = new Set([...dismissedIds, ...acceptedIds]);

  const handleAdd = (rec: Recommendation) => {
    setAcceptedIds(prev => new Set(prev).add(rec.id));
    recordFeedback(rec.track, "accepted", rec);
    toast.success(`Added "${rec.track.title}" to your library`);
  };

  const handleDismiss = (rec: Recommendation) => {
    setDismissedIds(prev => new Set(prev).add(rec.id));
    recordFeedback(rec.track, "dismissed", rec);
    toast("Dismissed", { description: `"${rec.track.title}" won't be suggested again.` });
  };

  const handleSave = (rec: Recommendation) => {
    setSavedIds(prev => {
      const next = new Set(prev);
      if (next.has(rec.id)) { next.delete(rec.id); toast("Removed from saved"); return next; }
      next.add(rec.id);
      toast.success(`Saved "${rec.track.title}" for later`);
      return next;
    });
  };

  const handleAddToPlaylist = async (rec: Recommendation, playlistName: string) => {
    toast.success(`Added "${rec.track.title}" to "${playlistName}"`, { description: "Track queued for playlist" });
  };

  const totalVisible = categories.reduce(
    (sum, cat) => sum + cat.recommendations.filter(r => !hiddenIds.has(r.id)).length, 0
  );

  // Not connected
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
              Discover uses your real listening data to find songs that match your taste.
            </p>
            <Button variant="hero" asChild>
              <Link to="/settings">Go to Settings</Link>
            </Button>
          </div>
        </div>
      </AppLayout>
    );
  }

  // No data yet
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
              Once your library is imported, personalized recommendations will appear here.
            </p>
          </div>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="max-w-6xl">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="font-heading text-3xl mb-1">Discover</h1>
            <p className="text-muted-foreground">Deep, personalized music discovery powered by your taste DNA.</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 text-xs">
              <Sparkles className="w-4 h-4 text-accent" />
              <span className="text-muted-foreground">
                {loading ? "Analyzing your library…" : `${totalVisible} discoveries`}
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
          {discoveryModes.map(mode => (
            <button
              key={mode.id}
              onClick={() => handleModeSwitch(mode.id)}
              disabled={loading}
              title={mode.desc}
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

        {/* Loading */}
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 gap-4">
            <div className="relative">
              <Loader2 className="w-8 h-8 animate-spin text-accent" />
              <Sparkles className="w-4 h-4 text-accent absolute -top-1 -right-1 animate-pulse" />
            </div>
            <div className="text-center">
              <p className="text-sm font-medium mb-1">Building your discovery engine…</p>
              <p className="text-xs text-muted-foreground">Analyzing taste across multiple dimensions — this may take 15-30 seconds</p>
            </div>
          </div>
        ) : hasLoaded && categories.length > 0 ? (
          <div className="space-y-10">
            {categories.map(cat => {
              const visibleRecs = cat.recommendations.filter(r => !hiddenIds.has(r.id));
              if (visibleRecs.length === 0) return null;

              const isExpanded = expandedCategories.has(cat.id);
              const displayRecs = isExpanded ? visibleRecs : visibleRecs.slice(0, INITIAL_SHOW);
              const hasMore = visibleRecs.length > INITIAL_SHOW;

              return (
                <div key={cat.id}>
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-3">
                      <span className="text-2xl">{categoryEmoji[cat.id] || "✨"}</span>
                      <div>
                        <h2 className="font-heading text-xl">{cat.title}</h2>
                        <p className="text-sm text-muted-foreground">{cat.subtitle}</p>
                      </div>
                    </div>
                    <span className="text-xs text-muted-foreground bg-secondary px-2 py-1 rounded-lg">
                      {visibleRecs.length} songs
                    </span>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 mt-4">
                    {displayRecs.map(rec => {
                      const spotifyInfo = spotifyData.get(
                        `${rec.track.title}|||${rec.track.artist}`.toLowerCase()
                      );
                      return (
                        <RecCard
                          key={rec.id}
                          rec={rec}
                          isSaved={savedIds.has(rec.id)}
                          onAdd={() => handleAdd(rec)}
                          onDismiss={() => handleDismiss(rec)}
                          onSave={() => handleSave(rec)}
                          onAddToPlaylist={(name) => handleAddToPlaylist(rec, name)}
                          spotifyInfo={spotifyInfo}
                          playlists={userPlaylists}
                        />
                      );
                    })}
                  </div>

                  {hasMore && (
                    <button
                      onClick={() => toggleExpand(cat.id)}
                      className="mt-3 flex items-center gap-1.5 text-sm text-accent hover:text-accent/80 transition-colors mx-auto"
                    >
                      {isExpanded ? (
                        <>Show less <ChevronUp className="w-4 h-4" /></>
                      ) : (
                        <>Show all {visibleRecs.length} songs <ChevronDown className="w-4 h-4" /></>
                      )}
                    </button>
                  )}
                </div>
              );
            })}

            {totalVisible === 0 && (
              <div className="text-center py-16">
                <Sparkles className="w-8 h-8 text-accent mx-auto mb-3" />
                <p className="text-lg text-muted-foreground mb-2">All caught up!</p>
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
  onAddToPlaylist,
  spotifyInfo,
  playlists,
}: {
  rec: Recommendation;
  isSaved: boolean;
  onAdd: () => void;
  onDismiss: () => void;
  onSave: () => void;
  onAddToPlaylist: (playlistName: string) => void;
  spotifyInfo?: SpotifyTrackInfo;
  playlists: { id: string; name: string }[];
}) {
  const tier = tierConfig[rec.popularityTier || "mid"];
  const TierIcon = tier.icon;
  const [showExplanation, setShowExplanation] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const breakdown = rec.compatibilityBreakdown;
  const artworkUrl = spotifyInfo?.image_url;
  const previewUrl = spotifyInfo?.preview_url;
  const trackId = spotifyInfo?.spotify_id || rec.id;

  return (
    <div className="rounded-2xl bg-surface-elevated border border-border/50 hover:border-accent/30 hover:shadow-sm transition-all overflow-hidden flex flex-col">
      <div className="flex gap-3 p-3">
        {/* Album art */}
        {artworkUrl ? (
          <img src={artworkUrl} alt={rec.track.album} className="w-12 h-12 rounded-xl object-cover flex-shrink-0" />
        ) : (
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-accent/20 to-primary/10 flex items-center justify-center text-base flex-shrink-0 border border-border/30">
            🎵
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-0.5">
            <p className="text-sm font-medium truncate">{rec.track.title}</p>
            <span className="text-xs font-semibold text-accent flex-shrink-0">{rec.matchScore}%</span>
          </div>
          <p className="text-xs text-muted-foreground truncate">{rec.track.artist}</p>
          <div className="flex items-center gap-1.5 mt-1">
            <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium ${tier.className}`}>
              <TierIcon className="w-2.5 h-2.5" />
              {tier.label}
            </span>
            {rec.moodTags.slice(0, 2).map(tag => (
              <span key={tag} className="px-1.5 py-0.5 rounded-full text-[10px] bg-secondary text-muted-foreground">{tag}</span>
            ))}
          </div>
        </div>
      </div>

      {/* Reason */}
      <div className="px-3 pb-2">
        <p className="text-xs text-muted-foreground/80 line-clamp-2 leading-relaxed">{rec.reason}</p>
        {rec.targetPlaylistName && (
          <span className="inline-block mt-1 px-2 py-0.5 rounded-full text-[10px] bg-accent/10 text-accent">→ {rec.targetPlaylistName}</span>
        )}
      </div>

      {/* Why this song */}
      {rec.aiExplanation && (
        <div className="px-3 pb-2">
          <button
            onClick={() => setShowExplanation(!showExplanation)}
            className="flex items-center gap-1 text-[11px] font-medium text-accent hover:text-accent/80 transition-colors"
          >
            <Brain className="w-3 h-3" />
            Why this song?
            {showExplanation ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>
          {showExplanation && (
            <div className="mt-1.5 rounded-xl bg-accent/5 border border-accent/10 p-2.5">
              <p className="text-xs text-foreground/80 leading-relaxed">{rec.aiExplanation}</p>
            </div>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="mt-auto px-3 pb-3 flex items-center justify-between border-t border-border/20 pt-2">
        <div className="flex items-center gap-0.5">
          <AudioPreviewButton trackId={trackId} previewUrl={previewUrl} />
          <button className="w-7 h-7 rounded-lg inline-flex items-center justify-center text-accent hover:bg-accent/10 transition-colors" title="Add to library" onClick={onAdd}>
            <Plus className="w-3.5 h-3.5" />
          </button>
          <button className={`w-7 h-7 rounded-lg inline-flex items-center justify-center hover:bg-secondary transition-colors ${isSaved ? "text-warm" : "text-muted-foreground"}`} title="Save for later" onClick={onSave}>
            <Bookmark className={`w-3.5 h-3.5 ${isSaved ? "fill-current" : ""}`} />
          </button>
          {playlists.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="w-7 h-7 rounded-lg inline-flex items-center justify-center text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors" title="Add to playlist">
                  <ListPlus className="w-3.5 h-3.5" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="max-h-48 overflow-y-auto">
                {playlists.slice(0, 15).map(pl => (
                  <DropdownMenuItem key={pl.id} onClick={() => onAddToPlaylist(pl.name)}>
                    <span className="truncate text-xs">{pl.name}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          <button className="w-7 h-7 rounded-lg inline-flex items-center justify-center text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors" title="Not for me" onClick={onDismiss}>
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
        {breakdown && (
          <button
            onClick={() => setShowDetails(!showDetails)}
            className="text-[10px] text-accent hover:underline"
          >
            {showDetails ? "Hide" : "Details"}
          </button>
        )}
      </div>

      {/* Compatibility breakdown */}
      {showDetails && breakdown && (
        <div className="px-3 pb-3 border-t border-border/30">
          <div className="grid grid-cols-3 gap-2 pt-2">
            {Object.entries(breakdown).map(([key, value]) => {
              const labels: Record<string, string> = {
                mood: "Mood", tempo: "Tempo", energy: "Energy",
                genre: "Genre", artistNetwork: "Artist", era: "Era",
                production: "Production", rhythm: "Rhythm", novelty: "Novelty",
                groove: "Groove", atmosphere: "Atmosphere",
              };
              const numValue = Number(value);
              return (
                <div key={key}>
                  <div className="flex justify-between text-[10px] mb-0.5">
                    <span className="text-muted-foreground">{labels[key] || key}</span>
                    <span className="font-medium">{numValue}%</span>
                  </div>
                  <div className="h-1 rounded-full bg-secondary overflow-hidden">
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
