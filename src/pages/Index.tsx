import { Link } from "react-router-dom";
import { Music2, ArrowRight, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import FooterSection from "@/components/landing/FooterSection";

const Index = () => {
  return (
    <div className="min-h-screen flex flex-col">
      <nav className="fixed top-0 left-0 right-0 z-50 bg-background/80 backdrop-blur-xl border-b border-border/50">
        <div className="container flex items-center justify-between h-16">
          <Link to="/" className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
              <Music2 className="w-4 h-4 text-primary-foreground" />
            </div>
            <span className="font-heading text-xl tracking-tight">Tempo</span>
          </Link>
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" asChild>
              <Link to="/auth">Log in</Link>
            </Button>
            <Button variant="hero" size="sm" asChild>
              <Link to="/auth">Get started</Link>
            </Button>
          </div>
        </div>
      </nav>

      <section className="flex-1 flex items-center justify-center pt-32 pb-20">
        <div className="container max-w-2xl text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-secondary border border-border mb-6 text-sm text-muted-foreground">
            <Sparkles className="w-3.5 h-3.5 text-accent" />
            AI music organization for Spotify
          </div>
          <h1 className="font-heading text-5xl md:text-7xl leading-[1.05] tracking-tight mb-6">
            Your Spotify library,
            <br />
            <span className="italic text-accent">beautifully organized</span>
          </h1>
          <p className="text-lg text-muted-foreground mb-8">
            Connect your Spotify account, let AI analyze your real music taste, and generate playlists that actually feel like you.
          </p>
          <Button variant="hero" size="lg" className="rounded-xl px-8 h-12 text-base" asChild>
            <Link to="/auth">
              Connect Spotify <ArrowRight className="w-4 h-4 ml-1" />
            </Link>
          </Button>
        </div>
      </section>

      <FooterSection />
    </div>
  );
};

export default Index;
