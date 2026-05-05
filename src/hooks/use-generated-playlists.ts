import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./use-auth";

export interface GeneratedPlaylist {
  id: string;
  name: string;
  description: string | null;
  concept: string | null;
  vibe: string | null;
  context: string | null;
  status: string;
  is_exported_to_spotify: boolean;
  spotify_url: string | null;
  spotify_playlist_id: string | null;
  snapshot_id?: string | null;
  is_public?: boolean;
  last_export_error?: string | null;
  last_export_step?: string | null;
  exported_at?: string | null;
  created_at: string;
  track_count?: number;
}

export interface GeneratedTrack {
  id: string;
  position: number;
  fit_score: number | null;
  reason_for_inclusion: string | null;
  track_id: string;
  spotify_track_id: string;
  name: string;
  artist_names: string[];
  album_name: string | null;
  image_url: string | null;
}

export function useGeneratedPlaylists() {
  const { user } = useAuth();
  const [playlists, setPlaylists] = useState<GeneratedPlaylist[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const { data: pls } = await supabase
      .from("generated_playlists")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    const ids = (pls ?? []).map((p) => p.id);
    const counts = new Map<string, number>();
    if (ids.length) {
      const { data: rows } = await supabase
        .from("generated_playlist_tracks")
        .select("generated_playlist_id")
        .in("generated_playlist_id", ids);
      for (const r of rows ?? []) {
        counts.set(r.generated_playlist_id, (counts.get(r.generated_playlist_id) ?? 0) + 1);
      }
    }
    setPlaylists((pls ?? []).map((p) => ({ ...p, track_count: counts.get(p.id) ?? 0 })));
    setLoading(false);
  }, [user]);

  useEffect(() => { void refresh(); }, [refresh]);
  return { playlists, loading, refresh };
}

export function useGeneratedPlaylistDetail(playlistId: string | null) {
  const [playlist, setPlaylist] = useState<GeneratedPlaylist | null>(null);
  const [tracks, setTracks] = useState<GeneratedTrack[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!playlistId) return;
    setLoading(true);
    const [{ data: pl }, { data: rows }] = await Promise.all([
      supabase.from("generated_playlists").select("*").eq("id", playlistId).maybeSingle(),
      supabase
        .from("generated_playlist_tracks")
        .select("id, position, fit_score, reason_for_inclusion, track_id, tracks:track_id(spotify_track_id, name, artist_names, album_name)")
        .eq("generated_playlist_id", playlistId)
        .order("position", { ascending: true }),
    ]);

    setPlaylist(pl as GeneratedPlaylist | null);

    const sids = (rows ?? []).map((r: any) => r.tracks?.spotify_track_id).filter(Boolean) as string[];
    const imageMap = new Map<string, string | null>();
    if (sids.length) {
      const { data: imgs } = await supabase
        .from("liked_songs")
        .select("spotify_track_id, image_url")
        .in("spotify_track_id", sids);
      for (const i of imgs ?? []) imageMap.set(i.spotify_track_id, i.image_url);
    }

    const mapped: GeneratedTrack[] = (rows ?? []).map((r: any) => ({
      id: r.id,
      position: r.position,
      fit_score: r.fit_score,
      reason_for_inclusion: r.reason_for_inclusion,
      track_id: r.track_id,
      spotify_track_id: r.tracks?.spotify_track_id ?? "",
      name: r.tracks?.name ?? "Unknown",
      artist_names: r.tracks?.artist_names ?? [],
      album_name: r.tracks?.album_name ?? null,
      image_url: imageMap.get(r.tracks?.spotify_track_id) ?? null,
    }));
    setTracks(mapped);
    setLoading(false);
  }, [playlistId]);

  useEffect(() => { void load(); }, [load]);

  const removeTrack = useCallback(async (rowId: string) => {
    await supabase.from("generated_playlist_tracks").delete().eq("id", rowId);
    setTracks((t) => t.filter((x) => x.id !== rowId).map((x, i) => ({ ...x, position: i + 1 })));
  }, []);

  const move = useCallback(async (rowId: string, dir: -1 | 1) => {
    setTracks((cur) => {
      const idx = cur.findIndex((t) => t.id === rowId);
      const ni = idx + dir;
      if (idx < 0 || ni < 0 || ni >= cur.length) return cur;
      const next = [...cur];
      [next[idx], next[ni]] = [next[ni], next[idx]];
      const reordered = next.map((t, i) => ({ ...t, position: i + 1 }));
      // persist async
      void Promise.all(reordered.map((t) =>
        supabase.from("generated_playlist_tracks").update({ position: t.position }).eq("id", t.id),
      ));
      return reordered;
    });
  }, []);

  const updateMeta = useCallback(async (patch: { name?: string; description?: string | null }) => {
    if (!playlistId) return;
    await supabase.from("generated_playlists").update(patch).eq("id", playlistId);
    setPlaylist((p) => (p ? { ...p, ...patch } : p));
  }, [playlistId]);

  return useMemo(() => ({ playlist, tracks, loading, refresh: load, removeTrack, move, updateMeta }),
    [playlist, tracks, loading, load, removeTrack, move, updateMeta]);
}
