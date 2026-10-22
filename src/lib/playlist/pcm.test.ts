import { it, expect } from "vitest";
import { middleWav } from "../../../supabase/functions/_shared/pcm";
it("encodes exactly 15 seconds in a complete WAV container", () => {
  const wave = middleWav([new Float32Array(48000 * 30).fill(0.5)], 48000, 48000 * 30);
  const header = new DataView(wave.buffer);
  expect(String.fromCharCode(...wave.slice(0, 4))).toBe("RIFF");
  expect(String.fromCharCode(...wave.slice(8, 12))).toBe("WAVE");
  expect(header.getUint32(40, true) / header.getUint32(28, true)).toBe(15);
  expect(wave.length).toBe(44 + 48000 * 15 * 2);
  expect(() => middleWav([new Float32Array(100)], 48000, 100)).toThrow();
});