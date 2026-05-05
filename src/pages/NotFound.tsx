import { Link, useLocation } from "react-router-dom";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";

const NotFound = () => {
  const location = useLocation();

  useEffect(() => {
    console.error("404 Error: User attempted to access non-existent route:", location.pathname);
  }, [location.pathname]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="text-center">
        <h1 className="mb-2 font-heading text-6xl text-accent">404</h1>
        <p className="mb-6 text-xl text-muted-foreground">This page doesn't exist</p>
        <div className="flex items-center justify-center gap-3">
          <Button variant="hero" className="rounded-xl gap-2" asChild>
            <Link to="/library">
              <ArrowLeft className="w-4 h-4" />
              Go to Library
            </Link>
          </Button>
          <Button variant="hero-outline" className="rounded-xl" asChild>
            <Link to="/">Home</Link>
          </Button>
        </div>
      </div>
    </div>
  );
};

export default NotFound;
