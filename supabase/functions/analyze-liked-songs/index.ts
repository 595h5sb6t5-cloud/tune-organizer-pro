import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function extractJson(raw: string): any {
  let cleaned = raw.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
  const start = cleaned.search(/[\{\[]/);
  if (start === -1) throw new Error("No JSON found in response");
  cleaned = cleaned.substring(start);
  try { return JSON.parse(cleaned); } catch { /* continue */ }
  const opens = { "{": 0, "[": 0 };
  let inString = false, escape = false;
  for (const ch of cleaned) {
    if (escape) { escape = false; continue; }
    if (ch === "\\") { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "{") opens["{"]++;
    if (ch === "}") opens["{"]--;
    if (ch === "[") opens["["]++;
    if (ch === "]") opens["["]--;
  }
  if (inString) cleaned += '"';
  cleaned = cleaned.replace(/,\s*"[^"]*"?\s*:?\s*"?[^"]*$/, "");
  cleaned = cleaned.replace(/,\s*\{[^}]*$/, "");
  cleaned = cleaned.replace(/,\s*$/, "");
  for (let i = 0; i < opens["["]; i++) cleaned += "]";
  for (let i = 0; i < opens["{"]; i++) cleaned += "}";
  cleaned = cleaned
    .replace(/[\x00-\x1F\x7F]/g, " ")
    .replace(/,\s*}/g, "}")
    .replace(/,\s*]/g, "]");
  return JSON.parse(cleaned);
}

function fmtAudio(s: any): string {
  const p: string[] = [];
  if (s.audio_tempo != null) p.push(`BPM:${Math.round(s.audio_tempo)}`);
  if (s.audio_energy != null) p.push(`e:${s.audio_energy.toFixed(2)}`);
  if (s.audio_valence != null) p.push(`v:${s.audio_valence.toFixed(2)}`);
  if (s.audio_danceability != null) p.push(`d:${s.audio_danceability.toFixed(2)}`);
  if (s.audio_acousticness != null) p.push(`ac:${s.audio_acousticness.toFixed(2)}`);
  if (s.audio_instrumentalness != null) p.push(`in:${s.audio_instrumentalness.toFixed(2)}`);
  if (s.audio_speechiness != null) p.push(`sp:${s.audio_speechiness.toFixed(2)}`);
  if (s.audio_loudness != null) p.push(`L:${s.audio_loudness.toFixed(1)}`);
  return p.length > 0 ? ` [${p.join(",")}]` : "";
}

function fmtTags(s: any): string {
  const t: string[] = [];
  if (s.mood) t.push(`mood:"${s.mood}"`);
  if (s.groove_feel) t.push(`grv:"${s.groove_feel}"`);
  if (s.sonic_brightness) t.push(`brt:${s.sonic_brightness}`);
  if (s.spatial_quality) t.push(`spc:"${s.spatial_quality}"`);
  if (s.rhythmic_identity) t.push(`rhy:"${s.rhythmic_identity}"`);
  if (s.production_style) t.push(`prd:"${s.production_style}"`);
  if (s.vocal_style) t.push(`voc:"${s.vocal_style}"`);
  if (s.sonic_texture) t.push(`tex:"${s.sonic_texture}"`);
  if (s.atmosphere) t.push(`atm:"${s.atmosphere}"`);
  if (s.listening_context) t.push(`ctx:"${s.listening_context}"`);
  if (s.intimacy_scale) t.push(`scl:"${s.intimacy_scale}"`);
  if (s.tension_level) t.push(`ten:"${s.tension_level}"`);
  if (s.energy) t.push(`E:${s.energy}`);
  if (s.genre_tags?.length) t.push(`g:[${s.genre_tags.join(",")}]`);
  return t.length > 0 ? ` {${t.join(", ")}}` : "";
}

function fmtSong(s: any, i: number): string {
  let l = `${i + 1}. "${s.track_name}" – ${s.artist_name}`;
  if (s.album_name) l += ` (${s.album_name})`;
  l += fmtAudio(s);
  l += fmtTags(s);
  return l;
}

async function fetchAll(client: any, table: string, userId: string, columns: string, extra?: { col: string; val: any }): Promise<any[]> {
  const all: any[] = [];
  let from = 0;
  while (true) {
    let q = client.from(table).select(columns).eq("user_id", userId);
    if (extra) q = q.eq(extra.col, extra.val);
    const { data, error } = await q.range(from, from + 999);
    if (error) throw error;
    const rows = data || [];
    all.push(...rows);
    if (rows.length < 1000) break;
    from += 1000;
  }
  return all;
}

async function callAI(
  apiKey: string, model: string, sys: string, usr: string,
  tools?: any[], toolChoice?: any, temp = 0.3, retries = 2,
): Promise<any> {
  const body: any = {
    model,
    messages: [{ role: "system", content: sys }, { role: "user", content: usr }],
    temperature: temp,
  };
  if (tools) body.tools = tools;
  if (toolChoice) body.tool_choice = toolChoice;

  for (let a = 0; a <= retries; a++) {
    try {
      const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const t = await r.text();
        console.error(`AI err (${a}):`, r.status, t);
        if (r.status === 429) {
          if (a < retries) { await new Promise(w => setTimeout(w, 5000 * (a + 1))); continue; }
          throw new Error("RATE_LIMIT");
        }
        if (r.status === 402) throw new Error("CREDITS_EXHAUSTED");
        throw new Error(`AI failed: ${r.status}`);
      }
      const d = await r.json();
      const finish = d.choices?.[0]?.finish_reason;
      const tc = d.choices?.[0]?.message?.tool_calls?.[0];
      if (tc?.function?.arguments) {
        try { return JSON.parse(tc.function.arguments); } catch { return extractJson(tc.function.arguments); }
      }
      const c = d.choices?.[0]?.message?.content;
      if (!c) {
        console.warn(`Empty AI content (finish_reason: ${finish}, attempt ${a})`);
        if (a < retries) continue;
        throw new Error("Empty AI response");
      }
      return extractJson(c);
    } catch (e: any) {
      if (e.message === "RATE_LIMIT" || e.message === "CREDITS_EXHAUSTED") throw e;
      if (a < retries) { console.warn(`AI retry ${a + 1}:`, e.message); continue; }
      throw e;
    }
  }
  throw new Error("AI failed after retries");
}

