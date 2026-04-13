import { X, Play, Pause, Loader2 } from "lucide-react";
import { useAudioPreview } from "@/hooks/use-audio-preview";

export function FloatingPlayer() {
  const { trackId, playing, progress, loading, stop, play, seek } = useAudioPreview();

  if (!trackId) return null;

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 bg-card border border-border/60 rounded-2xl shadow-xl px-4 py-3 flex items-center gap-3 min-w-[280px] max-w-[400px]">
      {/* Play/Pause */}
      <button
        onClick={() => {
          // Toggling is handled inside the hook via play with same trackId
          const audio = document.querySelector("audio");
          if (playing) {
            audio?.pause();
          } else {
            audio?.play();
          }
        }}
        className="w-8 h-8 rounded-full bg-accent/10 flex items-center justify-center text-accent flex-shrink-0"
      >
        {loading ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : playing ? (
          <Pause className="w-4 h-4" />
        ) : (
          <Play className="w-4 h-4" />
        )}
      </button>

      {/* Progress bar */}
      <div
        className="flex-1 h-1.5 rounded-full bg-secondary cursor-pointer relative overflow-hidden"
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const fraction = (e.clientX - rect.left) / rect.width;
          seek(Math.max(0, Math.min(1, fraction)));
        }}
      >
        <div
          className="absolute inset-y-0 left-0 bg-accent rounded-full transition-[width] duration-100"
          style={{ width: `${progress * 100}%` }}
        />
      </div>

      {/* Close */}
      <button
        onClick={stop}
        className="w-6 h-6 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
