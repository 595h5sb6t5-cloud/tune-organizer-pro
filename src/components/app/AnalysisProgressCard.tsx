import { Loader2, PauseCircle } from "lucide-react";
import { useLibraryEnrichment } from "@/hooks/use-library-enrichment";

export default function AnalysisProgressCard() {
  const { state, inProgress } = useLibraryEnrichment();
  if (!state || !inProgress) return null;
  const pausedMs = state.paused_until ? new Date(state.paused_until).getTime() - Date.now() : 0;
  const paused = state.status === "paused" && pausedMs > 0;
  const artistsLeft = state.artists_done < state.artists_total;
  const label = state.status === "error"
    ? `Library analysis stopped: ${state.error ?? "unknown error"}`
    : artistsLeft
      ? `Analyzing your library · ${state.artists_done.toLocaleString()} of ${state.artists_total.toLocaleString()} artists`
      : `Analyzing your library · ${state.tracks_done.toLocaleString()} of ${state.tracks_total.toLocaleString()} songs`;
  return (
    <div className="p-4 rounded-2xl bg-surface-elevated border border-border/50 flex items-center gap-3 text-sm">
      {paused ? <PauseCircle className="w-4 h-4 text-muted-foreground" /> : <Loader2 className="w-4 h-4 animate-spin text-accent" />}
      <span>{label}</span>
      {paused && (
        <span className="text-muted-foreground">
          · {state.pause_reason === "ai_rate_limit" ? "Paused briefly" : "Paused by Spotify"}, resuming in {Math.max(1, Math.ceil(pausedMs / 60000))} min
        </span>
      )}
    </div>
  );
}
