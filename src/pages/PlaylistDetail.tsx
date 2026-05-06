import AppLayout from "@/components/app/AppLayout";
import { Button } from "@/components/ui/button";
import { useParams, Link } from "react-router-dom";
import { ArrowLeft, RefreshCw, Plus, X, Bookmark, Sparkles, Loader2, Gem, TrendingUp, Music, Brain, Eye, EyeOff, Zap, Clock, Palette, Target, Shield, Lightbulb, MapPin, Mic2, Radio, Layers, Star, ChevronDown, ChevronUp, Edit3, Upload, ExternalLink, Users, Lock, Trash2, GripVertical } from "lucide-react";
import { useState, useEffect, useCallback, useRef } from "react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { usePlaylistVibe, type PlaylistVibeAnalysis, type EmotionalArcSegment, type SonicDna, type TrackHighlight } from "@/hooks/use-playlist-vibe";
import { supabase } from "@/integrations/supabase/client";
import { useKnownTracks } from "@/hooks/use-known-tracks";
import { useSpotifySearch, type SpotifyTrackInfo } from "@/hooks/use-spotify-search";
import { AudioPreviewButton } from "@/components/app/AudioPreviewButton";

interface PlaylistTrack {
  id: string;
  spotify_track_id: string;
  track_name: string;
  artist_name: string;
  album_name: string | null;
  image_url: string | null;
  duration_ms: number | null;
  preview_url: string | null;
  position: number;
}

interface SpotifyPlaylistInfo {
  id: string;
  spotify_playlist_id: string;
  name: string;
  description: string | null;
  image_url: string | null;
  track_count: number;
  spotify_total_tracks: number;
  tracks_import_status: string | null;
  tracks_import_error: string | null;
  is_owned_by_user: boolean;
  is_collaborative: boolean;
  owner_display_name: string | null;
  spotify_owner_id: string | null;
}

interface VibeRecommendation {
  id: string;
  title: string;
  artist: string;
  album: string;
  matchScore: number;
  reason: string;
  aiExplanation: string | null;
  moodTags: string[];
  insertAfterTrack: string | null;
  insertExplanation: string | null;
  sonicConnection: string | null;
  popularityTier: "deep-cut" | "mid" | "well-known";
  compatibilityBreakdown: Record<string, number> | null;
}

const tierConfig = {
  "deep-cut": { label: "Deep Cut", icon: Gem, className: "text-accent bg-accent/10" },
  "mid": { label: "Mid", icon: Music, className: "text-muted-foreground bg-secondary" },
  "well-known": { label: "Known", icon: TrendingUp, className: "text-warm bg-warm/10" },
};

