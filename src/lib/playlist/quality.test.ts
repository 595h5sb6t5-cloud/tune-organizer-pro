import { describe, it, expect, vi, beforeEach } from "vitest";
import { anchorVerdict, overlappingGroups, checkFinalPlaylist } from "./quality";
import { songIdentity, uniqueSongs, deduplicateSet } from "./identity";
import { sequence, transitionClash } from "./organize";
import { respectsRemovals } from "./feedback";
import type { TrackProfile } from "./features";
import { supabase } from "@/integrations/supabase/client";
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: vi.fn() } } }));
const track = (id: string, extra: Partial<TrackProfile> = {}): TrackProfile => ({
  id, name: id, uri: id, artists: [id], artistIds: [id], album: "", albumId: id, image: null,
  year: null, explicit: false, durationMs: 180000, genres: [], families: [], lang: "en", langConfidence: 1,
  energy: 0.4, valence: 0.5, danceability: 0.5, tempo: 90, mood: "chill", style: "jazz",
  instruments: ["piano", "bass"], texture: 0.2, warmth: 0.7, scale: 0.3, groove: "straight",
  scene: null, feeling: "peaceful", melodicFocus: 0.5, arc: "steady-groove", confidence: 1,
  percussiveDrive: 0.2, drumSound: "brushes-soft", mixCharacter: "warm-analog", ...extra,
});
beforeEach(() => vi.clearAllMocks());
describe("final playlist rules", () => {
  it("honors Twenty Tears' contextual removal without banning WhoMadeWho", () => {
    const removed = track("twenty", { name: "Twenty Tears", artists: ["WhoMadeWho", "Rebolledo"] });
    const oblivion = track("oblivion", { name: "Oblivion", artists: ["WhoMadeWho", "Mano Le Tough"] });
    const other = track("other", { artists: ["WhoMadeWho"] });
    const rules = [{ spotify_track_id: removed.id, seed_track_id: oblivion.id, context: "ai-playlist: Oblivion / What To Do" }];
    expect(respectsRemovals(removed, [oblivion], rules, [removed, oblivion])).toBe(false);
    expect(respectsRemovals(removed, [other], rules, [removed, oblivion, other])).toBe(true);
    expect(respectsRemovals(other, [oblivion], rules, [removed, oblivion, other])).toBe(true);
  });
  it("requires 8 against two anchors, not just the closest", () => {
    expect(anchorVerdict({ a: 10, b: 7, c: 7 }, ["a", "b", "c"], "song")).toBe("rejected");
    expect(anchorVerdict({ a: 8, b: 8, c: 6 }, ["a", "b", "c"], "song")).toBe("accepted");
    expect(anchorVerdict({ a: 8 }, ["a", "b", "c"], "song")).toBe("unheard");
    expect(anchorVerdict({ a: 10, b: 8, c: 7 }, ["a", "b", "c"], "a")).toBe("rejected");
  });
  it("covers final order with overlapping groups of at most 20", () => {
    const ids = Array.from({ length: 41 }, (_, i) => i);
    const groups = overlappingGroups(ids);
    expect(groups.map((g) => g.length)).toEqual([20, 20, 3]);
    expect(groups[0][19]).toBe(groups[1][0]);
    expect(groups[1][19]).toBe(groups[2][0]);
    expect([...new Set(groups.flat())]).toEqual(ids);
  });
  it("removes an audible intruder and repeats once in the new final order", async () => {
    vi.mocked(supabase.functions.invoke).mockImplementation(async (_name, opts) => {
      const body = opts?.body as { ids: string[]; anchor_ids: string[] };
      return { error: null, data: { complete: true, unheard: [], results: body.ids.map((id) => ({ id, anchor_scores: Object.fromEntries(body.anchor_ids.map((a) => [a, 8])), why: "Encaja" })),
        intruders: body.ids.includes("intruder") ? [{ id: "intruder", reason: "La voz cambia el momento" }] : [] } };
    });
    const result = await checkFinalPlaylist([track("a"), track("b"), track("c"), track("intruder")], "Conversación");
    expect(result.tracks.map((t) => t.id)).not.toContain("intruder");
    expect(result.report.removed[0]).toMatchObject({ id: "intruder", kind: "intruder", reason: "La voz cambia el momento" });
    expect(supabase.functions.invoke).toHaveBeenCalledTimes(2);
    expect(result.report.passes).toBe(2);
  });
  it("retries a failed listen once and keeps it unresolved, never rejected", async () => {
    vi.mocked(supabase.functions.invoke).mockResolvedValue({ data: null, error: new Error("504") });
    const result = await checkFinalPlaylist([track("a"), track("b"), track("c")], "Noche");
    expect(supabase.functions.invoke).toHaveBeenCalledTimes(2);
    expect(result.rejected).toEqual([]);
    expect(result.pending).toHaveLength(3);
  });
  it("removes unavoidable instrument, production, drive and feeling jumps", () => {
    const base = track("a");
    for (const extra of [{ instruments: ["guitar"] }, { drumSound: "drum-machine", mixCharacter: "dense-compressed" }, { percussiveDrive: 0.8 }, { feeling: "dark-tense" }]) {
      const out = track("out", extra);
      expect(transitionClash(base, out)).toBe(true);
      expect(sequence([base, track("b"), out], "a").map((t) => t.id)).toEqual(["a", "b"]);
    }
  });
  it("tries another smooth order instead of dropping a placeable track", () => {
    const a = track("a", { instruments: ["piano"] }), bridge = track("bridge", { instruments: ["piano", "guitar"] }), b = track("b", { instruments: ["guitar"] });
    expect(sequence([a, b, bridge], "a").map((t) => t.id)).toEqual(["a", "bridge", "b"]);
  });
  it("keeps one Yumi across IDs and versions and across all buckets", () => {
    const a = track("first", { name: "Yumi", artists: ["Notre Dame"], isrc: "DEDH72200073" });
    const b = track("second", { name: "Yumi - Extended Mix", artists: ["Notre Dame"] });
    expect(songIdentity(a)).toBe(songIdentity(b));
    expect(uniqueSongs([a, b]).map((t) => t.id)).toEqual(["first"]);
    const result = deduplicateSet([{ tracks: [a, a] }], [b], [a]);
    expect(result.playlists[0].tracks).toHaveLength(1); expect(result.unsorted).toEqual([]); expect(result.analyzing).toEqual([]);
    expect(uniqueSongs([a, track("different", { name: "Yumi", artists: ["Other"] })])).toHaveLength(2);
  });
});