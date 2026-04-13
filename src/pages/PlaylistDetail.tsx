import AppLayout from "@/components/app/AppLayout";
import { Button } from "@/components/ui/button";
import { useParams, Link } from "react-router-dom";
import { ArrowLeft, RefreshCw, Play, MoreHorizontal, Plus, X, Bookmark, Sparkles, Loader2, Gem, TrendingUp, Music, Trash2, Brain, Eye, EyeOff, Zap, Clock, Palette, Target, Shield, Lightbulb, MapPin } from "lucide-react";
import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { usePlaylistVibe, type PlaylistVibeAnalysis } from "@/hooks/use-playlist-vibe";
import { supabase } from "@/integrations/supabase/client";
import { useKnownTracks } from "@/hooks/use-known-tracks";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

interface PlaylistTrack {
  id: string;
  spotify_track_id: string;
  track_name: string;
  artist_name: string;
  album_name: string | null;
  image_url: string | null;
  position: number;
}

interface SpotifyPlaylistInfo {
  id: string;
  name: string;
  description: string | null;
  image_url: string | null;
  track_count: number;
}

interface VibeRecommendation {
  id: string;
  title: string;
  artist: string;
  album: string;
  matchScore: number;
  reason: string;
  moodTags: string[];
  insertAfterTrack: string | null;
  insertExplanation: string | null;
  popularityTier: "deep-cut" | "mid" | "well-known";
}

const tierConfig = {
  "deep-cut": { label: "Deep Cut", icon: Gem, className: "text-accent bg-accent/10" },
  "mid": { label: "Mid", icon: Music, className: "text-muted-foreground bg-secondary" },
  "well-known": { label: "Known", icon: TrendingUp, className: "text-warm bg-warm/10" },
};

