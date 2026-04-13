import { useState, useCallback, useRef } from "react";
import {
  Plus, Sparkles, Loader2, Music, Check, X, Send, Trash2,
  ChevronDown, ChevronUp, Save,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "@/integrations/supabase/client";
import { useSpotifySearch, type SpotifyTrackInfo } from "@/hooks/use-spotify-search";
import { AudioPreviewButton } from "@/components/app/AudioPreviewButton";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface Recommendation {
  title: string;
  artist: string;
  album?: string;
  year?: number;
  genre?: string;
  reason: string;
  compatibility_score: number;
  mood?: string;
  energy?: number;
}

interface SelectedTrack extends Recommendation {
  spotifyInfo?: SpotifyTrackInfo;
}

interface Props {
  onPlaylistCreated: () => void;
}

export default function CreatePlaylistDialog({ onPlaylistCreated }: Props) {
  const [open, setOpen] = useState(false);
  const [description, setDescription] = useState("");
  const [playlistName, setPlaylistName] = useState("");
  const [suggestedName, setSuggestedName] = useState("");
  const [moodTags, setMoodTags] = useState<string[]>([]);
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [selectedTracks, setSelectedTracks] = useState<SelectedTrack[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [spotifyData, setSpotifyData] = useState<Map<string, SpotifyTrackInfo>>(new Map());
  const [showSelected, setShowSelected] = useState(false);
  const excludeIdsRef = useRef<string[]>([]);
  const { enrich } = useSpotifySearch();

  const fetchRecommendations = useCallback(async () => {
    if (!description.trim()) return;
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("custom-playlist-recommend", {
        body: {
          description: description.trim(),
          selectedTracks: selectedTracks.map(t => ({ title: t.title, artist: t.artist })),
          excludeTrackIds: excludeIdsRef.current,
          count: 8,
        },
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);

      const recs: Recommendation[] = data.recommendations || [];
      setRecommendations(recs);

      if (!playlistName && data.playlist_name_suggestion) {
        setSuggestedName(data.playlist_name_suggestion);
        setPlaylistName(data.playlist_name_suggestion);
      }
      if (data.playlist_mood_tags?.length) setMoodTags(data.playlist_mood_tags);

      // Enrich with Spotify data
      const enriched = await enrich(recs.map(r => ({ title: r.title, artist: r.artist })));
      setSpotifyData(prev => {
        const merged = new Map(prev);
        enriched.forEach((v, k) => merged.set(k, v));
        return merged;
      });

      // Track exclude IDs
      enriched.forEach(info => {
        if (info.spotify_id && !excludeIdsRef.current.includes(info.spotify_id)) {
          excludeIdsRef.current.push(info.spotify_id);
        }
      });
    } catch (e: any) {
      toast.error("Failed to get recommendations", { description: e.message });
    } finally {
      setLoading(false);
    }
  }, [description, selectedTracks, enrich, playlistName]);

  const addTrack = (rec: Recommendation) => {
    const key = `${rec.title}|||${rec.artist}`.toLowerCase();
    const info = spotifyData.get(key);
    setSelectedTracks(prev => [...prev, { ...rec, spotifyInfo: info }]);
    setRecommendations(prev => prev.filter(r => r.title !== rec.title || r.artist !== rec.artist));
  };

  const removeTrack = (idx: number) => {
    setSelectedTracks(prev => prev.filter((_, i) => i !== idx));
  };

  const getSpotifyInfo = (rec: Recommendation) =>
    spotifyData.get(`${rec.title}|||${rec.artist}`.toLowerCase());

  const handleSave = async () => {
    if (selectedTracks.length === 0) {
      toast.error("Add at least one song to your playlist.");
      return;
    }
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const name = playlistName.trim() || suggestedName || "Custom Playlist";
      const coverTracks = selectedTracks.slice(0, 4).map(t => ({
        image_url: t.spotifyInfo?.image_url || "",
        track_name: t.title,
      })).filter(c => c.image_url);

      // Create cluster
      const { data: cluster, error: clusterErr } = await supabase
        .from("liked_song_clusters")
        .insert({
          user_id: user.id,
          name,
          description: description.trim(),
          vibe_description: description.trim(),
          mood_tags: moodTags,
          color_hex: "#6366f1",
          track_count: selectedTracks.length,
          sort_order: 999,
          ai_explanation: `Custom playlist created from: "${description}"`,
          cover_tracks: coverTracks,
          analysis_model: "custom",
        })
        .select("id")
        .single();

      if (clusterErr) throw clusterErr;

      // Insert cluster tracks — we use the spotify track IDs from enrichment
      const trackRows = selectedTracks.map(t => ({
        cluster_id: cluster.id,
        user_id: user.id,
        liked_song_id: cluster.id, // placeholder since these may not be liked songs
        spotify_track_id: t.spotifyInfo?.spotify_id || `custom-${t.title}-${t.artist}`.replace(/\s+/g, "-").toLowerCase(),
        confidence_score: (t.compatibility_score || 80) / 100,
      }));

      const { error: tracksErr } = await supabase
        .from("liked_song_cluster_tracks")
        .insert(trackRows);

      if (tracksErr) throw tracksErr;

      toast.success(`"${name}" created!`, { description: `${selectedTracks.length} songs added.` });
      onPlaylistCreated();
      resetAndClose();
    } catch (e: any) {
      toast.error("Failed to save playlist", { description: e.message });
    } finally {
      setSaving(false);
    }
  };

  const resetAndClose = () => {
    setOpen(false);
    setDescription("");
    setPlaylistName("");
    setSuggestedName("");
    setMoodTags([]);
    setRecommendations([]);
    setSelectedTracks([]);
    setSpotifyData(new Map());
    setShowSelected(false);
    excludeIdsRef.current = [];
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) resetAndClose(); else setOpen(true); }}>
      <DialogTrigger asChild>
        <Button variant="hero" className="gap-1.5">
          <Plus className="w-4 h-4" /> Create Playlist
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col p-0">
        <DialogHeader className="px-6 pt-6 pb-2">
          <DialogTitle className="font-heading text-xl flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-accent" />
            Create New Playlist
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-hidden flex flex-col px-6">
          {/* Playlist name */}
          <Input
            placeholder="Playlist name (optional — AI will suggest one)"
            value={playlistName}
            onChange={(e) => setPlaylistName(e.target.value)}
            className="mb-3 text-sm"
          />

          {/* Description input */}
          <div className="flex gap-2 mb-4">
            <Input
              placeholder="Describe your playlist… e.g. 'Chill lofi for studying at night'"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !loading) fetchRecommendations(); }}
              className="flex-1 text-sm"
            />
            <Button
              variant="hero"
              size="icon"
              onClick={fetchRecommendations}
              disabled={loading || !description.trim()}
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </Button>
          </div>

          {/* Selected tracks summary */}
          {selectedTracks.length > 0 && (
            <button
              onClick={() => setShowSelected(!showSelected)}
              className="flex items-center justify-between w-full mb-3 px-3 py-2 rounded-lg bg-accent/10 text-accent text-sm font-medium hover:bg-accent/15 transition-colors"
            >
              <span className="flex items-center gap-1.5">
                <Check className="w-3.5 h-3.5" />
                {selectedTracks.length} song{selectedTracks.length !== 1 ? "s" : ""} selected
              </span>
              {showSelected ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>
          )}

          {/* Selected tracks list */}
          {showSelected && selectedTracks.length > 0 && (
            <div className="mb-3 rounded-lg border border-border/50 overflow-hidden">
              <div className="divide-y divide-border/20 max-h-40 overflow-y-auto">
                {selectedTracks.map((t, idx) => (
                  <div key={idx} className="flex items-center gap-2 px-3 py-2 text-sm">
                    {t.spotifyInfo?.image_url ? (
                      <img src={t.spotifyInfo.image_url} alt="" className="w-8 h-8 rounded object-cover" />
                    ) : (
                      <div className="w-8 h-8 rounded bg-secondary flex items-center justify-center">
                        <Music className="w-3 h-3 text-muted-foreground" />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="truncate font-medium text-xs">{t.title}</p>
                      <p className="truncate text-[11px] text-muted-foreground">{t.artist}</p>
                    </div>
                    <button onClick={() => removeTrack(idx)} className="text-muted-foreground hover:text-destructive transition-colors">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Recommendations */}
          <ScrollArea className="flex-1 min-h-0">
            {loading && recommendations.length === 0 && (
              <div className="flex flex-col items-center justify-center py-12 gap-3">
                <Loader2 className="w-8 h-8 animate-spin text-accent" />
                <p className="text-sm text-muted-foreground">Finding perfect tracks…</p>
              </div>
            )}

            {!loading && recommendations.length === 0 && selectedTracks.length === 0 && (
              <div className="flex flex-col items-center justify-center py-12 gap-3 text-center">
                <Music className="w-10 h-10 text-muted-foreground/40" />
                <div>
                  <p className="text-sm text-muted-foreground">Describe the playlist you want</p>
                  <p className="text-xs text-muted-foreground/70 mt-1">
                    e.g. "Indie rock road trip songs" or "Canciones para un domingo tranquilo"
                  </p>
                </div>
              </div>
            )}

            {recommendations.length > 0 && (
              <div className="space-y-2 pb-2">
                <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider mb-2">
                  Recommendations — tap + to add
                </p>
                {recommendations.map((rec, idx) => {
                  const info = getSpotifyInfo(rec);
                  return (
                    <div
                      key={`${rec.title}-${rec.artist}-${idx}`}
                      className="flex items-start gap-3 p-3 rounded-xl bg-surface-elevated border border-border/30 hover:border-border/60 transition-all group"
                    >
                      {info?.image_url ? (
                        <img src={info.image_url} alt="" className="w-12 h-12 rounded-lg object-cover flex-shrink-0" />
                      ) : (
                        <div className="w-12 h-12 rounded-lg bg-secondary flex items-center justify-center flex-shrink-0">
                          <Music className="w-5 h-5 text-muted-foreground" />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium truncate">{rec.title}</p>
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-accent/10 text-accent font-medium flex-shrink-0">
                            {rec.compatibility_score}%
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground truncate">
                          {rec.artist}{rec.album ? ` · ${rec.album}` : ""}{rec.year ? ` · ${rec.year}` : ""}
                        </p>
                        <p className="text-[11px] text-muted-foreground/80 mt-1 line-clamp-2 leading-relaxed">{rec.reason}</p>
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        {info?.preview_url && (
                          <AudioPreviewButton trackId={`rec-${idx}`} previewUrl={info.preview_url} size="sm" />
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 rounded-full text-accent hover:bg-accent/10"
                          onClick={() => addTrack(rec)}
                        >
                          <Plus className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  );
                })}

                {/* Get more button */}
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full mt-2 rounded-lg gap-1.5 text-xs"
                  onClick={fetchRecommendations}
                  disabled={loading}
                >
                  {loading ? (
                    <><Loader2 className="w-3 h-3 animate-spin" /> Loading…</>
                  ) : (
                    <><Sparkles className="w-3 h-3" /> Get more suggestions</>
                  )}
                </Button>
              </div>
            )}
          </ScrollArea>
        </div>

        <DialogFooter className="px-6 py-4 border-t border-border/50">
          <div className="flex items-center justify-between w-full">
            <p className="text-xs text-muted-foreground">
              {selectedTracks.length} song{selectedTracks.length !== 1 ? "s" : ""} selected
            </p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={resetAndClose}>Cancel</Button>
              <Button
                variant="hero"
                size="sm"
                className="gap-1.5"
                onClick={handleSave}
                disabled={saving || selectedTracks.length === 0}
              >
                {saving ? (
                  <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Saving…</>
                ) : (
                  <><Save className="w-3.5 h-3.5" /> Save Playlist</>
                )}
              </Button>
            </div>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
