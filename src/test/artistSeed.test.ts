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
  it("picks the 3 songs most alike in style, scene and feeling", () => {
    const s = (id: string, style: string, feeling: string) => ({ id, style, scene: null, feeling });
    const out = representativeSongs([s("a", "classic-soul", "sensual"), s("b", "classic-soul", "sensual"), s("c", "funk", "groovy-carefree"), s("d", "classic-soul", "sensual")]);
    expect(out.map((x) => x.id).sort()).toEqual(["a", "b", "d"]);
  });
});

describe("percussive drive hard rule", () => {
  it("clashes when drive differs more than 0.3", () => {
    expect(drumClash({ percussiveDrive: 0.2 } as any, { percussiveDrive: 0.6 } as any)).toBe(true);
    expect(drumClash({ percussiveDrive: 0.4 } as any, { percussiveDrive: 0.6 } as any)).toBe(false);
  });
});