function stratSample(songs: any[], max: number): any[] {
  if (songs.length <= max) return [...songs];
  const bk = new Map<string, any[]>();
  for (const s of songs) {
    const k = [s.sonic_brightness || "?", s.energy || "?", s.spatial_quality || "?", (s.genre_tags?.[0] || "?").substring(0, 10)].join("|");
    if (!bk.has(k)) bk.set(k, []);
    bk.get(k)!.push(s);
  }
  const out: any[] = [];
  const ks = [...bk.keys()];
  let r = 0;
  while (out.length < max) {
    let added = false;
    for (const k of ks) { const b = bk.get(k)!; if (r < b.length && out.length < max) { out.push(b[r]); added = true; } }
    if (!added) break;
    r++;
  }
  return out;
}

/* ═══ PROMPTS & TOOLS ═══ */

const TAG_SYS = `You are Tempo — a world-class music analyst with the ear of a mastering engineer, the soul of a DJ, and the vocabulary of a musicologist.

Analyze each song across 17 DEEP musical dimensions:

1. **mood** — Precise emotional shade ("wistful nostalgia", not "happy")
2. **energy** — Overall energy level
3. **genre_tags** — 2-4 specific subgenre tags
4. **tempo_estimate** — Rhythmic speed category
5. **era** — Sonic era influence
6. **atmosphere** — Spatial/environmental quality
7. **production_style** — Production philosophy
8. **groove_feel** — How the rhythm FEELS
9. **vocal_style** — Vocal character
10. **sonic_brightness** — Dark-to-bright spectrum
11. **spatial_quality** — Mix space
12. **rhythmic_identity** — Groove DNA
13. **listening_context** — Best listening scenario
14. **sonic_texture** — Tactile quality
15. **intimacy_scale** — Scale of sound
16. **tension_level** — Tension vs release
17. **language** — Language of lyrics

Be SPECIFIC. Each tag must be precise enough that songs sharing it would genuinely sound right next to each other.`;

