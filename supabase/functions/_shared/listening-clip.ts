import MPEGDecoder from "./mpg123/MPEGDecoder.js";
import decodeAAC from "https://esm.sh/@audio/decode-aac@1.6.0?target=es2022";
import { middleWav } from "./pcm.ts";

/** Decode the complete preview and encode exactly 15 seconds into a complete WAV. */
export async function fetchListeningClip(url: string): Promise<{ data: string; format: "wav" } | null> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!response.ok) return null;
    const bytes = new Uint8Array(await response.arrayBuffer());
    let wav: Uint8Array;
    const mp4 = String.fromCharCode(...bytes.subarray(4, 8)) === "ftyp";
    if (mp4) {
      const pcm = await decodeAAC(bytes);
      wav = middleWav(pcm.channelData, pcm.sampleRate, pcm.channelData[0]?.length ?? 0);
    } else {
      const decoder = new MPEGDecoder();
      try {
        await decoder.ready;
        const pcm = decoder.decode(bytes);
        wav = middleWav(pcm.channelData, pcm.sampleRate, pcm.samplesDecoded);
      } finally { decoder.free(); }
    }
    let binary = "";
    for (let i = 0; i < wav.length; i += 0x8000) binary += String.fromCharCode(...wav.subarray(i, i + 0x8000));
    return { data: btoa(binary), format: "wav" };
  } catch (e) {
    console.warn("[listening-clip]", e instanceof Error ? e.message : "Clip decode failed");
    return null;
  }
}