import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

async function spotifyFetch(url: string, token: string) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const text = await res.text();
  let body: any = null;
  try { body = JSON.parse(text); } catch { body = { raw: text.slice(0, 300) }; }
  return { status: res.status, ok: res.ok, body, wwwAuth: res.headers.get("www-authenticate") };
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
    .select("access_token, refresh_token, expires_at, spotify_user_id")
    .eq("user_id", user.id).single();
  if (!conn) return new Response(JSON.stringify({ error: "no spotify connection" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  let token = conn.access_token;
  if (new Date(conn.expires_at) <= new Date(Date.now() + 30 * 1000)) {
    const r = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: `Basic ${btoa(`${Deno.env.get("SPOTIFY_CLIENT_ID")}:${Deno.env.get("SPOTIFY_CLIENT_SECRET")}`)}` },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: conn.refresh_token }),
    });
    const j = await r.json();
    if (j.access_token) {
      token = j.access_token;
      await admin.from("spotify_connections").update({
        access_token: j.access_token,
        expires_at: new Date(Date.now() + j.expires_in * 1000).toISOString(),
      }).eq("user_id", user.id);
    }
  }

  // Get profile to know spotify user id
  const me = await spotifyFetch("https://api.spotify.com/v1/me", token);
  const myId = me.body?.id;

  // Get all playlists (paginate up to ~100)
  const allPlaylists: any[] = [];
  let url: string | null = "https://api.spotify.com/v1/me/playlists?limit=50";
  while (url && allPlaylists.length < 200) {
    const r: any = await spotifyFetch(url, token);
    if (!r.ok) break;
    allPlaylists.push(...(r.body?.items ?? []));
    url = r.body?.next ?? null;
  }

  // Categorize playlists
  const owned = allPlaylists.filter(p => p?.owner?.id === myId);
  const ownedPublic = owned.filter(p => p?.public === true);
  const ownedPrivate = owned.filter(p => p?.public === false);
  const collaborative = allPlaylists.filter(p => p?.collaborative === true);
  const savedFromOthers = allPlaylists.filter(p => p?.owner?.id && p.owner.id !== myId);
  const savedNonSpotify = savedFromOthers.filter(p => p?.owner?.id !== "spotify");
  const savedFromSpotifyEditorial = savedFromOthers.filter(p => p?.owner?.id === "spotify");

  // Pick at least 5 distinct samples covering categories
  const picks: any[] = [];
  const addUnique = (p: any) => { if (p && !picks.find(x => x.id === p.id)) picks.push(p); };
  if (owned[0]) addUnique(owned[0]);
  if (ownedPublic.find(p => p.id !== picks[0]?.id)) addUnique(ownedPublic.find(p => p.id !== picks[0]?.id));
  if (ownedPrivate[0]) addUnique(ownedPrivate[0]);
  if (collaborative[0]) addUnique(collaborative[0]);
  if (savedNonSpotify[0]) addUnique(savedNonSpotify[0]);
  if (savedNonSpotify[1]) addUnique(savedNonSpotify[1]);
  if (savedFromSpotifyEditorial[0]) addUnique(savedFromSpotifyEditorial[0]);
  // Top up from any remaining
  for (const p of allPlaylists) { if (picks.length >= 7) break; addUnique(p); }

  const probes = [];
  for (const p of picks) {
    const tr = await spotifyFetch(`https://api.spotify.com/v1/playlists/${p.id}/tracks?limit=100`, token);
    let categorization = "ok";
    if (tr.status === 403) categorization = "restricted_or_inaccessible";
    else if (tr.status === 404) categorization = "not_found";
    else if (tr.status === 401) categorization = "auth_problem";
    else if (!tr.ok) categorization = "other_error";

    probes.push({
      playlist_name: p?.name ?? null,
      playlist_id: p?.id ?? null,
      owner_id: p?.owner?.id ?? null,
      owner_display_name: p?.owner?.display_name ?? null,
      is_owner: p?.owner?.id === myId,
      collaborative: p?.collaborative ?? null,
      public: p?.public ?? null,
      total_tracks_meta: p?.tracks?.total ?? null,
      tracks_request: {
        status: tr.status,
        ok: tr.ok,
        items_returned: Array.isArray(tr.body?.items) ? tr.body.items.length : null,
        body_total: tr.body?.total ?? null,
        error_status: tr.body?.error?.status ?? null,
        error_message: tr.body?.error?.message ?? null,
        www_authenticate: tr.wwwAuth,
      },
      categorization,
    });
  }

  return new Response(JSON.stringify({
    spotify_user_id: myId,
    total_playlists_found: allPlaylists.length,
    counts: {
      owned: owned.length,
      owned_public: ownedPublic.length,
      owned_private: ownedPrivate.length,
      collaborative: collaborative.length,
      saved_from_others: savedFromOthers.length,
      saved_from_spotify_editorial: savedFromSpotifyEditorial.length,
    },
    probes,
  }, null, 2), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 });
});
