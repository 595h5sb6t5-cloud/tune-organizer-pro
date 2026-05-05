import { useState } from "react";
import { Sparkles, X, Check, Zap } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "sonner";

interface PaywallDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  reason?: string;
  onUpgraded?: () => void;
}

const FEATURES = [
  "Análisis ilimitado de canciones (incluye bibliotecas grandes)",
  "Playlists generadas ilimitadas",
  "Recomendaciones ilimitadas",
  "Exportación ilimitada a Spotify",
  "Sincronización completa y reanálisis total",
  "Mejor calidad de análisis IA",
];

export function PaywallDialog({ open, onOpenChange, reason, onUpgraded }: PaywallDialogProps) {
  const { user } = useAuth();
  const [activating, setActivating] = useState(false);

  // Direct activation path until billing provider is connected.
  // Replaces user's row to Premium with unlimited (-1) limits.
  const activatePremium = async () => {
    if (!user) return;
    setActivating(true);
    try {
      const { error } = await supabase
        .from("user_subscription")
        .update({
          plan: "premium",
          song_analysis_limit: -1,
          playlists_limit: -1,
          recommendations_limit: -1,
          export_limit: -1,
          is_active: true,
        })
        .eq("user_id", user.id);
      if (error) throw error;
      toast.success("Premium activado");
      onUpgraded?.();
      onOpenChange(false);
    } catch (e: any) {
      toast.error("No se pudo activar Premium", { description: e.message });
    } finally {
      setActivating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <div className="w-12 h-12 rounded-2xl bg-accent/15 flex items-center justify-center mb-3">
            <Sparkles className="w-6 h-6 text-accent" />
          </div>
          <DialogTitle className="font-heading text-2xl">Lleva Tempo a Premium</DialogTitle>
          <DialogDescription className="text-sm">
            {reason ?? "Has alcanzado el límite de tu plan Free. Activa Premium para desbloquear todo el potencial de tu biblioteca."}
          </DialogDescription>
        </DialogHeader>

        <ul className="space-y-2 my-2">
          {FEATURES.map((f) => (
            <li key={f} className="flex items-start gap-2 text-sm">
              <Check className="w-4 h-4 text-accent mt-0.5 shrink-0" />
              <span>{f}</span>
            </li>
          ))}
        </ul>

        <div className="rounded-xl bg-muted/40 p-3 text-xs text-muted-foreground">
          Tus datos no se borran. Mantienes todo lo importado y analizado.
        </div>

        <div className="flex flex-col gap-2 mt-2">
          <Button variant="hero" onClick={activatePremium} disabled={activating}>
            <Zap className="w-4 h-4 mr-2" />
            {activating ? "Activando…" : "Activar Premium"}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            <X className="w-4 h-4 mr-1" />Más tarde
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
