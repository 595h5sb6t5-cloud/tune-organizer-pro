import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Verify user
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userErr } = await supabase.auth.getUser(token);
    if (userErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const body = await req.json();
    const { cluster_id, name, description, track_ids, spotify_playlist_id: directSpotifyPlaylistId } = body;
    console.log("[spotify-export-playlist] received:", JSON.stringify({ cluster_id, name, track_ids_count: track_ids?.length ?? 0, directSpotifyPlaylistId }));
    if (!name || !track_ids?.length) {
      return new Response(JSON.stringify({ error: "Missing required fields", details: { has_cluster_id: !!cluster_id, has_name: !!name, track_ids_count: track_ids?.length ?? 0 } }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Get Spotify tokens
    const { data: conn } = await supabase
      .from("spotify_connections")
      .select("access_token, refresh_token, expires_at, spotify_user_id")
      .eq("user_id", user.id)
      .single();

    if (!conn) {
      return new Response(JSON.stringify({ error: "Spotify not connected" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    let accessToken = conn.access_token;

    // Always refresh token to ensure we have latest scopes
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
    const refreshData = await refreshRes.json();
    if (refreshData.access_token) {
      accessToken = refreshData.access_token;
      await supabase.from("spotify_connections").update({
        access_token: refreshData.access_token,
        refresh_token: refreshData.refresh_token || conn.refresh_token,
        expires_at: new Date(Date.now() + (refreshData.expires_in || 3600) * 1000).toISOString(),
      }).eq("user_id", user.id);
    } else if (new Date(conn.expires_at) <= new Date()) {
      return new Response(JSON.stringify({ error: "Spotify token expired. Please reconnect Spotify in Settings." }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Check if this cluster was already exported
    const { data: cluster } = await supabase
      .from("liked_song_clusters")
      .select("spotify_playlist_id")
      .eq("id", cluster_id)
      .eq("user_id", user.id)
      .single();

    let spotifyPlaylistId = cluster?.spotify_playlist_id;
    let isUpdate = false;

    if (spotifyPlaylistId) {
      // Update existing playlist — clear tracks and re-add
      isUpdate = true;
      // Update name/description
      await fetch(`https://api.spotify.com/v1/playlists/${spotifyPlaylistId}`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ name, description: description || "" }),
      });

      // Clear existing tracks
      const existingRes = await fetch(`https://api.spotify.com/v1/playlists/${spotifyPlaylistId}/tracks?limit=100`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const existingData = await existingRes.json();
      if (existingData.items?.length > 0) {
        await fetch(`https://api.spotify.com/v1/playlists/${spotifyPlaylistId}/tracks`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({ tracks: existingData.items.map((t: any) => ({ uri: t.track.uri })) }),
        });
      }
    } else {
      // Create new playlist
      let spotifyUserId = conn.spotify_user_id;
      if (!spotifyUserId) {
        const meRes = await fetch("https://api.spotify.com/v1/me", { headers: { Authorization: `Bearer ${accessToken}` } });
        const meData = await meRes.json();
        spotifyUserId = meData.id;
        await supabase.from("spotify_connections").update({ spotify_user_id: spotifyUserId }).eq("user_id", user.id);
      }

      const createRes = await fetch(`https://api.spotify.com/v1/users/${spotifyUserId}/playlists`, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ name, description: `${description || ""} · Created by Tempo`, public: false }),
      });
      const createData = await createRes.json();

      if (!createRes.ok || !createData.id) {
        const status = createRes.status;
        if (status === 403) {
          return new Response(JSON.stringify({
            error: "Spotify permissions insufficient. Please disconnect and reconnect Spotify in Settings to grant playlist creation permissions.",
            needs_reauth: true,
          }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        return new Response(JSON.stringify({ error: "Failed to create Spotify playlist", details: createData }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      spotifyPlaylistId = createData.id;
    }

    // Add tracks in batches of 100
    const uris = track_ids.map((id: string) => `spotify:track:${id}`);
    for (let i = 0; i < uris.length; i += 100) {
      const batch = uris.slice(i, i + 100);
      await fetch(`https://api.spotify.com/v1/playlists/${spotifyPlaylistId}/tracks`, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ uris: batch }),
      });
    }

    const spotifyUrl = `https://open.spotify.com/playlist/${spotifyPlaylistId}`;

    // Update cluster with Spotify info
    await supabase.from("liked_song_clusters").update({
      spotify_playlist_id: spotifyPlaylistId,
      spotify_exported_at: new Date().toISOString(),
      spotify_playlist_url: spotifyUrl,
    }).eq("id", cluster_id).eq("user_id", user.id);

    return new Response(JSON.stringify({
      success: true,
      spotify_playlist_id: spotifyPlaylistId,
      spotify_playlist_url: spotifyUrl,
      is_update: isUpdate,
      tracks_added: track_ids.length,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (e: any) {
    console.error("[spotify-export-playlist] error:", e);
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
