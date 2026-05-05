import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

interface Candidate {
  title: string;
  artist: string;
  reason: string;
  fit_score: number;
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
    const { data: { user }, error: userErr } = await supabase.auth.getUser(token);
    if (userErr || !user) return json({ error: "Unauthorized" }, 401);

    const { generated_playlist_id, count = 12 } = await req.json().catch(() => ({} as any));
    if (!generated_playlist_id) return json({ error: "generated_playlist_id required" }, 400);

    // Plan gating: monthly recommendation cap
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
    // Load playlist + tracks
    const { data: pl } = await supabase
      .from("generated_playlists")
      .select("id, name, concept, vibe, context, description")
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

    // Build EXCLUSION set
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

    // Pull rejected reasons (artist+title hints)
    const { data: rejectedFull } = await supabase
      .from("recommendations")
      .select("track_name, artist_name")
      .eq("user_id", user.id)
      .eq("status", "rejected")
      .limit(40);
    const rejectedHints = (rejectedFull ?? [])
      .map((r) => `${r.track_name} — ${r.artist_name}`)
      .filter(Boolean);

    // Sonic profile from analysis (if available) for these tracks
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

    // Top artists & followed artists context
    const { data: topArtists } = await supabase
      .from("spotify_followed_artists")
      .select("artist_name, genres")
      .eq("user_id", user.id)
      .limit(40);

    // Call OpenAI to generate candidates
    const openaiKey = Deno.env.get("OPENAI_API_KEY");
    if (!openaiKey) return json({ error: "OPENAI_API_KEY missing" }, 500);

    const systemPrompt = `You are a senior music curator. Given a curated playlist concept and a listener's sonic profile, suggest NEW tracks that fit the playlist's vibe. Strict rules:
- Do NOT suggest tracks already in the user's library or the playlist (lists provided).
- Avoid tracks the user previously rejected.
- Do NOT recommend by mainstream popularity alone; favor coherent sonic fit.
- Match groove, production texture, energy, mood, era when possible.
- Only mix languages if it makes musical sense for the concept.
- Each suggestion needs a concrete reason describing the sonic fit.
Return STRICT JSON: {"candidates":[{"title":"","artist":"","reason":"","fit_score":0.0}]}`;

    const userPrompt = JSON.stringify({
      playlist: {
        name: pl.name,
        concept: pl.concept,
        vibe: pl.vibe,
        context: pl.context,
        description: pl.description,
      },
      sonic_profile: sonicProfile,
      seed_tracks: playlistSeed.map((t) => `${t.name} — ${(t.artists ?? []).join(", ")}`).slice(0, 20),
      followed_artists: (topArtists ?? []).slice(0, 20).map((a) => a.artist_name),
      rejected_examples: rejectedHints.slice(0, 20),
      avoid_titles_artists: "Avoid duplicates; we will deduplicate against the user library on our side.",
      requested_count: effectiveCount,
    });

    const aiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${openaiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        response_format: { type: "json_object" },
        temperature: 0.8,
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

    if (!candidates.length) return json({ error: "No candidates produced" }, 500);

    // Resolve candidates via Spotify search
    const accessToken = await refreshSpotifyToken(supabase, user.id);
    if (!accessToken) return json({ error: "Spotify not connected" }, 400);

    const inserted: any[] = [];
    for (const c of candidates) {
      if (!c.title || !c.artist) continue;
      const q = encodeURIComponent(`track:"${c.title}" artist:"${c.artist}"`);
      let sr = await fetch(`https://api.spotify.com/v1/search?q=${q}&type=track&limit=1`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      let sd = await sr.json().catch(() => ({} as any));
      let item = sd?.tracks?.items?.[0];
      if (!item) {
        // fallback fuzzy
        const q2 = encodeURIComponent(`${c.title} ${c.artist}`);
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
        fit_score: typeof c.fit_score === "number" ? Math.max(0, Math.min(1, c.fit_score)) : 0.7,
        recommendation_reason: c.reason ?? null,
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

    return json({ success: true, count: inserted.length, recommendations: inserted });
  } catch (e: any) {
    console.error("[recommend-for-playlist] error", e);
    return json({ error: e?.message ?? "Unknown error" }, 500);
  }
});
