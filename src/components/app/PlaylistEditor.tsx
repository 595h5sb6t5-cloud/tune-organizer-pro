import { useState, useCallback, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  GripVertical, X, Plus, Search, Sparkles, Save, Loader2,
  Music, ArrowLeft, Pencil, Check, ChevronDown, ChevronUp
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "sonner";
import type { LikedSongCluster, ClusterTrack } from "@/hooks/use-liked-song-clusters";

interface PlaylistEditorProps {
  cluster: LikedSongCluster;
  onClose: () => void;
  onSaved: () => void;
}

interface LikedSongOption {
  id: string;
  spotify_track_id: string;
  track_name: string;
  artist_name: string;
  album_name: string | null;
  image_url: string | null;
  mood: string | null;
  energy: string | null;
}

export default function PlaylistEditor({ cluster, onClose, onSaved }: PlaylistEditorProps) {
  const { user } = useAuth();
  const [name, setName] = useState(cluster.name);
  const [tracks, setTracks] = useState<ClusterTrack[]>([...cluster.tracks]);
  const [saving, setSaving] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<LikedSongOption[]>([]);
  const [searching, setSearching] = useState(false);
  const [showAddPanel, setShowAddPanel] = useState(false);
  const [suggestions, setSuggestions] = useState<LikedSongOption[]>([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);
  const searchTimeout = useRef<ReturnType<typeof setTimeout>>();

  const existingIds = new Set(tracks.map(t => t.spotify_track_id));

  // Debounced search through liked songs
  const handleSearch = useCallback(async (q: string) => {
    if (!user || q.trim().length < 2) { setSearchResults([]); return; }
    setSearching(true);
    try {
      const { data } = await supabase
        .from("liked_songs")
        .select("id, spotify_track_id, track_name, artist_name, album_name, image_url, mood, energy")
        .eq("user_id", user.id)
        .or(`track_name.ilike.%${q}%,artist_name.ilike.%${q}%,album_name.ilike.%${q}%`)
        .limit(30);
      setSearchResults((data || []).filter(s => !existingIds.has(s.spotify_track_id)));
    } catch {
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  }, [user, existingIds]);

  useEffect(() => {
    clearTimeout(searchTimeout.current);
    if (searchQuery.trim().length >= 2) {
      searchTimeout.current = setTimeout(() => handleSearch(searchQuery), 300);
    } else {
      setSearchResults([]);
    }
    return () => clearTimeout(searchTimeout.current);
  }, [searchQuery]);

  // Load suggested matches for short playlists
  const loadSuggestions = useCallback(async () => {
    if (!user || tracks.length === 0) return;
    setLoadingSuggestions(true);
    try {
      // Get mood/energy from existing tracks to find similar songs
      const moods = tracks.map(t => t.mood).filter(Boolean);
      const energies = tracks.map(t => t.energy).filter(Boolean);
      const topMood = moods.length > 0 ? mostFrequent(moods as string[]) : null;
      const topEnergy = energies.length > 0 ? mostFrequent(energies as string[]) : null;

      let query = supabase
        .from("liked_songs")
        .select("id, spotify_track_id, track_name, artist_name, album_name, image_url, mood, energy")
        .eq("user_id", user.id)
        .not("spotify_track_id", "in", `(${[...existingIds].join(",")})`)
        .limit(20);

      if (topMood) query = query.eq("mood", topMood);
      if (topEnergy) query = query.eq("energy", topEnergy);

      const { data } = await query;

      // If mood/energy filter returned too few, fetch without filters
      if (!data || data.length < 5) {
        const { data: fallback } = await supabase
          .from("liked_songs")
          .select("id, spotify_track_id, track_name, artist_name, album_name, image_url, mood, energy")
          .eq("user_id", user.id)
          .limit(50);

        const filtered = (fallback || []).filter(s => !existingIds.has(s.spotify_track_id));
        // Score by matching artists, mood, energy
        const artistSet = new Set(tracks.map(t => t.artist_name.toLowerCase()));
        const scored = filtered.map(s => {
          let score = 0;
          if (artistSet.has(s.artist_name.toLowerCase())) score += 3;
          if (topMood && s.mood === topMood) score += 2;
          if (topEnergy && s.energy === topEnergy) score += 1;
          return { ...s, score };
        }).sort((a, b) => b.score - a.score);

        setSuggestions(scored.slice(0, 15));
      } else {
        setSuggestions(data.filter(s => !existingIds.has(s.spotify_track_id)));
      }
    } catch {
      setSuggestions([]);
    } finally {
      setLoadingSuggestions(false);
    }
  }, [user, tracks, existingIds]);

  // Add track to playlist
  const addTrack = (song: LikedSongOption) => {
    const newTrack: ClusterTrack = {
      id: `new-${Date.now()}-${Math.random()}`,
      liked_song_id: song.id,
      spotify_track_id: song.spotify_track_id,
      track_name: song.track_name,
      artist_name: song.artist_name,
      album_name: song.album_name,
      image_url: song.image_url,
      mood: song.mood,
      energy: song.energy,
      atmosphere: null,
    };
    setTracks(prev => [...prev, newTrack]);
    setSearchResults(prev => prev.filter(s => s.spotify_track_id !== song.spotify_track_id));
    setSuggestions(prev => prev.filter(s => s.spotify_track_id !== song.spotify_track_id));
  };

  // Remove track
  const removeTrack = (idx: number) => {
    setTracks(prev => prev.filter((_, i) => i !== idx));
  };

  // Drag reorder
  const handleDragStart = (idx: number) => setDragIdx(idx);
  const handleDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    setDragOverIdx(idx);
  };
  const handleDrop = (idx: number) => {
    if (dragIdx === null || dragIdx === idx) { setDragIdx(null); setDragOverIdx(null); return; }
    setTracks(prev => {
      const copy = [...prev];
      const [moved] = copy.splice(dragIdx, 1);
      copy.splice(idx, 0, moved);
      return copy;
    });
    setDragIdx(null);
    setDragOverIdx(null);
  };

  // Move up/down (mobile-friendly alternative)
  const moveTrack = (from: number, to: number) => {
    if (to < 0 || to >= tracks.length) return;
    setTracks(prev => {
      const copy = [...prev];
      const [moved] = copy.splice(from, 1);
      copy.splice(to, 0, moved);
      return copy;
    });
  };

  // Save all changes
  const handleSave = async () => {
    if (!user) return;
    setSaving(true);
    try {
      // 1. Update cluster name and track_count
      await supabase
        .from("liked_song_clusters")
        .update({ name, track_count: tracks.length })
        .eq("id", cluster.id);

      // 2. Delete all existing cluster tracks
      await supabase
        .from("liked_song_cluster_tracks")
        .delete()
        .eq("cluster_id", cluster.id);

      // 3. Re-insert with positions
      if (tracks.length > 0) {
        const rows = tracks.map((t, i) => ({
          user_id: user.id,
          cluster_id: cluster.id,
          liked_song_id: t.liked_song_id,
          spotify_track_id: t.spotify_track_id,
          confidence_score: 0.9,
          position: i,
        }));
        for (let i = 0; i < rows.length; i += 100) {
          await supabase.from("liked_song_cluster_tracks").insert(rows.slice(i, i + 100));
        }
      }

      // 4. Update cover_tracks
      const coverTracks = tracks
        .filter(t => t.image_url)
        .slice(0, 4)
        .map(t => ({ image_url: t.image_url!, track_name: t.track_name }));
      await supabase
        .from("liked_song_clusters")
        .update({ cover_tracks: coverTracks })
        .eq("id", cluster.id);

      toast.success("Playlist saved!");
      onSaved();
    } catch (e: any) {
      toast.error("Failed to save", { description: e.message });
    } finally {
      setSaving(false);
    }
  };

  const hasChanges = name !== cluster.name ||
    tracks.length !== cluster.tracks.length ||
    tracks.some((t, i) => t.spotify_track_id !== cluster.tracks[i]?.spotify_track_id);

  return (
    <div className="max-w-4xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <button onClick={onClose} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="w-4 h-4" /> Back
        </button>
        <div className="flex items-center gap-2">
          {hasChanges && (
            <span className="text-xs text-accent font-medium">Unsaved changes</span>
          )}
          <Button variant="hero" size="sm" className="rounded-lg gap-1.5" onClick={handleSave} disabled={saving || tracks.length === 0}>
            {saving ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Saving…</> : <><Save className="w-3.5 h-3.5" /> Save Changes</>}
          </Button>
        </div>
      </div>

      {/* Editable name */}
      <div className="mb-6">
        <label className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1 block">Playlist Name</label>
        <Input
          value={name}
          onChange={e => setName(e.target.value)}
          className="font-heading text-2xl h-auto py-2 border-border/30 bg-transparent"
          placeholder="Playlist name"
        />
      </div>

      {/* Info bar */}
      <div className="flex items-center gap-4 mb-4 text-xs text-muted-foreground">
        <span>{tracks.length} songs</span>
        <span className="text-muted-foreground/40">·</span>
        <span>Drag to reorder</span>
        {cluster.tracks.length !== tracks.length && (
          <>
            <span className="text-muted-foreground/40">·</span>
            <span className="text-accent">Originally {cluster.tracks.length} songs</span>
          </>
        )}
      </div>

      {/* Action buttons */}
      <div className="flex gap-2 mb-6">
        <Button
          variant={showAddPanel ? "default" : "outline"}
          size="sm"
          className="rounded-lg gap-1.5 text-xs"
          onClick={() => { setShowAddPanel(!showAddPanel); if (!showAddPanel) loadSuggestions(); }}
        >
          <Plus className="w-3.5 h-3.5" /> Add Songs
        </Button>
      </div>

      {/* Add songs panel */}
      {showAddPanel && (
        <div className="rounded-xl bg-surface-elevated border border-border/50 p-4 mb-6 space-y-4">
          {/* Search */}
          <div>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search your liked songs by title, artist, or album…"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>
            {searching && <p className="text-xs text-muted-foreground mt-2">Searching…</p>}
            {searchResults.length > 0 && (
              <div className="mt-2 max-h-60 overflow-y-auto divide-y divide-border/20 rounded-lg border border-border/30">
                {searchResults.map(song => (
                  <SongRow key={song.id} song={song} onAdd={() => addTrack(song)} />
                ))}
              </div>
            )}
            {searchQuery.length >= 2 && !searching && searchResults.length === 0 && (
              <p className="text-xs text-muted-foreground mt-2">No matching songs found.</p>
            )}
          </div>

          {/* Suggested matches */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-accent" />
                <span className="text-xs font-medium text-accent">Suggested Matches</span>
              </div>
              <Button variant="ghost" size="sm" className="text-xs h-7" onClick={loadSuggestions} disabled={loadingSuggestions}>
                {loadingSuggestions ? <Loader2 className="w-3 h-3 animate-spin" /> : "Refresh"}
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground mb-2">Songs from your library that match this playlist's mood, energy, and style.</p>
            {loadingSuggestions ? (
              <div className="flex items-center gap-2 py-4 justify-center">
                <Loader2 className="w-4 h-4 animate-spin text-accent" />
                <span className="text-xs text-muted-foreground">Finding matching songs…</span>
              </div>
            ) : suggestions.length > 0 ? (
              <div className="max-h-60 overflow-y-auto divide-y divide-border/20 rounded-lg border border-border/30">
                {suggestions.map(song => (
                  <SongRow key={song.id} song={song} onAdd={() => addTrack(song)} />
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground py-2">No additional suggestions found.</p>
            )}
          </div>
        </div>
      )}

      {/* Track list - editable */}
      <div className="rounded-xl bg-surface-elevated border border-border/50 overflow-hidden">
        {tracks.length === 0 ? (
          <div className="py-12 text-center">
            <Music className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">No tracks. Add songs to build your playlist.</p>
          </div>
        ) : (
          <div className="divide-y divide-border/20">
            {tracks.map((track, idx) => (
              <div
                key={`${track.spotify_track_id}-${idx}`}
                draggable
                onDragStart={() => handleDragStart(idx)}
                onDragOver={(e) => handleDragOver(e, idx)}
                onDrop={() => handleDrop(idx)}
                onDragEnd={() => { setDragIdx(null); setDragOverIdx(null); }}
                className={`flex items-center gap-2 px-3 py-2.5 group transition-colors ${
                  dragOverIdx === idx ? "bg-accent/10" : "hover:bg-secondary/20"
                } ${dragIdx === idx ? "opacity-40" : ""}`}
              >
                {/* Drag handle */}
                <GripVertical className="w-4 h-4 text-muted-foreground/40 cursor-grab flex-shrink-0" />

                {/* Position */}
                <span className="text-xs text-muted-foreground w-5 text-right flex-shrink-0">{idx + 1}</span>

                {/* Artwork */}
                {track.image_url ? (
                  <img src={track.image_url} alt="" className="w-9 h-9 rounded-md object-cover flex-shrink-0" loading="lazy" />
                ) : (
                  <div className="w-9 h-9 rounded-md bg-secondary flex items-center justify-center flex-shrink-0">
                    <Music className="w-3.5 h-3.5 text-muted-foreground" />
                  </div>
                )}

                {/* Info */}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{track.track_name}</p>
                  <p className="text-xs text-muted-foreground truncate">{track.artist_name}</p>
                </div>

                {/* Mobile reorder buttons */}
                <div className="flex flex-col gap-0.5 md:hidden flex-shrink-0">
                  <button onClick={() => moveTrack(idx, idx - 1)} disabled={idx === 0} className="p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-20">
                    <ChevronUp className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => moveTrack(idx, idx + 1)} disabled={idx === tracks.length - 1} className="p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-20">
                    <ChevronDown className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* Remove */}
                <button
                  onClick={() => removeTrack(idx)}
                  className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors flex-shrink-0 opacity-0 group-hover:opacity-100"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Bottom save bar */}
      {hasChanges && (
        <div className="sticky bottom-0 mt-4 p-3 rounded-xl bg-surface-elevated border border-accent/30 flex items-center justify-between">
          <span className="text-sm text-muted-foreground">You have unsaved changes</span>
          <Button variant="hero" size="sm" className="rounded-lg gap-1.5" onClick={handleSave} disabled={saving}>
            {saving ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Saving…</> : <><Save className="w-3.5 h-3.5" /> Save Changes</>}
          </Button>
        </div>
      )}
    </div>
  );
}

function SongRow({ song, onAdd }: { song: LikedSongOption; onAdd: () => void }) {
  return (
    <div className="flex items-center gap-3 px-3 py-2.5 hover:bg-secondary/20 transition-colors">
      {song.image_url ? (
        <img src={song.image_url} alt="" className="w-9 h-9 rounded-md object-cover flex-shrink-0" loading="lazy" />
      ) : (
        <div className="w-9 h-9 rounded-md bg-secondary flex items-center justify-center flex-shrink-0">
          <Music className="w-3.5 h-3.5 text-muted-foreground" />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium truncate">{song.track_name}</p>
        <p className="text-xs text-muted-foreground truncate">{song.artist_name}{song.album_name ? ` · ${song.album_name}` : ""}</p>
      </div>
      <div className="flex gap-1.5 flex-shrink-0 hidden md:flex">
        {song.mood && <span className="px-2 py-0.5 rounded-full text-[10px] bg-secondary text-muted-foreground">{song.mood}</span>}
        {song.energy && <span className="px-2 py-0.5 rounded-full text-[10px] bg-secondary text-muted-foreground">{song.energy}</span>}
      </div>
      <Button variant="ghost" size="sm" className="h-7 w-7 p-0 rounded-lg flex-shrink-0" onClick={onAdd}>
        <Plus className="w-4 h-4 text-accent" />
      </Button>
    </div>
  );
}

function mostFrequent(arr: string[]): string {
  const freq: Record<string, number> = {};
  for (const v of arr) freq[v] = (freq[v] || 0) + 1;
  return Object.entries(freq).sort((a, b) => b[1] - a[1])[0]?.[0] || "";
}
