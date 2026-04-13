import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

async function getSpotifyToken(userId: string): Promise<string | null> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  const { data } = await supabase
    .from("spotify_connections")
    .select("access_token, refresh_token, expires_at")
    .eq("user_id", userId)
    .single();

  if (!data) return null;

  // If expired, refresh
  if (new Date(data.expires_at) <= new Date()) {
    const clientId = Deno.env.get("SPOTIFY_CLIENT_ID")!;
    const clientSecret = Deno.env.get("SPOTIFY_CLIENT_SECRET")!;

    const refreshRes = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: data.refresh_token,
      }),
    });

    if (!refreshRes.ok) return null;
    const tokens = await refreshRes.json();

    await supabase
      .from("spotify_connections")
      .update({
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token || data.refresh_token,
        expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
      })
      .eq("user_id", userId);

    return tokens.access_token;
  }

  return data.access_token;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    // Get user from JWT
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("No auth header");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Not authenticated");

    const { tracks } = await req.json();
    if (!Array.isArray(tracks) || tracks.length === 0) {
      return new Response(JSON.stringify({ results: [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const token = await getSpotifyToken(user.id);
    if (!token) {
      return new Response(JSON.stringify({ results: tracks.map(() => null) }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Search each track (limited to 20 to avoid rate limits)
    const searchBatch = tracks.slice(0, 20);
    const results = await Promise.all(
      searchBatch.map(async (t: { title: string; artist: string }) => {
        try {
          const q = encodeURIComponent(`track:${t.title} artist:${t.artist}`);
          const res = await fetch(
            `https://api.spotify.com/v1/search?q=${q}&type=track&limit=1`,
            { headers: { Authorization: `Bearer ${token}` } },
          );
          if (!res.ok) return null;
          const data = await res.json();
          const item = data.tracks?.items?.[0];
          if (!item) return null;
          return {
            spotify_id: item.id,
            preview_url: item.preview_url || null,
            image_url: item.album?.images?.[0]?.url || null,
            album: item.album?.name || null,
            uri: item.uri || null,
          };
        } catch {
          return null;
        }
      }),
    );

    return new Response(JSON.stringify({ results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("spotify-search-tracks error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
