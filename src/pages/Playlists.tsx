import AppLayout from "@/components/app/AppLayout";
import { samplePlaylists } from "@/lib/sample-data";
import { Button } from "@/components/ui/button";
import { Plus, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import { Link } from "react-router-dom";

const statusBadge = (status: string) => {
  switch (status) {
    case "synced":
      return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-accent/10 text-accent"><CheckCircle2 className="w-3 h-3" />Synced</span>;
    case "exporting":
      return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-warm-light/20 text-warm"><Loader2 className="w-3 h-3 animate-spin" />Exporting</span>;
    case "failed":
      return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-destructive/10 text-destructive"><AlertCircle className="w-3 h-3" />Failed</span>;
    default:
      return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-secondary text-muted-foreground">Ready</span>;
  }
};

const Playlists = () => {
  return (
    <AppLayout>
      <div className="max-w-5xl">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="font-heading text-3xl mb-1">Your Playlists</h1>
            <p className="text-muted-foreground">AI-generated and curated for your library.</p>
          </div>
          <Button variant="hero" className="rounded-xl gap-2">
            <Plus className="w-4 h-4" />
            Generate New
          </Button>
        </div>

        <div className="grid grid-cols-2 gap-5">
          {samplePlaylists.map((pl) => (
            <Link
              key={pl.id}
              to={`/playlists/${pl.id}`}
              className="group flex gap-5 p-5 rounded-2xl bg-surface-elevated border border-border/50 hover:border-border hover:shadow-lg hover:shadow-navy/5 transition-all duration-300"
            >
              <div className="w-20 h-20 rounded-xl bg-secondary flex items-center justify-center text-4xl flex-shrink-0">
                {pl.emoji}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between mb-1">
                  <h3 className="font-heading text-xl group-hover:text-accent transition-colors">{pl.name}</h3>
                  {statusBadge(pl.syncStatus)}
                </div>
                <p className="text-sm text-muted-foreground mb-3 line-clamp-1">{pl.description}</p>
                <div className="flex items-center gap-4 text-xs text-muted-foreground">
                  <span>{pl.trackCount} tracks</span>
                  <span>{pl.mood}</span>
                  <span>{pl.avgTempo} BPM</span>
                  <span className="text-accent font-medium">{pl.cohesionScore}% cohesion</span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </AppLayout>
  );
};

export default Playlists;
