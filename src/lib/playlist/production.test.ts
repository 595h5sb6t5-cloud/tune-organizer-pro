import { describe, expect, it } from "vitest";
import { compatibility, productionClash } from "./organize";
import type { TrackProfile } from "./features";
import { audioFirst, sameBackgroundWorld } from "./vibe";
import { withinBudget } from "./priority";

const track = (extra: Partial<TrackProfile> = {}): TrackProfile => ({
  id: "a", uri: "spotify:track:a", name: "Recording", artists: ["Artist"], artistIds: ["artist-a"],
  album: "Album", albumId: "album", image: null, year: null, explicit: false, durationMs: 180000,
  genres: [], families: ["soul"], lang: "en", langConfidence: 1,
  energy: 0.4, valence: 0.5, danceability: 0.4, tempo: 90, mood: "chill", style: "soul",
  instruments: ["piano", "bass", "drums"], texture: 0.2, warmth: 0.7, scale: 0.3,
  groove: "straight", scene: null, feeling: "peaceful", melodicFocus: 0.6, arc: "steady-groove",
  confidence: 0.9, productionEra: "modern", drumSound: "dry-close", mixCharacter: "warm-analog",
  ...extra,
});

describe("vibe priority and sonic world", () => {
  it("starts with the best eight stored-audio candidates and leaves missing audio last", () => {
    const pending = track({ id: "pending", audioSource: null });
    const saved = Array.from({ length: 9 }, (_, i) => track({ id: `heard-${i}`, audioSource: "deezer" }));
    expect(audioFirst([pending, ...saved], 10).slice(0, 8).map((t) => t.id))
      .toEqual(Array.from({ length: 8 }, (_, i) => `heard-${i}`));
    expect(audioFirst([pending, ...saved], 10)[9].id).toBe("pending");
  });
  it("background rejects different production despite sharing a chill mood", () => {
    expect(sameBackgroundWorld(track(), track({ mixCharacter: "lo-fi-raw" }))).toBe(false);
    expect(sameBackgroundWorld(track(), track({ vocalStyle: "raspy-rock" })) &&
      sameBackgroundWorld(track({ vocalStyle: "soft-intimate" }), track({ vocalStyle: "raspy-rock" }))).toBe(false);
    expect(sameBackgroundWorld(track(), track())).toBe(true);
  });
  it("a hanging operation returns its fallback at the deadline", async () => {
    const result = await withinBudget(new Promise<string>(() => {}), performance.now() + 20, "omitted");
    expect(result).toBe("omitted");
  });
});

describe("heard production compatibility", () => {
  it("multiplies compatibility by exactly 0.6 when both drums and mix differ", () => {
    const a = track();
    const base = compatibility(a, track({ id: "b" }));
    expect(base).toBeGreaterThan(0);
    expect(compatibility(a, track({ drumSound: "drum-machine", mixCharacter: "bright-polished" }))).toBeCloseTo(base * 0.6, 10);
  });
  it("does not penalize a difference in only one production dimension", () => {
    expect(productionClash(track(), track({ drumSound: "drum-machine" }))).toBe(false);
    expect(productionClash(track(), track({ mixCharacter: "bright-polished" }))).toBe(false);
    expect(productionClash(track(), track({ drumSound: null, mixCharacter: "bright-polished" }))).toBe(false);
  });
  it("artist identity does not alter compatibility", () => {
    expect(compatibility(track(), track({ artistIds: ["other"], artists: ["Other"] })))
      .toBe(compatibility(track(), track()));
  });
});