const TAG_TOOL = {
  type: "function" as const,
  function: {
    name: "tag_songs",
    description: "Save deep musical analysis tags for each song",
    parameters: {
      type: "object",
      properties: {
        songs: {
          type: "array",
          items: {
            type: "object",
            properties: {
              index: { type: "number" },
              genre_tags: { type: "array", items: { type: "string" } },
              mood: { type: "string" },
              energy: { type: "string", enum: ["low", "medium-low", "medium", "medium-high", "high"] },
              tempo_estimate: { type: "string" }, era: { type: "string" },
              atmosphere: { type: "string" }, production_style: { type: "string" },
              groove_feel: { type: "string" }, vocal_style: { type: "string" },
              sonic_brightness: { type: "string", enum: ["very dark", "dark", "neutral", "bright", "very bright"] },
              spatial_quality: { type: "string" }, rhythmic_identity: { type: "string" },
              listening_context: { type: "string" }, sonic_texture: { type: "string" },
              intimacy_scale: { type: "string" }, tension_level: { type: "string" },
              language: { type: "string" },
            },
            required: ["index", "mood", "energy", "groove_feel", "vocal_style", "sonic_brightness", "spatial_quality", "rhythmic_identity", "listening_context", "sonic_texture", "intimacy_scale", "tension_level", "language"],
          },
        },
      },
      required: ["songs"],
    },
  },
};

const WORLDS_SYS = `You are Tempo — building sonic worlds from a user's ENTIRE Spotify library.

A "sonic world" is a tight cluster of songs that makes a perfect playlist — every song transitions naturally into the next.

You receive the user's FULL ecosystem:
1. ALL their Spotify playlists with tracklists — the STRONGEST signal showing how they group music
2. ALL followed artists with genres
3. ALL saved albums
4. A large sample of tagged liked songs with 17-dimension deep analysis

YOUR JOB:
- Study existing playlists DEEPLY — they are your PRIMARY BLUEPRINT
- If a playlist mixes two different sonic identities, define TWO separate worlds
- Define as many worlds as the music naturally requires (typically 10-30+ for large libraries)
- Each world MUST be narrow: "Late-night lo-fi bedroom R&B with breathy vocals" IS a world; "Chill vibes" is NOT
- Include "what_belongs" and "what_breaks_it" for each world — critical for assignment
- DO NOT create catch-all or miscellaneous worlds
- DO NOT create worlds around a single artist — focus on sonic qualities
- Language matters: keep English and Spanish songs separate unless sonic identity overrides`;

const WORLDS_TOOL = {
  type: "function" as const,
  function: {
    name: "define_sonic_worlds",
    description: "Define sonic worlds in the user's library",
    parameters: {
      type: "object",
      properties: {
        worlds: {
          type: "array",
          items: {
            type: "object",
            properties: {
              world_id: { type: "string" },
              name: { type: "string" },
              vibe_description: { type: "string" },
              ai_explanation: { type: "string" },
              mood_tags: { type: "array", items: { type: "string" } },
              color_hex: { type: "string" },
              energy_level: { type: "string", enum: ["low", "medium-low", "medium", "medium-high", "high"] },
              primary_language: { type: "string" },
              groove_identity: { type: "string" },
              sonic_brightness: { type: "string" },
              spatial_quality: { type: "string" },
              production_identity: { type: "string" },
              atmosphere: { type: "string" },
              listening_context: { type: "string" },
              vocal_character: { type: "string" },
              what_belongs: { type: "string" },
              what_breaks_it: { type: "string" },
              reference_playlist_names: { type: "array", items: { type: "string" } },
              example_song_indices: { type: "array", items: { type: "number" } },
            },
            required: ["world_id", "name", "vibe_description", "ai_explanation", "mood_tags", "color_hex", "energy_level", "primary_language", "groove_identity", "what_belongs", "what_breaks_it"],
          },
        },
      },
      required: ["worlds"],
    },
  },
};

const ASSIGN_SYS = `You are Tempo — a strict curator assigning songs to sonic worlds.

For EACH song, run this 10-point checklist against every world. Need 7+/10 to assign:

1. ✓ Same sonic texture (reverb, warmth, frequency balance)
2. ✓ Compatible groove feel (swing, bounce, rhythmic identity)
3. ✓ Same emotional shade (specific mood)
4. ✓ Compatible production philosophy
5. ✓ Compatible vocal texture
6. ✓ Same brightness spectrum
7. ✓ Same spatial scale
8. ✓ Compatible tension behavior
9. ✓ Same listening context
10. ✓ Language compatibility

RULES:
- Be STRICT. Polluted worlds are worse than missing songs.
- If 7+ pass for multiple worlds, pick highest compatibility.
- If <7 for ALL worlds, assign "__unassigned__".
- DISTRIBUTE across all worlds — don't pile into 3.
- Pay attention to "what_breaks_it".
- Genre alone is NOT enough — groove and texture matter more.`;

