import { useCallback, useEffect, useState, useRef } from "react";
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

const MIN_TAGGED_SONGS = 10;

async function fetchAllFromTable(table: "liked_song_clusters" | "liked_song_cluster_tracks" | "liked_songs", userId: string, columns: string) {
  const all: any[] = [];
  let from = 0;
  while (true) {
    const { data } = await (supabase.from(table) as any).select(columns).eq("user_id", userId).range(from, from + 999);
    const rows = data || [];
    all.push(...rows);
    if (rows.length < 1000) break;
    from += 1000;
  }
  return all;
}

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
  const abortRef = useRef(false);

  const getDeepTagCounts = useCallback(async () => {
    if (!user) return { total: 0, tagged: 0 };

    const [totalRes, taggedRes] = await Promise.all([
      supabase.from("liked_songs").select("id", { count: "exact", head: true }).eq("user_id", user.id),
      supabase.from("liked_songs").select("id", { count: "exact", head: true }).eq("user_id", user.id).not("groove_feel", "is", null),
    ]);

    return {
      total: totalRes.count ?? 0,
      tagged: taggedRes.count ?? 0,
    };
  }, [user]);

  const loadClusters = useCallback(async () => {
    if (!user || !spotifyConnected) { setClusters([]); return; }
    setLoading(true);

    const { total: totalSongs, tagged: totalAnalyzed } = await getDeepTagCounts();
    setLikedCount(totalSongs);
    setProgress(prev => ({ ...prev, totalAnalyzed, totalSongs }));

    const clusterData = await fetchAllFromTable("liked_song_clusters", user.id,
      "id, name, description, vibe_description, ai_explanation, mood_tags, color_hex, energy_level, tempo_range, era_range, track_count, sort_order, cover_tracks, spotify_playlist_id, spotify_exported_at, spotify_playlist_url");

    if (!clusterData.length) {
      setClusters([]); setHasAnalyzed(false); setLoading(false); return;
    }

    // Fetch ALL cluster tracks in one go (not per-cluster)
    const allTrackData = await fetchAllFromTable("liked_song_cluster_tracks", user.id, "id, cluster_id, liked_song_id, spotify_track_id");

    const likedSongIds = [...new Set(allTrackData.map(t => t.liked_song_id))];
    const songMap = new Map<string, any>();
    for (let i = 0; i < likedSongIds.length; i += 500) {
      const batch = likedSongIds.slice(i, i + 500);
      const { data: songs } = await supabase
        .from("liked_songs")
        .select("id, track_name, artist_name, album_name, image_url, mood, energy, atmosphere")
        .in("id", batch);
      for (const s of songs || []) songMap.set(s.id, s);
    }

    const enriched: LikedSongCluster[] = clusterData.map(c => {
      const clusterTracks = allTrackData
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
        spotify_playlist_id: c.spotify_playlist_id ?? null,
        spotify_exported_at: c.spotify_exported_at ?? null,
        spotify_playlist_url: c.spotify_playlist_url ?? null,
        tracks: clusterTracks,
      };
    });

    setClusters(enriched); setHasAnalyzed(true); setLoading(false);
  }, [user, spotifyConnected, getDeepTagCounts]);

  useEffect(() => { void loadClusters(); }, [loadClusters]);

  const runAnalysis = useCallback(async (options?: { forceRetag?: boolean }) => {
    if (!user) return;
    const forceRetag = options?.forceRetag ?? false;
    abortRef.current = false;

    setAnalyzing(true);
    setError(null);
    setProgress({ ...INITIAL_PROGRESS, totalSongs: likedCount, phase: "tagging", statusMessage: "Starting deep analysis…" });

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData.session?.access_token) throw new Error("Session expired. Please sign in again.");

      // ═══ PHASE 1: Tag songs (skip if already fully tagged and not forcing) ═══
      if (!forceRetag) {
        // Quick check: are all songs already tagged?
        const { total, tagged } = await getDeepTagCounts();

        if (tagged >= total && total > 0) {
          console.log(`[rebuild] All ${total} songs already tagged — skipping Phase 1`);
          setProgress(prev => ({
            ...prev, totalAnalyzed: tagged, totalSongs: total,
            statusMessage: `All ${total} songs already fully tagged — using cached data`,
          }));
          // Skip straight to Phase 2
        } else {
          // Tag only untagged songs
          await tagSongs(forceRetag);
        }
      } else {
        await tagSongs(forceRetag);
      }

      if (abortRef.current) return;

      const { total: totalSongsReady, tagged: taggedSongsReady } = await getDeepTagCounts();
      setProgress(prev => ({
        ...prev,
        totalAnalyzed: taggedSongsReady,
        totalSongs: totalSongsReady,
      }));

      if (taggedSongsReady < MIN_TAGGED_SONGS) {
        throw new Error(`Need more tagged songs. Run tagging first. (${taggedSongsReady}/${totalSongsReady} ready)`);
      }

      // ═══ PHASE 2: Define sonic worlds from full ecosystem ═══
      setProgress(prev => ({
        ...prev, phase: "defining_worlds",
        statusMessage: "Studying your full Spotify ecosystem — playlists, albums, artists…",
      }));

      const worldRes = await supabase.functions.invoke("analyze-liked-songs", {
        body: { mode: "define_worlds" },
      });

      if (worldRes.error || worldRes.data?.error) {
        throw new Error(worldRes.data?.error || worldRes.error?.message || "Failed to define sonic worlds");
      }

      const worlds = worldRes.data?.worlds || [];
      console.log(`[rebuild] Defined ${worlds.length} sonic worlds from ${worldRes.data?.playlists_analyzed ?? 0} playlists`);

      setProgress(prev => ({
        ...prev, worldsCount: worlds.length,
        statusMessage: `Discovered ${worlds.length} sonic worlds in your library`,
      }));

      if (abortRef.current) return;

      // ═══ PHASE 3: Assign all songs to worlds (larger batches) ═══
      setProgress(prev => ({ ...prev, phase: "assigning", statusMessage: "Assigning songs to sonic worlds…" }));

      const totalSongs = worldRes.data?.total_songs || likedCount;
      let offset = 0;
      let assignDone = false;
      const allAssignments: { song_id: string; spotify_track_id: string; world_id: string; confidence: number }[] = [];

      while (!assignDone && !abortRef.current) {
        const assignRes = await supabase.functions.invoke("analyze-liked-songs", {
          body: { mode: "assign_batch", world_definitions: worlds, offset, batch_size: 50 },
        });

        if (assignRes.error || assignRes.data?.error) {
          console.error("Assign error:", assignRes.data?.error || assignRes.error);
          break;
        }

        allAssignments.push(...(assignRes.data?.assignments || []));
        assignDone = assignRes.data?.done ?? true;
        offset += 50;

        setProgress(prev => ({
          ...prev, assignedCount: allAssignments.length,
          statusMessage: `${allAssignments.length} of ${totalSongs} songs assigned to worlds…`,
        }));
      }

      if (abortRef.current) return;

      // ═══ PHASE 4: Save clusters progressively ═══
      setProgress(prev => ({ ...prev, phase: "saving", statusMessage: "Building playlists from sonic worlds…" }));

      // Clear old clusters
      const existingClusters = await fetchAllFromTable("liked_song_clusters", user.id, "id");
      if (existingClusters.length) {
        const ids = existingClusters.map(c => c.id);
        for (let i = 0; i < ids.length; i += 50) {
          await supabase.from("liked_song_cluster_tracks").delete().in("cluster_id", ids.slice(i, i + 50));
        }
        await supabase.from("liked_song_clusters").delete().eq("user_id", user.id);
      }

      // Group by world
      const worldMap = new Map<string, typeof allAssignments>();
      for (const a of allAssignments) {
        if (a.world_id === "__unassigned__") continue;
        if (!worldMap.has(a.world_id)) worldMap.set(a.world_id, []);
        worldMap.get(a.world_id)!.push(a);
      }

      // Fetch song metadata for covers
      const songIds = allAssignments.map(a => a.song_id);
      const songMap = new Map<string, any>();
      for (let i = 0; i < songIds.length; i += 500) {
        const { data: songs } = await supabase.from("liked_songs")
          .select("id, track_name, image_url").in("id", songIds.slice(i, i + 500));
        for (const s of songs || []) songMap.set(s.id, s);
      }

      let sortOrder = 0;
      let savedCount = 0;
      const totalWorlds = worlds.filter((w: any) => (worldMap.get(w.world_id)?.length ?? 0) >= 2).length;

      for (const world of worlds) {
        const assignments = worldMap.get(world.world_id);
        if (!assignments || assignments.length < 2) continue;

        const coverTracks: { image_url: string; track_name: string }[] = [];
        for (const a of assignments) {
          if (coverTracks.length >= 4) break;
          const song = songMap.get(a.song_id);
          if (song?.image_url) coverTracks.push({ image_url: song.image_url, track_name: song.track_name });
        }

        const { data: inserted, error: insertErr } = await supabase
          .from("liked_song_clusters")
          .insert({
            user_id: user.id, name: world.name,
            description: world.ai_explanation || null,
            vibe_description: world.vibe_description || null,
            ai_explanation: world.ai_explanation || null,
            mood_tags: world.mood_tags || [],
            color_hex: world.color_hex || "#6366f1",
            energy_level: world.energy_level || "medium",
            tempo_range: "Mixed", era_range: "Mixed",
            track_count: assignments.length,
            cover_tracks: coverTracks,
            analysis_model: "deep-sonic-worlds-v3",
            sort_order: sortOrder++,
          })
          .select("id").single();

        if (insertErr || !inserted) { console.error("Insert err:", insertErr); continue; }

        const rows = assignments.map(a => ({
          user_id: user.id, cluster_id: inserted.id,
          liked_song_id: a.song_id, spotify_track_id: a.spotify_track_id,
          confidence_score: a.confidence,
        }));
        for (let i = 0; i < rows.length; i += 100) {
          await supabase.from("liked_song_cluster_tracks").insert(rows.slice(i, i + 100));
        }

        savedCount++;
        setProgress(prev => ({
          ...prev,
          statusMessage: `Saved ${savedCount} of ${totalWorlds} playlists…`,
        }));
      }

      // Uncategorized bucket
      const unassigned = allAssignments.filter(a => a.world_id === "__unassigned__");
      if (unassigned.length >= 3) {
        const covers: { image_url: string; track_name: string }[] = [];
        for (const a of unassigned.slice(0, 4)) {
          const s = songMap.get(a.song_id);
          if (s?.image_url) covers.push({ image_url: s.image_url, track_name: s.track_name });
        }
        const { data: uc } = await supabase.from("liked_song_clusters")
          .insert({
            user_id: user.id, name: "Uncategorized",
            description: "Songs that didn't strongly match any sonic world.",
            vibe_description: "Diverse tracks awaiting deeper classification",
            mood_tags: ["eclectic"], color_hex: "#71717a", energy_level: "medium",
            track_count: unassigned.length, cover_tracks: covers,
            analysis_model: "deep-sonic-worlds-v3", sort_order: sortOrder++,
          }).select("id").single();
        if (uc) {
          const rows = unassigned.map(a => ({
            user_id: user.id, cluster_id: uc.id,
            liked_song_id: a.song_id, spotify_track_id: a.spotify_track_id,
            confidence_score: a.confidence,
          }));
          for (let i = 0; i < rows.length; i += 100) {
            await supabase.from("liked_song_cluster_tracks").insert(rows.slice(i, i + 100));
          }
        }
      }

      // ═══ PHASE 5: Refine — remove outliers, merge small clusters ═══
      setProgress(prev => ({ ...prev, phase: "refining", statusMessage: "Running final coherence check…" }));

      try {
        const refineRes = await supabase.functions.invoke("analyze-liked-songs", {
          body: { mode: "refine" },
        });
        if (refineRes.data) {
          const { removals = 0, merges = 0, deletions = 0 } = refineRes.data;
          console.log(`[rebuild] Refined: ${removals} removals, ${merges} merges, ${deletions} deletions`);
        }
      } catch (e) {
        console.warn("Refine phase skipped:", e);
      }

      // ═══ DONE ═══
      setProgress(prev => ({ ...prev, phase: "done", statusMessage: "Playlists ready!" }));
      await loadClusters();

    } catch (e: any) {
      setError(e.message || "Analysis failed");
    } finally {
      setAnalyzing(false);
    }
  }, [user, loadClusters, likedCount, getDeepTagCounts]);

  // Helper for tagging phase
  async function tagSongs(forceRetag: boolean) {
    setProgress(prev => ({ ...prev, phase: "tagging", statusMessage: "Analyzing each song across 17 musical dimensions…" }));

    let tagDone = false;
    let batchNum = 0;
    let consecutiveErrors = 0;

    while (!tagDone && batchNum < 200 && !abortRef.current) {
      batchNum++;
      try {
        const tagRes = await supabase.functions.invoke("analyze-liked-songs", {
          body: {
            mode: "tag_only",
            batch_size: 50,
            ...(batchNum === 1 && forceRetag ? { force_retag: true } : {}),
          },
        });

        if (tagRes.error) {
          const msg = tagRes.error.message || "Tagging failed";
          console.error("Tag error:", msg, tagRes.error);
          consecutiveErrors++;
          if (consecutiveErrors >= 3) {
            throw new Error(`Tagging failed after ${consecutiveErrors} retries: ${msg}`);
          }
          // Wait and retry on transient errors
          await new Promise(r => setTimeout(r, 2000 * consecutiveErrors));
          continue;
        }

        if (tagRes.data?.error) {
          console.error("Tag data error:", tagRes.data.error);
          throw new Error(tagRes.data.error);
        }

        consecutiveErrors = 0; // Reset on success
        tagDone = tagRes.data?.done ?? true;
        setProgress(prev => ({
          ...prev,
          totalAnalyzed: tagRes.data?.total_analyzed ?? prev.totalAnalyzed,
          totalSongs: tagRes.data?.total_liked_songs ?? prev.totalSongs,
          statusMessage: tagDone
            ? "All songs analyzed!"
            : `${tagRes.data?.total_analyzed ?? 0} of ${tagRes.data?.total_liked_songs ?? 0} songs analyzed…`,
        }));
      } catch (e: any) {
        if (e.message?.includes("retries")) throw e;
        consecutiveErrors++;
        console.warn(`Tag batch ${batchNum} error (attempt ${consecutiveErrors}):`, e.message);
        if (consecutiveErrors >= 3) throw new Error(`Song analysis failed: ${e.message}`);
        await new Promise(r => setTimeout(r, 2000 * consecutiveErrors));
      }
    }

    if (!abortRef.current && !tagDone) {
      throw new Error("Song tagging did not finish. Please retry.");
    }
  }

  return { clusters, loading, analyzing, hasAnalyzed, error, likedCount, progress, runAnalysis, refresh: loadClusters };
}
