import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.49.1/cors";

async function refreshTokenIfNeeded(supabase: any, userId: string) {
  const { data: conn } = await supabase
    .from("spotify_connections")
    .select("*")
    .eq("user_id", userId)
    .single();

  if (!conn) throw new Error("No Spotify connection found");

  // Check if token is expired (with 5 min buffer)
  if (new Date(conn.expires_at) > new Date(Date.now() + 5 * 60 * 1000)) {
    return conn.access_token;
  }

  // Refresh the token
  const clientId = Deno.env.get("SPOTIFY_CLIENT_ID")!;
  const clientSecret = Deno.env.get("SPOTIFY_CLIENT_SECRET")!;

  const res = await fetch("https://accounts.spotify.com/api/token", {
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

  const data = await res.json();
  if (data.error) throw new Error(data.error_description || data.error);

  const expires_at = new Date(Date.now() + data.expires_in * 1000).toISOString();

  await supabase
    .from("spotify_connections")
    .update({
      access_token: data.access_token,
      refresh_token: data.refresh_token || conn.refresh_token,
      expires_at,
    })
    .eq("user_id", userId);

  return data.access_token;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Not authenticated" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Invalid session" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const accessToken = await refreshTokenIfNeeded(supabase, user.id);

    // Fetch saved tracks in batches
    let allTracks: any[] = [];
    let offset = 0;
    const limit = 50;
    let total = Infinity;

    while (offset < total && offset < 2000) {
      const res = await fetch(
        `https://api.spotify.com/v1/me/tracks?limit=${limit}&offset=${offset}`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      const data = await res.json();
      if (data.error) throw new Error(data.error.message);

      total = data.total;
      for (const item of data.items) {
        const track = item.track;
        allTracks.push({
          user_id: user.id,
          spotify_track_id: track.id,
          track_name: track.name,
          artist_name: track.artists.map((a: any) => a.name).join(", "),
          album_name: track.album?.name || null,
          image_url: track.album?.images?.[0]?.url || null,
          release_date: track.album?.release_date || null,
          added_at: item.added_at,
        });
      }
      offset += limit;
    }

    // Upsert tracks in batches of 100
    let imported = 0;
    for (let i = 0; i < allTracks.length; i += 100) {
      const batch = allTracks.slice(i, i + 100);
      const { error } = await supabase
        .from("imported_tracks")
        .upsert(batch, { onConflict: "user_id,spotify_track_id" });
      if (!error) imported += batch.length;
    }

    return new Response(JSON.stringify({
      success: true,
      total_found: total,
      imported,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