const ASSIGN_TOOL = {
  type: "function" as const,
  function: {
    name: "assign_songs",
    description: "Assign songs to sonic worlds",
    parameters: {
      type: "object",
      properties: {
        assignments: {
          type: "array",
          items: {
            type: "object",
            properties: {
              index: { type: "number" },
              world_id: { type: "string" },
              confidence: { type: "number" },
            },
            required: ["index", "world_id", "confidence"],
          },
        },
      },
      required: ["assignments"],
    },
  },
};

const REFINE_SYS = `You are Tempo — final strict quality pass on playlists.

For each playlist:
1. COHERENCE: Would every song transition smoothly? Remove outliers aggressively.
2. SIZE: <3 songs → merge or delete.
3. LANGUAGE: Flag inappropriate mixing.
4. SPLIT: If two distinct sub-groups exist, recommend splitting.
5. OVERLAP: If two playlists are too similar, merge them.

A tight 12-song playlist beats a loose 20-song playlist.`;

const REFINE_TOOL = {
  type: "function" as const,
  function: {
    name: "refine_playlists",
    description: "Refine playlist assignments",
    parameters: {
      type: "object",
      properties: {
        actions: {
          type: "array",
          items: {
            type: "object",
            properties: {
              action: { type: "string", enum: ["keep", "remove", "move", "merge", "delete_world"] },
              world_id: { type: "string" },
              song_indices: { type: "array", items: { type: "number" } },
              target_world_id: { type: "string" },
              reason: { type: "string" },
            },
            required: ["action", "world_id"],
          },
        },
      },
      required: ["actions"],
    },
  },
};

