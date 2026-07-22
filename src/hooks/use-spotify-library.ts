import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./use-auth";
import { useJobs, type JobType } from "./use-jobs";

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

/** Each stage the sync pipeline goes through, in order */
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

function formatTimeAgo(dateStr: string | null): string | null {
  if (!dateStr) return null;
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

/** Fetch all rows from a table, bypassing the 1000-row default limit */
async function fetchAllRows<T>(
  table: string,
  select: string,
  userId: string,
  orderCol: string,
  ascending = true,
): Promise<T[]> {
  const PAGE = 1000;
  let offset = 0;
  const all: T[] = [];
  while (true) {
    const { data, error } = await (supabase
      .from(table as any)
      .select(select)
      .eq("user_id", userId)
      .order(orderCol, { ascending })
      .range(offset, offset + PAGE - 1) as any);
    if (error || !data || data.length === 0) break;
    all.push(...(data as T[]));
    if (data.length < PAGE) break;
    offset += PAGE;
  }
  return all;
}

const INITIAL_STAGES: SyncStageState[] = [
  { stage: "profile", label: "Reading your profile", status: "pending" },
  { stage: "liked_songs", label: "Importing liked songs", status: "pending" },
  { stage: "albums", label: "Importing saved albums", status: "pending" },
  { stage: "playlists", label: "Importing playlists", status: "pending" },
  { stage: "artists", label: "Importing followed artists", status: "pending" },
  { stage: "tops", label: "Top tracks & recent plays", status: "pending" },
  { stage: "analysis", label: "Audio analysis", status: "pending" },
];

export function useSpotifyLibrary() {
  const { user, profile } = useAuth();
  const spotifyConnected = profile?.spotify_connected ?? false;
  const jobsApi = useJobs();

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

  const setStage = useCallback((stage: SyncStage, status: StageStatus, detail?: string) => {
    setSyncStages(prev =>
      prev.map(s => s.stage === stage ? { ...s, status, detail: detail ?? s.detail } : s)
    );
  }, []);

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

  const getFunctionAuthHeaders = useCallback(async () => {
    let { data: { session }, error } = await supabase.auth.getSession();
    if (error) throw new Error("Tu sesión expiró. Vuelve a iniciar sesión y presiona Sync otra vez.");

    const expiresAt = session?.expires_at ? session.expires_at * 1000 : 0;
    if (session && expiresAt > 0 && expiresAt < Date.now() + 60_000) {
      const refreshed = await supabase.auth.refreshSession();
      session = refreshed.data.session;
      if (refreshed.error) throw new Error("Tu sesión expiró. Vuelve a iniciar sesión y presiona Sync otra vez.");
    }

    if (!session?.access_token) {
      throw new Error("Tu sesión expiró. Vuelve a iniciar sesión y presiona Sync otra vez.");
    }

    return { Authorization: `Bearer ${session.access_token}` };
  }, []);

  const readFunctionError = useCallback(async (error: any, data: any) => {
    let payload = data;
    const response = error?.context;

    if (!payload && response && typeof response.clone === "function") {
      try {
        const text = await response.clone().text();
        payload = text ? JSON.parse(text) : null;
      } catch {
        payload = null;
      }
    }

    const step = typeof payload?.step === "string" ? payload.step : undefined;
    const status = typeof payload?.status === "number" ? payload.status : response?.status;
    const rawMessage = String(payload?.error || error?.message || "No pudimos sincronizar.");

    if (
      status === 401 &&
      (step === "auth_validation" || step === "user_session" || /Invalid session|Unauthorized|Missing Authorization/i.test(rawMessage))
    ) {
      return "Tu sesión expiró. Vuelve a iniciar sesión y presiona Sync otra vez.";
    }

    if (step === "refresh_token" || /Spotify authorization expired/i.test(rawMessage)) {
      return "La autorización de Spotify expiró. Reconecta Spotify en Settings y vuelve a sincronizar.";
    }

    return step ? `${rawMessage} · paso: ${step}` : rawMessage;
  }, []);

  const invokeFunction = useCallback(async <T extends Record<string, any>>(name: string, body: Record<string, any> = {}) => {
    const headers = await getFunctionAuthHeaders();
    const res = await supabase.functions.invoke(name, { body, headers });

    if (res.error) {
      throw new Error(await readFunctionError(res.error, res.data));
    }
    if ((res.data as any)?.error) {
      throw new Error(await readFunctionError(null, res.data));
    }

    return (res.data ?? {}) as T;
  }, [getFunctionAuthHeaders, readFunctionError]);

  const refreshLiked = useCallback(async () => {
    if (!user) return;
    // Get count
    const countRes = await supabase.from("liked_songs").select("id", { count: "exact", head: true }).eq("user_id", user.id);
    setLikedCount(countRes.count ?? 0);
    // Fetch ALL liked songs
    const all = await fetchAllRows<LikedSong>(
      "liked_songs",
      "id, spotify_track_id, track_name, artist_name, album_name, image_url, added_at",
      user.id,
      "added_at",
      false,
    );
    setLikedSongs(all);
  }, [user]);

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

  const refresh = useCallback(async () => {
    if (!user || !spotifyConnected) {
      setPlaylists([]);
      setLikedSongs([]);
      setLikedCount(0);
      setFollowedArtists([]);
      setSavedAlbums([]);
      setAlbumCount(0);
      return;
    }
    setLoading(true);
    await Promise.all([refreshLiked(), refreshPlaylists(), refreshArtists(), refreshAlbums(), loadSyncMeta()]);
    setLoading(false);
  }, [user, spotifyConnected, refreshLiked, refreshPlaylists, refreshArtists, refreshAlbums, loadSyncMeta]);

  const invokeSync = useCallback(async (scope: string, forceFullSync: boolean) => {
    const body: Record<string, any> = { scope };
    if (forceFullSync) body.force_full = true;
    return invokeFunction("spotify-import-tracks", body);
  }, [invokeFunction]);

  const abortRef = useRef(false);

  const resync = useCallback(async (forceFullSync = false) => {
    if (syncing || !user || !spotifyConnected) return;

    abortRef.current = false;
    setSyncing(true);
    setSyncStages(INITIAL_STAGES.map(s => ({ ...s, status: "pending" as StageStatus })));
    setLastSyncResult(null);

    const combinedResult: Record<string, any> = { success: true };

    // Per-stage job helper
    const runStage = async <T,>(
      type: JobType,
      label: string,
      stage: SyncStage,
      fn: (update: (msg: string, processed?: number, total?: number) => void) => Promise<T>,
      opts: { silentFail?: boolean } = {},
    ): Promise<T | null> => {
      const jobId = jobsApi.startJob({
        type,
        label,
        message: `Iniciando ${label.toLowerCase()}…`,
        retry: () => { void resync(forceFullSync); },
      });
      setStage(stage, "active");
      try {
        const result = await fn((msg, processed, total) => {
          setStage(stage, "active", msg);
          jobsApi.updateJob(jobId, {
            message: msg,
            ...(processed != null ? { itemsProcessed: processed } : {}),
            ...(total != null ? { totalItems: total } : {}),
          });
        });
        jobsApi.completeJob(jobId, `${label} · listo`);
        return result;
      } catch (e: any) {
        const msg = e?.message ?? "Error desconocido";
        if (opts.silentFail) {
          setStage(stage, "skipped", msg);
          jobsApi.completeJob(jobId, `${label} · omitido`);
          return null;
        }
        setStage(stage, "error", msg);
        jobsApi.failJob(jobId, msg, { step: stage, technical: e?.stack });
        throw e;
      }
    };

    try {
      await runStage("spotify_import", "Leyendo perfil de Spotify", "profile", async (update) => {
        update("Leyendo tu perfil…");
        await invokeFunction("spotify-sync-extras", {});
        setStage("profile", "done", "ready");
      }, { silentFail: true });
      if (abortRef.current) return;

      await runStage("sync_liked", "Sincronizando liked songs", "liked_songs", async (update) => {
        update("Importando liked songs…");
        const likedRes = await invokeSync("liked", forceFullSync);
        Object.assign(combinedResult, likedRes);
        const added = likedRes.liked_songs_added ?? 0;
        const removed = likedRes.liked_songs_removed ?? 0;
        const total = likedRes.liked_songs_total ?? added;
        const message = removed > 0
          ? `${added} nuevas · ${removed} removidas · ${total} liked songs`
          : `${added} nuevas · ${total} liked songs`;
        update(message, total, total);
        setStage("liked_songs", "done", `${added} new`);
        await refreshLiked();
      });
      if (abortRef.current) return;

      await runStage("sync_albums", "Sincronizando álbumes guardados", "albums", async (update) => {
        update("Importando álbumes…");
        const albumRes = await invokeSync("albums", forceFullSync);
        Object.assign(combinedResult, albumRes);
        const added = albumRes.albums_added ?? 0;
        update(`+${added} álbumes`, added);
        setStage("albums", "done", `+${added}`);
        await refreshAlbums();
      });
      if (abortRef.current) return;

      await runStage("sync_playlists", "Sincronizando playlists", "playlists", async (update) => {
        let playlistsRemaining = Infinity;
        let totalPlaylistTracksSynced = 0;
        let plBatchNum = 0;
        while (playlistsRemaining > 0) {
          plBatchNum++;
          update(`Procesando lote ${plBatchNum}…`);
          const plRes = await invokeSync("playlists", forceFullSync);
          Object.assign(combinedResult, plRes);
          totalPlaylistTracksSynced += plRes.playlist_tracks_synced ?? 0;
          playlistsRemaining = plRes.playlists_remaining ?? 0;
          const totalPL = (plRes.total_playlists ?? 0);
          const processedPL = totalPL - playlistsRemaining;
          update(
            `Lote ${plBatchNum}: ${plRes.playlist_tracks_synced ?? 0} canciones · ${playlistsRemaining} playlists restantes`,
            processedPL > 0 ? processedPL : totalPlaylistTracksSynced,
            totalPL > 0 ? totalPL : undefined,
          );
          setStage("playlists", "active", `batch ${plBatchNum}: ${plRes.playlist_tracks_synced ?? 0} tracks, ${playlistsRemaining} playlists remaining`);
          if (plBatchNum > 50) break;
        }
        update(`${totalPlaylistTracksSynced} canciones sincronizadas`, totalPlaylistTracksSynced, totalPlaylistTracksSynced);
        setStage("playlists", "done", `${totalPlaylistTracksSynced} tracks synced`);
        await refreshPlaylists();
      });
      if (abortRef.current) return;

      await runStage("sync_artists", "Sincronizando artistas seguidos", "artists", async (update) => {
        update("Importando artistas…");
        const artRes = await invokeSync("artists", forceFullSync);
        Object.assign(combinedResult, artRes);
        const added = artRes.artists_added ?? 0;
        update(`+${added} artistas`, added);
        setStage("artists", "done", `+${added}`);
        await refreshArtists();
      });
      if (abortRef.current) return;

      await runStage("spotify_import", "Top tracks y reproducciones recientes", "tops", async (update) => {
        update("Cargando tops…");
        const t = await invokeFunction("spotify-sync-extras", {});
        update(`${t.top_tracks ?? 0} tops · ${t.recent_plays ?? 0} recientes`);
        setStage("tops", "done", `${t.top_tracks ?? 0} tops · ${t.recent_plays ?? 0} recent`);
      }, { silentFail: true });

      await runStage("ai_analysis", "Análisis de audio Spotify", "analysis", async (update) => {
        update("Analizando audio…");
        const analysisRes = await invokeFunction("spotify-import-tracks", {
          scope: "all",
          skip_core: false,
          ...(forceFullSync ? { force_full: true } : {}),
        });
        const featureCount = analysisRes.audio_features ?? 0;
        update(featureCount > 0 ? `${featureCount} tracks analizados` : "Al día");
        setStage("analysis", "done", featureCount > 0 ? `${featureCount} tracks` : "up to date");
      }, { silentFail: true });

      combinedResult.sync_mode = forceFullSync ? "full" : "incremental";
      setLastSyncResult(combinedResult);
      await loadSyncMeta();
    } catch (e: any) {
      setSyncStages(prev =>
        prev.map(s => s.status === "active" ? { ...s, status: "error" as StageStatus, detail: e.message } : s)
      );
      await loadSyncMeta();
      throw e;
    } finally {
      setSyncing(false);
    }
  }, [syncing, user, spotifyConnected, invokeSync, invokeFunction, refreshLiked, refreshAlbums, refreshPlaylists, refreshArtists, loadSyncMeta, setStage, jobsApi]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    return () => { abortRef.current = true; };
  }, []);

  const lastSyncedLabel = formatTimeAgo(syncMeta.lastIncrementalSyncAt || syncMeta.lastFullSyncAt);
  const allDone = syncing === false && syncStages.some(s => s.status === "done");

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
