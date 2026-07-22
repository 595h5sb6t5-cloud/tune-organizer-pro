// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const REVIEWER_SYS = `Eres el revisor final de playlists de una app conectada con Spotify.
Recibirás una playlist creada usando canciones que el usuario ya tiene guardadas.
Tu trabajo es revisar si las canciones realmente combinan entre ellas y si la playlist se siente coherente de principio a fin.
No debes agregar canciones nuevas.

Analiza: ambiente general, energía, tempo, tipo de beat, instrumentos, melodía, tono, emoción, agresividad, suavidad, cambios entre canciones, orden de reproducción, coherencia del nombre y descripción, canciones fuera de lugar, canciones demasiado parecidas repetitivas, canciones que quedarían mejor en otra playlist.

No apruebes solo porque comparten género. Una buena playlist tiene identidad clara: mismo ambiente, mismo grupo de idiomas, aunque cambien artistas, años o géneros.

Revisa especialmente:
- Una canción lenta no debe romper una sección intensa.
- Una canción alegre no debe aparecer de golpe en un ambiente oscuro.
- Rap melódico no se mezcla sin razón con rap agresivo y seco.
- Rock suave no se mezcla con rock pesado solo por ser rock.
- Español no se agrupa solo por idioma.
- Antiguo no se agrupa solo por década.
- Los cambios de energía deben ser suaves o intencionales.

Si una canción no encaja, elimínala y explica por qué.
Si el orden no funciona, cambia posiciones.
Si hay dos ambientes, divide solo si hay suficiente para dos grupos sólidos.

