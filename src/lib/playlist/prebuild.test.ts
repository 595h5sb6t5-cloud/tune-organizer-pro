import { describe, it, expect } from "vitest";
import { needsRebuild } from "./prebuild";

const base = { total: 1000, analyzed: 0, builtCount: 0, hasBuild: false, analysisDone: false };

describe("needsRebuild", () => {
  it("waits for the first 200 analyzed songs", () => {
    expect(needsRebuild({ ...base, analyzed: 199 })).toBe(false);
    expect(needsRebuild({ ...base, analyzed: 200 })).toBe(true);
  });
  it("rebuilds after a 5% change", () => {
    const b = { ...base, hasBuild: true, builtCount: 400 };
    expect(needsRebuild({ ...b, analyzed: 449 })).toBe(false);
    expect(needsRebuild({ ...b, analyzed: 450 })).toBe(true);
  });
  it("rebuilds when analysis finishes with a 1% change", () => {
    expect(needsRebuild({ ...base, hasBuild: true, builtCount: 980, analyzed: 990, analysisDone: true })).toBe(true);
    expect(needsRebuild({ ...base, hasBuild: true, builtCount: 985, analyzed: 990, analysisDone: true })).toBe(false);
  });
});
