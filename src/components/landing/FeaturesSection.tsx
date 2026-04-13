import { Brain, ArrowUpDown, RefreshCw, Shield, Sliders, Zap } from "lucide-react";

const features = [
  {
    icon: Brain,
    title: "AI Analysis",
    description: "Every track analyzed by tempo, energy, mood, genre, era, and context to find perfect groupings.",
  },
  {
    icon: ArrowUpDown,
    title: "Real Sync",
    description: "Playlists are created directly inside your Spotify account — not just in our app.",
  },
  {
    icon: Sliders,
    title: "Vibe Controls",
    description: "Regenerate playlists with a mood shift — more chill, more energetic, more nostalgic, more underground.",
  },
  {
    icon: RefreshCw,
    title: "Smart Refresh",
    description: "Add new liked songs and refresh your AI playlists. They evolve as your taste does.",
  },
  {
    icon: Zap,
    title: "Cohesion Scoring",
    description: "Each playlist gets a cohesion score so you know how well the tracks flow together.",
  },
  {
    icon: Shield,
    title: "Your Music, Your Data",
    description: "We only read your library with your permission. No training on your data. Ever.",
  },
];

const FeaturesSection = () => {
  return (
    <section id="features" className="py-24">
      <div className="container">
        <div className="text-center mb-16">
          <h2 className="font-heading text-4xl md:text-5xl tracking-tight mb-4">
            Everything your library needs
          </h2>
          <p className="text-muted-foreground text-lg max-w-lg mx-auto">
            From deep analysis to direct sync — Tempo handles the complexity so your music just flows.
          </p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6 max-w-5xl mx-auto">
          {features.map((feature, i) => (
            <div
              key={feature.title}
              className="group p-6 rounded-2xl bg-surface-elevated border border-border/50 hover:border-border hover:shadow-lg hover:shadow-navy/5 transition-all duration-300"
            >
              <div className="w-10 h-10 rounded-xl bg-secondary flex items-center justify-center mb-4 group-hover:bg-accent/10 transition-colors">
                <feature.icon className="w-5 h-5 text-foreground group-hover:text-accent transition-colors" />
              </div>
              <h3 className="font-heading text-xl mb-2">{feature.title}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">{feature.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default FeaturesSection;
