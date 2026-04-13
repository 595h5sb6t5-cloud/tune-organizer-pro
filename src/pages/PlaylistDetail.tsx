import AppLayout from "@/components/app/AppLayout";
import { samplePlaylists, getRecommendationsForPlaylist, type Recommendation } from "@/lib/sample-data";
import { Button } from "@/components/ui/button";
import { useParams, Link } from "react-router-dom";
import { ArrowLeft, Upload, RefreshCw, Shuffle, Play, MoreHorizontal, Plus, X, Bookmark, Sparkles, Loader2, Check } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

const PlaylistDetail = () => {
  const { id } = useParams();
  const playlist = samplePlaylists.find((p) => p.id === id) ?? samplePlaylists[0];
  const allRecs = getRecommendationsForPlaylist(playlist.id).filter((r) => r.status === "pending");

  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());
  const [acceptedRecs, setAcceptedRecs] = useState<Recommendation[]>([]);
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [syncing, setSyncing] = useState(false);
  const [regenerating, setRegenerating] = useState(false);

  const acceptedIds = new Set(acceptedRecs.map((r) => r.id));
  const visibleRecs = allRecs.filter((r) => !dismissedIds.has(r.id) && !acceptedIds.has(r.id));
  const allTracks = [...playlist.tracks, ...acceptedRecs.map((r) => r.track)];

  const handleSync = () => {
    setSyncing(true);
    toast.loading("Syncing to Spotify…");
    setTimeout(() => {
      setSyncing(false);
      toast.dismiss();
      toast.success(`"${playlist.name}" synced to Spotify!`);
    }, 2000);
  };

  const handleRegenerate = () => {
    setRegenerating(true);
    toast.loading("Regenerating playlist…");
    setTimeout(() => {
      setRegenerating(false);
      toast.dismiss();
      toast.success(`"${playlist.name}" regenerated with fresh picks!`);
    }, 2500);
  };

  const handleShuffle = () => {
    toast.success("Playlist order shuffled!");
  };

  const handleAddRec = (rec: Recommendation) => {
    setAcceptedRecs((prev) => [...prev, rec]);
    toast.success(`Added "${rec.track.title}" to ${playlist.name}`);
  };

  const handleDismissRec = (rec: Recommendation) => {
    setDismissedIds((prev) => new Set(prev).add(rec.id));
    toast("Dismissed", { description: `"${rec.track.title}" removed from suggestions.` });
  };

  const handleSaveRec = (rec: Recommendation) => {
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

  return (
    <AppLayout>
      <div className="max-w-4xl">
        <Link to="/playlists" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-6 transition-colors">
          <ArrowLeft className="w-4 h-4" />
          Back to playlists
        </Link>

        {/* Playlist header */}
        <div className="flex gap-6 mb-8">
          <div className="w-32 h-32 rounded-2xl bg-secondary flex items-center justify-center text-6xl flex-shrink-0">
            {playlist.emoji}
          </div>
          <div className="flex-1">
            <h1 className="font-heading text-4xl mb-1">{playlist.name}</h1>
            <p className="text-muted-foreground mb-4">{playlist.description}</p>
            <div className="flex items-center gap-6 text-sm text-muted-foreground mb-4">
              <span>{allTracks.length} tracks</span>
              <span>{playlist.mood}</span>
              <span>{playlist.avgTempo} BPM avg</span>
              <span className="text-accent font-medium">{playlist.cohesionScore}% cohesion</span>
            </div>
            <div className="flex gap-3">
              <Button variant="hero" className="rounded-xl gap-2" onClick={handleSync} disabled={syncing}>
                {syncing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                {syncing ? "Syncing…" : "Sync to Spotify"}
              </Button>
              <Button variant="secondary" className="rounded-xl gap-2" onClick={handleRegenerate} disabled={regenerating}>
                <RefreshCw className={`w-4 h-4 ${regenerating ? "animate-spin" : ""}`} />
                {regenerating ? "Regenerating…" : "Regenerate"}
              </Button>
              <Button variant="ghost" size="icon" className="rounded-xl" onClick={handleShuffle}>
                <Shuffle className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </div>

        {/* Track list */}
        <div className="rounded-2xl border border-border/50 overflow-hidden mb-8">
          <div className="grid grid-cols-[40px_1fr_1fr_80px_80px_40px] gap-4 px-5 py-3 text-xs text-muted-foreground border-b border-border/50 bg-secondary/30">
            <span>#</span>
            <span>Title</span>
            <span>Album</span>
            <span>BPM</span>
            <span>Mood</span>
            <span />
          </div>
          {allTracks.map((track, i) => {
            const isNew = acceptedRecs.some((r) => r.track.id === track.id);
            return (
              <div
                key={track.id}
                className={`group grid grid-cols-[40px_1fr_1fr_80px_80px_40px] gap-4 px-5 py-3 items-center hover:bg-secondary/30 transition-colors ${isNew ? "bg-accent/5" : ""}`}
              >
                <span className="text-sm text-muted-foreground group-hover:hidden">{i + 1}</span>
                <Play className="w-4 h-4 text-accent hidden group-hover:block" />
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium truncate">{track.title}</p>
                    {isNew && <span className="px-1.5 py-0.5 rounded text-[10px] bg-accent/10 text-accent font-medium">New</span>}
                  </div>
                  <p className="text-xs text-muted-foreground">{track.artist}</p>
                </div>
                <p className="text-sm text-muted-foreground truncate">{track.album}</p>
                <p className="text-sm text-muted-foreground">{track.tempo}</p>
                <p className="text-xs text-muted-foreground">{track.mood}</p>
                <button
                  className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground"
                  onClick={() => toast("Track options", { description: `Options for "${track.title}" coming soon.` })}
                >
                  <MoreHorizontal className="w-4 h-4" />
                </button>
              </div>
            );
          })}
        </div>

        {/* Suggested Additions */}
        {visibleRecs.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-4">
              <Sparkles className="w-5 h-5 text-accent" />
              <h2 className="font-heading text-2xl">Suggested Additions</h2>
              <span className="text-xs text-muted-foreground ml-1">({visibleRecs.length} songs)</span>
            </div>
            <p className="text-sm text-muted-foreground mb-4">Songs we think belong in this playlist based on your taste.</p>
            <div className="space-y-2">
              {visibleRecs.map((rec) => (
                <div
                  key={rec.id}
                  className="group flex items-center gap-4 p-4 rounded-2xl bg-surface-elevated border border-border/50 hover:border-accent/30 hover:shadow-sm transition-all"
                >
                  <div className="w-10 h-10 rounded-xl bg-secondary flex items-center justify-center text-base flex-shrink-0">
                    🎵
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <p className="text-sm font-medium truncate">{rec.track.title}</p>
                      <span className="text-xs font-medium text-accent">{rec.matchScore}% match</span>
                    </div>
                    <p className="text-xs text-muted-foreground">{rec.track.artist} · {rec.track.album}</p>
                    <p className="text-xs text-muted-foreground mt-1">{rec.reason}</p>
                  </div>
                  <div className="flex gap-1.5 flex-wrap justify-end">
                    {rec.moodTags.map((tag) => (
                      <span key={tag} className="px-2 py-0.5 rounded-full text-[10px] bg-secondary text-muted-foreground">{tag}</span>
                    ))}
                  </div>
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                    <Button variant="ghost" size="icon" className="w-8 h-8 rounded-lg text-accent hover:text-accent" title="Add to playlist" onClick={() => handleAddRec(rec)}>
                      <Plus className="w-4 h-4" />
                    </Button>
                    <Button variant="ghost" size="icon" className={`w-8 h-8 rounded-lg ${savedIds.has(rec.id) ? "text-warm" : ""}`} title="Save for later" onClick={() => handleSaveRec(rec)}>
                      <Bookmark className={`w-4 h-4 ${savedIds.has(rec.id) ? "fill-current" : ""}`} />
                    </Button>
                    <Button variant="ghost" size="icon" className="w-8 h-8 rounded-lg text-muted-foreground" title="Dismiss" onClick={() => handleDismissRec(rec)}>
                      <X className="w-4 h-4" />
                    </Button>
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

export default PlaylistDetail;
