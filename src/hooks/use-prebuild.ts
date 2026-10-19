import { useEffect } from "react";
import { maybePrebuild } from "@/lib/playlist/prebuild";

let running = false;

/** While the app is open, keeps the saved AI Playlists up to date in the background. */
export function usePrebuild(userId: string | undefined) {
  useEffect(() => {
    if (!userId) return;
    let alive = true;
    const tick = async () => {
      if (running || !alive) return;
      running = true;
      try { await maybePrebuild(userId); } catch { /* next tick */ } finally { running = false; }
    };
    const first = setTimeout(tick, 3000);
    const t = setInterval(tick, 60_000);
    return () => { alive = false; clearTimeout(first); clearInterval(t); };
  }, [userId]);
}
