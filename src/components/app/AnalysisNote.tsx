import { useLibraryEnrichment } from "@/hooks/use-library-enrichment";

export default function AnalysisNote() {
  const { inProgress } = useLibraryEnrichment();
  if (!inProgress) return null;
  return <p className="text-xs text-muted-foreground">Your library is still being analyzed; results will get better when it finishes.</p>;
}
