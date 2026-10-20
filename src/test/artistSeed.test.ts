import { describe, it, expect } from "vitest";
import { findArtistMatch, representativeSongs } from "@/components/app/seedMatch";
import { drumClash } from "@/lib/playlist/organize";

const tr = (id: string, name: string, artist: string) => ({ id, uri: "", name, explicit: false, duration_ms: 0, is_local: false, artists: [{ id: artist, name: artist }], album: { id: "a", name: "A", release_date: "1970", images: [] } });

describe("artist as seed", () => {
  it("finds an artist named in the text", () => {
    const m = findArtistMatch("marvin gaye", [tr("1", "What's Going On", "Marvin Gaye"), tr("2", "Let's Stay Together", "Al Green")]);
    expect(m?.name).toBe("Marvin Gaye");
    expect(m?.tracks.map((t) => t.id)).toEqual(["1"]);
  });
  it("picks 3 varied seeds covering the artist's most common feelings", () => {
    const s = (id: string, feeling: string) => ({ id, style: "classic-soul", scene: null, feeling });
    const out = representativeSongs([s("a", "sensual"), s("b", "sensual"), s("c", "groovy-carefree"), s("d", "introspective"), s("e", "sensual"), s("f", "groovy-carefree")]);
    expect(out.map((x) => x.feeling).sort()).toEqual(["groovy-carefree", "introspective", "sensual"]);
  });
});

describe("percussive drive hard rule", () => {
  it("clashes when drive differs more than 0.3", () => {
    expect(drumClash({ percussiveDrive: 0.2 } as any, { percussiveDrive: 0.6 } as any)).toBe(true);
    expect(drumClash({ percussiveDrive: 0.4 } as any, { percussiveDrive: 0.6 } as any)).toBe(false);
  });
});

import { rescuedScore } from "@/lib/playlist/vibe";
describe("listening rescue", () => {
  it("a text 6 becomes a 7 only when the ear gives 8+ and the feeling strongly matches", () => {
    expect(rescuedScore(6, 8, true)).toBe(7);
    expect(rescuedScore(6, 7, true)).toBe(6);
    expect(rescuedScore(6, 9, false)).toBe(6);
    expect(rescuedScore(8, 2, false)).toBe(8);
  });
});

import { earAdmits } from "@/lib/playlist/vibe";
describe("strict ear", () => {
  it("strong feeling needs 8+, neighbor-only needs 9+", () => {
    expect(earAdmits(8, true, true)).toBe(true);
    expect(earAdmits(7, true, true)).toBe(false);
    expect(earAdmits(8, false, true)).toBe(false);
    expect(earAdmits(9, false, true)).toBe(true);
    expect(earAdmits(10, false, false)).toBe(false);
  });
});
