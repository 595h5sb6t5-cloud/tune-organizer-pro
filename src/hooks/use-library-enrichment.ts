import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./use-auth";
import type { Tables } from "@/integrations/supabase/types";

export type LibraryEnrichment = Tables<"library_enrichment">;

/** Live status of the background library analysis (genres + AI classification). */
export function useLibraryEnrichment() {
  const { user } = useAuth();
  const [state, setState] = useState<LibraryEnrichment | null>(null);
  useEffect(() => {
    if (!user) return;
    const load = () => supabase.from("library_enrichment").select("*").eq("user_id", user.id).maybeSingle()
      .then(({ data }) => setState(data));
    void load();
    const ch = supabase.channel(`enrich-${user.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "library_enrichment", filter: `user_id=eq.${user.id}` }, () => void load())
      .subscribe();
    const t = setInterval(load, 30_000);
    return () => { clearInterval(t); void supabase.removeChannel(ch); };
  }, [user]);
  const inProgress = !!state && state.status !== "done" && state.status !== "idle";
  return { state, inProgress };
}
