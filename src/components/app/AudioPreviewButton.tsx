import { Play, Pause, Loader2, Volume2 } from "lucide-react";
import { useAudioPreview } from "@/hooks/use-audio-preview";
import { cn } from "@/lib/utils";

interface AudioPreviewButtonProps {
  trackId: string;
  previewUrl: string | null | undefined;
  size?: "sm" | "md";
  className?: string;
}

export function AudioPreviewButton({ trackId, previewUrl, size = "sm", className }: AudioPreviewButtonProps) {
  const { play, isPlaying, isLoading } = useAudioPreview();

  if (!previewUrl) {
    return (
      <button
        disabled
        title="No preview available"
        className={cn(
          "rounded-lg inline-flex items-center justify-center text-muted-foreground/30 cursor-not-allowed",
          size === "sm" ? "w-7 h-7" : "w-9 h-9",
          className,
        )}
      >
        <Volume2 className={size === "sm" ? "w-3.5 h-3.5" : "w-4 h-4"} />
      </button>
    );
  }

  const playing = isPlaying(trackId);
  const loading = isLoading(trackId);

  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        play(trackId, previewUrl);
      }}
      title={playing ? "Pause preview" : "Play preview"}
      className={cn(
        "rounded-lg inline-flex items-center justify-center transition-colors",
        playing
          ? "text-accent bg-accent/10"
          : "text-muted-foreground hover:text-accent hover:bg-accent/10",
        size === "sm" ? "w-7 h-7" : "w-9 h-9",
        className,
      )}
    >
      {loading ? (
        <Loader2 className={cn("animate-spin", size === "sm" ? "w-3.5 h-3.5" : "w-4 h-4")} />
      ) : playing ? (
        <Pause className={cn(size === "sm" ? "w-3.5 h-3.5" : "w-4 h-4")} />
      ) : (
        <Play className={cn(size === "sm" ? "w-3.5 h-3.5" : "w-4 h-4")} />
      )}
    </button>
  );
}
