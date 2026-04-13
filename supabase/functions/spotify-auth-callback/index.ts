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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseJsonText(text: string) {
  if (!text) return null;

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { raw_body: text };
  }
}

function fail(step: string, error: string, status = 400, details: Record<string, unknown> = {}) {
  console.error("[spotify-auth-callback]", step, { error, status, ...details });
  return json({ error, step, status, ...details }, status);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  let step = "callback_parsing";

  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return fail(step, "Invalid callback payload.", 400);
    }

    const { code, code_verifier, redirect_uri: requestedRedirectUri } = body as Record<string, string | undefined>;
    if (!code || !code_verifier) {
      return fail(step, "Missing code or PKCE verifier.", 400, {
        diagnostics: {
          has_code: Boolean(code),
          has_code_verifier: Boolean(code_verifier),
        },
      });
    }

    step = "runtime_config";
    const clientId = Deno.env.get("SPOTIFY_CLIENT_ID")?.trim();
    const clientSecret = Deno.env.get("SPOTIFY_CLIENT_SECRET")?.trim();
    const redirectUri = Deno.env.get("SPOTIFY_REDIRECT_URI")?.trim();
    const runtimeDiagnostics = {
      has_client_id: Boolean(clientId),
      has_client_secret: Boolean(clientSecret),
      has_redirect_uri: Boolean(redirectUri),
      configured_redirect_uri: redirectUri ?? null,
      requested_redirect_uri: requestedRedirectUri ?? null,
      exact_redirect_uri: EXACT_SPOTIFY_REDIRECT_URI,
      redirect_uri_matches_exact: redirectUri === EXACT_SPOTIFY_REDIRECT_URI,
    };

    console.info("[spotify-auth-callback] runtime_config", runtimeDiagnostics);

    if (!clientId || !clientSecret || !redirectUri) {
      return fail(step, "Spotify credentials are not fully configured.", 500, {
        diagnostics: runtimeDiagnostics,
      });
    }

    if (redirectUri !== EXACT_SPOTIFY_REDIRECT_URI) {
      return fail(
        step,
        `Spotify redirect URI mismatch. Expected ${EXACT_SPOTIFY_REDIRECT_URI} but got ${redirectUri}.`,
        500,
        { diagnostics: runtimeDiagnostics },
      );
    }

    if (requestedRedirectUri && requestedRedirectUri !== redirectUri) {
      return fail(
        step,
        `Spotify redirect URI mismatch. Expected ${redirectUri} but got ${requestedRedirectUri}.`,
        400,
        { diagnostics: runtimeDiagnostics },
      );
    }

    console.info("[spotify-auth-callback] token_exchange_request", {
      redirect_uri: redirectUri,
      has_code: true,
      has_code_verifier: true,
      code_verifier_length: code_verifier.length,
    });

    step = "token_exchange";
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

    const tokenText = await tokenRes.text();
    const tokenData = parseJsonText(tokenText);
    const tokenError = isRecord(tokenData)
      ? (typeof tokenData.error_description === "string" ? tokenData.error_description : typeof tokenData.error === "string" ? tokenData.error : null)
      : null;

    if (!tokenRes.ok || tokenError) {
      return fail(step, tokenError || "Spotify token exchange failed.", tokenRes.status || 400, {
        spotify_status: tokenRes.status,
        spotify_body: tokenData,
        diagnostics: runtimeDiagnostics,
      });
    }

    const access_token = isRecord(tokenData) && typeof tokenData.access_token === "string" ? tokenData.access_token : null;
    const refresh_token = isRecord(tokenData) && typeof tokenData.refresh_token === "string" ? tokenData.refresh_token : null;
    const expires_in = isRecord(tokenData) && typeof tokenData.expires_in === "number" ? tokenData.expires_in : null;

    if (!access_token || !refresh_token || !expires_in) {
      return fail(step, "Spotify token exchange returned an incomplete token payload.", 400, {
        spotify_status: tokenRes.status,
        spotify_body: tokenData,
        diagnostics: runtimeDiagnostics,
      });
    }

    const expires_at = new Date(Date.now() + expires_in * 1000).toISOString();

    step = "spotify_profile_fetch";
    const meRes = await fetch("https://api.spotify.com/v1/me", {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    const meText = await meRes.text();
    const meData = parseJsonText(meText);
    const spotifyProfileError = isRecord(meData) && isRecord(meData.error) && typeof meData.error.message === "string"
      ? meData.error.message
      : null;

    if (!meRes.ok || spotifyProfileError) {
      return fail(step, spotifyProfileError || "Unable to read Spotify profile.", meRes.status || 400, {
        spotify_status: meRes.status,
        spotify_body: meData,
      });
    }

    if (!isRecord(meData) || typeof meData.id !== "string") {
      return fail(step, "Spotify profile response is missing a user id.", 400, {
        spotify_status: meRes.status,
        spotify_body: meData,
      });
    }

    step = "user_session";
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return fail(step, "Not authenticated.", 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_ANON_KEY");

    if (!supabaseUrl || !supabaseKey) {
      return fail("backend_client_config", "Backend client configuration is missing.", 500, {
        diagnostics: {
          has_supabase_url: Boolean(supabaseUrl),
          has_supabase_anon_key: Boolean(supabaseKey),
        },
      });
    }

    const supabase = createClient(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return fail(step, "Invalid user session.", 401, {
        diagnostics: {
          user_error: userError?.message ?? null,
        },
      });
    }

    step = "database_write_connection";
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
      return fail(step, upsertError.message, 500, {
        diagnostics: {
          user_id: user.id,
          spotify_user_id: meData.id,
        },
      });
    }

    step = "database_write_profile";
    const { error: profileError } = await supabase
      .from("profiles")
      .update({ spotify_connected: true })
      .eq("user_id", user.id);

    if (profileError) {
      return fail(step, profileError.message, 500, {
        diagnostics: {
          user_id: user.id,
        },
      });
    }

    return json({
      success: true,
      step: "complete",
      spotify_user_id: meData.id,
      display_name: typeof meData.display_name === "string" ? meData.display_name : null,
      diagnostics: runtimeDiagnostics,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Spotify callback failed.";
    return fail(step, message, 500);
  }
});