/* ─── Emotional Arc Visualization ─── */
function EmotionalArc({ arc, color }: { arc: EmotionalArcSegment[]; color: string }) {
  if (!arc?.length) return null;
  const maxEnergy = Math.max(...arc.map(a => a.energy), 100);

  return (
    <div className="mt-6">
      <div className="flex items-center gap-2 mb-3">
        <TrendingUp className="w-4 h-4" style={{ color }} />
        <span className="text-xs font-semibold uppercase tracking-wider" style={{ color }}>Emotional Arc</span>
      </div>
      <div className="flex items-end gap-1 h-24 mb-2">
        {arc.map((seg, i) => {
          const height = (seg.energy / maxEnergy) * 100;
          return (
            <div key={seg.segment} className="flex-1 flex flex-col items-center gap-1">
              <div
                className="w-full rounded-t-lg transition-all relative group cursor-default"
                style={{
                  height: `${height}%`,
                  backgroundColor: color + "30",
                  borderLeft: `2px solid ${color}`,
                  borderTop: `2px solid ${color}`,
                  borderRight: `2px solid ${color}`,
                }}
              >
                <span className="absolute -top-5 left-1/2 -translate-x-1/2 text-[10px] font-bold" style={{ color }}>{seg.energy}</span>
                <div className="absolute bottom-full mb-6 left-1/2 -translate-x-1/2 w-48 p-2 rounded-lg bg-popover border border-border shadow-lg text-xs opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
                  <p className="font-medium mb-0.5" style={{ color }}>{seg.mood}</p>
                  <p className="text-muted-foreground">{seg.description}</p>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex gap-1">
        {arc.map(seg => (
          <div key={seg.segment} className="flex-1 text-center">
            <p className="text-[10px] text-muted-foreground capitalize">{seg.segment}</p>
            <p className="text-[9px] text-muted-foreground/70 truncate">{seg.mood}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─── Sonic DNA Panel ─── */
function SonicDnaPanel({ dna, color }: { dna: SonicDna; color: string }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Radio className="w-4 h-4" style={{ color }} />
        <span className="text-xs font-semibold uppercase tracking-wider" style={{ color }}>Sonic DNA</span>
      </div>
      <div className="grid grid-cols-1 gap-3">
        {dna.key_instruments?.length > 0 && (
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Key Instruments</p>
            <div className="flex flex-wrap gap-1">
              {dna.key_instruments.map(inst => (
                <span key={inst} className="px-2 py-0.5 rounded-full text-[11px] border border-border/50" style={{ color: color + "cc" }}>{inst}</span>
              ))}
            </div>
          </div>
        )}
        {dna.vocal_character && (
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Vocal Character</p>
            <p className="text-sm text-foreground/80">{dna.vocal_character}</p>
          </div>
        )}
        {dna.production_school && (
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Production School</p>
            <p className="text-sm text-foreground/80">{dna.production_school}</p>
          </div>
        )}
        {dna.spatial_quality && (
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Spatial Quality</p>
            <p className="text-sm text-foreground/80">{dna.spatial_quality}</p>
          </div>
        )}
        {dna.rhythmic_identity && (
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Rhythmic Identity</p>
            <p className="text-sm text-foreground/80">{dna.rhythmic_identity}</p>
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Genre Blend Bar ─── */
function GenreBlend({ blend, color }: { blend: Record<string, number>; color: string }) {
  const entries = Object.entries(blend).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) return null;
  const total = entries.reduce((s, [, v]) => s + v, 0);

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <Layers className="w-4 h-4" style={{ color }} />
        <span className="text-xs font-semibold uppercase tracking-wider" style={{ color }}>Genre DNA</span>
      </div>
      <div className="flex rounded-full h-3 overflow-hidden mb-2">
        {entries.map(([genre, pct], i) => (
          <div
            key={genre}
            className="h-full first:rounded-l-full last:rounded-r-full"
            style={{
              width: `${(pct / total) * 100}%`,
              backgroundColor: color,
              opacity: 1 - (i * 0.15),
            }}
            title={`${genre}: ${pct}%`}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {entries.map(([genre, pct], i) => (
          <span key={genre} className="text-[11px] text-muted-foreground">
            <span className="inline-block w-2 h-2 rounded-full mr-1" style={{ backgroundColor: color, opacity: 1 - (i * 0.15) }} />
            {genre} {pct}%
          </span>
        ))}
      </div>
    </div>
  );
}

/* ─── Track Highlights ─── */
function TrackHighlights({ highlights, color }: { highlights: TrackHighlight[]; color: string }) {
  if (!highlights?.length) return null;
  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <Star className="w-4 h-4" style={{ color }} />
        <span className="text-xs font-semibold uppercase tracking-wider" style={{ color }}>Identity Pillars</span>
      </div>
      <div className="space-y-2">
        {highlights.map((h, i) => (
          <div key={i} className="rounded-xl bg-card/50 border border-border/30 p-3">
            <div className="flex items-center gap-2 mb-1">
              <p className="text-sm font-medium">{h.track_name}</p>
              <span className="text-[10px] px-2 py-0.5 rounded-full font-medium" style={{ backgroundColor: color + "20", color }}>{h.role}</span>
            </div>
            <p className="text-xs text-muted-foreground">{h.artist_name}</p>
            <p className="text-xs text-foreground/70 mt-1">{h.why}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─── Playlist Identity Panel ─── */
function PlaylistIdentity({ vibe, analyzing, onAnalyze }: {
  vibe: PlaylistVibeAnalysis | null;
  analyzing: boolean;
  onAnalyze: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [tab, setTab] = useState<"overview" | "sonic" | "flow">("overview");

  if (!vibe && !analyzing) {
    return (
      <div className="rounded-2xl border border-border/50 bg-surface-elevated p-8 mb-8">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-12 h-12 rounded-2xl bg-accent/10 flex items-center justify-center">
            <Brain className="w-6 h-6 text-accent" />
          </div>
          <div>
            <h2 className="font-heading text-xl">Playlist Identity Engine</h2>
            <p className="text-xs text-muted-foreground">Deep musical intelligence by Tempo AI</p>
          </div>
        </div>
        <p className="text-sm text-muted-foreground mb-6 max-w-lg">
          Decode the true identity of this playlist — emotional arc, sonic DNA, production fingerprint, and the invisible thread connecting every track.
        </p>
        <Button variant="hero" className="rounded-xl gap-2" onClick={onAnalyze}>
          <Sparkles className="w-4 h-4" />
          Analyze Playlist Identity
        </Button>
      </div>
    );
  }

  if (analyzing) {
    return (
      <div className="rounded-2xl border border-border/50 bg-surface-elevated p-8 mb-8">
        <div className="flex items-center gap-3 mb-4">
          <Loader2 className="w-6 h-6 text-accent animate-spin" />
          <div>
            <h2 className="font-heading text-xl">Decoding Playlist Identity…</h2>
            <p className="text-xs text-muted-foreground">Analyzing emotional arc, sonic DNA, production fingerprint, and flow intelligence</p>
          </div>
        </div>
        <div className="flex gap-2 flex-wrap mt-4">
          {["Mapping emotional arc", "Analyzing production DNA", "Identifying sonic palette", "Building genre blend", "Finding identity pillars"].map(step => (
            <span key={step} className="text-[11px] px-3 py-1 rounded-full bg-secondary text-muted-foreground animate-pulse">{step}</span>
          ))}
        </div>
      </div>
    );
  }

  if (!vibe) return null;

  const vibeColor = vibe.vibe_color_hex || "#6366f1";

  return (
    <div className="rounded-2xl border border-border/50 overflow-hidden mb-8" style={{ borderTopColor: vibeColor, borderTopWidth: 3 }}>
      {/* Header */}
      <div className="p-6 bg-surface-elevated">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl flex items-center justify-center" style={{ backgroundColor: vibeColor + "20" }}>
              <Brain className="w-6 h-6" style={{ color: vibeColor }} />
            </div>
            <div>
              <h2 className="font-heading text-xl">Playlist Identity</h2>
              <p className="text-[11px] text-muted-foreground">Deep analysis by Tempo AI</p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" className="rounded-lg gap-1 text-xs" onClick={() => setExpanded(!expanded)}>
              {expanded ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              {expanded ? "Collapse" : "Deep Dive"}
            </Button>
            <Button variant="ghost" size="sm" className="rounded-lg gap-1 text-xs text-accent" onClick={onAnalyze}>
              <RefreshCw className="w-3.5 h-3.5" />
              Re-analyze
            </Button>
          </div>
        </div>

        {/* Primary identity */}
        <div className="mb-4">
          <span className="inline-block px-4 py-2 rounded-xl text-sm font-semibold" style={{ backgroundColor: vibeColor + "20", color: vibeColor }}>
            {vibe.primary_vibe}
          </span>
        </div>

        {/* Secondary + emotional keywords */}
        <div className="flex flex-wrap gap-1.5 mb-4">
          {vibe.secondary_vibes?.map((v) => (
            <span key={v} className="px-2 py-0.5 rounded-full text-[11px] bg-secondary text-muted-foreground">{v}</span>
          ))}
        </div>

        {vibe.emotional_keywords?.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-4">
            {vibe.emotional_keywords.map(kw => (
              <span key={kw} className="px-2 py-0.5 rounded-full text-[11px] font-medium border" style={{ borderColor: vibeColor + "40", color: vibeColor }}>{kw}</span>
            ))}
          </div>
        )}

        {/* Sonic palette chips */}
        {vibe.sonic_palette?.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-4">
            {vibe.sonic_palette.map(sp => (
              <span key={sp} className="px-2 py-0.5 rounded-full text-[10px] bg-card text-muted-foreground/80 border border-border/30">{sp}</span>
            ))}
          </div>
        )}

        {/* AI explanation */}
        <p className="text-sm text-foreground/80 leading-relaxed">{vibe.ai_explanation}</p>

        {/* Emotional Arc (always visible) */}
        <EmotionalArc arc={vibe.emotional_arc} color={vibeColor} />

        {/* Genre Blend (always visible) */}
        {vibe.genre_blend && Object.keys(vibe.genre_blend).length > 0 && (
          <div className="mt-6">
            <GenreBlend blend={vibe.genre_blend} color={vibeColor} />
          </div>
        )}
      </div>

      {/* Expanded deep dive */}
      {expanded && (
        <div className="border-t border-border/30">
          {/* Tab navigation */}
          <div className="flex border-b border-border/30 bg-card/50">
            {[
              { key: "overview" as const, label: "Overview", icon: Palette },
              { key: "sonic" as const, label: "Sonic DNA", icon: Radio },
              { key: "flow" as const, label: "Flow & Identity", icon: TrendingUp },
            ].map(t => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`flex items-center gap-1.5 px-5 py-3 text-xs font-medium transition-colors border-b-2 ${
                  tab === t.key ? "border-accent text-accent" : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                <t.icon className="w-3.5 h-3.5" />
                {t.label}
              </button>
            ))}
          </div>

          <div className="p-6 bg-card">
            {tab === "overview" && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {vibe.mood_summary && <VibeDetail icon={<Palette className="w-4 h-4" />} title="Emotional Landscape" content={vibe.mood_summary} color={vibeColor} />}
                {vibe.energy_summary && <VibeDetail icon={<Zap className="w-4 h-4" />} title="Energy Profile" content={vibe.energy_summary} color={vibeColor} />}
                {vibe.tempo_summary && <VibeDetail icon={<Clock className="w-4 h-4" />} title="Rhythm & Pulse" content={vibe.tempo_summary} color={vibeColor} />}
                {vibe.production_summary && <VibeDetail icon={<Music className="w-4 h-4" />} title="Production Signature" content={vibe.production_summary} color={vibeColor} />}
                {vibe.listening_context && <VibeDetail icon={<Target className="w-4 h-4" />} title="Listening Context" content={vibe.listening_context} color={vibeColor} />}
                {vibe.era_summary && <VibeDetail icon={<Clock className="w-4 h-4" />} title="Era & Time" content={vibe.era_summary} color={vibeColor} />}
              </div>
            )}

            {tab === "sonic" && (
              <div className="space-y-8">
                {vibe.sonic_dna && <SonicDnaPanel dna={vibe.sonic_dna} color={vibeColor} />}
                <TrackHighlights highlights={vibe.track_highlights} color={vibeColor} />
              </div>
            )}

            {tab === "flow" && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {vibe.structural_flow && <VibeDetail icon={<TrendingUp className="w-4 h-4" />} title="Structural Flow" content={vibe.structural_flow} color={vibeColor} />}
                {vibe.user_intent && <VibeDetail icon={<Target className="w-4 h-4" />} title="Curator's Intent" content={vibe.user_intent} color={vibeColor} />}
                {vibe.cohesion_description && <VibeDetail icon={<Shield className="w-4 h-4" />} title="Cohesion Thread" content={vibe.cohesion_description} color={vibeColor} />}
                {vibe.what_belongs && <VibeDetail icon={<Lightbulb className="w-4 h-4" />} title="What Belongs" content={vibe.what_belongs} color={vibeColor} />}
                {vibe.what_breaks_it && <VibeDetail icon={<X className="w-4 h-4" />} title="What Breaks It" content={vibe.what_breaks_it} accent="destructive" color={vibeColor} />}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function VibeDetail({ icon, title, content, color, accent }: { icon: React.ReactNode; title: string; content: string; color: string; accent?: string }) {
  const textColor = accent === "destructive" ? "hsl(var(--destructive))" : color;
  return (
    <div>
      <div className="flex items-center gap-2 mb-1.5" style={{ color: textColor }}>
        {icon}
        <span className="text-xs font-semibold uppercase tracking-wider">{title}</span>
      </div>
      <p className="text-sm text-foreground/70 leading-relaxed">{content}</p>
    </div>
  );
}

/* ─── Compatibility Breakdown Mini Chart ─── */
function CompatibilityBreakdown({ breakdown, color }: { breakdown: Record<string, number>; color: string }) {
  const entries = Object.entries(breakdown).slice(0, 6);
  if (entries.length === 0) return null;
  return (
    <div className="grid grid-cols-3 gap-x-4 gap-y-1 mt-2">
      {entries.map(([key, val]) => (
        <div key={key} className="flex items-center gap-1.5">
          <div className="flex-1 h-1 rounded-full bg-secondary overflow-hidden">
            <div className="h-full rounded-full" style={{ width: `${val}%`, backgroundColor: color }} />
          </div>
          <span className="text-[9px] text-muted-foreground w-14 truncate capitalize">{key}</span>
          <span className="text-[9px] font-medium" style={{ color }}>{val}</span>
        </div>
      ))}
    </div>
  );
}

/* ─── Ownership Badge ─── */
function OwnershipBadge({ playlist }: { playlist: SpotifyPlaylistInfo }) {
  if (playlist.is_owned_by_user) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-accent/15 text-accent">
        <Edit3 className="w-3 h-3" /> Your playlist
      </span>
    );
  }
  if (playlist.is_collaborative) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-primary/15 text-primary">
        <Users className="w-3 h-3" /> Collaborative
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-secondary text-muted-foreground">
      <Lock className="w-3 h-3" /> Saved · by {playlist.owner_display_name || "Unknown"}
    </span>
  );
}

/* ─── Main Page ─── */
const PlaylistDetail = () => {
  const { id } = useParams();
  const { user } = useAuth();
  const { knownTrackIds, isKnown } = useKnownTracks();
  const { enrich } = useSpotifySearch();

  const [playlist, setPlaylist] = useState<SpotifyPlaylistInfo | null>(null);
  const [tracks, setTracks] = useState<PlaylistTrack[]>([]);
  const [loadingPlaylist, setLoadingPlaylist] = useState(true);
  const [recoveringTracks, setRecoveringTracks] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editedName, setEditedName] = useState("");
  const [exporting, setExporting] = useState(false);
  const attemptedTrackRecoveryRef = useRef<string | null>(null);

  const { vibe, loading: vibeLoading, analyzing, analyze } = usePlaylistVibe(id);

  const [recs, setRecs] = useState<VibeRecommendation[]>([]);
  const [recsLoading, setRecsLoading] = useState(false);
  const [recsLoaded, setRecsLoaded] = useState(false);
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [recSpotifyData, setRecSpotifyData] = useState<Map<string, SpotifyTrackInfo>>(new Map());
  const [expandedRecId, setExpandedRecId] = useState<string | null>(null);
  const [explainedRecId, setExplainedRecId] = useState<string | null>(null);

  const canEdit = playlist?.is_owned_by_user || playlist?.is_collaborative;

  const loadPlaylistData = useCallback(async () => {
    if (!id || !user) return null;

    setLoadingPlaylist(true);
    try {
      // Load playlist metadata
      const plRes = await supabase
        .from("spotify_playlists")
        .select("id, spotify_playlist_id, name, description, image_url, track_count, spotify_total_tracks, tracks_import_status, tracks_import_error, is_owned_by_user, is_collaborative, owner_display_name, spotify_owner_id")
        .eq("id", id)
        .single();

      if (plRes.error) throw plRes.error;

      const playlistData = (plRes.data as SpotifyPlaylistInfo | null) ?? null;

      // Load ALL tracks with pagination (bypassing 1000-row limit)
      const PAGE = 1000;
      let offset = 0;
      const allTracks: PlaylistTrack[] = [];
      while (true) {
        const { data, error } = await supabase
          .from("spotify_playlist_tracks")
          .select("id, spotify_track_id, track_name, artist_name, album_name, image_url, duration_ms, preview_url, position")
          .eq("playlist_id", id)
          .eq("user_id", user.id)
          .order("position")
          .range(offset, offset + PAGE - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;
        allTracks.push(...(data as PlaylistTrack[]));
        if (data.length < PAGE) break;
        offset += PAGE;
      }

      setPlaylist(playlistData);
      setEditedName(playlistData?.name ?? "");
      setTracks(allTracks);

      return { playlist: playlistData, tracks: allTracks };
    } catch (error) {
      console.error("[PlaylistDetail] Failed to load playlist details", error);
      toast.error("Failed to load playlist details");
      return null;
    } finally {
      setLoadingPlaylist(false);
    }
  }, [id, user]);

  const repairMissingTracks = useCallback(async (silent = false) => {
    if (!id || !playlist) return false;

    setRecoveringTracks(true);
    try {
      // Targeted single-playlist sync — fast, avoids timeout
      const { data, error } = await supabase.functions.invoke("spotify-import-tracks", {
        body: { playlist_id: id },
      });

      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);

      const refreshed = await loadPlaylistData();
      const recoveredCount = refreshed?.tracks.length ?? 0;

      if (recoveredCount > 0) {
        if (!silent) toast.success(`Loaded ${recoveredCount} tracks`);
        return true;
      }

      if (!silent) {
        toast.error("Playlist tracks are still missing. Reconnect Spotify and sync again from Library.");
      }
      return false;
    } catch (error) {
      console.error("[PlaylistDetail] Failed to refresh playlist tracks", error);
      if (!silent) toast.error("Failed to refresh playlist tracks");
      return false;
    } finally {
      setRecoveringTracks(false);
    }
  }, [id, playlist, loadPlaylistData]);

  useEffect(() => {
    if (!id || !user) return;

    let cancelled = false;

    const bootstrap = async () => {
      const loaded = await loadPlaylistData();
      if (cancelled || !loaded?.playlist) return;

      const expected = loaded.playlist.spotify_total_tracks || loaded.playlist.track_count || 0;
      if (
        expected > 0 &&
        loaded.tracks.length === 0 &&
        loaded.playlist.tracks_import_status !== "failed" &&
        attemptedTrackRecoveryRef.current !== id
      ) {
        attemptedTrackRecoveryRef.current = id;
        await repairMissingTracks(true);
      }
    };

    void bootstrap();

    return () => {
      cancelled = true;
    };
  }, [id, user, loadPlaylistData, repairMissingTracks]);

  const handleRemoveTrack = useCallback(async (trackId: string) => {
    if (!canEdit || !user) return;
    const trackToRemove = tracks.find(t => t.id === trackId);
    if (!trackToRemove) return;
    
    setTracks(prev => prev.filter(t => t.id !== trackId));
    const { error } = await supabase.from("spotify_playlist_tracks").delete().eq("id", trackId);
    if (error) {
      toast.error("Failed to remove track");
      // Re-add
      setTracks(prev => [...prev, trackToRemove].sort((a, b) => a.position - b.position));
    }
  }, [canEdit, user, tracks]);

  const handleMoveTrack = useCallback(async (trackId: string, direction: "up" | "down") => {
    if (!canEdit) return;
    const idx = tracks.findIndex(t => t.id === trackId);
    if (idx < 0) return;
    const swapIdx = direction === "up" ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= tracks.length) return;

    const newTracks = [...tracks];
    [newTracks[idx], newTracks[swapIdx]] = [newTracks[swapIdx], newTracks[idx]];
    newTracks.forEach((t, i) => t.position = i);
    setTracks(newTracks);

    // Persist positions
    await Promise.all([
      supabase.from("spotify_playlist_tracks").update({ position: newTracks[idx].position }).eq("id", newTracks[idx].id),
      supabase.from("spotify_playlist_tracks").update({ position: newTracks[swapIdx].position }).eq("id", newTracks[swapIdx].id),
    ]);
  }, [canEdit, tracks]);

  const handleExportToSpotify = useCallback(async () => {
    if (!playlist || !canEdit || tracks.length === 0) return;
    setExporting(true);
    try {
      // Use the spotify-export-playlist edge function but adapted for spotify playlists
      const trackIds = tracks.map(t => t.spotify_track_id).filter(Boolean);
      
      const { data: conn } = await supabase
        .from("spotify_connections")
        .select("access_token, refresh_token, expires_at, spotify_user_id")
        .eq("user_id", user!.id)
        .single();
      
      if (!conn) throw new Error("Spotify not connected");

      // Call the export function
      const { data, error } = await supabase.functions.invoke("spotify-export-playlist", {
        body: {
          cluster_id: playlist.id, // reuse as identifier
          name: editedName || playlist.name,
          description: playlist.description || "",
          track_ids: trackIds,
          spotify_playlist_id: playlist.spotify_playlist_id, // pass the existing Spotify playlist ID
        },
      });

      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);

      toast.success(
        data?.is_update ? "Playlist updated on Spotify" : "Playlist exported to Spotify",
        { description: `${trackIds.length} tracks synced` }
      );
    } catch (err: any) {
      toast.error("Export failed", { description: err.message });
    } finally {
      setExporting(false);
    }
  }, [playlist, canEdit, tracks, user, editedName]);

  const handleSaveName = useCallback(async () => {
    if (!playlist || !editedName.trim()) return;
    await supabase.from("spotify_playlists").update({ name: editedName.trim() }).eq("id", playlist.id);
    setPlaylist(prev => prev ? { ...prev, name: editedName.trim() } : null);
    setEditing(false);
    toast.success("Playlist renamed");
  }, [playlist, editedName]);

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
          tracks: tracks.slice(0, 60).map(t => ({
            title: t.track_name,
            artist: t.artist_name,
          })),
          discoveryMode: "balanced",
          existingLibrary: knownSongs.map(id => ({ spotifyId: id })),
          vibeContext: vibe ? {
            primaryVibe: vibe.primary_vibe,
            secondaryVibes: vibe.secondary_vibes,
            moodSummary: vibe.mood_summary,
            energySummary: vibe.energy_summary,
            productionSummary: vibe.production_summary,
            structuralFlow: vibe.structural_flow,
            listeningContext: vibe.listening_context,
            whatBelongs: vibe.what_belongs,
            whatBreaksIt: vibe.what_breaks_it,
            cohesionDescription: vibe.cohesion_description,
            sonicPalette: vibe.sonic_palette,
            emotionalKeywords: vibe.emotional_keywords,
            sonicDna: vibe.sonic_dna,
            genreBlend: vibe.genre_blend,
            emotionalArc: vibe.emotional_arc,
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
        reason: r.reason || "Fits the playlist identity",
        aiExplanation: r.aiExplanation || null,
        moodTags: r.moodTags || [],
        insertAfterTrack: r.insertAfterTrack || null,
        insertExplanation: r.insertExplanation || null,
        sonicConnection: r.sonicConnection || null,
        popularityTier: r.popularityTier || "mid",
        compatibilityBreakdown: r.compatibilityBreakdown || null,
      }));
      const filtered = recommendations.filter(r => !isKnown(r.title, r.artist));
      setRecs(filtered);
      setRecsLoaded(true);

      // Enrich with Spotify data (preview URLs, artwork)
      enrich(filtered.map(r => ({ title: r.title, artist: r.artist }))).then(setRecSpotifyData);
    } catch (err: any) {
      console.error("Rec error:", err);
      toast.error("Failed to generate recommendations", { description: err.message });
    } finally {
      setRecsLoading(false);
    }
  }, [playlist, tracks, vibe, knownTrackIds, isKnown, enrich]);

  const handleAnalyze = () => {
    if (!playlist) return;
    analyze(playlist.name, tracks.map(t => ({
      track_name: t.track_name,
      artist_name: t.artist_name,
      album_name: t.album_name || undefined,
    })));
  };

  const visibleRecs = recs.filter(r => !dismissedIds.has(r.id));
  const vibeColor = vibe?.vibe_color_hex || "#6366f1";

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
          <Link to="/library" className="text-accent hover:underline mt-2 block text-sm">Back to library</Link>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="max-w-4xl">
        <Link to="/library" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-6 transition-colors">
          <ArrowLeft className="w-4 h-4" />
          Back to library
        </Link>

        {/* Playlist header */}
        <div className="flex gap-6 mb-8">
          {playlist.image_url ? (
            <img src={playlist.image_url} alt={playlist.name} className="w-36 h-36 rounded-2xl object-cover flex-shrink-0 shadow-lg" />
          ) : (
            <div className="w-36 h-36 rounded-2xl bg-secondary flex items-center justify-center text-5xl flex-shrink-0">🎵</div>
          )}
          <div className="flex-1">
            {editing && canEdit ? (
              <div className="flex items-center gap-2 mb-2">
                <input
                  value={editedName}
                  onChange={e => setEditedName(e.target.value)}
                  className="font-heading text-3xl bg-transparent border-b-2 border-accent outline-none w-full"
                  autoFocus
                  onKeyDown={e => e.key === "Enter" && handleSaveName()}
                />
                <Button size="sm" variant="hero" onClick={handleSaveName}>Save</Button>
                <Button size="sm" variant="ghost" onClick={() => { setEditing(false); setEditedName(playlist.name); }}>Cancel</Button>
              </div>
            ) : (
              <div className="flex items-center gap-2 mb-1">
                <h1 className="font-heading text-4xl">{playlist.name}</h1>
                {canEdit && (
                  <button onClick={() => setEditing(true)} className="text-muted-foreground hover:text-accent transition-colors">
                    <Edit3 className="w-4 h-4" />
                  </button>
                )}
              </div>
            )}
            {playlist.description && (
              <p className="text-muted-foreground text-sm mb-3">{playlist.description}</p>
            )}
            
            {/* Ownership and meta info */}
            <div className="flex items-center gap-3 flex-wrap mb-4">
              <OwnershipBadge playlist={playlist} />
              <span className="text-sm text-muted-foreground">{tracks.length} tracks</span>
              {vibe && (
                <span className="text-sm font-medium" style={{ color: vibeColor }}>{vibe.primary_vibe}</span>
              )}
            </div>

            <div className="flex gap-3 flex-wrap">
              <Button variant="hero" className="rounded-xl gap-2" onClick={generateRecs} disabled={recsLoading || tracks.length === 0}>
                {recsLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                {recsLoading ? "Finding songs…" : "Get Recommendations"}
              </Button>
              {canEdit && (
                <Button variant="secondary" className="rounded-xl gap-2" onClick={handleExportToSpotify} disabled={exporting || tracks.length === 0}>
                  {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                  {exporting ? "Exporting…" : "Export to Spotify"}
                </Button>
              )}
              {playlist.spotify_playlist_id && (
                <Button variant="ghost" className="rounded-xl gap-2" asChild>
                  <a href={`https://open.spotify.com/playlist/${playlist.spotify_playlist_id}`} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="w-4 h-4" />
                    Open in Spotify
                  </a>
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* Playlist Identity Panel */}
        <PlaylistIdentity vibe={vibe} analyzing={analyzing} onAnalyze={handleAnalyze} />

        {/* Track list */}
        <div className="rounded-2xl border border-border/50 overflow-hidden mb-8">
          <div className={`grid ${canEdit ? "grid-cols-[40px_1fr_1fr_80px]" : "grid-cols-[40px_1fr_1fr_40px]"} gap-4 px-5 py-3 text-xs text-muted-foreground border-b border-border/50 bg-secondary/30`}>
            <span>#</span>
            <span>Title</span>
            <span>Album</span>
            <span />
          </div>
          {tracks.length === 0 ? (
            (() => {
              const expected = playlist?.spotify_total_tracks ?? playlist?.track_count ?? 0;
              const status = playlist?.tracks_import_status;
              const isFailed = status === "failed";
              const isProcessing = status === "processing" || recoveringTracks;
              const isTrulyEmpty = expected === 0 && !isProcessing && !isFailed;

              let message: string;
              if (isProcessing) message = "Importando canciones desde Spotify…";
              else if (isFailed) message = "No pudimos cargar las canciones. Reintentar.";
              else if (isTrulyEmpty) message = "Esta playlist no tiene canciones.";
              else message = `Esta playlist tiene ${expected} canciones en Spotify pero aún no se han importado.`;

              return (
                <div className="text-center py-12 space-y-3">
                  <p className="text-sm text-muted-foreground">{message}</p>
                  {playlist?.tracks_import_error && (
                    <p className="text-xs text-destructive/70">{playlist.tracks_import_error}</p>
                  )}
                  {!isTrulyEmpty && (
                    <Button
                      variant="secondary"
                      className="rounded-xl gap-2"
                      onClick={() => repairMissingTracks()}
                      disabled={recoveringTracks}
                    >
                      {recoveringTracks ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                      {recoveringTracks ? "Sincronizando…" : "Sync playlist tracks"}
                    </Button>
                  )}
                </div>
              );
            })()
          ) : (
            tracks.map((track, i) => (
              <div key={track.id} className={`group grid ${canEdit ? "grid-cols-[40px_1fr_1fr_80px]" : "grid-cols-[40px_1fr_1fr_40px]"} gap-4 px-5 py-3 items-center hover:bg-secondary/30 transition-colors`}>
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
                <div className="flex items-center gap-1">
                  <AudioPreviewButton trackId={track.spotify_track_id} previewUrl={null} size="sm" />
                  {canEdit && (
                    <>
                      <button
                        onClick={() => handleMoveTrack(track.id, "up")}
                        disabled={i === 0}
                        className="w-6 h-6 flex items-center justify-center rounded text-muted-foreground hover:text-foreground disabled:opacity-20 opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <ChevronUp className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => handleMoveTrack(track.id, "down")}
                        disabled={i === tracks.length - 1}
                        className="w-6 h-6 flex items-center justify-center rounded text-muted-foreground hover:text-foreground disabled:opacity-20 opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <ChevronDown className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => handleRemoveTrack(track.id)}
                        className="w-6 h-6 flex items-center justify-center rounded text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))
          )}
        </div>

        {/* AI Curated Additions */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-accent" />
              <h2 className="font-heading text-2xl">Curated Additions</h2>
              {!recsLoading && visibleRecs.length > 0 && (
                <span className="text-xs text-muted-foreground ml-1">({visibleRecs.length})</span>
              )}
            </div>
            <Button variant="ghost" size="sm" className="rounded-lg gap-1 text-accent" onClick={generateRecs} disabled={recsLoading}>
              <RefreshCw className={`w-3.5 h-3.5 ${recsLoading ? "animate-spin" : ""}`} />
              {recsLoading ? "Generating…" : "Refresh"}
            </Button>
          </div>

          {recsLoading ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <Loader2 className="w-6 h-6 animate-spin text-accent" />
              <p className="text-sm text-muted-foreground">Analyzing sonic coherence, emotional fit, and flow quality…</p>
            </div>
          ) : visibleRecs.length > 0 ? (
            <>
              <p className="text-sm text-muted-foreground mb-4">
                Each recommendation was selected for musical coherence with this playlist's identity — not genre tags or popularity.
              </p>
              <div className="space-y-3">
                {visibleRecs.map((rec) => {
                  const tier = tierConfig[rec.popularityTier || "mid"];
                  const TierIcon = tier.icon;
                  const isExpanded = expandedRecId === rec.id;
                  const spotifyInfo = recSpotifyData.get(`${rec.title}|||${rec.artist}`.toLowerCase());
                  const artworkUrl = spotifyInfo?.image_url;
                  const previewUrl = spotifyInfo?.preview_url;
                  const recTrackId = spotifyInfo?.spotify_id || rec.id;

                  return (
                    <div key={rec.id} className="rounded-2xl bg-surface-elevated border border-border/50 hover:border-accent/30 hover:shadow-sm transition-all overflow-hidden">
                      <div className="group p-4">
                        <div className="flex items-start gap-4">
                          {artworkUrl ? (
                            <img src={artworkUrl} alt={rec.album} className="w-10 h-10 rounded-xl object-cover flex-shrink-0 mt-0.5" />
                          ) : (
                            <div className="w-10 h-10 rounded-xl flex items-center justify-center text-base flex-shrink-0 mt-0.5" style={{ backgroundColor: vibeColor + "15" }}>
                              🎵
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-0.5">
                              <p className="text-sm font-medium truncate">{rec.title}</p>
                              <span className="text-xs font-bold" style={{ color: vibeColor }}>{rec.matchScore}%</span>
                              <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${tier.className}`}>
                                <TierIcon className="w-2.5 h-2.5" />
                                {tier.label}
                              </span>
                            </div>
                            <p className="text-xs text-muted-foreground">{rec.artist} · {rec.album}</p>

                            {/* Reason */}
                            <p className="text-xs text-foreground/70 mt-2 leading-relaxed">{rec.reason}</p>

                            {/* Sonic connection highlight */}
                            {rec.sonicConnection && (
                              <div className="flex items-start gap-1.5 mt-2">
                                <Radio className="w-3 h-3 flex-shrink-0 mt-0.5" style={{ color: vibeColor }} />
                                <p className="text-[11px] italic" style={{ color: vibeColor + "cc" }}>{rec.sonicConnection}</p>
                              </div>
                            )}

                            {/* Why this song? */}
                            {rec.aiExplanation && (
                              <button
                                onClick={() => setExplainedRecId(explainedRecId === rec.id ? null : rec.id)}
                                className="flex items-center gap-1 mt-2 text-[11px] font-medium hover:opacity-80 transition-colors"
                                style={{ color: vibeColor }}
                              >
                                <Brain className="w-3 h-3" />
                                Why this song?
                                {explainedRecId === rec.id ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                              </button>
                            )}

                            {explainedRecId === rec.id && rec.aiExplanation && (
                              <div className="mt-2 rounded-xl border p-3" style={{ backgroundColor: vibeColor + "08", borderColor: vibeColor + "20" }}>
                                <div className="flex items-center gap-1.5 mb-1.5">
                                  <Brain className="w-3.5 h-3.5" style={{ color: vibeColor }} />
                                  <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: vibeColor }}>Tempo AI Insight</span>
                                </div>
                                <p className="text-xs text-foreground/80 leading-relaxed">{rec.aiExplanation}</p>
                              </div>
                            )}

                            {/* Compatibility breakdown */}
                            {rec.compatibilityBreakdown && (
                              <CompatibilityBreakdown breakdown={rec.compatibilityBreakdown} color={vibeColor} />
                            )}

                            {/* Mood tags */}
                            <div className="flex flex-wrap gap-1 mt-2">
                              {rec.moodTags.map((tag) => (
                                <span key={tag} className="px-2 py-0.5 rounded-full text-[10px] bg-secondary text-muted-foreground">{tag}</span>
                              ))}
                            </div>

                            {/* Insertion detail toggle */}
                            {(rec.insertExplanation || rec.insertAfterTrack) && (
                              <button onClick={() => setExpandedRecId(isExpanded ? null : rec.id)} className="text-[11px] hover:underline mt-2 flex items-center gap-1" style={{ color: vibeColor }}>
                                <MapPin className="w-3 h-3" />
                                {isExpanded ? "Hide placement" : "View suggested placement"}
                              </button>
                            )}
                          </div>

                          {/* Actions */}
                          <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                            <AudioPreviewButton trackId={recTrackId} previewUrl={previewUrl} size="sm" />
                            <Button variant="ghost" size="icon" className="w-8 h-8 rounded-lg text-accent hover:text-accent" title="Add" onClick={() => toast.success(`"${rec.title}" would be added`)}>
                              <Plus className="w-4 h-4" />
                            </Button>
                            <Button
                              variant="ghost" size="icon"
                              className={`w-8 h-8 rounded-lg ${savedIds.has(rec.id) ? "text-warm" : ""}`}
                              title="Save"
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
                      </div>

                      {/* Insertion point detail */}
                      {isExpanded && (rec.insertExplanation || rec.insertAfterTrack) && (
                        <div className="px-4 pb-4 pt-0 border-t border-border/30">
                          <div className="pt-3 flex items-start gap-2">
                            <MapPin className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: vibeColor }} />
                            <div>
                              {rec.insertAfterTrack && (
                                <p className="text-xs font-medium mb-0.5">Insert after: "{rec.insertAfterTrack}"</p>
                              )}
                              {rec.insertExplanation && (
                                <p className="text-xs text-muted-foreground">{rec.insertExplanation}</p>
                              )}
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
              <p className="text-sm text-muted-foreground mb-1">Click "Get Recommendations" to find songs curated for this playlist.</p>
              <p className="text-xs text-muted-foreground/60">
                {vibe ? "Recommendations will use the deep identity analysis for maximum coherence." : "Analyze the playlist identity first for more intelligent recommendations."}
              </p>
            </div>
          ) : null}
        </div>
      </div>
    </AppLayout>
  );
};

export default PlaylistDetail;
