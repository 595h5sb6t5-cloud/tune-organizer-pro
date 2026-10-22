import { MPEGDecoder } from "https://esm.sh/mpg123-decoder@1.0.3";
import { middleWav } from "./pcm.ts";

/** Decode the complete preview and encode exactly 15 seconds into a complete WAV. */
export async function fetchListeningClip(url: string): Promise<{ data: string; format: "wav" } | null> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!response.ok) return null;
    const bytes = new Uint8Array(await response.arrayBuffer());
    const decoder = new MPEGDecoder();
    let wav: Uint8Array;
    try {
      await decoder.ready;
      const pcm = decoder.decode(bytes);
      wav = middleWav(pcm.channelData, pcm.sampleRate, pcm.samplesDecoded);
    } finally { decoder.free(); }
    let binary = "";
    for (let i = 0; i < wav.length; i += 0x8000) binary += String.fromCharCode(...wav.subarray(i, i + 0x8000));
    return { data: btoa(binary), format: "wav" };
  } catch (e) {
    console.warn("[listening-clip]", e instanceof Error ? e.message : "Clip decode failed");
    return null;
  }
}