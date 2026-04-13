import AppLayout from "@/components/app/AppLayout";
import { Music, Disc3, Headphones, Activity, Link as LinkIcon } from "lucide-react";
import { Link } from "react-router-dom";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { useSpotify } from "@/hooks/use-spotify";

const Dashboard = () => {
  const { profile } = useAuth();
  const { startAuth } = useSpotify();
  const firstName = profile?.first_name || "there";
  const spotifyConnected = profile?.spotify_connected ?? false;

  if (!spotifyConnected) {
    return (
      <AppLayout>
        <div className="max-w-xl mx-auto text-center py-20">
          <Headphones className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
          <h1 className="font-heading text-3xl mb-2">Welcome, {firstName}</h1>
          <p className="text-muted-foreground mb-6">
            Connect your Spotify account to see your music stats, get AI recommendations, and create playlists.
          </p>
          <Button variant="hero" size="lg" onClick={() => startAuth("/dashboard")}>
            Connect Spotify
          </Button>
          <p className="text-xs text-muted-foreground mt-4">
            Your dashboard will populate once we import your library.
          </p>
        </div>
      </AppLayout>
    );
  }

  const stats = [
    { label: "Imported Tracks", value: "—", icon: Music },
    { label: "AI Playlists", value: "0", icon: Disc3 },
    { label: "Avg Cohesion", value: "—", icon: Activity },
    { label: "Spotify", value: "Connected", icon: Headphones },
  ];

  return (
    <AppLayout>
      <div className="max-w-6xl">
        <div className="mb-8">
          <h1 className="font-heading text-3xl mb-1">Welcome back, {firstName}</h1>
          <p className="text-muted-foreground">Your music library at a glance.</p>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
          {stats.map((stat) => (
            <div key={stat.label} className="p-4 rounded-2xl bg-surface-elevated border border-border/50">
              <stat.icon className="w-4 h-4 text-muted-foreground mb-2" />
              <p className="font-heading text-xl mb-0.5">{stat.value}</p>
              <p className="text-xs text-muted-foreground">{stat.label}</p>
            </div>
          ))}
        </div>

        <div className="rounded-2xl bg-surface-elevated border border-border/50 p-8 text-center">
          <Music className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
          <h3 className="font-heading text-lg mb-1">Your library is being analyzed</h3>
          <p className="text-sm text-muted-foreground mb-4">
            Head to <Link to="/discover" className="text-accent hover:underline">Discover</Link> to get your first AI recommendations.
          </p>
        </div>
      </div>
    </AppLayout>
  );
};

export default Dashboard;
