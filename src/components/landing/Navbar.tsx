import { Button } from "@/components/ui/button";
import { Music2 } from "lucide-react";
import { Link } from "react-router-dom";

const scrollTo = (id: string) => {
  const el = document.getElementById(id);
  if (el) el.scrollIntoView({ behavior: "smooth" });
};

const Navbar = () => {
  return (
    <nav className="fixed top-0 left-0 right-0 z-50 bg-background/80 backdrop-blur-xl border-b border-border/50">
      <div className="container flex items-center justify-between h-16">
        <Link to="/" className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
            <Music2 className="w-4 h-4 text-primary-foreground" />
          </div>
          <span className="font-heading text-xl tracking-tight">Tempo</span>
        </Link>

        <div className="hidden md:flex items-center gap-8 text-sm text-muted-foreground">
          <button onClick={() => scrollTo("features")} className="hover:text-foreground transition-colors cursor-pointer">Features</button>
          <button onClick={() => scrollTo("how-it-works")} className="hover:text-foreground transition-colors cursor-pointer">How it works</button>
          <button onClick={() => scrollTo("pricing")} className="hover:text-foreground transition-colors cursor-pointer">Pricing</button>
        </div>

        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" asChild>
            <Link to="/dashboard">Log in</Link>
          </Button>
          <Button variant="hero" size="sm" asChild>
            <Link to="/dashboard">Get started</Link>
          </Button>
        </div>
      </div>
    </nav>
  );
};

export default Navbar;
