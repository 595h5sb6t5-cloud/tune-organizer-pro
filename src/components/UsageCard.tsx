import { Sparkles, Crown, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { useSubscription } from "@/hooks/use-subscription";

interface Props {
  onUpgrade?: () => void;
  compact?: boolean;
}

function fmt(used: number, limit: number) {
  if (limit === -1) return `${used.toLocaleString()} · sin límite`;
  return `${used.toLocaleString()} / ${limit.toLocaleString()}`;
}
function pct(used: number, limit: number) {
  if (limit === -1) return 100;
  if (limit === 0) return 100;
  return Math.min(100, Math.round((used / limit) * 100));
}

export function UsageCard({ onUpgrade, compact }: Props) {
  const { plan, subscription, usage, loading } = useSubscription();

  if (loading || !subscription) {
    return (
      <div className="rounded-2xl border border-border/50 bg-card/50 p-5 animate-pulse">
        <div className="h-4 w-32 bg-muted rounded mb-3" />
        <div className="h-3 w-full bg-muted/60 rounded" />
      </div>
    );
  }

  const isPremium = plan === "premium";

  const items = [
    { label: "Canciones analizadas", used: usage.songs_analyzed, limit: subscription.song_analysis_limit },
    { label: "Playlists generadas", used: usage.playlists_generated, limit: subscription.playlists_limit },
    { label: "Recomendaciones este mes", used: usage.recommendations_this_period, limit: subscription.recommendations_limit },
    { label: "Exportaciones a Spotify", used: usage.exports, limit: subscription.export_limit },
  ];

  return (
    <div className={`rounded-3xl border border-border/50 bg-card/50 ${compact ? "p-5" : "p-6"}`}>
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h3 className="font-heading text-lg">Tu plan</h3>
            <Badge variant={isPremium ? "default" : "secondary"} className="text-xs">
              {isPremium ? <><Crown className="w-3 h-3 mr-1" />Premium</> : "Free"}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            {isPremium
              ? "Acceso completo a Tempo, sin límites."
              : `Estás probando Tempo. Tienes ${usage.liked_total.toLocaleString()} canciones likeadas detectadas en Spotify.`}
          </p>
        </div>
        {!isPremium && (
          <Button variant="hero" size="sm" onClick={onUpgrade}>
            <Sparkles className="w-4 h-4 mr-1.5" />Upgrade
          </Button>
        )}
      </div>

      <div className="space-y-3">
        {items.map((it) => (
          <div key={it.label}>
            <div className="flex justify-between text-xs mb-1">
              <span className="text-muted-foreground">{it.label}</span>
              <span className="tabular-nums">{fmt(it.used, it.limit)}</span>
            </div>
            <Progress value={pct(it.used, it.limit)} className={isPremium ? "opacity-60" : ""} />
          </div>
        ))}
      </div>

      {!isPremium && usage.liked_total > subscription.song_analysis_limit && (
        <div className="mt-4 rounded-xl bg-accent/10 border border-accent/30 p-3 text-xs">
          <p className="font-medium mb-1 flex items-center gap-1.5"><Zap className="w-3.5 h-3.5 text-accent" />Tu biblioteca es más grande que tu plan</p>
          <p className="text-muted-foreground">
            Tienes {usage.liked_total.toLocaleString()} canciones likeadas y Free analiza solo {subscription.song_analysis_limit}. Premium analiza todas.
          </p>
        </div>
      )}
    </div>
  );
}