/* ═══ MAIN ═══ */

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const auth = req.headers.get("Authorization");
    if (!auth) return json({ error: "Not authenticated" }, 401);

    const url = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const svc = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const sb = createClient(url, anon, { global: { headers: { Authorization: auth } } });
    const adm = createClient(url, svc);

    const { data: { user }, error: ue } = await sb.auth.getUser();
    if (ue || !user) return json({ error: "Invalid session" }, 401);

    let mode = "tag_only";
    let batchSize = 150;
    let forceRetag = false;
    let worldDefs: any[] = [];
    let offset = 0;

    try {
      const b = await req.json();
      if (b?.mode) mode = b.mode;
      if (typeof b?.batch_size === "number") batchSize = Math.min(b.batch_size, 200);
      if (b?.force_retag) forceRetag = true;
      if (b?.world_definitions) worldDefs = b.world_definitions;
      if (typeof b?.offset === "number") offset = b.offset;
    } catch { /* no body */ }

    const COLS = "id, spotify_track_id, track_name, artist_name, album_name, image_url, audio_tempo, audio_energy, audio_valence, audio_danceability, audio_acousticness, audio_instrumentalness, audio_speechiness, audio_loudness, audio_liveness, mood, energy, atmosphere, production_style, groove_feel, vocal_style, sonic_brightness, spatial_quality, rhythmic_identity, listening_context, sonic_texture, intimacy_scale, tension_level, genre_tags, era, tempo_estimate";

    /* ═══ TAG ═══ */
    if (mode === "tag_only") {
      if (forceRetag) {
        console.info("[tag] force retag");
        await adm.from("liked_songs").update({
          analyzed_at: null, groove_feel: null, vocal_style: null,
          sonic_brightness: null, spatial_quality: null, rhythmic_identity: null,
          listening_context: null, sonic_texture: null, intimacy_scale: null,
          tension_level: null, mood: null, energy: null, atmosphere: null,
          production_style: null, era: null, tempo_estimate: null, genre_tags: [],
        }).eq("user_id", user.id);

        const { data: ec } = await adm.from("liked_song_clusters").select("id").eq("user_id", user.id);
        if (ec?.length) {
          await adm.from("liked_song_cluster_tracks").delete().in("cluster_id", ec.map((c: any) => c.id));
          await adm.from("liked_song_clusters").delete().eq("user_id", user.id);
        }
      }

      const { count: total } = await sb.from("liked_songs").select("id", { count: "exact", head: true }).eq("user_id", user.id);
      const t = total ?? 0;
      if (t === 0) return json({ error: "No liked songs. Import library first." }, 400);

      const { data: unan } = await sb.from("liked_songs")
        .select("id, spotify_track_id, track_name, artist_name, album_name, image_url, audio_tempo, audio_energy, audio_valence, audio_danceability, audio_acousticness, audio_instrumentalness, audio_speechiness, audio_loudness, audio_liveness")
        .eq("user_id", user.id).is("analyzed_at", null)
        .order("added_at", { ascending: false }).limit(batchSize);

      const songs = unan || [];
      if (songs.length === 0) {
        const { count: ac } = await sb.from("liked_songs").select("id", { count: "exact", head: true })
          .eq("user_id", user.id).not("analyzed_at", "is", null);
        return json({ success: true, done: true, tracks_analyzed_this_batch: 0, total_analyzed: ac ?? 0, total_liked_songs: t });
      }

      console.info(`[tag] ${songs.length}/${t} songs`);
      const list = songs.map((s: any, i: number) =>
        `${i + 1}. "${s.track_name}" – ${s.artist_name}${s.album_name ? ` (${s.album_name})` : ""}${fmtAudio(s)}`
      ).join("\n");

      const p = await callAI(API_KEY, "google/gemini-2.5-flash", TAG_SYS,
        `Analyze these ${songs.length} songs across all 17 dimensions.\n\n${list}\n\nUse tag_songs.`,
        [TAG_TOOL], { type: "function", function: { name: "tag_songs" } });

      const ts = p.songs || [];
      const now = new Date().toISOString();
      for (const tg of ts) {
        const idx = (tg.index || 0) - 1;
        if (idx < 0 || idx >= songs.length) continue;
        await adm.from("liked_songs").update({
          genre_tags: tg.genre_tags || [], mood: tg.mood, energy: tg.energy,
          tempo_estimate: tg.tempo_estimate, era: tg.era, atmosphere: tg.atmosphere,
          production_style: tg.production_style, groove_feel: tg.groove_feel,
          vocal_style: tg.vocal_style, sonic_brightness: tg.sonic_brightness,
          spatial_quality: tg.spatial_quality, rhythmic_identity: tg.rhythmic_identity,
          listening_context: tg.listening_context, sonic_texture: tg.sonic_texture,
          intimacy_scale: tg.intimacy_scale, tension_level: tg.tension_level,
          analyzed_at: now,
        }).eq("id", songs[idx].id);
      }

      const { count: an } = await sb.from("liked_songs").select("id", { count: "exact", head: true })
        .eq("user_id", user.id).not("analyzed_at", "is", null);
      return json({ success: true, done: (an ?? 0) >= t, tracks_analyzed_this_batch: ts.length, total_analyzed: an ?? 0, total_liked_songs: t });
    }

    /* ═══ DEFINE WORLDS ═══ */
    if (mode === "define_worlds") {
      const all = await fetchAll(sb, "liked_songs", user.id, COLS);
      const tagged = all.filter((s: any) => s.groove_feel != null);
      if (tagged.length < 10) return json({ error: "Need more tagged songs. Run tagging first.", needs_tagging: true, tagged: tagged.length, total: all.length }, 400);

      // Full playlists with tracklists
      const pls = await fetchAll(sb, "spotify_playlists", user.id, "id, name, description, track_count, is_owned_by_user, is_collaborative");
      const plBlocks: string[] = [];
      for (const pl of pls) {
        const tks = await fetchAll(sb, "spotify_playlist_tracks", user.id, "track_name, artist_name, position", { col: "playlist_id", val: pl.id });
        tks.sort((a: any, b: any) => (a.position || 0) - (b.position || 0));
        const shown = tks.slice(0, 50);
        if (shown.length > 0) {
          const tl = shown.map((t: any) => `  - "${t.track_name}" – ${t.artist_name}`).join("\n");
          const f = [pl.is_owned_by_user ? "user-created" : "followed", pl.is_collaborative ? "collab" : null, `${pl.track_count} tracks`].filter(Boolean).join(", ");
          plBlocks.push(`📋 "${pl.name}" (${f})${pl.description ? ` — "${pl.description}"` : ""}\n${tl}${tks.length > 50 ? `\n  +${tks.length - 50} more` : ""}`);
        }
      }

      const arts = await fetchAll(sb, "spotify_followed_artists", user.id, "artist_name, genres, popularity");
      const artL = arts.map((a: any) => `- ${a.artist_name}${a.genres?.length ? ` [${a.genres.slice(0, 4).join(", ")}]` : ""}`).join("\n");

      const albs = await fetchAll(sb, "spotify_saved_albums", user.id, "album_name, artist_name, genres, release_date, total_tracks");
      const albL = albs.map((a: any) => `- "${a.album_name}" by ${a.artist_name} (${a.release_date || "?"})${a.genres?.length ? ` [${a.genres.slice(0, 3).join(", ")}]` : ""}`).join("\n");

      const sample = stratSample(tagged, 500);
      const sampleL = sample.map((s: any, i: number) => fmtSong(s, i)).join("\n");
      const suggest = Math.max(8, Math.min(30, Math.floor(all.length / 40)));

      const ctx = `
═══ FULL SPOTIFY ECOSYSTEM ═══
LIBRARY: ${all.length} liked songs (${tagged.length} analyzed)

═══ PLAYLISTS (${pls.length} — PRIMARY BLUEPRINT) ═══
${plBlocks.length > 0 ? plBlocks.join("\n\n") : "None"}

═══ FOLLOWED ARTISTS (${arts.length}) ═══
${artL || "None"}

═══ SAVED ALBUMS (${albs.length}) ═══
${albL || "None"}

═══ TAGGED SONG SAMPLE (${sample.length} of ${tagged.length}) ═══
${sampleL}`;

      console.info(`[worlds] ${sample.length} sample, ${pls.length} playlists, ${arts.length} artists, ${albs.length} albums`);

      const p = await callAI(API_KEY, "google/gemini-2.5-pro", WORLDS_SYS,
        `Study this COMPLETE ecosystem and define ALL sonic worlds.
Use playlists as PRIMARY reference. Aim for ${suggest}+ worlds for ${all.length} songs. Be specific.\n${ctx}\n\nUse define_sonic_worlds.`,
        [WORLDS_TOOL], { type: "function", function: { name: "define_sonic_worlds" } }, 0.4);

      const worlds = p.worlds || [];
      console.info(`[worlds] defined ${worlds.length}`);
      return json({ success: true, worlds, total_songs: all.length, tagged_songs: tagged.length, playlists_analyzed: pls.length });
    }

    /* ═══ ASSIGN ═══ */
    if (mode === "assign_batch") {
      if (!worldDefs?.length) return json({ error: "world_definitions required" }, 400);

      const all = await fetchAll(sb, "liked_songs", user.id, COLS);
      const batch = all.slice(offset, offset + batchSize);
      if (batch.length === 0) return json({ success: true, done: true, assignments: [], total: all.length });

      const ws = worldDefs.map((w: any) =>
        `[${w.world_id}] "${w.name}" — ${w.vibe_description}
  Groove: ${w.groove_identity || "?"} | Bright: ${w.sonic_brightness || "?"} | Space: ${w.spatial_quality || "?"}
  Prod: ${w.production_identity || "?"} | Atm: ${w.atmosphere || "?"} | Vocal: ${w.vocal_character || "?"}
  Ctx: ${w.listening_context || "?"} | Lang: ${w.primary_language || "any"} | Energy: ${w.energy_level || "?"}
  ✅ ${w.what_belongs || "N/A"}
  ❌ ${w.what_breaks_it || "N/A"}`
      ).join("\n\n");

      const sl = batch.map((s: any, i: number) => fmtSong(s, i)).join("\n");
      console.info(`[assign] ${batch.length} songs (off ${offset}) → ${worldDefs.length} worlds`);

      const p = await callAI(API_KEY, "google/gemini-2.5-flash", ASSIGN_SYS,
        `WORLDS (${worldDefs.length}):\n${ws}\n\nSONGS (${batch.length}):\n${sl}\n\n10-point check each. 7+ to assign. Use assign_songs.`,
        [ASSIGN_TOOL], { type: "function", function: { name: "assign_songs" } });

      const asgn = (p.assignments || []).map((a: any) => {
        const i = (a.index || 0) - 1;
        if (i < 0 || i >= batch.length) return null;
        return { song_id: batch[i].id, spotify_track_id: batch[i].spotify_track_id, world_id: a.world_id, confidence: a.confidence ?? 0.8 };
      }).filter(Boolean);

      return json({ success: true, done: offset + batch.length >= all.length, assignments: asgn, batch_size: batch.length, offset, total: all.length });
    }

    /* ═══ REFINE ═══ */
    if (mode === "refine") {
      const { data: cls } = await sb.from("liked_song_clusters")
        .select("id, name, vibe_description, ai_explanation, track_count")
        .eq("user_id", user.id).order("sort_order");
      if (!cls?.length) return json({ success: true, removals: 0, merges: 0, deletions: 0 });

      const allS = await fetchAll(sb, "liked_songs", user.id, COLS);
      const sm = new Map<string, any>();
      for (const s of allS) sm.set(s.id, s);

      const wcm: Record<string, string> = {};
      const ctk: Record<string, { id: string; liked_song_id: string }[]> = {};
      const sums: string[] = [];

      for (const c of cls) {
        const tks = await fetchAll(sb, "liked_song_cluster_tracks", user.id, "id, liked_song_id", { col: "cluster_id", val: c.id });
        ctk[c.id] = tks;
        const wid = c.name.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");
        wcm[wid] = c.id;
        const tl = tks.map((t: any, i: number) => { const s = sm.get(t.liked_song_id); return s ? fmtSong(s, i) : `${i + 1}. [?]`; }).join("\n");
        sums.push(`📋 [${wid}] "${c.name}" (${tks.length} songs)\nVibe: ${c.vibe_description || "N/A"}\n${tl}`);
      }

      console.info(`[refine] ${cls.length} clusters`);

      try {
        const p = await callAI(API_KEY, "google/gemini-2.5-flash", REFINE_SYS,
          `Review ${cls.length} playlists. Remove outliers, merge small ones, delete incoherent.\n\n${sums.join("\n\n")}\n\nUse refine_playlists.`,
          [REFINE_TOOL], { type: "function", function: { name: "refine_playlists" } });

        let rem = 0, mrg = 0, del = 0;
        for (const act of (p.actions || [])) {
          const cid = wcm[act.world_id];
          if (!cid && act.action !== "keep") continue;

          if (act.action === "remove" && act.song_indices?.length && cid) {
            const tl = ctk[cid] || [];
            for (const idx of act.song_indices) {
              const ri = idx - 1;
              if (ri >= 0 && ri < tl.length) { await adm.from("liked_song_cluster_tracks").delete().eq("id", tl[ri].id); rem++; }
            }
            const { count } = await sb.from("liked_song_cluster_tracks").select("id", { count: "exact", head: true }).eq("cluster_id", cid).eq("user_id", user.id);
            await adm.from("liked_song_clusters").update({ track_count: count ?? 0 }).eq("id", cid);
          }
          if (act.action === "delete_world" && cid) {
            await adm.from("liked_song_cluster_tracks").delete().eq("cluster_id", cid);
            await adm.from("liked_song_clusters").delete().eq("id", cid);
            del++;
          }
          if (act.action === "merge" && act.target_world_id && cid) {
            const tid = wcm[act.target_world_id];
            if (tid) {
              await adm.from("liked_song_cluster_tracks").update({ cluster_id: tid }).eq("cluster_id", cid).eq("user_id", user.id);
              const { count } = await sb.from("liked_song_cluster_tracks").select("id", { count: "exact", head: true }).eq("cluster_id", tid).eq("user_id", user.id);
              await adm.from("liked_song_clusters").update({ track_count: count ?? 0 }).eq("id", tid);
              await adm.from("liked_song_clusters").delete().eq("id", cid);
              mrg++;
            }
          }
        }
        console.info(`[refine] ${rem} rem, ${mrg} mrg, ${del} del`);
        return json({ success: true, removals: rem, merges: mrg, deletions: del });
      } catch (e: any) {
        console.error("Refine err:", e);
        return json({ success: true, removals: 0, merges: 0, deletions: 0 });
      }
    }

    return json({ error: `Unknown mode: ${mode}` }, 400);
  } catch (e: any) {
    console.error("analyze error:", e);
    const m = e instanceof Error ? e.message : "Analysis failed";
    if (m === "RATE_LIMIT") return json({ error: "Rate limit. Try again." }, 429);
    if (m === "CREDITS_EXHAUSTED") return json({ error: "AI credits exhausted." }, 402);
    return json({ error: m }, 500);
  }
});
