import { Button } from "@/components/ui/button";
import { ArrowRight, Sparkles } from "lucide-react";
import { Link } from "react-router-dom";
import heroVisual from "@/assets/hero-visual.jpg";

const HeroSection = () => {
  return (
    <section className="relative pt-32 pb-20 overflow-hidden">
      {/* Subtle background gradient */}
      <div className="absolute inset-0 bg-gradient-to-b from-beige/50 to-background pointer-events-none" />

      <div className="container relative">
        <div className="max-w-3xl mx-auto text-center mb-12">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-secondary border border-border mb-6 text-sm text-muted-foreground animate-fade-up">
            <Sparkles className="w-3.5 h-3.5 text-accent" />
            AI-powered music organization
          </div>

          <h1 className="font-heading text-5xl md:text-7xl leading-[1.05] tracking-tight mb-6 animate-fade-up" style={{ animationDelay: "0.1s" }}>
            Your music library,
            <br />
            <span className="italic text-accent">beautifully organized</span>
          </h1>

          <p className="text-lg md:text-xl text-muted-foreground max-w-xl mx-auto mb-8 animate-fade-up" style={{ animationDelay: "0.2s" }}>
            Tempo analyzes your saved songs and creates intelligent playlists — then syncs them directly to your Spotify or Apple Music account.
          </p>

          <div className="flex items-center justify-center gap-4 animate-fade-up" style={{ animationDelay: "0.3s" }}>
            <Button variant="hero" size="lg" className="rounded-xl px-8 h-12 text-base" asChild>
              <Link to="/dashboard">
                Start organizing
                <ArrowRight className="w-4 h-4 ml-1" />
              </Link>
            </Button>
            <Button variant="hero-outline" size="lg" className="rounded-xl px-8 h-12 text-base" asChild>
              <a href="#how-it-works">See how it works</a>
            </Button>
          </div>
        </div>

        {/* Hero visual */}
        <div className="relative max-w-4xl mx-auto animate-fade-up" style={{ animationDelay: "0.4s" }}>
          <div className="relative rounded-2xl overflow-hidden shadow-2xl shadow-navy/10 border border-border/50">
            <img src={heroVisual} alt="Tempo AI music organization dashboard" className="w-full h-auto" />
            <div className="absolute inset-0 bg-gradient-to-t from-background/20 to-transparent" />
          </div>

          {/* Floating cards */}
          <div className="absolute -left-4 top-1/3 glass-card rounded-xl p-3 animate-slide-in hidden md:block" style={{ animationDelay: "0.6s" }}>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-accent/10 flex items-center justify-center">
                <span className="text-lg">🌅</span>
              </div>
              <div>
                <p className="text-xs font-medium">Soft Morning</p>
                <p className="text-[11px] text-muted-foreground">24 tracks · Chill</p>
              </div>
            </div>
          </div>

          <div className="absolute -right-4 top-1/2 glass-card rounded-xl p-3 animate-slide-in hidden md:block" style={{ animationDelay: "0.8s" }}>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-navy/10 flex items-center justify-center">
                <span className="text-lg">🌙</span>
              </div>
              <div>
                <p className="text-xs font-medium">Night Drive</p>
                <p className="text-[11px] text-muted-foreground">31 tracks · Moody</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default HeroSection;
