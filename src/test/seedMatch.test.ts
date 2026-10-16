import { describe, it, expect } from "vitest";
import { leftoverKeywords, type SeedMatch } from "@/components/app/seedMatch";

const track = (name: string, artists: string[]) => ({ id: name, name, artists: artists.map((a, i) => ({ id: `${a}${i}`, name: a })) }) as any;
const seed = (t: any, span: string): SeedMatch => ({ track: t, span, artistHit: [], score: 1 });
const fol = track("Forms Of Love", ["Adam Port", "Alan Dixon", "Keinemusik"]);
const lib = [fol, track("Impossible - &ME Remix", ["&ME"]), track("Sun", ["BLOND:ISH"])];

describe("leftoverKeywords", () => {
  it("removes seed title, seed artists and symbol artists; <3 letters means no keywords", () => {
    expect(leftoverKeywords("forms of love adam port &me", [seed(fol, "forms of love")], lib)).toBe("");
  });
  it("keeps real vibe words", () => {
    expect(leftoverKeywords("forms of love, late night drive", [seed(fol, "forms of love")], lib)).toBe("late night drive");
  });
  it("recognizes BLOND:ISH", () => {
    expect(leftoverKeywords("blond:ish sunset", [], lib)).toBe("sunset");
  });
});
