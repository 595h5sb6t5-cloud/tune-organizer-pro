import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./use-auth";

export interface SpotifyPlaylist {
  id: string;
  spotify_playlist_id: string;
  name: string;
  description: string | null;
  image_url: string | null;
  track_count: number;
  is_owned_by_user: boolean;
  is_collaborative: boolean;
  owner_display_name: string | null;
  last_synced_at: string;
}

export interface LikedSong {
  id: string;
  spotify_track_id: string;
  track_name: string;
  artist_name: string;
  album_name: string | null;
  image_url: string | null;
  added_at: string | null;
}

export interface FollowedArtist {
  id: string;
  spotify_artist_id: string;
  artist_name: string;
  image_url: string | null;
  genres: string[];
  popularity: number | null;
  top_tracks_count?: number | null;
  top_tracks_synced_at?: string | null;
}

export interface SavedAlbum {
  id: string;
  spotify_album_id: string;
  album_name: string;
  artist_name: string;
  image_url: string | null;
  release_date: string | null;
  total_tracks: number;
  album_type: string | null;
  added_at: string | null;
}

export type SyncStage = "profile" | "liked_songs" | "albums" | "playlists" | "artists" | "tops" | "analysis";
export type StageStatus = "pending" | "active" | "done" | "error" | "skipped";

export interface SyncStageState {
  stage: SyncStage;
  label: string;
  status: StageStatus;
  detail?: string;
}

export type SyncStatus = "idle" | "syncing" | "error";

export interface SyncMetadata {
  syncStatus: SyncStatus;
  syncError: string | null;
  lastFullSyncAt: string | null;
  lastIncrementalSyncAt: string | null;
  lastLibrarySyncAt: string | null;
  lastPlaylistSyncAt: string | null;
  lastArtistSyncAt: string | null;
  lastAlbumSyncAt: string | null;
}

type UseSpotifyLibraryOptions = {
  loadAllLikedSongs?: boolean;
};

const INITIAL_STAGES: SyncStageState[] = [
  { stage: "profile", label: "Reading Spotify profile", status: "pending" },
  { stage: "liked_songs", label: "Liked songs", status: "pending" },
  { stage: "albums", label: "Saved albums", status: "pending" },
  { stage: "playlists", label: "Playlists", status: "pending" },
  { stage: "artists", label: "Followed artists", status: "pending" },
  { stage: "tops", label: "Top tracks & recent plays", status: "pending" },
  { stage: "analysis", label: "Audio analysis", status: "pending" },
];

const STAGE_MAP: Record<string, SyncStage> = {
  profile: "profile",
  liked_songs: "liked_songs",
  saved_albums: "albums",
  playlists: "playlists",
  followed_artists: "artists",
  tops_recent: "tops",
  audio_analysis: "analysis",
};

