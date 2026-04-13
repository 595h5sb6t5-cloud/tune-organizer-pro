const EXACT_SPOTIFY_REDIRECT_URI = "https://id-preview--159079dd-d99f-4e32-b626-b73b50d600ec.lovable.app/spotify-callback";

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

function fail(step: string, error: string, status = 500, diagnostics: Record<string, unknown> = {}) {
  console.error("[spotify-config]", step, { error, status, ...diagnostics });
  return json({ error, step, status, diagnostics }, status);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const clientId = Deno.env.get("SPOTIFY_CLIENT_ID")?.trim() ?? null;
  const redirectUri = Deno.env.get("SPOTIFY_REDIRECT_URI")?.trim() ?? null;
  const diagnostics = {
    has_client_id: Boolean(clientId),
    has_redirect_uri: Boolean(redirectUri),
    redirect_uri: redirectUri,
    expected_redirect_uri: EXACT_SPOTIFY_REDIRECT_URI,
    redirect_uri_matches_exact: redirectUri === EXACT_SPOTIFY_REDIRECT_URI,
  };

  console.info("[spotify-config] runtime_config", diagnostics);

  if (!clientId) {
    return fail("runtime_config", "Spotify client ID is not configured.", 500, diagnostics);
  }

  if (!redirectUri) {
    return fail("runtime_config", "Spotify redirect URI is not configured.", 500, diagnostics);
  }

  if (redirectUri !== EXACT_SPOTIFY_REDIRECT_URI) {
    return fail(
      "runtime_config",
      `Spotify redirect URI mismatch. Expected ${EXACT_SPOTIFY_REDIRECT_URI} but got ${redirectUri}.`,
      500,
      diagnostics,
    );
  }

  return json({
    client_id: clientId,
    redirect_uri: redirectUri,
    diagnostics,
  });
});
