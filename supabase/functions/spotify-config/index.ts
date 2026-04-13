const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  return new Response(JSON.stringify({
    client_id: Deno.env.get("SPOTIFY_CLIENT_ID"),
  }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
