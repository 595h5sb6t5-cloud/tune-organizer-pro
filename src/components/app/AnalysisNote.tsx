import { useLibraryEnrichment } from "@/hooks/use-library-enrichment";

export default function AnalysisNote() {
  const { state, inProgress } = useLibraryEnrichment();
  // Above 90% analyzed the results are already good, even if the process is paused.
  const share = state?.tracks_total ? state.tracks_done / state.tracks_total : 0;
  if (!inProgress || share >= 0.9) return null;
  return <p className="text-xs text-muted-foreground">Your library is still being analyzed; results will get better when it finishes.</p>;
}
