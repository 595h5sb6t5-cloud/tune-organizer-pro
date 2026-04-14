import { Loader2, Sparkles, Music, Globe, ListMusic, CheckCircle } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import type { AnalysisProgress, AnalysisPhase } from "@/hooks/use-liked-song-clusters";

const PHASE_CONFIG: Record<AnalysisPhase, { icon: React.ElementType; label: string; description: string }> = {
  idle: { icon: Sparkles, label: "Preparing…", description: "Getting ready to analyze your library." },
  queued: { icon: Loader2, label: "Queued…", description: "Waiting for the backend processor to start…" },
  tagging: { icon: Music, label: "Analyzing Songs", description: "Studying each song across 17 musical dimensions — mood, groove, texture, energy…" },
  defining_worlds: { icon: Globe, label: "Discovering Worlds", description: "Finding sonic patterns across your playlists, albums, and artists…" },
  assigning: { icon: ListMusic, label: "Building Playlists", description: "Assigning every song to its best sonic world using deep compatibility checks…" },
  saving: { icon: ListMusic, label: "Saving Playlists", description: "Persisting your curated playlists with covers, metadata, and track order…" },
  validating: { icon: CheckCircle, label: "Final Quality Check", description: "Running coherence, outlier, and language-trap detection on every playlist…" },
  done: { icon: CheckCircle, label: "Complete!", description: "Your playlists are ready." },
};

function getProgressValue(progress: AnalysisProgress): number {
  const { phase, totalAnalyzed, totalSongs, assignedCount, savedWorlds, totalWorlds } = progress;
  if (phase === "tagging" && totalSongs > 0) return (totalAnalyzed / totalSongs) * 100;
  if (phase === "assigning" && totalSongs > 0) return (assignedCount / totalSongs) * 100;
  if (phase === "saving" && totalWorlds > 0) return (savedWorlds / totalWorlds) * 100;
  if (phase === "done") return 100;
  return 0;
}

function getSubtext(progress: AnalysisProgress): string | null {
  const { phase, totalAnalyzed, totalSongs, assignedCount, worldsCount, savedWorlds, totalWorlds } = progress;
  if (phase === "tagging" && totalSongs > 0) return `${totalAnalyzed} of ${totalSongs} songs analyzed`;
  if (phase === "defining_worlds" && worldsCount > 0) return `${worldsCount} sonic worlds discovered`;
  if (phase === "assigning" && totalSongs > 0) return `${assignedCount} of ${totalSongs} songs assigned`;
  if (phase === "saving" && totalWorlds > 0) return `${savedWorlds} of ${totalWorlds} playlists saved`;
  return null;
}

export function AnalysisProgressDisplay({ progress, analyzing }: { progress: AnalysisProgress; analyzing: boolean }) {
  if (!analyzing) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4">
        <Loader2 className="w-10 h-10 animate-spin text-accent" />
        <p className="font-heading text-lg">Loading playlists…</p>
      </div>
    );
  }

  const config = PHASE_CONFIG[progress.phase] || PHASE_CONFIG.idle;
  const Icon = config.icon;
  const pct = getProgressValue(progress);
  const subtext = getSubtext(progress);
  const showBar = ["tagging", "assigning", "saving"].includes(progress.phase) && pct > 0;

  // Step indicators
  const phases: AnalysisPhase[] = ["tagging", "defining_worlds", "assigning", "saving", "validating"];
  const currentIdx = phases.indexOf(progress.phase);

  return (
    <div className="flex flex-col items-center justify-center py-20 gap-6">
      <div className="relative">
        <Loader2 className="w-10 h-10 animate-spin text-accent" />
        <Icon className="w-5 h-5 text-accent absolute -top-1 -right-1 animate-pulse" />
      </div>

      <div className="text-center max-w-md">
        <p className="font-heading text-lg mb-1">{progress.statusMessage || config.label}</p>

        {showBar && (
          <div className="max-w-xs mx-auto mt-3 space-y-2">
            <Progress value={pct} className="h-2" />
            {subtext && <p className="text-sm font-medium text-accent">{subtext}</p>}
          </div>
        )}

        {!showBar && subtext && (
          <p className="text-sm font-medium text-accent mt-2">{subtext}</p>
        )}

        <p className="text-sm text-muted-foreground mt-3">{config.description}</p>
      </div>

      {/* Phase steps */}
      <div className="flex items-center gap-2 mt-2">
        {phases.map((p, i) => {
          const isDone = currentIdx > i;
          const isCurrent = currentIdx === i;
          return (
            <div key={p} className="flex items-center gap-1.5">
              <div className={`w-2 h-2 rounded-full transition-colors ${
                isDone ? "bg-accent" : isCurrent ? "bg-accent animate-pulse" : "bg-muted-foreground/30"
              }`} />
              {i < phases.length - 1 && (
                <div className={`w-6 h-0.5 ${isDone ? "bg-accent/50" : "bg-muted-foreground/20"}`} />
              )}
            </div>
          );
        })}
      </div>
      <div className="flex justify-between text-[10px] text-muted-foreground gap-3">
        <span>Analyze</span>
        <span>Discover</span>
        <span>Assign</span>
        <span>Save</span>
        <span>Verify</span>
      </div>
    </div>
  );
}
