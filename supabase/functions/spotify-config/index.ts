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

  const clientId = Deno.env.get("SPOTIFY_CLIENT_ID")?.trim() ?? null;
  const redirectUri = Deno.env.get("SPOTIFY_REDIRECT_URI")?.trim() ?? null;

  if (!clientId) {
    return json({ error: "Spotify client ID is not configured." }, 500);
  }

  if (!redirectUri) {
    return json({ error: "Spotify redirect URI is not configured." }, 500);
  }

  if (redirectUri !== EXACT_SPOTIFY_REDIRECT_URI) {
    return json({ error: `Spotify redirect URI mismatch. Expected ${EXACT_SPOTIFY_REDIRECT_URI} but got ${redirectUri}.` }, 500);
  }

  console.info("[spotify-config] redirect_uri", redirectUri);

  return json({
    client_id: clientId,
    redirect_uri: redirectUri,
  });
});