function formatTimeAgo(dateStr: string | null): string | null {
  if (!dateStr) return null;
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

async function fetchAllRows<T>(
  table: string,
  select: string,
  userId: string,
  orderCol: string,
  ascending = true,
  filters?: (query: any) => any,
): Promise<T[]> {
  const pageSize = 1000;
  let offset = 0;
  const all: T[] = [];

  while (true) {
    let query = supabase
      .from(table as any)
      .select(select)
      .eq("user_id", userId)
      .order(orderCol, { ascending })
      .range(offset, offset + pageSize - 1) as any;
    if (filters) query = filters(query);
    const { data, error } = await query;
    if (error) throw error;
    const rows = (data || []) as T[];
    all.push(...rows);
    if (rows.length < pageSize) break;
    offset += pageSize;
  }

  return all;
}

function stageStatus(status: string): StageStatus {
  if (status === "running") return "active";
  if (status === "completed") return "done";
  if (status === "failed") return "error";
  if (status === "skipped") return "skipped";
  return "pending";
}

function stageDetail(row: any): string | undefined {
  if (row.error_message) return String(row.error_message);
  const processed = Number(row.items_processed ?? 0);
  const found = Number(row.items_found ?? 0);
  const created = Number(row.items_created ?? 0);
  const removed = Number(row.items_removed_or_deactivated ?? 0);
  if (row.status === "running" && found > 0) return `${processed} / ${found}`;
  const parts: string[] = [];
  if (processed > 0 || found > 0) parts.push(found > 0 ? `${processed}/${found}` : `${processed}`);
  if (created > 0) parts.push(`+${created}`);
  if (removed > 0) parts.push(`-${removed}`);
  const pendingAi = Number(row.meta?.pending_ai_analysis ?? 0);
  if (pendingAi > 0) parts.push(`${pendingAi} pending AI`);
  return parts.length ? parts.join(" · ") : undefined;
}

function mapStages(rows: any[] | null | undefined): SyncStageState[] {
  if (!rows?.length) return INITIAL_STAGES;
  const byStage = new Map<string, any>();
  for (const row of rows) {
    const stage = STAGE_MAP[row.stage_key];
    if (stage) byStage.set(stage, row);
  }
  return INITIAL_STAGES.map((initial) => {
    const row = byStage.get(initial.stage);
    if (!row) return initial;
    return {
      ...initial,
      label: row.label || initial.label,
      status: stageStatus(String(row.status || "pending")),
      detail: stageDetail(row),
    };
  });
}

function isActiveRun(run: any | null) {
  return !!run && ["pending", "running", "waiting_rate_limit"].includes(String(run.status));
}

export function useSpotifyLibrary(options: UseSpotifyLibraryOptions = {}) {
  const { loadAllLikedSongs = false } = options;
  const { user, profile } = useAuth();
  const spotifyConnected = profile?.spotify_connected ?? false;

  const [playlists, setPlaylists] = useState<SpotifyPlaylist[]>([]);
  const [likedSongs, setLikedSongs] = useState<LikedSong[]>([]);
  const [likedCount, setLikedCount] = useState(0);
  const [followedArtists, setFollowedArtists] = useState<FollowedArtist[]>([]);
  const [savedAlbums, setSavedAlbums] = useState<SavedAlbum[]>([]);
  const [albumCount, setAlbumCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncStages, setSyncStages] = useState<SyncStageState[]>(INITIAL_STAGES);
  const [lastSyncResult, setLastSyncResult] = useState<Record<string, any> | null>(null);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [lastRunStatus, setLastRunStatus] = useState<string | null>(null);
  const pollingRef = useRef<number | null>(null);
  const [syncMeta, setSyncMeta] = useState<SyncMetadata>({
    syncStatus: "idle",
    syncError: null,
    lastFullSyncAt: null,
    lastIncrementalSyncAt: null,
    lastLibrarySyncAt: null,
    lastPlaylistSyncAt: null,
    lastArtistSyncAt: null,
    lastAlbumSyncAt: null,
  });

  const getFunctionAuthHeaders = useCallback(async () => {
    let { data: { session }, error } = await supabase.auth.getSession();
    if (error) throw new Error("Tu sesión expiró. Vuelve a iniciar sesión y presiona Sync otra vez.");

    const expiresAt = session?.expires_at ? session.expires_at * 1000 : 0;
    if (session && expiresAt > 0 && expiresAt < Date.now() + 60_000) {
      const refreshed = await supabase.auth.refreshSession();
      session = refreshed.data.session;
      if (refreshed.error) throw new Error("Tu sesión expiró. Vuelve a iniciar sesión y presiona Sync otra vez.");
    }

    if (!session?.access_token) throw new Error("Tu sesión expiró. Vuelve a iniciar sesión y presiona Sync otra vez.");
    return { Authorization: `Bearer ${session.access_token}` };
  }, []);

  const invokeFunction = useCallback(async <T extends Record<string, any>>(name: string, body: Record<string, any> = {}) => {
    const headers = await getFunctionAuthHeaders();
    const res = await supabase.functions.invoke(name, { body, headers });
    if (res.error) throw new Error(res.error.message || "No pudimos sincronizar.");
    if ((res.data as any)?.error) throw new Error((res.data as any).error);
    return (res.data ?? {}) as T;
  }, [getFunctionAuthHeaders]);

  const loadSyncMeta = useCallback(async () => {
    if (!user || !spotifyConnected) return;
    const { data } = await supabase
      .from("spotify_connections")
      .select("sync_status, sync_error, last_full_sync_at, last_incremental_sync_at, last_library_sync_at, last_playlist_sync_at, last_artist_sync_at, last_album_sync_at")
      .eq("user_id", user.id)
      .single();

    if (data) {
      setSyncMeta({
        syncStatus: (data.sync_status as SyncStatus) || "idle",
        syncError: data.sync_error || null,
        lastFullSyncAt: data.last_full_sync_at || null,
        lastIncrementalSyncAt: data.last_incremental_sync_at || null,
        lastLibrarySyncAt: data.last_library_sync_at || null,
        lastPlaylistSyncAt: data.last_playlist_sync_at || null,
        lastArtistSyncAt: data.last_artist_sync_at || null,
        lastAlbumSyncAt: (data as any).last_album_sync_at || null,
      });
    }
  }, [user, spotifyConnected]);

  const refreshLiked = useCallback(async () => {
    if (!user) return;
    const countRes = await supabase
      .from("liked_songs")
      .select("spotify_track_id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("is_active", true)
      .eq("is_available", true);
    setLikedCount(countRes.count ?? 0);
    if (loadAllLikedSongs) {
      const all = await fetchAllRows<LikedSong>(
        "liked_songs",
        "id, spotify_track_id, track_name, artist_name, album_name, image_url, added_at",
        user.id,
        "added_at",
        false,
        (query) => query.eq("is_active", true).eq("is_available", true),
      );
      setLikedSongs(all);
      return;
    }

    const { data, error } = await supabase
      .from("liked_songs")
      .select("id, spotify_track_id, track_name, artist_name, album_name, image_url, added_at")
      .eq("user_id", user.id)
      .eq("is_active", true)
      .eq("is_available", true)
      .order("added_at", { ascending: false })
      .limit(4);
    if (error) throw error;
    setLikedSongs((data || []) as LikedSong[]);
  }, [user, loadAllLikedSongs]);

  const refreshPlaylists = useCallback(async () => {
    if (!user) return;
    const all = await fetchAllRows<SpotifyPlaylist>(
      "spotify_playlists",
      "id, spotify_playlist_id, name, description, image_url, track_count, is_owned_by_user, is_collaborative, owner_display_name, last_synced_at",
      user.id,
      "name",
      true,
    );
    setPlaylists(all);
  }, [user]);

  const refreshArtists = useCallback(async () => {
    if (!user) return;
    const all = await fetchAllRows<FollowedArtist>(
      "spotify_followed_artists",
      "id, spotify_artist_id, artist_name, image_url, genres, popularity, top_tracks_count, top_tracks_synced_at",
      user.id,
      "artist_name",
      true,
    );
    setFollowedArtists(all);
  }, [user]);

  const refreshAlbums = useCallback(async () => {
    if (!user) return;
    const countRes = await supabase.from("spotify_saved_albums").select("id", { count: "exact", head: true }).eq("user_id", user.id);
    setAlbumCount(countRes.count ?? 0);
    const all = await fetchAllRows<SavedAlbum>(
      "spotify_saved_albums",
      "id, spotify_album_id, album_name, artist_name, image_url, release_date, total_tracks, album_type, added_at",
      user.id,
      "added_at",
      false,
    );
    setSavedAlbums(all);
  }, [user]);

  const refreshData = useCallback(async () => {
    if (!user || !spotifyConnected) {
      setPlaylists([]);
      setLikedSongs([]);
      setLikedCount(0);
      setFollowedArtists([]);
      setSavedAlbums([]);
      setAlbumCount(0);
      return;
    }
    await Promise.all([refreshLiked(), refreshArtists(), refreshAlbums(), loadSyncMeta()]);
  }, [user, spotifyConnected, refreshLiked, refreshArtists, refreshAlbums, loadSyncMeta]);

  const loadRun = useCallback(async (runId?: string | null) => {
    if (!user || !spotifyConnected) return null;
    const res = await invokeFunction<{ run: any | null; stages: any[] }>("spotify-sync-library", {
      action: "status",
      ...(runId ? { run_id: runId } : {}),
    });
    const run = res.run ?? null;
    setSyncStages(mapStages(res.stages));
    setActiveRunId(run?.id ?? null);
    setLastRunStatus(run?.status ?? null);
    setSyncing(isActiveRun(run));
    if (run?.summary) setLastSyncResult(run.summary);
    if (run && !isActiveRun(run)) await refreshData();
    return run;
  }, [user, spotifyConnected, invokeFunction, refreshData]);

  const startPolling = useCallback((runId: string) => {
    if (pollingRef.current) window.clearInterval(pollingRef.current);
    pollingRef.current = window.setInterval(async () => {
      try {
        const run = await loadRun(runId);
        if (!isActiveRun(run) && pollingRef.current) {
          window.clearInterval(pollingRef.current);
          pollingRef.current = null;
        }
      } catch {
        // keep polling; transient auth/network errors should not cancel the backend job
      }
    }, 2500);
  }, [loadRun]);

  const refresh = useCallback(async () => {
    if (!user || !spotifyConnected) {
      await refreshData();
      return;
    }
    setLoading(true);
    try {
      await refreshData();
      const run = await loadRun(activeRunId);
      if (run?.id && isActiveRun(run)) startPolling(run.id);
    } finally {
      setLoading(false);
    }
  }, [user, spotifyConnected, refreshData, loadRun, activeRunId, startPolling]);

  const resync = useCallback(async (forceFullSync = false) => {
    if (!user || !spotifyConnected) return;
    setSyncing(true);
    setLastSyncResult(null);
    const res = await invokeFunction<{ run_id: string; run: any; stages: any[]; reused?: boolean }>("spotify-sync-library", {
      mode: forceFullSync ? "full" : "quick",
    });
    setActiveRunId(res.run_id);
    setLastRunStatus(res.run?.status ?? "running");
    setSyncStages(mapStages(res.stages));
    startPolling(res.run_id);
  }, [user, spotifyConnected, invokeFunction, startPolling]);

  useEffect(() => {
    void refresh();
    return () => {
      if (pollingRef.current) window.clearInterval(pollingRef.current);
    };
  }, [refresh]);

  useEffect(() => {
    if (!user || !spotifyConnected) return;
    const channel = supabase
      .channel(`sync-library-${user.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "sync_run_stages", filter: `user_id=eq.${user.id}` },
        () => { void loadRun(activeRunId); },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "sync_runs", filter: `user_id=eq.${user.id}` },
        () => { void loadRun(activeRunId); },
      )
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [user, spotifyConnected, activeRunId, loadRun]);

  const lastSyncedLabel = formatTimeAgo(syncMeta.lastIncrementalSyncAt || syncMeta.lastFullSyncAt);
  const allDone = ["completed", "completed_with_restrictions"].includes(String(lastRunStatus)) &&
    syncStages.every((stage) => stage.status === "done" || stage.status === "skipped" || stage.status === "error");

  return {
    playlists,
    likedSongs,
    likedCount,
    followedArtists,
    savedAlbums,
    albumCount,
    loading,
    syncing,
    syncStages,
    allDone,
    lastSyncResult,
    syncMeta,
    lastSyncedLabel,
    refresh,
    resync,
  };
}