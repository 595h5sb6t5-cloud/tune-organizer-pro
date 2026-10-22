/** A complete PCM container, never a byte-sliced compressed file. Audio remains in memory. */
export function middleWav(channels: Float32Array[], sampleRate: number, samples: number, seconds = 15): Uint8Array {
  if (!channels.length || sampleRate <= 0 || samples < sampleRate * seconds) throw new Error("Preview is shorter than the required listening clip");
  const frames = Math.round(sampleRate * seconds), start = Math.floor((samples - frames) / 2);
  const count = channels.length, bytes = frames * count * 2;
  const out = new Uint8Array(44 + bytes), view = new DataView(out.buffer);
  const ascii = (at: number, value: string) => [...value].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
  ascii(0, "RIFF"); view.setUint32(4, 36 + bytes, true); ascii(8, "WAVE"); ascii(12, "fmt ");
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, count, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * count * 2, true);
  view.setUint16(32, count * 2, true); view.setUint16(34, 16, true); ascii(36, "data"); view.setUint32(40, bytes, true);
  let at = 44;
  for (let i = start; i < start + frames; i++) for (const channel of channels) {
    const v = Math.max(-1, Math.min(1, channel[i] ?? 0));
    view.setInt16(at, Math.round(v * (v < 0 ? 32768 : 32767)), true); at += 2;
  }
  return out;
}