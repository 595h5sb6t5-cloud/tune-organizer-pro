import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./use-auth";

export interface LikedSongCluster {
  id: string;
  name: string;
  description: string | null;
  vibe_description: string | null;
  ai_explanation: string | null;
  mood_tags: string[];
  color_hex: string;
  energy_level: string | null;
  tempo_range: string | null;
  era_range: string | null;
  track_count: number;
  cover_tracks: { image_url: string; track_name: string }[];
  sort_order: number;
  tracks: ClusterTrack[];
  spotify_playlist_id: string | null;
  spotify_exported_at: string | null;
  spotify_playlist_url: string | null;
}

export interface ClusterTrack {
  id: string;
  liked_song_id: string;
  spotify_track_id: string;
  track_name: string;
  artist_name: string;
  album_name: string | null;
  image_url: string | null;
  mood: string | null;
  energy: string | null;
  atmosphere: string | null;
}

export type AnalysisPhase =
  | "idle"
  | "tagging"
  | "defining_worlds"
  | "assigning"
  | "saving"
  | "refining"
  | "done";

export interface AnalysisProgress {
  totalAnalyzed: number;
  totalSongs: number;
  phase: AnalysisPhase;
  worldsCount: number;
  assignedCount: number;
  statusMessage: string;
}

const INITIAL_PROGRESS: AnalysisProgress = {
  totalAnalyzed: 0, totalSongs: 0, phase: "idle",
  worldsCount: 0, assignedCount: 0, statusMessage: "",
};

