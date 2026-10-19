import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Sparkles, X } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { loadPrebuilt, markPrebuiltSeen } from "@/lib/playlist/prebuild";

/** "Your playlists are ready" when a new background set hasn't been opened yet. */
export default function PlaylistsReadyBanner() {
  const { user } = useAuth();
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!user) return;
    let alive = true;
    const check = async () => {
      const s = await loadPrebuilt(user.id);
      if (!alive || !s?.built_at) return;
      const fresh = !s.seen_at || new Date(s.built_at) > new Date(s.seen_at);
      setCount(fresh ? s.playlists.length : 0);
    };
    check();
    const t = setInterval(check, 30000);
    return () => { alive = false; clearInterval(t); };
  }, [user]);
  if (!user || !count) return null;
  return (
    <div role="status" className="flex items-center gap-3 p-4 rounded-2xl border border-accent/40 bg-accent/10">
      <Sparkles className="w-5 h-5 text-accent shrink-0" />
      <p className="flex-1 text-sm">
        <span className="font-medium">Your playlists are ready</span>
        <span className="text-muted-foreground"> · {count} playlists built from your Liked Songs</span>
      </p>
      <Link to="/ai-playlists" className="text-sm font-medium text-accent hover:underline">Open</Link>
      <button aria-label="Dismiss" onClick={() => { setCount(0); void markPrebuiltSeen(user.id); }} className="text-muted-foreground hover:text-foreground">
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