/* ─── Playlist DNA Component ─── */
function PlaylistDNA({ vibe, analyzing, onAnalyze }: {
  vibe: PlaylistVibeAnalysis | null;
  analyzing: boolean;
  onAnalyze: () => void;
}) {
  const [expanded, setExpanded] = useState(false);

  if (!vibe && !analyzing) {
    return (
      <div className="rounded-2xl border border-border/50 bg-surface-elevated p-6 mb-8">
        <div className="flex items-center gap-3 mb-4">
          <Brain className="w-5 h-5 text-accent" />
          <h2 className="font-heading text-xl">AI Playlist Identity</h2>
        </div>
        <p className="text-sm text-muted-foreground mb-4">
          Let Tempo AI analyze the true vibe, mood, and identity of this playlist — going far beyond genre labels.
        </p>
        <Button variant="hero" className="rounded-xl gap-2" onClick={onAnalyze}>
          <Sparkles className="w-4 h-4" />
          Analyze Playlist DNA
        </Button>
      </div>
    );
  }

  if (analyzing) {
    return (
      <div className="rounded-2xl border border-border/50 bg-surface-elevated p-6 mb-8">
        <div className="flex items-center gap-3 mb-4">
          <Loader2 className="w-5 h-5 text-accent animate-spin" />
          <h2 className="font-heading text-xl">Analyzing Playlist DNA…</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          AI is deeply analyzing mood, atmosphere, production style, rhythm, and emotional arc…
        </p>
      </div>
    );
  }

  if (!vibe) return null;

  const vibeColor = vibe.vibe_color_hex || "#6366f1";

  return (
    <div className="rounded-2xl border border-border/50 overflow-hidden mb-8" style={{ borderTopColor: vibeColor, borderTopWidth: 3 }}>
      {/* Header */}
      <div className="p-6 bg-surface-elevated">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: vibeColor + "20" }}>
              <Brain className="w-5 h-5" style={{ color: vibeColor }} />
            </div>
            <div>
              <h2 className="font-heading text-xl">AI Playlist Identity</h2>
              <p className="text-xs text-muted-foreground">Deep vibe analysis by Tempo AI</p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" className="rounded-lg gap-1 text-xs" onClick={() => setExpanded(!expanded)}>
              {expanded ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              {expanded ? "Less" : "More"}
            </Button>
            <Button variant="ghost" size="sm" className="rounded-lg gap-1 text-xs text-accent" onClick={onAnalyze}>
              <RefreshCw className="w-3.5 h-3.5" />
              Re-analyze
            </Button>
          </div>
        </div>

        {/* Primary vibe */}
        <div className="mb-4">
          <span className="inline-block px-3 py-1.5 rounded-full text-sm font-medium" style={{ backgroundColor: vibeColor + "20", color: vibeColor }}>
            {vibe.primary_vibe}
          </span>
        </div>

        {/* Secondary vibes */}
        {vibe.secondary_vibes?.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-4">
            {vibe.secondary_vibes.map((v) => (
              <span key={v} className="px-2 py-0.5 rounded-full text-[11px] bg-secondary text-muted-foreground">{v}</span>
            ))}
          </div>
        )}

        {/* AI explanation */}
        <p className="text-sm text-foreground/80 leading-relaxed">{vibe.ai_explanation}</p>
      </div>

      {/* Expanded details */}
      {expanded && (
        <div className="border-t border-border/30 p-6 bg-card">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {vibe.mood_summary && (
              <VibeDetail icon={<Palette className="w-4 h-4" />} title="Mood & Emotion" content={vibe.mood_summary} />
            )}
            {vibe.energy_summary && (
              <VibeDetail icon={<Zap className="w-4 h-4" />} title="Energy Profile" content={vibe.energy_summary} />
            )}
            {vibe.tempo_summary && (
              <VibeDetail icon={<Clock className="w-4 h-4" />} title="Tempo & Rhythm" content={vibe.tempo_summary} />
            )}
            {vibe.production_summary && (
              <VibeDetail icon={<Music className="w-4 h-4" />} title="Production Style" content={vibe.production_summary} />
            )}
            {vibe.structural_flow && (
              <VibeDetail icon={<TrendingUp className="w-4 h-4" />} title="Structural Flow" content={vibe.structural_flow} />
            )}
            {vibe.listening_context && (
              <VibeDetail icon={<Target className="w-4 h-4" />} title="Listening Context" content={vibe.listening_context} />
            )}
            {vibe.cohesion_description && (
              <VibeDetail icon={<Shield className="w-4 h-4" />} title="What Makes It Cohesive" content={vibe.cohesion_description} />
            )}
            {vibe.what_belongs && (
              <VibeDetail icon={<Lightbulb className="w-4 h-4" />} title="What Belongs Here" content={vibe.what_belongs} />
            )}
            {vibe.what_breaks_it && (
              <VibeDetail icon={<X className="w-4 h-4" />} title="What Breaks The Vibe" content={vibe.what_breaks_it} color="text-destructive/70" />
            )}
            {vibe.era_summary && (
              <VibeDetail icon={<Clock className="w-4 h-4" />} title="Era" content={vibe.era_summary} />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function VibeDetail({ icon, title, content, color }: { icon: React.ReactNode; title: string; content: string; color?: string }) {
  return (
    <div>
      <div className={`flex items-center gap-2 mb-1.5 ${color || "text-accent"}`}>
        {icon}
        <span className="text-xs font-medium uppercase tracking-wider">{title}</span>
      </div>
      <p className="text-sm text-foreground/70 leading-relaxed">{content}</p>
    </div>
  );
}

/* ─── Main Page ─── */
const PlaylistDetail = () => {
  const { id } = useParams();
  const { user } = useAuth();
  const { knownTrackIds, isKnown } = useKnownTracks();

  // Playlist data from DB
  const [playlist, setPlaylist] = useState<SpotifyPlaylistInfo | null>(null);
  const [tracks, setTracks] = useState<PlaylistTrack[]>([]);
  const [loadingPlaylist, setLoadingPlaylist] = useState(true);

  // Vibe intelligence
  const { vibe, loading: vibeLoading, analyzing, analyze } = usePlaylistVibe(id);

  // Recommendations
  const [recs, setRecs] = useState<VibeRecommendation[]>([]);
  const [recsLoading, setRecsLoading] = useState(false);
  const [recsLoaded, setRecsLoaded] = useState(false);
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [expandedRecId, setExpandedRecId] = useState<string | null>(null);

  // Load playlist + tracks
  useEffect(() => {
    if (!id || !user) return;
    setLoadingPlaylist(true);
    Promise.all([
      supabase.from("spotify_playlists").select("id, name, description, image_url, track_count").eq("id", id).single(),
      supabase.from("spotify_playlist_tracks").select("id, spotify_track_id, track_name, artist_name, album_name, image_url, position").eq("playlist_id", id).eq("user_id", user.id).order("position"),
    ]).then(([plRes, trRes]) => {
      if (plRes.data) setPlaylist(plRes.data as SpotifyPlaylistInfo);
      setTracks((trRes.data as PlaylistTrack[]) || []);
      setLoadingPlaylist(false);
    });
  }, [id, user]);

  // Generate vibe-aware recommendations
  const generateRecs = useCallback(async () => {
    if (!playlist || tracks.length === 0) return;
    setRecsLoading(true);
    try {
      const knownSongs = Array.from(knownTrackIds).slice(0, 500);
      const { data, error } = await supabase.functions.invoke("recommend-songs", {
        body: {
          playlistName: playlist.name,
          playlistMood: vibe?.primary_vibe || "mixed",
          playlistDescription: vibe?.ai_explanation || playlist.description || "",
          tracks: tracks.slice(0, 50).map(t => ({
            title: t.track_name,
            artist: t.artist_name,
            genre: "",
            mood: vibe?.primary_vibe || "",
            tempo: 0,
            energy: 0,
            valence: 0,
            acousticness: 0,
            danceability: 0,
            year: 0,
          })),
          discoveryMode: "balanced",
          existingLibrary: knownSongs.map(id => ({ spotifyId: id })),
          vibeContext: vibe ? {
            primaryVibe: vibe.primary_vibe,
            secondaryVibes: vibe.secondary_vibes,
            whatBelongs: vibe.what_belongs,
            whatBreaksIt: vibe.what_breaks_it,
            listeningContext: vibe.listening_context,
          } : null,
          count: 8,
        },
      });
      if (error) throw new Error(error.message);
      const recommendations: VibeRecommendation[] = (data?.recommendations || []).map((r: any, i: number) => ({
        id: `vibe-rec-${i}-${Date.now()}`,
        title: r.title,
        artist: r.artist,
        album: r.album || "Unknown",
        matchScore: r.matchScore || 80,
        reason: r.reason || "Fits the playlist vibe",
        moodTags: r.moodTags || [],
        insertAfterTrack: r.insertAfterTrack || null,
        insertExplanation: r.insertExplanation || null,
        popularityTier: r.popularityTier || "mid",
      }));
      // Filter out known tracks
      const filtered = recommendations.filter(r => !isKnown(r.title, r.artist));
      setRecs(filtered);
      setRecsLoaded(true);
    } catch (err: any) {
      console.error("Rec error:", err);
      toast.error("Failed to generate recommendations", { description: err.message });
    } finally {
      setRecsLoading(false);
    }
  }, [playlist, tracks, vibe, knownTrackIds, isKnown]);

  const handleAnalyze = () => {
    if (!playlist) return;
    analyze(playlist.name, tracks.map(t => ({
      track_name: t.track_name,
      artist_name: t.artist_name,
      album_name: t.album_name || undefined,
    })));
  };

  const visibleRecs = recs.filter(r => !dismissedIds.has(r.id));

  if (loadingPlaylist) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-6 h-6 animate-spin text-accent" />
        </div>
      </AppLayout>
    );
  }

  if (!playlist) {
    return (
      <AppLayout>
        <div className="text-center py-20">
          <p className="text-muted-foreground">Playlist not found.</p>
          <Link to="/playlists" className="text-accent hover:underline mt-2 block text-sm">Back to playlists</Link>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="max-w-4xl">
        <Link to="/playlists" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-6 transition-colors">
          <ArrowLeft className="w-4 h-4" />
          Back to playlists
        </Link>

        {/* Playlist header */}
        <div className="flex gap-6 mb-8">
          {playlist.image_url ? (
            <img src={playlist.image_url} alt={playlist.name} className="w-32 h-32 rounded-2xl object-cover flex-shrink-0" />
          ) : (
            <div className="w-32 h-32 rounded-2xl bg-secondary flex items-center justify-center text-5xl flex-shrink-0">🎵</div>
          )}
          <div className="flex-1">
            <h1 className="font-heading text-4xl mb-1">{playlist.name}</h1>
            {playlist.description && (
              <p className="text-muted-foreground text-sm mb-3">{playlist.description}</p>
            )}
            <div className="flex items-center gap-4 text-sm text-muted-foreground mb-4">
              <span>{tracks.length} tracks</span>
              {vibe && (
                <span className="text-accent font-medium">{vibe.primary_vibe}</span>
              )}
            </div>
            <div className="flex gap-3 flex-wrap">
              <Button variant="hero" className="rounded-xl gap-2" onClick={generateRecs} disabled={recsLoading || tracks.length === 0}>
                {recsLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                {recsLoading ? "Finding songs…" : "Get Recommendations"}
              </Button>
            </div>
          </div>
        </div>

        {/* AI Playlist Identity / DNA */}
        <PlaylistDNA vibe={vibe} analyzing={analyzing} onAnalyze={handleAnalyze} />

        {/* Track list */}
        <div className="rounded-2xl border border-border/50 overflow-hidden mb-8">
          <div className="grid grid-cols-[40px_1fr_1fr_40px] gap-4 px-5 py-3 text-xs text-muted-foreground border-b border-border/50 bg-secondary/30">
            <span>#</span>
            <span>Title</span>
            <span>Album</span>
            <span />
          </div>
          {tracks.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-sm text-muted-foreground">No tracks imported yet. Re-sync your library to load tracks.</p>
            </div>
          ) : (
            tracks.map((track, i) => (
              <div key={track.id} className="group grid grid-cols-[40px_1fr_1fr_40px] gap-4 px-5 py-3 items-center hover:bg-secondary/30 transition-colors">
                <span className="text-sm text-muted-foreground">{i + 1}</span>
                <div className="flex items-center gap-3 min-w-0">
                  {track.image_url && (
                    <img src={track.image_url} alt="" className="w-8 h-8 rounded flex-shrink-0" />
                  )}
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{track.track_name}</p>
                    <p className="text-xs text-muted-foreground truncate">{track.artist_name}</p>
                  </div>
                </div>
                <p className="text-sm text-muted-foreground truncate">{track.album_name || "—"}</p>
                <div />
              </div>
            ))
          )}
        </div>

        {/* AI Suggested Additions */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-accent" />
              <h2 className="font-heading text-2xl">Suggested Additions</h2>
              {!recsLoading && visibleRecs.length > 0 && (
                <span className="text-xs text-muted-foreground ml-1">({visibleRecs.length} songs)</span>
              )}
            </div>
            <Button variant="ghost" size="sm" className="rounded-lg gap-1 text-accent" onClick={generateRecs} disabled={recsLoading}>
              <RefreshCw className={`w-3.5 h-3.5 ${recsLoading ? "animate-spin" : ""}`} />
              {recsLoading ? "Generating…" : "Refresh"}
            </Button>
          </div>

          {recsLoading ? (
            <div className="flex flex-col items-center justify-center py-12 gap-3">
              <Loader2 className="w-6 h-6 animate-spin text-accent" />
              <p className="text-sm text-muted-foreground">AI is analyzing vibe compatibility and finding perfect matches…</p>
            </div>
          ) : visibleRecs.length > 0 ? (
            <>
              <p className="text-sm text-muted-foreground mb-4">
                Curated by AI based on playlist vibe, mood, energy, and flow — not just genre or popularity.
              </p>
              <div className="space-y-3">
                {visibleRecs.map((rec) => {
                  const tier = tierConfig[rec.popularityTier || "mid"];
                  const TierIcon = tier.icon;
                  const isExpanded = expandedRecId === rec.id;

                  return (
                    <div key={rec.id} className="rounded-2xl bg-surface-elevated border border-border/50 hover:border-accent/30 hover:shadow-sm transition-all overflow-hidden">
                      <div className="group flex items-center gap-4 p-4">
                        <div className="w-10 h-10 rounded-xl bg-secondary flex items-center justify-center text-base flex-shrink-0">🎵</div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-0.5">
                            <p className="text-sm font-medium truncate">{rec.title}</p>
                            <span className="text-xs font-medium text-accent">{rec.matchScore}%</span>
                            <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${tier.className}`}>
                              <TierIcon className="w-2.5 h-2.5" />
                              {tier.label}
                            </span>
                          </div>
                          <p className="text-xs text-muted-foreground">{rec.artist} · {rec.album}</p>
                          <p className="text-xs text-muted-foreground mt-1">{rec.reason}</p>
                          {rec.insertExplanation && (
                            <button onClick={() => setExpandedRecId(isExpanded ? null : rec.id)} className="text-[10px] text-accent hover:underline mt-1 flex items-center gap-1">
                              <MapPin className="w-2.5 h-2.5" />
                              {isExpanded ? "Hide placement" : "View suggested placement"}
                            </button>
                          )}
                        </div>
                        <div className="flex flex-col items-end gap-1.5">
                          <div className="flex gap-1 flex-wrap justify-end">
                            {rec.moodTags.map((tag) => (
                              <span key={tag} className="px-2 py-0.5 rounded-full text-[10px] bg-secondary text-muted-foreground">{tag}</span>
                            ))}
                          </div>
                        </div>
                        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                          <Button variant="ghost" size="icon" className="w-8 h-8 rounded-lg text-accent hover:text-accent" title="Add to playlist" onClick={() => toast.success(`"${rec.title}" would be added`)}>
                            <Plus className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className={`w-8 h-8 rounded-lg ${savedIds.has(rec.id) ? "text-warm" : ""}`}
                            title="Save for later"
                            onClick={() => {
                              setSavedIds(prev => {
                                const next = new Set(prev);
                                next.has(rec.id) ? next.delete(rec.id) : next.add(rec.id);
                                return next;
                              });
                            }}
                          >
                            <Bookmark className={`w-4 h-4 ${savedIds.has(rec.id) ? "fill-current" : ""}`} />
                          </Button>
                          <Button variant="ghost" size="icon" className="w-8 h-8 rounded-lg text-muted-foreground" title="Dismiss" onClick={() => setDismissedIds(prev => new Set(prev).add(rec.id))}>
                            <X className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>

                      {/* Insertion point detail */}
                      {isExpanded && rec.insertExplanation && (
                        <div className="px-4 pb-4 pt-0 border-t border-border/30">
                          <div className="pt-3 flex items-start gap-2">
                            <MapPin className="w-4 h-4 text-accent flex-shrink-0 mt-0.5" />
                            <div>
                              {rec.insertAfterTrack && (
                                <p className="text-xs font-medium mb-0.5">Suggested position: after "{rec.insertAfterTrack}"</p>
                              )}
                              <p className="text-xs text-muted-foreground">{rec.insertExplanation}</p>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          ) : recsLoaded ? (
            <div className="text-center py-12">
              <p className="text-sm text-muted-foreground mb-3">All suggestions reviewed! Want more?</p>
              <Button variant="secondary" className="rounded-xl gap-2" onClick={generateRecs}>
                <Sparkles className="w-4 h-4" />
                Generate More
              </Button>
            </div>
          ) : tracks.length > 0 ? (
            <div className="text-center py-12 rounded-2xl border border-dashed border-border/50">
              <Sparkles className="w-8 h-8 text-muted-foreground/40 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground mb-3">Click "Get Recommendations" above to find songs that match this playlist's vibe.</p>
            </div>
          ) : null}
        </div>
      </div>
    </AppLayout>
  );
};

export default PlaylistDetail;