export function useLikedSongClusters() {
  const { user, profile } = useAuth();
  const spotifyConnected = profile?.spotify_connected ?? false;

  const [clusters, setClusters] = useState<LikedSongCluster[]>([]);
  const [loading, setLoading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [hasAnalyzed, setHasAnalyzed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [likedCount, setLikedCount] = useState(0);
  const [progress, setProgress] = useState<AnalysisProgress>(INITIAL_PROGRESS);

  const loadClusters = useCallback(async () => {
    if (!user || !spotifyConnected) { setClusters([]); return; }
    setLoading(true);

    const [countRes, analyzedRes] = await Promise.all([
      supabase.from("liked_songs").select("id", { count: "exact", head: true }).eq("user_id", user.id),
      supabase.from("liked_songs").select("id", { count: "exact", head: true }).eq("user_id", user.id).not("analyzed_at", "is", null),
    ]);
    const totalSongs = countRes.count ?? 0;
    const totalAnalyzed = analyzedRes.count ?? 0;
    setLikedCount(totalSongs);
    setProgress(prev => ({ ...prev, totalAnalyzed, totalSongs }));

    const { data: clusterData } = await supabase
      .from("liked_song_clusters")
      .select("id, name, description, vibe_description, ai_explanation, mood_tags, color_hex, energy_level, tempo_range, era_range, track_count, sort_order, cover_tracks, spotify_playlist_id, spotify_exported_at, spotify_playlist_url")
      .eq("user_id", user.id)
      .order("sort_order");

    if (!clusterData || clusterData.length === 0) {
      setClusters([]); setHasAnalyzed(false); setLoading(false); return;
    }

    const clusterIds = clusterData.map(c => c.id);
    const { data: trackData } = await supabase
      .from("liked_song_cluster_tracks")
      .select("id, cluster_id, liked_song_id, spotify_track_id")
      .eq("user_id", user.id)
      .in("cluster_id", clusterIds);

    const likedSongIds = [...new Set((trackData || []).map(t => t.liked_song_id))];
    const songMap = new Map<string, any>();
    for (let i = 0; i < likedSongIds.length; i += 100) {
      const batch = likedSongIds.slice(i, i + 100);
      const { data: songs } = await supabase
        .from("liked_songs")
        .select("id, track_name, artist_name, album_name, image_url, mood, energy, atmosphere")
        .in("id", batch);
      for (const s of songs || []) songMap.set(s.id, s);
    }

    const enriched: LikedSongCluster[] = clusterData.map(c => {
      const clusterTracks = (trackData || [])
        .filter(t => t.cluster_id === c.id)
        .map(t => {
          const song = songMap.get(t.liked_song_id);
          return {
            id: t.id, liked_song_id: t.liked_song_id, spotify_track_id: t.spotify_track_id,
            track_name: song?.track_name || "Unknown", artist_name: song?.artist_name || "Unknown",
            album_name: song?.album_name || null, image_url: song?.image_url || null,
            mood: song?.mood || null, energy: song?.energy || null, atmosphere: song?.atmosphere || null,
          };
        });
      return {
        ...c, mood_tags: c.mood_tags || [],
        ai_explanation: c.ai_explanation ?? null,
        cover_tracks: (Array.isArray(c.cover_tracks) ? c.cover_tracks : []) as { image_url: string; track_name: string }[],
        spotify_playlist_id: (c as any).spotify_playlist_id ?? null,
        spotify_exported_at: (c as any).spotify_exported_at ?? null,
        spotify_playlist_url: (c as any).spotify_playlist_url ?? null,
        tracks: clusterTracks,
      };
    });

    setClusters(enriched); setHasAnalyzed(true); setLoading(false);
  }, [user, spotifyConnected]);

  useEffect(() => { void loadClusters(); }, [loadClusters]);

  const runAnalysis = useCallback(async (options?: { forceRetag?: boolean }) => {
    if (!user) return;
    const forceRetag = options?.forceRetag ?? false;

    setAnalyzing(true);
    setError(null);
    setProgress({ ...INITIAL_PROGRESS, totalSongs: likedCount, phase: "tagging", statusMessage: "Starting deep analysis…" });

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData.session?.access_token) throw new Error("Session expired. Please sign in again.");

      // ═══ PHASE 1: Tag all songs ═══
      setProgress(prev => ({ ...prev, phase: "tagging", statusMessage: "Analyzing each song across 17 musical dimensions…" }));

      let tagDone = false;
      let batchNum = 0;
      const maxTagBatches = 80;

      while (!tagDone && batchNum < maxTagBatches) {
        batchNum++;
        const tagRes = await supabase.functions.invoke("analyze-liked-songs", {
          body: {
            mode: "tag_only",
            batch_size: 150,
            ...(batchNum === 1 && forceRetag ? { force_retag: true } : {}),
          },
        });

        if (tagRes.error) { console.error("Tag error:", tagRes.error); break; }
        if (tagRes.data?.error) { console.error("Tag data error:", tagRes.data.error); break; }

        tagDone = tagRes.data?.done ?? true;
        setProgress(prev => ({
          ...prev,
          totalAnalyzed: tagRes.data?.total_analyzed ?? prev.totalAnalyzed,
          totalSongs: tagRes.data?.total_liked_songs ?? prev.totalSongs,
          statusMessage: tagDone
            ? "All songs analyzed!"
            : `${tagRes.data?.total_analyzed ?? 0} of ${tagRes.data?.total_liked_songs ?? likedCount} songs analyzed…`,
        }));
      }

      // ═══ PHASE 2: Define sonic worlds ═══
      setProgress(prev => ({
        ...prev, phase: "defining_worlds",
        statusMessage: "Analyzing your Spotify ecosystem — playlists, albums, artists…",
      }));

      const worldRes = await supabase.functions.invoke("analyze-liked-songs", {
        body: { mode: "define_worlds" },
      });

      if (worldRes.error || worldRes.data?.error) {
        throw new Error(worldRes.data?.error || worldRes.error?.message || "Failed to define sonic worlds");
      }

      const worlds = worldRes.data?.worlds || [];
      console.log(`[rebuild] Defined ${worlds.length} sonic worlds`);

      setProgress(prev => ({
        ...prev, worldsCount: worlds.length,
        statusMessage: `Discovered ${worlds.length} sonic worlds in your library`,
      }));

      // ═══ PHASE 3: Assign all songs to worlds in batches ═══
      setProgress(prev => ({ ...prev, phase: "assigning", statusMessage: "Assigning songs to sonic worlds…" }));

      const totalSongs = worldRes.data?.total_songs || likedCount;
      const assignBatchSize = 150;
      let offset = 0;
      let assignDone = false;
      const allAssignments: { song_id: string; spotify_track_id: string; world_id: string; confidence: number }[] = [];

      while (!assignDone) {
        const assignRes = await supabase.functions.invoke("analyze-liked-songs", {
          body: {
            mode: "assign_batch",
            world_definitions: worlds,
            offset,
            batch_size: assignBatchSize,
          },
        });

        if (assignRes.error || assignRes.data?.error) {
          console.error("Assign error:", assignRes.data?.error || assignRes.error);
          break;
        }

        const assignments = assignRes.data?.assignments || [];
        allAssignments.push(...assignments);
        assignDone = assignRes.data?.done ?? true;
        offset += assignBatchSize;

        setProgress(prev => ({
          ...prev,
          assignedCount: allAssignments.length,
          statusMessage: `${allAssignments.length} of ${totalSongs} songs assigned to worlds…`,
        }));
      }

      // ═══ PHASE 4: Save clusters to database ═══
      setProgress(prev => ({ ...prev, phase: "saving", statusMessage: "Building playlists from sonic worlds…" }));

      // Clear old clusters
      const { data: existingClusters } = await supabase
        .from("liked_song_clusters").select("id").eq("user_id", user.id);
      if (existingClusters?.length) {
        const ids = existingClusters.map(c => c.id);
        // Delete in batches to avoid issues
        for (let i = 0; i < ids.length; i += 50) {
          const batch = ids.slice(i, i + 50);
          await supabase.from("liked_song_cluster_tracks").delete().in("cluster_id", batch);
        }
        await supabase.from("liked_song_clusters").delete().eq("user_id", user.id);
      }

      // Group assignments by world
      const worldAssignments = new Map<string, typeof allAssignments>();
      for (const a of allAssignments) {
        if (a.world_id === "__unassigned__") continue;
        if (!worldAssignments.has(a.world_id)) worldAssignments.set(a.world_id, []);
        worldAssignments.get(a.world_id)!.push(a);
      }

      // Fetch liked songs for cover art
      const songIds = allAssignments.map(a => a.song_id);
      const songMap = new Map<string, any>();
      for (let i = 0; i < songIds.length; i += 500) {
        const batch = songIds.slice(i, i + 500);
        const { data: songs } = await supabase
          .from("liked_songs")
          .select("id, track_name, image_url, spotify_track_id")
          .in("id", batch);
        for (const s of songs || []) songMap.set(s.id, s);
      }

      // Create clusters
      let sortOrder = 0;
      for (const world of worlds) {
        const assignments = worldAssignments.get(world.world_id);
        if (!assignments || assignments.length < 2) continue; // Skip worlds with < 2 songs

        // Build cover tracks
        const coverTracks: { image_url: string; track_name: string }[] = [];
        for (const a of assignments) {
          if (coverTracks.length >= 4) break;
          const song = songMap.get(a.song_id);
          if (song?.image_url) {
            coverTracks.push({ image_url: song.image_url, track_name: song.track_name });
          }
        }

        const { data: inserted, error: insertErr } = await supabase
          .from("liked_song_clusters")
          .insert({
            user_id: user.id,
            name: world.name,
            description: world.ai_explanation || null,
            vibe_description: world.vibe_description || null,
            ai_explanation: world.ai_explanation || null,
            mood_tags: world.mood_tags || [],
            color_hex: world.color_hex || "#6366f1",
            energy_level: world.energy_level || "medium",
            tempo_range: "Mixed",
            era_range: "Mixed",
            track_count: assignments.length,
            cover_tracks: coverTracks,
            analysis_model: "multi-phase-sonic-worlds-v2",
            sort_order: sortOrder++,
          })
          .select("id")
          .single();

        if (insertErr || !inserted) {
          console.error("Cluster insert error:", insertErr);
          continue;
        }

        // Insert track assignments in batches
        const trackRows = assignments.map(a => ({
          user_id: user.id,
          cluster_id: inserted.id,
          liked_song_id: a.song_id,
          spotify_track_id: a.spotify_track_id,
          confidence_score: a.confidence,
        }));

        for (let i = 0; i < trackRows.length; i += 100) {
          const batch = trackRows.slice(i, i + 100);
          await supabase.from("liked_song_cluster_tracks").insert(batch);
        }
      }

      // Handle unassigned songs — create an "Uncategorized" cluster if there are enough
      const unassigned = allAssignments.filter(a => a.world_id === "__unassigned__");
      if (unassigned.length >= 3) {
        const coverTracks: { image_url: string; track_name: string }[] = [];
        for (const a of unassigned.slice(0, 4)) {
          const song = songMap.get(a.song_id);
          if (song?.image_url) coverTracks.push({ image_url: song.image_url, track_name: song.track_name });
        }

        const { data: uncatCluster } = await supabase
          .from("liked_song_clusters")
          .insert({
            user_id: user.id,
            name: "Uncategorized",
            description: "Songs that didn't strongly match any sonic world. These may form new worlds as your library grows.",
            vibe_description: "Diverse tracks awaiting deeper classification",
            mood_tags: ["eclectic"],
            color_hex: "#71717a",
            energy_level: "medium",
            track_count: unassigned.length,
            cover_tracks: coverTracks,
            analysis_model: "multi-phase-sonic-worlds-v2",
            sort_order: sortOrder++,
          })
          .select("id")
          .single();

        if (uncatCluster) {
          const rows = unassigned.map(a => ({
            user_id: user.id,
            cluster_id: uncatCluster.id,
            liked_song_id: a.song_id,
            spotify_track_id: a.spotify_track_id,
            confidence_score: a.confidence,
          }));
          for (let i = 0; i < rows.length; i += 100) {
            await supabase.from("liked_song_cluster_tracks").insert(rows.slice(i, i + 100));
          }
        }
      }

      // ═══ PHASE 5: Done ═══
      setProgress(prev => ({ ...prev, phase: "done", statusMessage: "Playlists ready!" }));
      await loadClusters();

    } catch (e: any) {
      setError(e.message || "Analysis failed");
    } finally {
      setAnalyzing(false);
    }
  }, [user, loadClusters, likedCount]);

  return { clusters, loading, analyzing, hasAnalyzed, error, likedCount, progress, runAnalysis, refresh: loadClusters };
}
