import { describe, it, expect } from "vitest";
import { sequence } from "./organize";
import type { TrackProfile } from "./features";

const t = (id: string, feeling: string, feeling2: string | null = null) =>
  ({ id, feeling, feeling2, energy: 0.5, artistIds: [id], albumId: id, melodicFocus: null, instruments: [], genres: [], moods: [], keywords: [] } as unknown as TrackProfile);

describe("seed playlist opening", () => {
  it("positions 2 and 3 are strong feeling matches, neighbor-only songs come later", () => {
    const seed = t("seed", "inspirational", "introspective");
    const tracks = [seed, t("n1", "peaceful"), t("n2", "nostalgic"), t("s1", "introspective"), t("n3", "peaceful"), t("s2", "inspirational")];
    const ids = sequence(tracks, "seed").map((x) => x.id);
    expect(ids[0]).toBe("seed");
    expect(new Set(ids.slice(1, 3))).toEqual(new Set(["s1", "s2"]));
  });
});
