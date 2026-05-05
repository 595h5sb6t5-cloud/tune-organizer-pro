import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // Step is updated as we move through the export pipeline so the client
  // (and the DB) can know exactly where we failed.
  let step = "init";

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    step = "auth";
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userErr } = await supabase.auth.getUser(token);
    if (userErr || !user) return jsonResponse({ error: "Unauthorized", step }, 401);

    step = "parse_input";
    const body = await req.json().catch(() => ({}));
    const {
      // legacy cluster path (kept for backwards compat)
      cluster_id,
      // generated playlist path (preferred)
      generated_playlist_id,
      name,
      description,
      track_ids,
      is_public,
      spotify_playlist_id: directSpotifyPlaylistId,
    } = body ?? {};

    if (!name || !Array.isArray(track_ids) || track_ids.length === 0) {
      return jsonResponse({
        error: "Missing required fields",
        step,
        details: { has_name: !!name, track_ids_count: track_ids?.length ?? 0 },
      }, 400);
    }

    // Mark generated playlist as "exporting" early so the UI can react.
    const markStatus = async (patch: Record<string, unknown>) => {
      if (!generated_playlist_id) return;
      await supabase
        .from("generated_playlists")
        .update(patch)
        .eq("id", generated_playlist_id)
        .eq("user_id", user.id);
    };

    await markStatus({ status: "exporting", last_export_error: null, last_export_step: step });

    step = "check_connection";
    const { data: conn } = await supabase
      .from("spotify_connections")
      .select("access_token, refresh_token, expires_at, spotify_user_id")
      .eq("user_id", user.id)
      .single();

    if (!conn) {
      await markStatus({ status: "failed", last_export_error: "Spotify not connected", last_export_step: step });
      return jsonResponse({ error: "Spotify not connected", step, needs_reauth: true }, 400);
    }

    let accessToken = conn.access_token as string;

    step = "refresh_token";
    const tokenExpired = !conn.expires_at || new Date(conn.expires_at) <= new Date(Date.now() + 60_000);
    // We refresh proactively (also gets latest scopes).
    {
      const clientId = Deno.env.get("SPOTIFY_CLIENT_ID")!;
      const clientSecret = Deno.env.get("SPOTIFY_CLIENT_SECRET")!;
      const refreshRes = await fetch("https://accounts.spotify.com/api/token", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
        },
        body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: conn.refresh_token }),
      });
      const refreshData = await refreshRes.json().catch(() => ({} as any));
      if (refreshData.access_token) {
        accessToken = refreshData.access_token;
        await supabase.from("spotify_connections").update({
          access_token: refreshData.access_token,
          refresh_token: refreshData.refresh_token || conn.refresh_token,
          expires_at: new Date(Date.now() + (refreshData.expires_in || 3600) * 1000).toISOString(),
        }).eq("user_id", user.id);
      } else if (tokenExpired) {
        await markStatus({ status: "failed", last_export_error: "Spotify token expired", last_export_step: step });
        return jsonResponse({
          error: "Spotify token expired. Please reconnect Spotify in Settings.",
          step,
          needs_reauth: true,
        }, 401);
      }
    }

    // Resolve target playlist (update if already exported, otherwise create)
    let spotifyPlaylistId: string | null = directSpotifyPlaylistId || null;
    let isUpdate = false;

    if (!spotifyPlaylistId && generated_playlist_id) {
      const { data: gp } = await supabase
        .from("generated_playlists")
        .select("spotify_playlist_id")
        .eq("id", generated_playlist_id)
        .eq("user_id", user.id)
        .single();
      spotifyPlaylistId = gp?.spotify_playlist_id || null;
    }

    if (!spotifyPlaylistId && cluster_id) {
      const { data: cluster } = await supabase
        .from("liked_song_clusters")
        .select("spotify_playlist_id")
        .eq("id", cluster_id)
        .eq("user_id", user.id)
        .single();
      spotifyPlaylistId = cluster?.spotify_playlist_id || null;
    }

    if (spotifyPlaylistId) {
      step = "update_existing_playlist_meta";
      isUpdate = true;
      const updMeta = await fetch(`https://api.spotify.com/v1/playlists/${spotifyPlaylistId}`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          description: description || "",
          public: is_public === true,
        }),
      });
      if (!updMeta.ok && updMeta.status !== 200) {
        const detail = await updMeta.text();
        await markStatus({ status: "failed", last_export_error: `Update meta failed: ${detail}`, last_export_step: step });
        return jsonResponse({ error: "Failed to update Spotify playlist", step, details: detail }, 500);
      }

      step = "clear_existing_tracks";
      // Replace tracks (replace endpoint with empty array clears)
      await fetch(`https://api.spotify.com/v1/playlists/${spotifyPlaylistId}/tracks`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ uris: [] }),
      });
    } else {
      step = "fetch_spotify_user";
      let spotifyUserId = conn.spotify_user_id as string | null;
      if (!spotifyUserId) {
        const meRes = await fetch("https://api.spotify.com/v1/me", { headers: { Authorization: `Bearer ${accessToken}` } });
        const meData = await meRes.json();
        spotifyUserId = meData.id;
        if (spotifyUserId) {
          await supabase.from("spotify_connections").update({ spotify_user_id: spotifyUserId }).eq("user_id", user.id);
        }
      }
      if (!spotifyUserId) {
        await markStatus({ status: "failed", last_export_error: "Could not resolve Spotify user", last_export_step: step });
        return jsonResponse({ error: "Could not resolve Spotify user", step }, 500);
      }

      step = "create_playlist";
      const createRes = await fetch(`https://api.spotify.com/v1/users/${spotifyUserId}/playlists`, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          description: `${description || ""}${description ? " · " : ""}Created by Tempo`.trim(),
          public: is_public === true,
        }),
      });
      const createData = await createRes.json().catch(() => ({} as any));

      if (!createRes.ok || !createData.id) {
        const status = createRes.status;
        const errMsg = status === 403
          ? "Spotify permissions insufficient. Please disconnect and reconnect Spotify in Settings."
          : (createData?.error?.message || "Failed to create Spotify playlist");
        await markStatus({ status: "failed", last_export_error: errMsg, last_export_step: step });
        return jsonResponse({
          error: errMsg,
          step,
          needs_reauth: status === 403,
          details: createData,
        }, status === 403 ? 403 : 500);
      }
      spotifyPlaylistId = createData.id;
    }

    step = "add_tracks";
    // Add in batches of 100 IN THE EXACT ORDER provided.
    const uris = (track_ids as string[]).map((id) => `spotify:track:${id}`);
    let lastSnapshotId: string | null = null;
    for (let i = 0; i < uris.length; i += 100) {
      const batch = uris.slice(i, i + 100);
      const addRes = await fetch(`https://api.spotify.com/v1/playlists/${spotifyPlaylistId}/tracks`, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ uris: batch }),
      });
      const addData = await addRes.json().catch(() => ({} as any));
      if (!addRes.ok) {
        const errMsg = addData?.error?.message || `Failed adding tracks at batch starting ${i}`;
        await markStatus({ status: "failed", last_export_error: errMsg, last_export_step: step });
        return jsonResponse({ error: errMsg, step, details: addData, batch_index: i }, 500);
      }
      if (addData?.snapshot_id) lastSnapshotId = addData.snapshot_id;
    }

    const spotifyUrl = `https://open.spotify.com/playlist/${spotifyPlaylistId}`;

    step = "persist_export";
    if (generated_playlist_id) {
      await supabase.from("generated_playlists").update({
        is_exported_to_spotify: true,
        spotify_playlist_id: spotifyPlaylistId,
        spotify_url: spotifyUrl,
        snapshot_id: lastSnapshotId,
        status: "exported",
        is_public: is_public === true,
        exported_at: new Date().toISOString(),
        last_export_error: null,
        last_export_step: null,
      }).eq("id", generated_playlist_id).eq("user_id", user.id);
    }

    if (cluster_id) {
      await supabase.from("liked_song_clusters").update({
        spotify_playlist_id: spotifyPlaylistId,
        spotify_exported_at: new Date().toISOString(),
        spotify_playlist_url: spotifyUrl,
      }).eq("id", cluster_id).eq("user_id", user.id);
    }

    return jsonResponse({
      success: true,
      spotify_playlist_id: spotifyPlaylistId,
      spotify_playlist_url: spotifyUrl,
      snapshot_id: lastSnapshotId,
      is_update: isUpdate,
      tracks_added: track_ids.length,
    });
  } catch (e: any) {
    console.error("[spotify-export-playlist] error:", e, "step:", step);
    return jsonResponse({ error: e?.message ?? "Unknown error", step }, 500);
  }
});
