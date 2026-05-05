import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

async function refreshToken(supabase: any, userId: string) {
  const { data: conn } = await supabase
    .from("spotify_connections")
    .select("access_token, refresh_token, expires_at")
    .eq("user_id", userId).single();
  if (!conn) return null;
  if (conn.expires_at && new Date(conn.expires_at) > new Date(Date.now() + 60_000)) return conn.access_token;
  const clientId = Deno.env.get("SPOTIFY_CLIENT_ID")!;
  const clientSecret = Deno.env.get("SPOTIFY_CLIENT_SECRET")!;
  const r = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}` },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: conn.refresh_token }),
  });
  const d = await r.json().catch(() => ({} as any));
  if (d.access_token) {
    await supabase.from("spotify_connections").update({
      access_token: d.access_token,
      refresh_token: d.refresh_token || conn.refresh_token,
      expires_at: new Date(Date.now() + (d.expires_in || 3600) * 1000).toISOString(),
    }).eq("user_id", userId);
    return d.access_token;
  }
  return conn.access_token;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
    const { data: { user }, error: userErr } = await supabase.auth.getUser(token);
    if (userErr || !user) return json({ error: "Unauthorized" }, 401);

    const { recommendation_id, action } = await req.json().catch(() => ({} as any));
    if (!recommendation_id || !["accept", "reject", "add_to_playlist"].includes(action)) {
      return json({ error: "Invalid input" }, 400);
    }

    const { data: rec } = await supabase
      .from("recommendations")
      .select("*")
      .eq("id", recommendation_id).eq("user_id", user.id).single();
    if (!rec) return json({ error: "Recommendation not found" }, 404);

    if (action === "reject") {
      await supabase.from("recommendations").update({ status: "rejected", updated_at: new Date().toISOString() }).eq("id", rec.id);
      return json({ success: true, status: "rejected" });
    }

    if (action === "accept") {
      await supabase.from("recommendations").update({ status: "accepted", updated_at: new Date().toISOString() }).eq("id", rec.id);
      return json({ success: true, status: "accepted" });
    }

    // add_to_playlist
    if (!rec.based_on_playlist_id || !rec.spotify_track_id) return json({ error: "Missing playlist or spotify track id" }, 400);

    // Ensure tracks row exists
    let { data: trackRow } = await supabase
      .from("tracks").select("id").eq("spotify_track_id", rec.spotify_track_id).maybeSingle();
    if (!trackRow) {
      const { data: created, error: cErr } = await supabase
        .from("tracks")
        .insert({
          spotify_track_id: rec.spotify_track_id,
          name: rec.track_name ?? "Unknown",
          artist_names: rec.artist_name ? [rec.artist_name] : [],
          album_name: rec.album_name,
        })
        .select("id").single();
      if (cErr) return json({ error: "Could not register track", details: cErr.message }, 500);
      trackRow = created;
    }

    const { data: lastRow } = await supabase
      .from("generated_playlist_tracks")
      .select("position").eq("generated_playlist_id", rec.based_on_playlist_id)
      .order("position", { ascending: false }).limit(1).maybeSingle();
    const nextPos = (lastRow?.position ?? 0) + 1;

    const { error: addErr } = await supabase.from("generated_playlist_tracks").insert({
      user_id: user.id,
      generated_playlist_id: rec.based_on_playlist_id,
      track_id: trackRow!.id,
      position: nextPos,
      added_by: "user",
      fit_score: rec.fit_score,
      reason_for_inclusion: rec.recommendation_reason,
    });
    if (addErr) return json({ error: "Failed to add to playlist", details: addErr.message }, 500);

    // If playlist already exported, push to Spotify too
    const { data: pl } = await supabase
      .from("generated_playlists")
      .select("spotify_playlist_id, is_exported_to_spotify")
      .eq("id", rec.based_on_playlist_id).single();
    let pushedToSpotify = false;
    if (pl?.is_exported_to_spotify && pl.spotify_playlist_id) {
      const accessToken = await refreshToken(supabase, user.id);
      if (accessToken) {
        const r = await fetch(`https://api.spotify.com/v1/playlists/${pl.spotify_playlist_id}/tracks`, {
          method: "POST",
          headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({ uris: [`spotify:track:${rec.spotify_track_id}`] }),
        });
        pushedToSpotify = r.ok;
      }
    }

    await supabase.from("recommendations").update({
      status: "accepted",
      updated_at: new Date().toISOString(),
    }).eq("id", rec.id);

    return json({ success: true, status: "accepted", added_to_playlist: true, pushed_to_spotify: pushedToSpotify });
  } catch (e: any) {
    console.error("[recommendation-action] error", e);
    return json({ error: e?.message ?? "Unknown error" }, 500);
  }
});
