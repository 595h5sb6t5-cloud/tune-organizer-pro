import AppLayout from "@/components/app/AppLayout";
import { samplePlaylists, sampleTracks } from "@/lib/sample-data";
import { Music, Disc3, Headphones, Activity, TrendingUp, CheckCircle2, AlertCircle } from "lucide-react";
import { Link } from "react-router-dom";
import { useConnections } from "@/hooks/use-connections";

const genreData = [
  { name: "Indie", pct: 28, color: "bg-accent" },
  { name: "R&B", pct: 22, color: "bg-navy" },
  { name: "Rock", pct: 18, color: "bg-warm-light" },
  { name: "Electronic", pct: 15, color: "bg-beige-dark" },
  { name: "Pop", pct: 10, color: "bg-muted-foreground/30" },
  { name: "Other", pct: 7, color: "bg-border" },
];

const moodData = [
  { name: "Melancholic", pct: 25 },
  { name: "Euphoric", pct: 20 },
  { name: "Contemplative", pct: 18 },
  { name: "Groovy", pct: 15 },
  { name: "Dark", pct: 12 },
  { name: "Dreamy", pct: 10 },
];

const Dashboard = () => {
  const { connections } = useConnections();

  const stats = [
    { label: "Imported Tracks", value: "1,247", icon: Music, change: "+38 this week", ok: true },
    { label: "AI Playlists", value: "12", icon: Disc3, change: "4 synced", ok: true },
    { label: "Avg Cohesion", value: "91%", icon: Activity, change: "+3% vs last gen", ok: true },
    { label: "Spotify", value: connections.spotify.connected ? "Connected" : "Off", icon: Headphones, change: connections.spotify.connected ? connections.spotify.email : "Not connected", ok: connections.spotify.connected },
    { label: "Apple Music", value: connections.apple.connected ? "Connected" : "Off", icon: Headphones, change: connections.apple.connected ? connections.apple.email : "Not connected", ok: connections.apple.connected },
  ];

  return (
    <AppLayout>
      <div className="max-w-6xl">
        {/* Header */}
        <div className="mb-8">
          <h1 className="font-heading text-3xl mb-1">Welcome back, Jordan</h1>
          <p className="text-muted-foreground">Your music library at a glance.</p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-5 gap-3 mb-8">
          {stats.map((stat) => (
            <div key={stat.label} className="p-4 rounded-2xl bg-surface-elevated border border-border/50">
              <div className="flex items-center justify-between mb-2">
                <stat.icon className="w-4 h-4 text-muted-foreground" />
                {stat.ok ? (
                  <TrendingUp className="w-3 h-3 text-accent" />
                ) : (
                  <AlertCircle className="w-3 h-3 text-destructive" />
                )}
              </div>
              <p className="font-heading text-xl mb-0.5">{stat.value}</p>
              <p className="text-xs text-muted-foreground">{stat.label}</p>
              <p className={`text-xs mt-1 truncate ${stat.ok ? "text-accent" : "text-destructive"}`}>{stat.change}</p>
            </div>
          ))}
        </div>
        <div className="grid grid-cols-3 gap-6 mb-8">
          {/* Genre distribution */}
          <div className="col-span-1 p-6 rounded-2xl bg-surface-elevated border border-border/50">
            <h3 className="font-heading text-lg mb-4">Genre Distribution</h3>
            <div className="space-y-3">
              {genreData.map((g) => (
                <div key={g.name}>
                  <div className="flex justify-between text-sm mb-1">
                    <span>{g.name}</span>
                    <span className="text-muted-foreground">{g.pct}%</span>
                  </div>
                  <div className="h-2 rounded-full bg-secondary overflow-hidden">
                    <div className={`h-full rounded-full ${g.color} transition-all`} style={{ width: `${g.pct}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Mood distribution */}
          <div className="col-span-1 p-6 rounded-2xl bg-surface-elevated border border-border/50">
            <h3 className="font-heading text-lg mb-4">Mood Map</h3>
            <div className="grid grid-cols-2 gap-3">
              {moodData.map((m) => (
                <div key={m.name} className="p-3 rounded-xl bg-secondary/50 text-center">
                  <p className="font-heading text-xl text-accent">{m.pct}%</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{m.name}</p>
                </div>
              ))}
            </div>
          </div>

          {/* AI Profile */}
          <div className="col-span-1 p-6 rounded-2xl bg-primary text-primary-foreground">
            <h3 className="font-heading text-lg mb-3">Your AI Music Profile</h3>
            <p className="text-sm leading-relaxed opacity-80 mb-4">
              You lean toward indie and R&B with a contemplative edge. Your library skews melancholic but with euphoric peaks — think late-night introspection balanced by festival energy.
            </p>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="opacity-70">Avg. Energy</span>
                <span>0.52</span>
              </div>
              <div className="flex justify-between">
                <span className="opacity-70">Avg. Tempo</span>
                <span>96 BPM</span>
              </div>
              <div className="flex justify-between">
                <span className="opacity-70">Top Era</span>
                <span>2010s</span>
              </div>
            </div>
          </div>
        </div>

        {/* Recent playlists */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-heading text-lg">Recent Playlists</h3>
            <Link to="/playlists" className="text-sm text-accent hover:underline">View all →</Link>
          </div>
          <div className="grid grid-cols-4 gap-4">
            {samplePlaylists.map((pl) => (
              <Link
                key={pl.id}
                to={`/playlists/${pl.id}`}
                className="group p-5 rounded-2xl bg-surface-elevated border border-border/50 hover:border-border hover:shadow-lg hover:shadow-navy/5 transition-all duration-300"
              >
                <div className="text-3xl mb-3">{pl.emoji}</div>
                <h4 className="font-heading text-lg mb-1 group-hover:text-accent transition-colors">{pl.name}</h4>
                <p className="text-xs text-muted-foreground mb-3 line-clamp-2">{pl.description}</p>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">{pl.trackCount} tracks</span>
                  <span className="flex items-center gap-1">
                    {pl.syncStatus === "synced" ? (
                      <><CheckCircle2 className="w-3 h-3 text-accent" /> Synced</>
                    ) : pl.syncStatus === "failed" ? (
                      <><AlertCircle className="w-3 h-3 text-destructive" /> Failed</>
                    ) : (
                      <span className="text-muted-foreground">Ready</span>
                    )}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </AppLayout>
  );
};

export default Dashboard;
