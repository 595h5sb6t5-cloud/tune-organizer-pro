import AppLayout from "@/components/app/AppLayout";
import { sampleRecommendations, samplePlaylists, getRecommendationsForPlaylist, getNewVibeRecommendations, type Recommendation } from "@/lib/sample-data";
import { Sparkles, Plus, X, Bookmark, ChevronRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import { useState } from "react";
import { toast } from "sonner";

const discoveryModes = ["Safe Picks", "Balanced", "Deep Cuts", "Mainstream", "Underground", "Nostalgic", "New Releases"];

const Discover = () => {
  const [activeMode, setActiveMode] = useState("Balanced");
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());
  const [acceptedIds, setAcceptedIds] = useState<Set<string>>(new Set());
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [switching, setSwitching] = useState(false);

  const hiddenIds = new Set([...dismissedIds, ...acceptedIds]);

  const handleAdd = (rec: Recommendation) => {
    setAcceptedIds((prev) => new Set(prev).add(rec.id));
    const playlistName = rec.targetPlaylistId
      ? samplePlaylists.find((p) => p.id === rec.targetPlaylistId)?.name
      : "your library";
    toast.success(`Added "${rec.track.title}" to ${playlistName}`);
  };

  const handleDismiss = (rec: Recommendation) => {
    setDismissedIds((prev) => new Set(prev).add(rec.id));
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

  const handleModeSwitch = (mode: string) => {
    if (mode === activeMode) return;
    setSwitching(true);
    setActiveMode(mode);
    // Reset dismissed/accepted for fresh view on mode switch
    setDismissedIds(new Set());
    setAcceptedIds(new Set());
    setTimeout(() => {
      setSwitching(false);
      toast.success(`Discovery mode: ${mode}`);
    }, 600);
  };

  const pendingCount = sampleRecommendations.filter(
    (r) => r.status === "pending" && !hiddenIds.has(r.id)
  ).length;

  const allHidden = pendingCount === 0 && !switching;

  return (
    <AppLayout>
      <div className="max-w-5xl">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="font-heading text-3xl mb-1">Discover</h1>
            <p className="text-muted-foreground">New songs tailored to your taste and playlists.</p>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <Sparkles className="w-4 h-4 text-accent" />
            <span className="text-muted-foreground">{pendingCount} new suggestions</span>
          </div>
        </div>

        {/* Discovery mode */}
        <div className="flex gap-2 mb-8 flex-wrap">
          {discoveryModes.map((mode) => (
            <button
              key={mode}
              onClick={() => handleModeSwitch(mode)}
              disabled={switching}
              className={`px-4 py-2 rounded-xl text-sm transition-all ${
                activeMode === mode
                  ? "bg-primary text-primary-foreground"
                  : "bg-secondary text-muted-foreground hover:text-foreground"
              } ${switching ? "opacity-50" : ""}`}
            >
              {mode}
            </button>
          ))}
        </div>

        {switching ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <Loader2 className="w-6 h-6 animate-spin text-accent" />
            <p className="text-sm text-muted-foreground">Switching to {activeMode} mode…</p>
          </div>
        ) : allHidden ? (
          <div className="text-center py-16">
            <Sparkles className="w-8 h-8 text-accent mx-auto mb-3" />
            <p className="text-lg text-muted-foreground mb-2">All caught up!</p>
            <p className="text-sm text-muted-foreground mb-4">You've reviewed all current suggestions. Try a different discovery mode or check back later.</p>
            <Button variant="secondary" className="rounded-xl" onClick={() => {
              setDismissedIds(new Set());
              setAcceptedIds(new Set());
              toast.success("Suggestions reset");
            }}>
              Reset Suggestions
            </Button>
          </div>
        ) : (
          <>
            {/* Recs grouped by playlist */}
            {samplePlaylists.map((pl) => {
              const recs = getRecommendationsForPlaylist(pl.id).filter(
                (r) => r.status === "pending" && !hiddenIds.has(r.id)
              );
              if (recs.length === 0) return null;
              return (
                <div key={pl.id} className="mb-8">
                  <div className="flex items-center justify-between mb-4">
                    <Link to={`/playlists/${pl.id}`} className="flex items-center gap-3 group">
                      <span className="text-2xl">{pl.emoji}</span>
                      <div>
                        <h3 className="font-heading text-xl group-hover:text-accent transition-colors">{pl.name}</h3>
                        <p className="text-xs text-muted-foreground">{recs.length} suggestions</p>
                      </div>
                    </Link>
                    <Link to={`/playlists/${pl.id}`} className="text-xs text-accent hover:underline flex items-center gap-0.5">
                      View playlist <ChevronRight className="w-3 h-3" />
                    </Link>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {recs.map((rec) => (
                      <RecommendationCard
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

            {/* New Vibe Suggestions */}
            {(() => {
              const newVibes = getNewVibeRecommendations().filter((r) => !hiddenIds.has(r.id));
              if (newVibes.length === 0) return null;
              return (
                <div className="mb-8">
                  <div className="flex items-center gap-3 mb-4">
                    <span className="text-2xl">🔮</span>
                    <div>
                      <h3 className="font-heading text-xl">New Vibe Suggestions</h3>
                      <p className="text-xs text-muted-foreground">Songs that don't fit existing playlists — potential new directions</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {newVibes.map((rec) => (
                      <RecommendationCard
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
            })()}
          </>
        )}
      </div>
    </AppLayout>
  );
};

function RecommendationCard({
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
  return (
    <div className="p-4 rounded-2xl bg-surface-elevated border border-border/50 flex gap-4 group hover:border-border hover:shadow-sm transition-all">
      <div className="w-12 h-12 rounded-xl bg-secondary flex items-center justify-center text-lg flex-shrink-0">
        🎵
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2 mb-1">
          <div className="min-w-0">
            <p className="text-sm font-medium truncate">{rec.track.title}</p>
            <p className="text-xs text-muted-foreground">{rec.track.artist}</p>
          </div>
          <span className="text-xs font-medium text-accent flex-shrink-0">{rec.matchScore}%</span>
        </div>
        <p className="text-xs text-muted-foreground mb-2 line-clamp-1">{rec.reason}</p>
        <div className="flex items-center justify-between">
          <div className="flex gap-1 flex-wrap">
            {rec.moodTags.map((tag) => (
              <span key={tag} className="px-2 py-0.5 rounded-full text-[10px] bg-secondary text-muted-foreground">{tag}</span>
            ))}
          </div>
          <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <Button variant="ghost" size="icon" className="w-7 h-7 rounded-lg text-accent hover:text-accent" title="Add to playlist" onClick={onAdd}>
              <Plus className="w-3.5 h-3.5" />
            </Button>
            <Button variant="ghost" size="icon" className={`w-7 h-7 rounded-lg ${isSaved ? "text-warm" : ""}`} title="Save for later" onClick={onSave}>
              <Bookmark className={`w-3.5 h-3.5 ${isSaved ? "fill-current" : ""}`} />
            </Button>
            <Button variant="ghost" size="icon" className="w-7 h-7 rounded-lg text-muted-foreground" title="Dismiss" onClick={onDismiss}>
              <X className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default Discover;
