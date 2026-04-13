import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

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

class SpotifyImportError extends Error {
  step: string;
  status: number;
  details: Record<string, unknown>;

  constructor(step: string, message: string, status = 500, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "SpotifyImportError";
    this.step = step;
    this.status = status;
    this.details = details;
  }
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

function fail(step: string, error: string, status = 500, details: Record<string, unknown> = {}) {
  console.error("[spotify-import-tracks]", step, { error, status, ...details });
  return json({ error, step, status, ...details }, status);
}

async function refreshTokenIfNeeded(supabase: ReturnType<typeof createClient>, userId: string) {
  const { data: conn, error } = await supabase
    .from("spotify_connections")
    .select("access_token, refresh_token, expires_at")
    .eq("user_id", userId)
    .single();

  if (error || !conn) {
    throw new SpotifyImportError("load_connection", "No Spotify connection found.", 404, {
      diagnostics: {
        user_id: userId,
        query_error: error?.message ?? null,
      },
    });
  }

  if (new Date(conn.expires_at) > new Date(Date.now() + 5 * 60 * 1000)) {
    return conn.access_token;
  }

  const clientId = Deno.env.get("SPOTIFY_CLIENT_ID");
  const clientSecret = Deno.env.get("SPOTIFY_CLIENT_SECRET");

  if (!clientId || !clientSecret) {
    throw new SpotifyImportError("runtime_config", "Spotify credentials are not fully configured.", 500, {
      diagnostics: {
        has_client_id: Boolean(clientId),
        has_client_secret: Boolean(clientSecret),
      },
    });
  }

  const refreshRes = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: conn.refresh_token,
    }),
  });

  const refreshText = await refreshRes.text();
  const refreshData = parseJsonText(refreshText);
  const refreshError = isRecord(refreshData)
    ? (typeof refreshData.error_description === "string" ? refreshData.error_description : typeof refreshData.error === "string" ? refreshData.error : null)
    : null;

  if (!refreshRes.ok || refreshError) {
    throw new SpotifyImportError("refresh_token", refreshError || "Spotify token refresh failed.", refreshRes.status || 400, {
      spotify_status: refreshRes.status,
      spotify_body: refreshData,
    });
  }

  const refreshedAccessToken = isRecord(refreshData) && typeof refreshData.access_token === "string"
    ? refreshData.access_token
    : null;
  const expiresIn = isRecord(refreshData) && typeof refreshData.expires_in === "number"
    ? refreshData.expires_in
    : null;

  if (!refreshedAccessToken || !expiresIn) {
    throw new SpotifyImportError("refresh_token", "Spotify token refresh returned an incomplete payload.", 400, {
      spotify_status: refreshRes.status,
      spotify_body: refreshData,
    });
  }

  const refreshedRefreshToken = isRecord(refreshData) && typeof refreshData.refresh_token === "string"
    ? refreshData.refresh_token
    : conn.refresh_token;

  const expires_at = new Date(Date.now() + expiresIn * 1000).toISOString();

  const { error: updateError } = await supabase
    .from("spotify_connections")
    .update({
      access_token: refreshedAccessToken,
      refresh_token: refreshedRefreshToken,
      expires_at,
    })
    .eq("user_id", userId);

  if (updateError) {
    throw new SpotifyImportError("database_write_connection_refresh", updateError.message, 500, {
      diagnostics: {
        user_id: userId,
      },
    });
  }

  return refreshedAccessToken;
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

    step = "refresh_access_token";
    const accessToken = await refreshTokenIfNeeded(supabase, user.id);
    console.info("[spotify-import-tracks] access_token_ready", {
      user_id: user.id,
      access_token_present: Boolean(accessToken),
    });

    const allTracks: Array<{
      user_id: string;
      spotify_track_id: string;
      track_name: string;
      artist_name: string;
      album_name: string | null;
      image_url: string | null;
      release_date: string | null;
      added_at: string | null;
    }> = [];

    let offset = 0;
    const limit = 50;
    let total = Infinity;

    while (offset < total && offset < 2000) {
      step = "saved_tracks_fetch";
      const spotifyRes = await fetch(
        `https://api.spotify.com/v1/me/tracks?limit=${limit}&offset=${offset}`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      const spotifyText = await spotifyRes.text();
      const spotifyData = parseJsonText(spotifyText);
      const spotifyError = isRecord(spotifyData) && isRecord(spotifyData.error) && typeof spotifyData.error.message === "string"
        ? spotifyData.error.message
        : null;

      if (!spotifyRes.ok || spotifyError) {
        throw new SpotifyImportError(step, spotifyError || "Failed to import Spotify library.", spotifyRes.status || 400, {
          spotify_status: spotifyRes.status,
          spotify_body: spotifyData,
          diagnostics: {
            offset,
            limit,
          },
        });
      }

      if (!isRecord(spotifyData)) {
        throw new SpotifyImportError(step, "Unexpected Spotify saved tracks response.", 500, {
          spotify_status: spotifyRes.status,
          spotify_body: spotifyData,
          diagnostics: {
            offset,
            limit,
          },
        });
      }

      total = typeof spotifyData.total === "number" ? spotifyData.total : allTracks.length;

      for (const item of Array.isArray(spotifyData.items) ? spotifyData.items : []) {
        if (!isRecord(item)) continue;

        const track = isRecord(item.track) ? item.track : null;
        if (!track || typeof track.id !== "string") continue;

        const artists = Array.isArray(track.artists) ? track.artists : [];
        const artistNames = artists
          .map((artist) => (isRecord(artist) && typeof artist.name === "string" ? artist.name : null))
          .filter((artistName): artistName is string => Boolean(artistName));

        const album = isRecord(track.album) ? track.album : null;
        const images = album && Array.isArray(album.images) ? album.images : [];
        const firstImage = images.find((image) => isRecord(image) && typeof image.url === "string");

        allTracks.push({
          user_id: user.id,
          spotify_track_id: track.id,
          track_name: typeof track.name === "string" ? track.name : "Untitled track",
          artist_name: artistNames.join(", "),
          album_name: album && typeof album.name === "string" ? album.name : null,
          image_url: isRecord(firstImage) && typeof firstImage.url === "string" ? firstImage.url : null,
          release_date: album && typeof album.release_date === "string" ? album.release_date : null,
          added_at: typeof item.added_at === "string" ? item.added_at : null,
        });
      }

      offset += limit;
    }

    step = "database_write_tracks";
    for (let index = 0; index < allTracks.length; index += 100) {
      const batch = allTracks.slice(index, index + 100);
      const { error } = await supabase
        .from("imported_tracks")
        .upsert(batch, { onConflict: "user_id,spotify_track_id", ignoreDuplicates: true });

      if (error) {
        throw new SpotifyImportError(step, error.message, 500, {
          diagnostics: {
            batch_start: index,
            batch_size: batch.length,
          },
        });
      }
    }

    return json({
      success: true,
      step: "complete",
      total_found: Number.isFinite(total) ? total : allTracks.length,
      imported: allTracks.length,
    });
  } catch (e) {
    if (e instanceof SpotifyImportError) {
      return fail(e.step, e.message, e.status, e.details);
    }

    const message = e instanceof Error ? e.message : "Spotify import failed.";
    return fail(step, message, 500);
  }
});
