import AppLayout from "@/components/app/AppLayout";
import { sampleRecommendations } from "@/lib/sample-data";
import { CheckCircle2, XCircle, Bookmark, Clock } from "lucide-react";
import { useState } from "react";

const filters = ["All", "Accepted", "Dismissed", "Saved"] as const;
type Filter = typeof filters[number];

const statusConfig = {
  accepted: { icon: CheckCircle2, label: "Added", className: "text-accent" },
  dismissed: { icon: XCircle, label: "Dismissed", className: "text-muted-foreground" },
  saved: { icon: Bookmark, label: "Saved", className: "text-warm" },
  pending: { icon: Clock, label: "Pending", className: "text-muted-foreground" },
};

const RecommendationHistory = () => {
  const [filter, setFilter] = useState<Filter>("All");

  const filtered = sampleRecommendations.filter((r) => {
    if (filter === "All") return r.status !== "pending";
    return r.status === filter.toLowerCase();
  });

  return (
    <AppLayout>
      <div className="max-w-3xl">
        <div className="mb-8">
          <h1 className="font-heading text-3xl mb-1">Recommendation History</h1>
          <p className="text-muted-foreground">Track every song we've suggested and your decisions.</p>
        </div>

        <div className="flex gap-2 mb-6">
          {filters.map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-4 py-2 rounded-xl text-sm transition-all ${
                filter === f
                  ? "bg-primary text-primary-foreground"
                  : "bg-secondary text-muted-foreground hover:text-foreground"
              }`}
            >
              {f}
            </button>
          ))}
        </div>

        {filtered.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-muted-foreground">No recommendations in this category yet.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map((rec) => {
              const config = statusConfig[rec.status];
              const StatusIcon = config.icon;
              return (
                <div
                  key={rec.id}
                  className="flex items-center gap-4 p-4 rounded-2xl bg-surface-elevated border border-border/50"
                >
                  <div className="w-10 h-10 rounded-xl bg-secondary flex items-center justify-center text-base flex-shrink-0">
                    🎵
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{rec.track.title}</p>
                    <p className="text-xs text-muted-foreground">{rec.track.artist}</p>
                  </div>
                  <span className="text-xs text-muted-foreground">{rec.matchScore}%</span>
                  <span className={`flex items-center gap-1 text-xs ${config.className}`}>
                    <StatusIcon className="w-3.5 h-3.5" />
                    {config.label}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </AppLayout>
  );
};

export default RecommendationHistory;
