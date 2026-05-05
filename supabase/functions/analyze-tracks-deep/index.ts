// Deep per-track AI analysis writing to ai_track_analysis.
// Processes a batch of liked songs not yet analyzed (or with stale version).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const ANALYSIS_VERSION = "v1";
const MODEL = "gpt-4o-mini";

const SYSTEM_PROMPT = `You are Tempo, a world-class music analyst. For each provided track, return a deep, specific musical analysis as JSON.

NEVER use language as a grouping signal. A Spanish indie ballad and an English indie ballad share the same DNA.
Be specific. Avoid generic words like "happy", "chill", "upbeat".

Return ONLY a single JSON object with this shape:
{
  "tracks": [
    {
      "spotify_track_id": "string (echo back)",
      "primary_genre": "string",
      "secondary_genres": ["string"],
      "language": "string",
      "moods": ["string"],
      "energy_level": "low | medium-low | medium | medium-high | high",
      "rhythm_type": "string",
      "vibe_tags": ["string"],
      "best_contexts": ["string"],
      "playlist_fit": ["string"],
      "compatibility_notes": "string",
      "avoid_pairing_with": ["string"],
      "confidence_score": 0.0
    }
  ]
}`;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function fmtTrack(s: any, ctx: any): string {
  const audio: string[] = [];
  if (s.audio_tempo != null) audio.push(`bpm:${Math.round(s.audio_tempo)}`);
  if (s.audio_energy != null) audio.push(`e:${s.audio_energy.toFixed(2)}`);
  if (s.audio_valence != null) audio.push(`v:${s.audio_valence.toFixed(2)}`);
  if (s.audio_danceability != null) audio.push(`d:${s.audio_danceability.toFixed(2)}`);
  if (s.audio_acousticness != null) audio.push(`ac:${s.audio_acousticness.toFixed(2)}`);
  return [
    `id:${s.spotify_track_id}`,
    `track:"${s.track_name}"`,
    `artist:"${s.artist_name}"`,
    s.album_name ? `album:"${s.album_name}"` : "",
    audio.length ? `audio:[${audio.join(",")}]` : "",
    ctx.followed ? "user_follows_artist:true" : "",
    `liked:true`,
    ctx.playlists?.length ? `in_playlists:[${ctx.playlists.slice(0, 5).join("|")}]` : "",
  ].filter(Boolean).join(" ");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const auth = req.headers.get("Authorization") ?? "";
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const svc = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const openaiKey = Deno.env.get("OPENAI_API_KEY");
    if (!openaiKey) return json({ error: "OPENAI_API_KEY missing" }, 500);

    const userClient = createClient(supabaseUrl, anon, {
      global: { headers: { Authorization: auth } },
    });
    const adm = createClient(supabaseUrl, svc);

    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user) return json({ error: "unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const batchSize = Math.min(Math.max(body.batch_size ?? 10, 1), 20);
    const force = body.force === true;

    const { data: liked } = await adm
      .from("liked_songs")
      .select("id, spotify_track_id, track_name, artist_name, album_name, image_url, audio_tempo, audio_energy, audio_valence, audio_danceability, audio_acousticness, audio_instrumentalness, audio_speechiness")
      .eq("user_id", user.id)
      .order("added_at", { ascending: false })
      .limit(500);

    if (!liked || liked.length === 0) {
      return json({ done: true, analyzed: 0, remaining: 0, total: 0, message: "No liked songs" });
    }

    const { count: totalCount } = await adm
      .from("liked_songs")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id);

    const { data: existing } = await adm
      .from("ai_track_analysis")
      .select("track_id, analysis_version, tracks:track_id(spotify_track_id)")
      .eq("user_id", user.id);

    const analyzedIds = new Set<string>(
      (existing ?? [])
        .filter((e: any) => !force && e.analysis_version === ANALYSIS_VERSION)
        .map((e: any) => e.tracks?.spotify_track_id)
        .filter(Boolean)
    );

    const pending = liked.filter((l: any) => !analyzedIds.has(l.spotify_track_id));
    if (pending.length === 0) {
      return json({ done: true, analyzed: 0, remaining: 0, total: totalCount ?? 0, message: "All analyzed" });
    }

    const batch = pending.slice(0, batchSize);
    const spotifyIds = batch.map((b: any) => b.spotify_track_id);

    const [{ data: ptracks }, { data: followed }] = await Promise.all([
      adm.from("spotify_playlist_tracks")
        .select("spotify_track_id, playlist_id, spotify_playlists!inner(name)")
        .eq("user_id", user.id)
        .in("spotify_track_id", spotifyIds),
      adm.from("spotify_followed_artists")
        .select("artist_name")
        .eq("user_id", user.id),
    ]);

    const followedSet = new Set<string>((followed ?? []).map((f: any) => f.artist_name?.toLowerCase()));
    const playlistsByTrack = new Map<string, string[]>();
    for (const pt of ptracks ?? []) {
      const arr = playlistsByTrack.get(pt.spotify_track_id) ?? [];
      const name = (pt as any).spotify_playlists?.name;
      if (name) arr.push(name);
      playlistsByTrack.set(pt.spotify_track_id, arr);
    }

    const lines = batch.map((s: any) => fmtTrack(s, {
      followed: followedSet.has(s.artist_name?.toLowerCase()),
      playlists: playlistsByTrack.get(s.spotify_track_id) ?? [],
    }));
    const userPrompt = `Analyze these ${batch.length} tracks. Echo back each spotify_track_id exactly.\n\n${lines.join("\n")}`;

    const aiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${openaiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
        response_format: { type: "json_object" },
      }),
    });

    if (!aiRes.ok) {
      const text = await aiRes.text();
      console.error("OpenAI error", aiRes.status, text.substring(0, 300));
      return json({ error: `OpenAI ${aiRes.status}`, detail: text.substring(0, 200) }, 502);
    }

    const aiData = await aiRes.json();
    const content = aiData.choices?.[0]?.message?.content;
    let parsed: any = {};
    try { parsed = JSON.parse(content); } catch { parsed = { tracks: [] }; }

    const results: any[] = Array.isArray(parsed.tracks) ? parsed.tracks : [];
    const byId = new Map<string, any>();
    for (const r of results) if (r?.spotify_track_id) byId.set(r.spotify_track_id, r);

    let analyzed = 0;
    let failed = 0;

    for (const song of batch) {
      const r = byId.get(song.spotify_track_id);
      if (!r) { failed++; continue; }

      try {
        const { data: existingTrack } = await adm
          .from("tracks")
          .select("id")
          .eq("spotify_track_id", song.spotify_track_id)
          .maybeSingle();

        let trackId = existingTrack?.id;
        if (!trackId) {
          const { data: ins } = await adm
            .from("tracks")
            .insert({
              spotify_track_id: song.spotify_track_id,
              name: song.track_name,
              artist_names: [song.artist_name],
              album_name: song.album_name,
            })
            .select("id")
            .single();
          trackId = ins?.id;
        }

        if (!trackId) { failed++; continue; }

        await adm.from("ai_track_analysis").upsert({
          user_id: user.id,
          track_id: trackId,
          primary_genre: r.primary_genre ?? null,
          secondary_genres: Array.isArray(r.secondary_genres) ? r.secondary_genres : [],
          language: r.language ?? null,
          moods: Array.isArray(r.moods) ? r.moods : [],
          energy_level: r.energy_level ?? null,
          rhythm_type: r.rhythm_type ?? null,
          vibe_tags: Array.isArray(r.vibe_tags) ? r.vibe_tags : [],
          best_contexts: Array.isArray(r.best_contexts) ? r.best_contexts : [],
          playlist_fit: Array.isArray(r.playlist_fit) ? r.playlist_fit : [],
          compatibility_notes: r.compatibility_notes ?? null,
          avoid_pairing_with: Array.isArray(r.avoid_pairing_with) ? r.avoid_pairing_with : [],
          confidence_score: typeof r.confidence_score === "number" ? r.confidence_score : null,
          model_used: MODEL,
          analysis_version: ANALYSIS_VERSION,
        }, { onConflict: "user_id,track_id" });

        analyzed++;
      } catch (e: any) {
        console.error("save failed for", song.spotify_track_id, e.message);
        failed++;
      }
    }

    const remaining = pending.length - analyzed;
    return json({
      done: remaining === 0,
      analyzed,
      failed,
      batch_size: batch.length,
      remaining,
      total: totalCount ?? 0,
      already_analyzed: analyzedIds.size + analyzed,
    });
  } catch (e: any) {
    console.error("analyze-tracks-deep error", e);
    return json({ error: e.message ?? "unknown" }, 500);
  }
});
