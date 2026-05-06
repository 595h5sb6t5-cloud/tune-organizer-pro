// Pre-flight diagnostic for AI playlist generation.
// Reports library readiness using ONLY sources available in Spotify Development Mode:
// liked songs, saved albums + their tracks, followed artists, artist top tracks (if any),
// recently played (if any). Playlist tracks are intentionally excluded as a source.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function json(b: unknown, s = 200) {
  return new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

async function count(adm: any, table: string, userId: string, extra?: (q: any) => any) {
  let q = adm.from(table).select("id", { count: "exact", head: true }).eq("user_id", userId);
  if (extra) q = extra(q);
  const { count } = await q;
  return count ?? 0;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const auth = req.headers.get("Authorization") ?? "";
    const url = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const svc = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(url, anon, { global: { headers: { Authorization: auth } } });
    const adm = createClient(url, svc);
    const { data: { user }, error: uerr } = await userClient.auth.getUser();
    if (uerr || !user) return json({ error: "unauthorized" }, 401);

    const userId = user.id;

    const [
      likedTotal,
      likedTagged,
      likedWithAudio,
      aiAnalyzedTotal,
      savedAlbums,
      albumTracks,
      followedArtists,
      artistTopTracks,
      recentPlays,
      playlistsTotal,
      playlistsRestricted,
      playlistsCompleted,
      generatedDraft,
      generatedExported,
    ] = await Promise.all([
      count(adm, "liked_songs", userId),
      count(adm, "liked_songs", userId, (q) => q.not("groove_feel", "is", null)),
      count(adm, "liked_songs", userId, (q) => q.not("audio_features_fetched_at", "is", null)),
      count(adm, "ai_track_analysis", userId),
      count(adm, "spotify_saved_albums", userId),
      count(adm, "spotify_album_tracks", userId),
      count(adm, "spotify_followed_artists", userId),
      count(adm, "artist_tracks", userId),
      count(adm, "user_recent_plays", userId),
      count(adm, "spotify_playlists", userId),
      count(adm, "spotify_playlists", userId, (q) => q.eq("tracks_import_status", "restricted")),
      count(adm, "spotify_playlists", userId, (q) => q.eq("tracks_import_status", "completed")),
      count(adm, "generated_playlists", userId, (q) => q.eq("status", "draft")),
      count(adm, "generated_playlists", userId, (q) => q.eq("is_exported_to_spotify", true)),
    ]);

    const pendingAnalysis = Math.max(0, likedTotal - likedTagged);

    // Metadata quality: % of liked songs with rich fields available for AI
    const { data: sample } = await adm.from("liked_songs")
      .select("artist_name, album_name, image_url")
      .eq("user_id", userId).limit(500);
    const sampleArr = sample ?? [];
    const haveAlbum = sampleArr.filter((s: any) => !!s.album_name).length;
    const haveImage = sampleArr.filter((s: any) => !!s.image_url).length;
    const metadataQuality = sampleArr.length === 0 ? 0 : Math.round(((haveAlbum + haveImage) / (sampleArr.length * 2)) * 100);

    // Estimated playlists: ~30 songs per playlist, capped to a sane range
    const estimatedPlaylists = Math.max(8, Math.min(30, Math.floor(likedTotal / 45)));

    // Sources actually usable for AI generation right now
    const usableSources = [];
    if (likedTotal > 0) usableSources.push({ source: "liked_songs", count: likedTotal });
    if (albumTracks > 0) usableSources.push({ source: "saved_album_tracks", count: albumTracks });
    if (followedArtists > 0) usableSources.push({ source: "followed_artists", count: followedArtists });
    if (artistTopTracks > 0) usableSources.push({ source: "artist_top_tracks", count: artistTopTracks });
    if (recentPlays > 0) usableSources.push({ source: "recently_played", count: recentPlays });
    if (playlistsTotal > 0) usableSources.push({ source: "playlist_metadata_only", count: playlistsTotal, note: "Used only as taste context, never as track source." });

    const limitations: string[] = [];
    if (playlistsRestricted > 0) {
      limitations.push(`Spotify Development Mode blocked playlist tracks for ${playlistsRestricted} playlist(s). Tracks not used as a source.`);
    }
    if (artistTopTracks === 0 && followedArtists > 0) {
      limitations.push("Spotify Development Mode blocked artist top-tracks endpoint. Followed artists are still usable as taste context.");
    }
    if (recentPlays === 0) {
      limitations.push("No recently-played history available (Spotify often returns empty in Dev Mode).");
    }
    if (likedWithAudio === 0) {
      limitations.push("Spotify audio-features endpoint returned 403 in Dev Mode. AI will rely on track/artist/album metadata instead of BPM/energy floats.");
    }

    const ready = likedTotal >= 20;

    return json({
      ready,
      ready_to_generate: ready && pendingAnalysis < likedTotal, // we can start now; analysis runs as part of pipeline
      library: {
        liked_songs_total: likedTotal,
        liked_songs_with_ai_tags: likedTagged,
        liked_songs_pending_ai: pendingAnalysis,
        liked_songs_with_audio_features: likedWithAudio,
        ai_track_analysis_rows: aiAnalyzedTotal,
        saved_albums: savedAlbums,
        saved_album_tracks: albumTracks,
        followed_artists: followedArtists,
        artist_top_tracks: artistTopTracks,
        recently_played: recentPlays,
        playlists_metadata: playlistsTotal,
        playlists_completed_tracks: playlistsCompleted,
        playlists_restricted_by_spotify: playlistsRestricted,
        existing_generated_drafts: generatedDraft,
        existing_generated_exported: generatedExported,
      },
      metadata_quality_percent: metadataQuality,
      estimated_playlists_to_generate: estimatedPlaylists,
      usable_sources_for_ai: usableSources,
      excluded_sources: ["spotify_playlist_tracks (blocked by Spotify Development Mode)"],
      limitations_due_to_spotify_dev_mode: limitations,
      next_step: ready
        ? "POST /functions/v1/analyze-liked-songs with { mode: 'run_pipeline', job_id } — pipeline analyzes each track, defines sonic worlds, assigns songs, and saves drafts."
        : "Import more liked songs first (need at least 20).",
      message: ready
        ? `Ready to generate ~${estimatedPlaylists} playlists from ${likedTotal} liked songs. ${pendingAnalysis} songs need AI analysis (handled inside the pipeline).`
        : `Only ${likedTotal} liked songs available. Import more before generating.`,
    });
  } catch (e: any) {
    console.error("playlist-diagnostic", e);
    return json({ error: e.message ?? "unknown" }, 500);
  }
});
