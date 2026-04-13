import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.49.1/cors";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  return new Response(JSON.stringify({
    client_id: Deno.env.get("SPOTIFY_CLIENT_ID"),
    redirect_uri: Deno.env.get("SPOTIFY_REDIRECT_URI"),
  }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
