import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function refreshTokenIfNeeded(supabase: ReturnType<typeof createClient>, userId: string) {
  const { data: conn, error } = await supabase
    .from("spotify_connections")
    .select("access_token, refresh_token, expires_at")
    .eq("user_id", userId)
    .single();

  if (error || !conn) {
    throw new Error("No Spotify connection found.");
  }

  if (new Date(conn.expires_at) > new Date(Date.now() + 5 * 60 * 1000)) {
    return conn.access_token;
  }

  const clientId = Deno.env.get("SPOTIFY_CLIENT_ID");
  const clientSecret = Deno.env.get("SPOTIFY_CLIENT_SECRET");

  if (!clientId || !clientSecret) {
    throw new Error("Spotify credentials are not fully configured.");
  }

  const refreshRes = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: conn.refresh_token,
    }),
  });

  const refreshData = await refreshRes.json();
  if (!refreshRes.ok || refreshData.error) {
    throw new Error(refreshData.error_description || refreshData.error || "Spotify token refresh failed.");
  }

  const expires_at = new Date(Date.now() + refreshData.expires_in * 1000).toISOString();

  const { error: updateError } = await supabase
    .from("spotify_connections")
    .update({
      access_token: refreshData.access_token,
      refresh_token: refreshData.refresh_token || conn.refresh_token,
      expires_at,
    })
    .eq("user_id", userId);

  if (updateError) {
    throw new Error(updateError.message);
  }

  return refreshData.access_token;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return json({ error: "Not authenticated." }, 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_ANON_KEY");

    if (!supabaseUrl || !supabaseKey) {
      return json({ error: "Backend client configuration is missing." }, 500);
    }

    const supabase = createClient(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return json({ error: "Invalid session." }, 401);
    }

    const accessToken = await refreshTokenIfNeeded(supabase, user.id);

    const allTracks: Array<{
      user_id: string;
      spotify_track_id: string;
      track_name: string;
      artist_name: string;
      album_name: string | null;
      image_url: string | null;
      release_date: string | null;
      added_at: string | null;
    }> = [];

    let offset = 0;
    const limit = 50;
    let total = Infinity;

    while (offset < total && offset < 2000) {
      const spotifyRes = await fetch(
        `https://api.spotify.com/v1/me/tracks?limit=${limit}&offset=${offset}`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      const spotifyData = await spotifyRes.json();

      if (!spotifyRes.ok || spotifyData.error) {
        throw new Error(spotifyData.error?.message || "Failed to import Spotify library.");
      }

      total = spotifyData.total;

      for (const item of spotifyData.items ?? []) {
        const track = item.track;
        if (!track?.id) continue;

        allTracks.push({
          user_id: user.id,
          spotify_track_id: track.id,
          track_name: track.name,
          artist_name: (track.artists ?? []).map((artist: { name: string }) => artist.name).join(", "),
          album_name: track.album?.name || null,
          image_url: track.album?.images?.[0]?.url || null,
          release_date: track.album?.release_date || null,
          added_at: item.added_at || null,
        });
      }

      offset += limit;
    }

    for (let index = 0; index < allTracks.length; index += 100) {
      const batch = allTracks.slice(index, index + 100);
      const { error } = await supabase
        .from("imported_tracks")
        .upsert(batch, { onConflict: "user_id,spotify_track_id", ignoreDuplicates: true });

      if (error) {
        throw new Error(error.message);
      }
    }

    return json({
      success: true,
      total_found: Number.isFinite(total) ? total : allTracks.length,
      imported: allTracks.length,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Spotify import failed.";
    return json({ error: message }, 500);
  }
});
