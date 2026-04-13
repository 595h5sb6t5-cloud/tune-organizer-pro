import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const EXACT_SPOTIFY_REDIRECT_URI = "https://159079dd-d99f-4e32-b626-b73b50d600ec.lovableproject.com/spotify-callback";
const SPOTIFY_AUTH_URL = "https://accounts.spotify.com/authorize";
const SCOPES = "user-read-private user-read-email user-library-read playlist-read-private playlist-read-collaborative playlist-modify-private playlist-modify-public";
const STATE_TTL_MS = 10 * 60 * 1000;

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

function fail(step: string, error: string, status = 500, details: Record<string, unknown> = {}) {
  console.error("[spotify-auth-start]", step, { error, status, ...details });
  return json({ error, step, status, ...details }, status);
}

function sanitizeReturnPath(path: unknown) {
  return typeof path === "string" && path.startsWith("/") && !path.startsWith("//")
    ? path
    : "/dashboard";
}

function base64UrlEncode(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes))
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function base64UrlEncodeString(value: string) {
  return base64UrlEncode(new TextEncoder().encode(value));
}

function randomString(length: number) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const values = crypto.getRandomValues(new Uint8Array(length));
  return values.reduce((acc, value) => acc + alphabet[value % alphabet.length], "");
}

async function sha256Base64Url(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return base64UrlEncode(new Uint8Array(digest));
}

async function createHmacSignature(secret: string, payload: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return base64UrlEncode(new Uint8Array(signature));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  let step = "auth_validation";

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return fail(step, "Not authenticated.", 401);
    }

    step = "backend_client_config";
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_ANON_KEY");

    if (!supabaseUrl || !supabaseKey) {
      return fail(step, "Backend client configuration is missing.", 500, {
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
      return fail("user_session", "Invalid session.", 401, {
        diagnostics: {
          user_error: userError?.message ?? null,
        },
      });
    }

    const body = await req.json().catch(() => ({}));
    const returnPath = sanitizeReturnPath((body as Record<string, unknown>)?.return_path);

    step = "runtime_config";
    const clientId = Deno.env.get("SPOTIFY_CLIENT_ID")?.trim();
    const redirectUri = Deno.env.get("SPOTIFY_REDIRECT_URI")?.trim();
    const signingSecret = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim() || Deno.env.get("LOVABLE_API_KEY")?.trim();
    const diagnostics = {
      has_client_id: Boolean(clientId),
      has_redirect_uri: Boolean(redirectUri),
      has_signing_secret: Boolean(signingSecret),
      redirect_uri: redirectUri ?? null,
      expected_redirect_uri: EXACT_SPOTIFY_REDIRECT_URI,
      redirect_uri_matches_exact: redirectUri === EXACT_SPOTIFY_REDIRECT_URI,
      return_path: returnPath,
    };

    if (!clientId || !redirectUri || !signingSecret) {
      return fail(step, "Spotify authorization is not fully configured.", 500, { diagnostics });
    }

    if (redirectUri !== EXACT_SPOTIFY_REDIRECT_URI) {
      return fail(
        step,
        `Spotify redirect URI mismatch. Expected ${EXACT_SPOTIFY_REDIRECT_URI} but got ${redirectUri}.`,
        500,
        { diagnostics },
      );
    }

    step = "state_generation";
    const codeVerifier = randomString(64);
    const codeChallenge = await sha256Base64Url(codeVerifier);
    const issuedAt = Date.now();
    const expiresAt = issuedAt + STATE_TTL_MS;

    const statePayload = {
      ver: 1,
      user_id: user.id,
      return_path: returnPath,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier,
      issued_at: issuedAt,
      expires_at: expiresAt,
      nonce: randomString(24),
    };

    const encodedPayload = base64UrlEncodeString(JSON.stringify(statePayload));
    const signature = await createHmacSignature(signingSecret, encodedPayload);
    const state = `${encodedPayload}.${signature}`;

    const params = new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: SCOPES,
      code_challenge_method: "S256",
      code_challenge: codeChallenge,
      state,
    });

    return json({
      authorization_url: `${SPOTIFY_AUTH_URL}?${params.toString()}`,
      redirect_uri: redirectUri,
      return_path: returnPath,
      expires_at: expiresAt,
      diagnostics,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to start Spotify authorization.";
    return fail(step, message, 500);
  }
});
