import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

interface IntentProfile {
  playlist_name: string;
  interpreted_meaning: string;
  emotional_context: string[];
  use_case: string[];
  desired_energy_range: string;
  desired_tempo_range: string;
  desired_moods: string[];
  desired_genres: string[];
  allowed_subgenres: string[];
  avoided_genres: string[];
  desired_instrumentation: string[];
  vocal_style: string[];
  lyrical_themes: string[];
  production_style: string[];
  compatibility_rules: string[];
  exclusion_rules: string[];
}

interface Candidate {
  track_name: string;
  artist: string;
  fit_score: number;
  reason_for_recommendation: string;
  matched_moods: string[];
  matched_contexts: string[];
  matched_audio_features: string[];
  possible_issue: string;
  final_decision: "recommend" | "skip";
}

async function refreshSpotifyToken(supabase: any, userId: string) {
  const { data: conn } = await supabase
    .from("spotify_connections")
    .select("access_token, refresh_token, expires_at")
    .eq("user_id", userId)
    .single();
  if (!conn) return null;
  if (conn.expires_at && new Date(conn.expires_at) > new Date(Date.now() + 60_000)) {
    return conn.access_token as string;
  }
  const clientId = Deno.env.get("SPOTIFY_CLIENT_ID")!;
  const clientSecret = Deno.env.get("SPOTIFY_CLIENT_SECRET")!;
  const r = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
    },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: conn.refresh_token }),
  });
  const d = await r.json().catch(() => ({} as any));
  if (d.access_token) {
    await supabase.from("spotify_connections").update({
      access_token: d.access_token,
      refresh_token: d.refresh_token || conn.refresh_token,
      expires_at: new Date(Date.now() + (d.expires_in || 3600) * 1000).toISOString(),
    }).eq("user_id", userId);
    return d.access_token as string;
  }
  return conn.access_token as string;
}

