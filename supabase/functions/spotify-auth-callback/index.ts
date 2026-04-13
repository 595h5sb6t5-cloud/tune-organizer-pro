import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const EXACT_SPOTIFY_REDIRECT_URI = "https://159079dd-d99f-4e32-b626-b73b50d600ec.lovableproject.com/spotify-callback";

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { code, code_verifier, redirect_uri: requestedRedirectUri } = await req.json();
    if (!code || !code_verifier) {
      return json({ error: "Missing code or PKCE verifier." }, 400);
    }

    const clientId = Deno.env.get("SPOTIFY_CLIENT_ID")?.trim();
    const clientSecret = Deno.env.get("SPOTIFY_CLIENT_SECRET")?.trim();
    const redirectUri = Deno.env.get("SPOTIFY_REDIRECT_URI")?.trim();

    if (!clientId || !clientSecret || !redirectUri) {
      return json({ error: "Spotify credentials are not fully configured." }, 500);
    }

    if (redirectUri !== EXACT_SPOTIFY_REDIRECT_URI) {
      return json({ error: `Spotify redirect URI mismatch. Expected ${EXACT_SPOTIFY_REDIRECT_URI} but got ${redirectUri}.` }, 500);
    }

    if (requestedRedirectUri && requestedRedirectUri !== redirectUri) {
      return json({ error: `Spotify redirect URI mismatch. Expected ${redirectUri} but got ${requestedRedirectUri}.` }, 400);
    }

    console.info("[spotify-auth-callback] token_exchange_redirect_uri", redirectUri);

    const tokenRes = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        code_verifier,
      }),
    });

    const tokenData = await tokenRes.json();
    if (!tokenRes.ok || tokenData.error) {
      return json({ error: tokenData.error_description || tokenData.error || "Spotify token exchange failed." }, 400);
    }

    const { access_token, refresh_token, expires_in } = tokenData;
    const expires_at = new Date(Date.now() + expires_in * 1000).toISOString();

    const meRes = await fetch("https://api.spotify.com/v1/me", {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    const meData = await meRes.json();

    if (!meRes.ok || meData.error) {
      return json({ error: meData.error?.message || "Unable to read Spotify profile." }, 400);
    }

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
      return json({ error: "Invalid user session." }, 401);
    }

    const { error: upsertError } = await supabase
      .from("spotify_connections")
      .upsert(
        {
          user_id: user.id,
          spotify_user_id: meData.id,
          access_token,
          refresh_token,
          expires_at,
        },
        { onConflict: "user_id" },
      );

    if (upsertError) {
      return json({ error: upsertError.message }, 500);
    }

    const { error: profileError } = await supabase
      .from("profiles")
      .update({ spotify_connected: true })
      .eq("user_id", user.id);

    if (profileError) {
      return json({ error: profileError.message }, 500);
    }

    return json({
      success: true,
      spotify_user_id: meData.id,
      display_name: meData.display_name,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Spotify callback failed.";
    return json({ error: message }, 500);
  }
});
