import { Component, ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { AlertCircle, RefreshCw } from "lucide-react";

interface Props { children: ReactNode; }
interface State { error: Error | null; }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: unknown) {
    console.error("[ErrorBoundary]", error, info);
  }

  reset = () => this.setState({ error: null });

  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-background p-6">
          <div className="max-w-md w-full text-center rounded-2xl bg-surface-elevated border border-border/60 p-8">
            <AlertCircle className="w-10 h-10 text-destructive mx-auto mb-4" />
            <h1 className="font-heading text-2xl mb-2">Something went wrong</h1>
            <p className="text-sm text-muted-foreground mb-6 break-words">
              {this.state.error.message || "An unexpected error occurred."}
            </p>
            <div className="flex items-center justify-center gap-3">
              <Button variant="hero" className="rounded-xl gap-2" onClick={() => { this.reset(); window.location.reload(); }}>
                <RefreshCw className="w-4 h-4" /> Retry
              </Button>
              <Button variant="hero-outline" className="rounded-xl" onClick={() => { this.reset(); window.location.href = "/"; }}>
                Go home
              </Button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