async function buildIntentProfile(
  openaiKey: string,
  pl: { name: string; concept: string | null; vibe: string | null; context: string | null; description: string | null },
  seedTracks: string[],
  sonicProfile: any,
): Promise<IntentProfile> {
  const systemPrompt = `You are a senior music curator. Given a playlist concept, interpret its DEEP musical meaning into a structured intent profile.
Do NOT be literal about the playlist name. Decode the emotional, contextual and sonic meaning behind it.
For example: "Late Night Drives" is NOT just any night song — it implies smooth low-medium energy, nocturnal atmosphere, introspective mood, soft production, steady relaxed tempo (~70-115 BPM), cinematic feel.
Return STRICT JSON matching the schema. All fields required. Lists must contain concrete musical descriptors, not vague terms.`;

  const userPrompt = JSON.stringify({
    playlist: pl,
    seed_tracks_in_playlist: seedTracks.slice(0, 15),
    user_sonic_profile: sonicProfile,
    schema: {
      playlist_name: "string",
      interpreted_meaning: "string — explain what this playlist is REALLY about, beyond the name",
      emotional_context: ["string"],
      use_case: ["string"],
      desired_energy_range: "string e.g. 'low-medium to medium'",
      desired_tempo_range: "string e.g. '70-115 BPM'",
      desired_moods: ["string"],
      desired_genres: ["string"],
      allowed_subgenres: ["string"],
      avoided_genres: ["string"],
      desired_instrumentation: ["string"],
      vocal_style: ["string"],
      lyrical_themes: ["string"],
      production_style: ["string"],
      compatibility_rules: ["string"],
      exclusion_rules: ["string — concrete rules the recommender MUST respect"],
    },
  });

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${openaiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      response_format: { type: "json_object" },
      temperature: 0.4,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    }),
  });
  if (!res.ok) throw new Error(`Intent profile AI error: ${await res.text()}`);
  const data = await res.json();
  const parsed = JSON.parse(data.choices?.[0]?.message?.content ?? "{}");
  // Minimal sanity defaults
  return {
    playlist_name: parsed.playlist_name ?? pl.name,
    interpreted_meaning: parsed.interpreted_meaning ?? "",
    emotional_context: parsed.emotional_context ?? [],
    use_case: parsed.use_case ?? [],
    desired_energy_range: parsed.desired_energy_range ?? "",
    desired_tempo_range: parsed.desired_tempo_range ?? "",
    desired_moods: parsed.desired_moods ?? [],
    desired_genres: parsed.desired_genres ?? [],
    allowed_subgenres: parsed.allowed_subgenres ?? [],
    avoided_genres: parsed.avoided_genres ?? [],
    desired_instrumentation: parsed.desired_instrumentation ?? [],
    vocal_style: parsed.vocal_style ?? [],
    lyrical_themes: parsed.lyrical_themes ?? [],
    production_style: parsed.production_style ?? [],
    compatibility_rules: parsed.compatibility_rules ?? [],
    exclusion_rules: parsed.exclusion_rules ?? [],
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
    const { data: { user }, error: userErr } = await supabase.auth.getUser(token);
    if (userErr || !user) return json({ error: "Unauthorized" }, 401);

    const { generated_playlist_id, count = 12, force_reprofile = false } = await req.json().catch(() => ({} as any));
    if (!generated_playlist_id) return json({ error: "generated_playlist_id required" }, 400);

    // Plan gating
    const { data: sub } = await supabase
      .from("user_subscription")
      .select("plan, recommendations_limit, current_period_started_at")
      .eq("user_id", user.id)
      .maybeSingle();
    const recLimit = sub?.recommendations_limit ?? 20;
    let effectiveCount = Math.max(1, Math.min(count, 20));
    if (recLimit !== -1) {
      const periodStart = sub?.current_period_started_at ?? new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();
      const { count: usedThisMonth } = await supabase
        .from("recommendations")
        .select("id", { head: true, count: "exact" })
        .eq("user_id", user.id)
        .gte("created_at", periodStart);
      const remaining = Math.max(0, recLimit - (usedThisMonth ?? 0));
      if (remaining === 0) {
        return json({
          error: `Monthly recommendation limit reached on Free plan (${recLimit}). Upgrade to Premium.`,
          plan_limited: true,
          plan: sub?.plan ?? "free",
          limit: recLimit,
        }, 402);
      }
      effectiveCount = Math.min(effectiveCount, remaining);
    }

    // Load playlist
    const { data: pl } = await supabase
      .from("generated_playlists")
      .select("id, name, concept, vibe, context, description, intent_profile")
      .eq("id", generated_playlist_id)
      .eq("user_id", user.id)
      .single();
    if (!pl) return json({ error: "Playlist not found" }, 404);

    const { data: plTracks } = await supabase
      .from("generated_playlist_tracks")
      .select("position, tracks:track_id(spotify_track_id, name, artist_names)")
      .eq("generated_playlist_id", generated_playlist_id)
      .order("position", { ascending: true });

    const playlistSeed = (plTracks ?? []).slice(0, 30).map((r: any) => ({
      name: r.tracks?.name,
      artists: r.tracks?.artist_names ?? [],
      spotify_track_id: r.tracks?.spotify_track_id,
    })).filter((t: any) => t.name);

    if (playlistSeed.length < 3) {
      return json({ error: "Playlist needs at least 3 tracks to generate recommendations" }, 400);
    }

    // Exclusions
    const [
      { data: liked },
      { data: spotifyPlTracks },
      { data: prevRecs },
    ] = await Promise.all([
      supabase.from("liked_songs").select("spotify_track_id").eq("user_id", user.id),
      supabase.from("spotify_playlist_tracks").select("spotify_track_id").eq("user_id", user.id),
      supabase.from("recommendations").select("spotify_track_id, status").eq("user_id", user.id),
    ]);

    const excludedIds = new Set<string>();
    for (const r of liked ?? []) r.spotify_track_id && excludedIds.add(r.spotify_track_id);
    for (const r of spotifyPlTracks ?? []) r.spotify_track_id && excludedIds.add(r.spotify_track_id);
    for (const t of playlistSeed) t.spotify_track_id && excludedIds.add(t.spotify_track_id);

    const rejectedKey = new Set<string>();
    const alreadySuggestedKey = new Set<string>();
    for (const r of prevRecs ?? []) {
      if (!r.spotify_track_id) continue;
      if (r.status === "rejected") rejectedKey.add(r.spotify_track_id);
      else alreadySuggestedKey.add(r.spotify_track_id);
    }

    const { data: rejectedFull } = await supabase
      .from("recommendations")
      .select("track_name, artist_name")
      .eq("user_id", user.id)
      .eq("status", "rejected")
      .limit(40);
    const rejectedHints = (rejectedFull ?? [])
      .map((r) => `${r.track_name} — ${r.artist_name}`)
      .filter(Boolean);

    // Sonic profile from analysis of seed tracks
    const seedSpotifyIds = playlistSeed.map((t) => t.spotify_track_id).filter(Boolean) as string[];
    const { data: trackRows } = await supabase
      .from("tracks")
      .select("id, spotify_track_id")
      .in("spotify_track_id", seedSpotifyIds);
    const trackIds = (trackRows ?? []).map((t) => t.id);
    const { data: analyses } = trackIds.length
      ? await supabase
          .from("ai_track_analysis")
          .select("primary_genre, moods, vibe_tags, energy_level, rhythm_type, language")
          .eq("user_id", user.id)
          .in("track_id", trackIds)
      : { data: [] as any[] };

    const aggregate = {
      genres: new Map<string, number>(),
      moods: new Map<string, number>(),
      vibes: new Map<string, number>(),
      energies: new Map<string, number>(),
      rhythms: new Map<string, number>(),
      languages: new Map<string, number>(),
    };
    const bump = (m: Map<string, number>, k?: string | null) => { if (k) m.set(k, (m.get(k) ?? 0) + 1); };
    for (const a of analyses ?? []) {
      bump(aggregate.genres, a.primary_genre);
      for (const x of a.moods ?? []) bump(aggregate.moods, x);
      for (const x of a.vibe_tags ?? []) bump(aggregate.vibes, x);
      bump(aggregate.energies, a.energy_level);
      bump(aggregate.rhythms, a.rhythm_type);
      bump(aggregate.languages, a.language);
    }
    const top = (m: Map<string, number>, n = 5) =>
      [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k]) => k);

    const sonicProfile = {
      top_genres: top(aggregate.genres),
      top_moods: top(aggregate.moods),
      top_vibes: top(aggregate.vibes, 8),
      energy: top(aggregate.energies, 2),
      rhythm: top(aggregate.rhythms, 2),
      languages: top(aggregate.languages, 3),
    };

    const openaiKey = Deno.env.get("OPENAI_API_KEY");
    if (!openaiKey) return json({ error: "OPENAI_API_KEY missing" }, 500);

    // STEP 1: Build (or reuse) the intent profile
    let intent: IntentProfile | null = (pl.intent_profile as IntentProfile | null) ?? null;
    if (!intent || force_reprofile) {
      console.log("[recommend] Building deep intent profile for:", pl.name);
      intent = await buildIntentProfile(
        openaiKey,
        { name: pl.name, concept: pl.concept, vibe: pl.vibe, context: pl.context, description: pl.description },
        playlistSeed.map((t) => `${t.name} — ${(t.artists ?? []).join(", ")}`),
        sonicProfile,
      );
      await supabase
        .from("generated_playlists")
        .update({ intent_profile: intent })
        .eq("id", generated_playlist_id);
    }

    // STEP 2: Generate candidates strictly filtered by the intent profile
    const { data: topArtists } = await supabase
      .from("spotify_followed_artists")
      .select("artist_name, genres")
      .eq("user_id", user.id)
      .limit(40);

    const systemPrompt = `You are a senior music curator. You are given a deep INTENT PROFILE describing what a playlist is really about (its musical meaning, mood, energy, tempo, allowed/avoided genres, instrumentation, lyrical themes and exclusion rules).

CRITICAL RULES:
1. Recommend tracks that MATCH the interpreted_meaning, not the literal playlist name.
2. NEVER recommend tracks just because they are popular.
3. NEVER recommend tracks that break the playlist's mood, energy or tempo range.
4. RESPECT every exclusion_rule and avoided_genres entry. If a track touches them, set final_decision = "skip".
5. Each recommendation needs: a fit_score (0-1), a concrete reason_for_recommendation, matched_moods, matched_contexts, matched_audio_features, possible_issue ("none" if none), and final_decision ("recommend" or "skip").
6. If you cannot clearly explain why a track fits the deep meaning, skip it.
7. Avoid duplicates against the user's existing library and previously rejected tracks.

Return STRICT JSON: {"candidates":[{...}]}`;

    const userPrompt = JSON.stringify({
      intent_profile: intent,
      seed_tracks_in_playlist: playlistSeed.map((t) => `${t.name} — ${(t.artists ?? []).join(", ")}`).slice(0, 20),
      user_sonic_profile: sonicProfile,
      followed_artists_hint: (topArtists ?? []).slice(0, 20).map((a) => a.artist_name),
      previously_rejected: rejectedHints.slice(0, 20),
      requested_count: effectiveCount,
      output_schema: {
        candidates: [{
          track_name: "string",
          artist: "string",
          fit_score: "number 0..1",
          reason_for_recommendation: "string — must reference specific intent fields",
          matched_moods: ["string"],
          matched_contexts: ["string"],
          matched_audio_features: ["string"],
          possible_issue: "string or 'none'",
          final_decision: "recommend | skip",
        }],
      },
    });

    const aiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${openaiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        response_format: { type: "json_object" },
        temperature: 0.7,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
    });
    if (!aiRes.ok) {
      const t = await aiRes.text();
      return json({ error: "OpenAI error", details: t }, 500);
    }
    const aiData = await aiRes.json();
    let candidates: Candidate[] = [];
    try {
      const parsed = JSON.parse(aiData.choices?.[0]?.message?.content ?? "{}");
      candidates = Array.isArray(parsed.candidates) ? parsed.candidates : [];
    } catch {
      return json({ error: "AI returned invalid JSON" }, 500);
    }

    // Filter: only "recommend" with fit_score >= 0.6 and a concrete reason
    candidates = candidates.filter((c) =>
      c &&
      c.final_decision === "recommend" &&
      typeof c.fit_score === "number" &&
      c.fit_score >= 0.6 &&
      typeof c.reason_for_recommendation === "string" &&
      c.reason_for_recommendation.trim().length > 20
    );

    if (!candidates.length) return json({ error: "No suitable candidates after intent filtering", intent_profile: intent }, 200);

    // Resolve via Spotify
    const accessToken = await refreshSpotifyToken(supabase, user.id);
    if (!accessToken) return json({ error: "Spotify not connected" }, 400);

    const inserted: any[] = [];
    for (const c of candidates) {
      if (!c.track_name || !c.artist) continue;
      const q = encodeURIComponent(`track:"${c.track_name}" artist:"${c.artist}"`);
      let sr = await fetch(`https://api.spotify.com/v1/search?q=${q}&type=track&limit=1`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      let sd = await sr.json().catch(() => ({} as any));
      let item = sd?.tracks?.items?.[0];
      if (!item) {
        const q2 = encodeURIComponent(`${c.track_name} ${c.artist}`);
        sr = await fetch(`https://api.spotify.com/v1/search?q=${q2}&type=track&limit=1`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        sd = await sr.json().catch(() => ({} as any));
        item = sd?.tracks?.items?.[0];
      }
      if (!item) continue;
      const sid: string = item.id;
      if (excludedIds.has(sid) || rejectedKey.has(sid) || alreadySuggestedKey.has(sid)) continue;
      excludedIds.add(sid);
      alreadySuggestedKey.add(sid);

      const row = {
        user_id: user.id,
        based_on_playlist_id: generated_playlist_id,
        spotify_track_id: sid,
        track_name: item.name,
        artist_name: (item.artists ?? []).map((a: any) => a.name).join(", "),
        album_name: item.album?.name ?? null,
        image_url: item.album?.images?.[0]?.url ?? null,
        preview_url: item.preview_url ?? null,
        fit_score: Math.max(0, Math.min(1, c.fit_score)),
        recommendation_reason: c.reason_for_recommendation,
        matched_moods: c.matched_moods ?? [],
        matched_contexts: c.matched_contexts ?? [],
        matched_audio_features: c.matched_audio_features ?? [],
        possible_issue: c.possible_issue ?? "none",
        final_decision: c.final_decision,
        status: "pending",
      };

      const { data: ins, error: insErr } = await supabase
        .from("recommendations")
        .insert(row)
        .select()
        .single();
      if (insErr) {
        console.error("[recommend-for-playlist] insert err", insErr);
        continue;
      }
      inserted.push(ins);
    }

    return json({
      success: true,
      count: inserted.length,
      intent_profile: intent,
      recommendations: inserted,
    });
  } catch (e: any) {
    console.error("[recommend-for-playlist] error", e);
    return json({ error: e?.message ?? "Unknown error" }, 500);
  }
});
