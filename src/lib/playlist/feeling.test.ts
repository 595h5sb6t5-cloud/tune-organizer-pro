import { describe, it, expect } from "vitest";
import { feelingScore, feelingNeighbors, feelClash } from "./organize";
import type { TrackProfile } from "./features";
const t = (feeling: string, feeling2: string | null = null) => ({ feeling, feeling2, melodicFocus: null } as unknown as TrackProfile);
describe("feeling compatibility", () => {
  it("same main feeling = 1", () => expect(feelingScore(t("inspirational"), t("inspirational"))).toBe(1));
  it("main equals the other's secondary = 0.75", () => expect(feelingScore(t("inspirational", "introspective"), t("introspective"))).toBe(0.75));
  it("neighbors = 0.5", () => expect(feelingScore(t("inspirational"), t("peaceful"))).toBe(0.5));
  it("inspirational and euphoric are no longer neighbors", () => {
    expect(feelingNeighbors("inspirational", "euphoric")).toBe(false);
    expect(feelingScore(t("inspirational", "introspective"), t("euphoric"))).toBe(0);
    expect(feelClash(t("inspirational"), t("euphoric"))).toBe(true);
  });
  it("euphoric ↔ groovy-carefree", () => expect(feelingNeighbors("euphoric", "groovy-carefree")).toBe(true));
});