Entrega SOLAMENTE JSON válido con esta forma exacta:
{
  "approved": true,
  "coherence_score": 0.0,
  "name_score": 0.0,
  "ordering_score": 0.0,
  "main_issue": "Problema principal o ninguno",
  "songs_to_remove": [{"spotify_track_id":"ID","reason":"..."}],
  "songs_to_reorder": [{"spotify_track_id":"ID","old_position":1,"new_position":5,"reason":"..."}],
  "should_split": false,
  "split_reason": "Razón o ninguno",
  "final_playlist": {
    "playlist_name": "Nombre final",
    "description": "Descripción final",
    "tracks": ["spotify_track_id_en_orden_final", "..."]
  }
}
Todos los scores entre 0 y 1. approved=true SOLO si coherence_score >= 0.82. No escribas nada fuera del JSON.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const auth = req.headers.get("Authorization") ?? "";
    const token = auth.replace(/^Bearer\s+/i, "");
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: userData, error: userErr } = await supabase.auth.getUser(token);
    if (userErr || !userData.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const userId = userData.user.id;

    const body = await req.json().catch(() => ({}));
    const playlistId = body?.generated_playlist_id as string | undefined;
    const apply = body?.apply === true;
    if (!playlistId) {
      return new Response(JSON.stringify({ error: "generated_playlist_id required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: pl } = await supabase
      .from("generated_playlists")
      .select("id,user_id,name,description,concept,vibe,context")
      .eq("id", playlistId)
      .maybeSingle();
    if (!pl || pl.user_id !== userId) {
      return new Response(JSON.stringify({ error: "Playlist not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: rows } = await supabase
      .from("generated_playlist_tracks")
      .select("id,position,fit_score,reason_for_inclusion,track_id,tracks:track_id(spotify_track_id,name,artist_names,album_name)")
      .eq("generated_playlist_id", playlistId)
      .order("position", { ascending: true });

    const trackList = (rows ?? []).map((r: any) => ({
      id: r.id,
      position: r.position,
      spotify_track_id: r.tracks?.spotify_track_id,
      track_id: r.track_id,
      name: r.tracks?.name,
      artists: r.tracks?.artist_names,
    }));

    const sids = trackList.map((t) => t.spotify_track_id).filter(Boolean) as string[];
    const { data: analyses } = await supabase
      .from("ai_track_analysis")
      .select("spotify_track_id,main_genre,main_mood,tempo_feel,beat_style,energy_score,darkness,softness,aggressiveness,dance_feel,nostalgia,melody_level,bass_level,vocal_intensity,drum_intensity,emotional_intensity,secondary_moods_v2,sound_texture,transition_in,transition_out,analysis_version")
      .eq("user_id", userId)
      .in("spotify_track_id", sids);

    const aMap = new Map<string, any>();
    for (const a of analyses ?? []) {
      const prev = aMap.get(a.spotify_track_id);
      if (!prev || (a.analysis_version === "v2" && prev.analysis_version !== "v2")) aMap.set(a.spotify_track_id, a);
    }

    const payload = {
      playlist: { name: pl.name, description: pl.description, concept: pl.concept, vibe: pl.vibe, context: pl.context },
      tracks: trackList.map((t) => {
        const a = aMap.get(t.spotify_track_id) ?? {};
        return {
          position: t.position,
          spotify_track_id: t.spotify_track_id,
          name: t.name,
          artists: t.artists,
          analysis: {
            main_genre: a.main_genre, main_mood: a.main_mood, tempo_feel: a.tempo_feel, beat_style: a.beat_style,
            energy: a.energy_score, dark: a.darkness, soft: a.softness, aggressive: a.aggressiveness,
            dance: a.dance_feel, nostalgia: a.nostalgia, melody: a.melody_level, bass: a.bass_level,
            vocal: a.vocal_intensity, drums: a.drum_intensity, emotion: a.emotional_intensity,
            secondary_moods: a.secondary_moods_v2, texture: a.sound_texture,
            transition_in: a.transition_in, transition_out: a.transition_out,
          },
        };
      }),
    };

    const openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: REVIEWER_SYS },
          { role: "user", content: JSON.stringify(payload) },
        ],
      }),
    });
    if (!openaiRes.ok) {
      const t = await openaiRes.text();
      return new Response(JSON.stringify({ error: `OpenAI error: ${openaiRes.status}`, detail: t.slice(0, 500) }), { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const oj = await openaiRes.json();
    const raw = oj.choices?.[0]?.message?.content ?? "{}";
    let review: any;
    try { review = JSON.parse(raw); } catch { review = { error: "Invalid JSON from model", raw }; }

    let applied: any = null;
    if (apply && review && !review.error) {
      const bySid = new Map(trackList.map((t) => [t.spotify_track_id, t]));
      // Remove songs
      const removeSids: string[] = (review.songs_to_remove ?? []).map((r: any) => r.spotify_track_id).filter(Boolean);
      const rowIdsToRemove = removeSids.map((s) => bySid.get(s)?.id).filter(Boolean) as string[];
      if (rowIdsToRemove.length) {
        await supabase.from("generated_playlist_tracks").delete().in("id", rowIdsToRemove);
      }

      // Reorder using final_playlist.tracks
      const finalSids: string[] = review.final_playlist?.tracks ?? [];
      const seen = new Set<string>();
      const orderedSids = finalSids.filter((s) => bySid.has(s) && !removeSids.includes(s) && !seen.has(s) && seen.add(s));
      // Append leftovers not mentioned
      for (const t of trackList) {
        if (!t.spotify_track_id) continue;
        if (removeSids.includes(t.spotify_track_id)) continue;
        if (!seen.has(t.spotify_track_id)) { orderedSids.push(t.spotify_track_id); seen.add(t.spotify_track_id); }
      }
      const updates = orderedSids.map((sid, idx) => ({ id: bySid.get(sid)!.id, position: idx + 1 }));
      for (const u of updates) {
        await supabase.from("generated_playlist_tracks").update({ position: u.position }).eq("id", u.id);
      }

      // Update name/description if provided
      const newName = review.final_playlist?.playlist_name?.trim();
      const newDesc = review.final_playlist?.description?.trim();
      const patch: any = {};
      if (newName && newName !== pl.name) patch.name = newName;
      if (newDesc && newDesc !== pl.description) patch.description = newDesc;
      if (Object.keys(patch).length) await supabase.from("generated_playlists").update(patch).eq("id", playlistId);

      applied = { removed: rowIdsToRemove.length, reordered: updates.length, renamed: !!patch.name, redescribed: !!patch.description };
    }

    return new Response(JSON.stringify({ review, applied }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
