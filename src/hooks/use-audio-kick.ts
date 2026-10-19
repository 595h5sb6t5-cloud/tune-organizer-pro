import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

/** Backstop: while the app is open, nudge the background listening every 3 min (single-flight on the server). */
export function useAudioKick(userId?: string) {
  useEffect(() => {
    if (!userId) return;
    const kick = async () => {
      const { data } = await supabase.from("audio_analysis_state").select("status, lease_until").eq("id", 1).maybeSingle();
      if (data?.status === "done") return;
      if (data?.lease_until && new Date(data.lease_until).getTime() > Date.now()) return;
      void supabase.functions.invoke("audio-analyze", { body: {} }).catch(() => null);
    };
    const first = setTimeout(kick, 15_000);
    const every = setInterval(kick, 180_000);
    return () => { clearTimeout(first); clearInterval(every); };
  }, [userId]);
}
