import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

async function probe(name: string, url: string, token: string) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const text = await res.text();
  let body: any = null;
  try { body = JSON.parse(text); } catch { body = { raw: text.slice(0, 500) }; }

  const wwwAuth = res.headers.get("www-authenticate");
  let itemCount: number | null = null;
  if (body && typeof body === "object") {
    if (Array.isArray(body.items)) itemCount = body.items.length;
    else if (Array.isArray(body?.artists?.items)) itemCount = body.artists.items.length;
    else if (Array.isArray(body?.tracks)) itemCount = body.tracks.length;
  }

  return {
    endpoint: name,
    url,
    status: res.status,
    ok: res.ok,
    item_count: itemCount,
    total: body?.total ?? body?.artists?.total ?? null,
    error_message: body?.error?.message ?? body?.error_description ?? body?.error ?? null,
    error_status: body?.error?.status ?? null,
    www_authenticate: wwwAuth,
    first_playlist_id: name === "GET /v1/me/playlists" ? body?.items?.[0]?.id ?? null : undefined,
    first_playlist_name: name === "GET /v1/me/playlists" ? body?.items?.[0]?.name ?? null : undefined,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return new Response(JSON.stringify({ error: "no auth" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return new Response(JSON.stringify({ error: "no user" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  const admin = createClient(supabaseUrl, serviceKey);
  const { data: conn } = await admin.from("spotify_connections")
    .select("access_token, refresh_token, expires_at")
    .eq("user_id", user.id).single();

  if (!conn) return new Response(JSON.stringify({ error: "no spotify connection" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  let token = conn.access_token;
  let refreshed = false;
  const expired = new Date(conn.expires_at) <= new Date(Date.now() + 30 * 1000);
  if (expired) {
    const clientId = Deno.env.get("SPOTIFY_CLIENT_ID")!;
    const clientSecret = Deno.env.get("SPOTIFY_CLIENT_SECRET")!;
    const r = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}` },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: conn.refresh_token }),
    });
    const j = await r.json();
    if (j.access_token) {
      token = j.access_token;
      refreshed = true;
      await admin.from("spotify_connections").update({
        access_token: j.access_token,
        expires_at: new Date(Date.now() + j.expires_in * 1000).toISOString(),
      }).eq("user_id", user.id);
    }
  }

  const results: any[] = [];
  results.push(await probe("GET /v1/me", "https://api.spotify.com/v1/me", token));
  results.push(await probe("GET /v1/me/tracks", "https://api.spotify.com/v1/me/tracks?limit=50", token));
  const playlistsRes = await probe("GET /v1/me/playlists", "https://api.spotify.com/v1/me/playlists?limit=50", token);
  results.push(playlistsRes);
  results.push(await probe("GET /v1/me/following?type=artist", "https://api.spotify.com/v1/me/following?type=artist&limit=50", token));

  const firstPlaylistId = (playlistsRes as any).first_playlist_id;
  if (firstPlaylistId) {
    results.push(await probe(
      `GET /v1/playlists/${firstPlaylistId}/tracks`,
      `https://api.spotify.com/v1/playlists/${firstPlaylistId}/tracks?limit=100`,
      token,
    ));
  } else {
    results.push({ endpoint: "GET /v1/playlists/{id}/tracks", skipped: "no playlist id available" });
  }

  return new Response(JSON.stringify({
    user_id: user.id,
    token_refreshed_now: refreshed,
    token_expires_at: conn.expires_at,
    results,
  }, null, 2), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 });
});
