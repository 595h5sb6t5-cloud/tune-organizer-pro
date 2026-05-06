import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

async function spotifyFetch(url: string, token: string) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const text = await res.text();
  let body: any = null;
  try { body = JSON.parse(text); } catch { body = { raw: text.slice(0, 500) }; }
  const headers: Record<string, string> = {};
  res.headers.forEach((v, k) => { headers[k] = v; });
  return { status: res.status, ok: res.ok, body, headers };
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
    .select("access_token, refresh_token, expires_at, spotify_user_id, updated_at, created_at")
    .eq("user_id", user.id).single();
  if (!conn) return new Response(JSON.stringify({ error: "no spotify connection" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  let token = conn.access_token;
  let refreshed = false;
  if (new Date(conn.expires_at) <= new Date(Date.now() + 30 * 1000)) {
    const r = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: `Basic ${btoa(`${Deno.env.get("SPOTIFY_CLIENT_ID")}:${Deno.env.get("SPOTIFY_CLIENT_SECRET")}`)}` },
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

  const me = await spotifyFetch("https://api.spotify.com/v1/me", token);
  const playlistId = "3DFFXGlZHn4a17Haa4KmDZ";
  const meta = await spotifyFetch(`https://api.spotify.com/v1/playlists/${playlistId}`, token);
  const tracks = await spotifyFetch(`https://api.spotify.com/v1/playlists/${playlistId}/tracks?limit=100`, token);

  return new Response(JSON.stringify({
    token_info: {
      connection_created_at: conn.created_at,
      connection_updated_at: conn.updated_at,
      expires_at: conn.expires_at,
      refreshed_now: refreshed,
      token_prefix: token?.slice(0, 12) + "...",
    },
    me: { status: me.status, id: me.body?.id, display_name: me.body?.display_name },
    playlist_meta: {
      status: meta.status,
      name: meta.body?.name,
      owner_id: meta.body?.owner?.id,
      public: meta.body?.public,
      collaborative: meta.body?.collaborative,
      total_tracks: meta.body?.tracks?.total,
      error: meta.body?.error,
    },
    playlist_tracks: {
      status: tracks.status,
      ok: tracks.ok,
      items_returned: Array.isArray(tracks.body?.items) ? tracks.body.items.length : null,
      total: tracks.body?.total ?? null,
      error: tracks.body?.error ?? null,
      headers: {
        "www-authenticate": tracks.headers["www-authenticate"] ?? null,
        "retry-after": tracks.headers["retry-after"] ?? null,
        "x-ratelimit-remaining": tracks.headers["x-ratelimit-remaining"] ?? null,
        "content-type": tracks.headers["content-type"] ?? null,
      },
    },
  }, null, 2), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 });
});
