import { useEffect, useState } from "react";
import AppLayout from "@/components/app/AppLayout";
import { CheckCircle2, XCircle, Clock, Headphones, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";

const filters = ["All", "Accepted", "Dismissed", "Pending"] as const;
type Filter = (typeof filters)[number];

const statusConfig = {
  accepted: { icon: CheckCircle2, label: "Added", className: "text-accent" },
  dismissed: { icon: XCircle, label: "Dismissed", className: "text-muted-foreground" },
  pending: { icon: Clock, label: "Pending", className: "text-muted-foreground" },
};

type HistoryRow = {
  id: string;
  track_title: string;
  track_artist: string;
  compatibility_score: number | null;
  status: string;
  created_at: string;
};

const RecommendationHistory = () => {
  const { user, profile } = useAuth();
  const [filter, setFilter] = useState<Filter>("All");
  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [loading, setLoading] = useState(true);

  const spotifyConnected = profile?.spotify_connected ?? false;

  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      const { data } = await supabase
        .from("recommendation_history")
        .select("id, track_title, track_artist, compatibility_score, status, created_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(100);
      if (!cancelled) {
        setRows((data as HistoryRow[] | null) ?? []);
        setLoading(false);
      }
    };

    void load();
    return () => { cancelled = true; };
  }, [user]);

  const filtered = rows.filter((r) => {
    if (filter === "All") return true;
    return r.status === filter.toLowerCase();
  });

  return (
    <AppLayout>
      <div className="max-w-3xl">
        <div className="mb-8">
          <h1 className="font-heading text-3xl mb-1">Recommendation History</h1>
          <p className="text-muted-foreground">Track every song we've suggested and your decisions.</p>
        </div>

        {!spotifyConnected ? (
          <div className="rounded-2xl bg-surface-elevated border border-border/50 p-12 text-center">
            <Headphones className="w-10 h-10 text-muted-foreground mx-auto mb-4" />
            <h2 className="font-heading text-xl mb-2">No history yet</h2>
            <p className="text-sm text-muted-foreground max-w-sm mx-auto mb-6">
              Connect Spotify and use Discover to start building your recommendation history.
            </p>
            <Button variant="hero" asChild>
              <Link to="/settings">Go to Settings</Link>
            </Button>
          </div>
        ) : loading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="w-6 h-6 animate-spin text-accent" />
          </div>
        ) : rows.length === 0 ? (
          <div className="rounded-2xl bg-surface-elevated border border-border/50 p-12 text-center">
            <Clock className="w-10 h-10 text-muted-foreground mx-auto mb-4" />
            <h2 className="font-heading text-xl mb-2">No recommendations yet</h2>
            <p className="text-sm text-muted-foreground max-w-sm mx-auto mb-6">
              Head to Discover to get AI-powered song suggestions. Your history will appear here.
            </p>
            <Button variant="hero" asChild>
              <Link to="/discover">Open Discover</Link>
            </Button>
          </div>
        ) : (
          <>
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
                  const status = (rec.status as keyof typeof statusConfig) || "pending";
                  const config = statusConfig[status] ?? statusConfig.pending;
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
                        <p className="text-sm font-medium truncate">{rec.track_title}</p>
                        <p className="text-xs text-muted-foreground">{rec.track_artist}</p>
                      </div>
                      {rec.compatibility_score != null && (
                        <span className="text-xs text-muted-foreground">{rec.compatibility_score}%</span>
                      )}
                      <span className={`flex items-center gap-1 text-xs ${config.className}`}>
                        <StatusIcon className="w-3.5 h-3.5" />
                        {config.label}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
    </AppLayout>
  );
};

export default RecommendationHistory;
