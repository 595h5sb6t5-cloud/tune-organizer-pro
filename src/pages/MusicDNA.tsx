import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Sparkles, ArrowRight, ArrowLeft, Library, Brain, Flame, Snowflake,
  Music2, Globe2, Users, Eye, Wand2, Plus, Pencil, SkipForward, Loader2,
} from "lucide-react";
import AppLayout from "@/components/app/AppLayout";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { useMusicDna, type PlaylistConcept } from "@/hooks/use-music-dna";
import { useSpotifyLibrary } from "@/hooks/use-spotify-library";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

type Step = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
const STEPS: { key: Step; label: string }[] = [
  { key: 0, label: "Welcome" },
  { key: 1, label: "Library Scan" },
  { key: 2, label: "Music DNA" },
  { key: 3, label: "Genres" },
  { key: 4, label: "Moods" },
  { key: 5, label: "Energy" },
  { key: 6, label: "Language" },
  { key: 7, label: "Top Artists" },
  { key: 8, label: "Hidden Patterns" },
  { key: 9, label: "Playlists" },
];

const MusicDNA = () => {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const spotifyConnected = profile?.spotify_connected ?? false;
  const dna = useMusicDna();
  const { likedCount, syncing } = useSpotifyLibrary();
  const [step, setStep] = useState<Step>(0);

  // Not connected gate
  if (!spotifyConnected) {
    return (
      <AppLayout>
        <EmptyState
          icon={<Brain className="w-7 h-7 text-accent" />}
          title="Connect Spotify to discover your Music DNA"
          desc="We need your real library to build a meaningful sonic profile. No mock data, no shortcuts."
          cta={<Button variant="hero" asChild><Link to="/settings"><Sparkles className="w-4 h-4 mr-2" />Connect Spotify</Link></Button>}
        />
      </AppLayout>
    );
  }

  if (likedCount === 0 && !syncing) {
    return (
      <AppLayout>
        <EmptyState
          icon={<Library className="w-7 h-7 text-accent" />}
          title="No songs to analyze yet"
          desc="Sync your Spotify library so we can read your real listening signals."
          cta={<Button variant="hero" onClick={() => navigate("/dashboard")}><Sparkles className="w-4 h-4 mr-2" />Go to Sync</Button>}
        />
      </AppLayout>
    );
  }

  if (dna.loading) {
    return (
      <AppLayout>
        <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3">
          <Loader2 className="w-8 h-8 animate-spin text-accent" />
          <p className="text-sm text-muted-foreground">Reading your Music DNA…</p>
        </div>
      </AppLayout>
    );
  }

  const next = () => setStep(s => (Math.min(9, s + 1) as Step));
  const prev = () => setStep(s => (Math.max(0, s - 1) as Step));

  return (
    <AppLayout>
      <div className="max-w-5xl mx-auto">
        {/* Progress bar */}
        <div className="mb-8 flex items-center gap-2">
          {STEPS.map(s => (
            <button
              key={s.key}
              onClick={() => setStep(s.key)}
              className={cn(
                "h-1.5 flex-1 rounded-full transition-all",
                s.key <= step ? "bg-accent" : "bg-border/50"
              )}
              aria-label={s.label}
            />
          ))}
        </div>

        <div className="min-h-[60vh]">
          {step === 0 && <Welcome onNext={next} />}
          {step === 1 && <ScanSummary dna={dna} />}
          {step === 2 && <YourDna dna={dna} />}
          {step === 3 && <GenresStep dna={dna} />}
          {step === 4 && <MoodsStep dna={dna} />}
          {step === 5 && <EnergyStep dna={dna} />}
          {step === 6 && <LanguageStep dna={dna} />}
          {step === 7 && <ArtistsStep dna={dna} />}
          {step === 8 && <PatternsStep dna={dna} />}
          {step === 9 && <SuggestionsStep dna={dna} />}
        </div>

        {/* Nav */}
        <div className="mt-10 flex items-center justify-between">
          <Button variant="ghost" onClick={prev} disabled={step === 0}>
            <ArrowLeft className="w-4 h-4 mr-2" /> Back
          </Button>
          <span className="text-xs text-muted-foreground">{STEPS[step].label} · {step + 1}/{STEPS.length}</span>
          {step < 9 ? (
            <Button variant="hero" onClick={next}>
              Continue <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
          ) : (
            <Button variant="hero" onClick={() => navigate("/ai-playlists")}>
              Done <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
          )}
        </div>
      </div>
    </AppLayout>
  );
};

/* ---------- Sub-components ---------- */

function EmptyState({ icon, title, desc, cta }: { icon: React.ReactNode; title: string; desc: string; cta: React.ReactNode }) {
  return (
    <div className="max-w-2xl mx-auto rounded-3xl bg-gradient-to-br from-accent/15 via-primary/10 to-background border border-border/50 p-12 text-center">
      <div className="w-14 h-14 rounded-2xl bg-accent/20 flex items-center justify-center mx-auto mb-5">{icon}</div>
      <h2 className="font-heading text-2xl mb-2">{title}</h2>
      <p className="text-sm text-muted-foreground max-w-md mx-auto mb-6">{desc}</p>
      {cta}
    </div>
  );
}

function StepShell({ eyebrow, title, subtitle, children }: { eyebrow?: string; title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div>
        {eyebrow && <p className="text-xs uppercase tracking-[0.2em] text-accent mb-3">{eyebrow}</p>}
        <h1 className="font-heading text-4xl md:text-5xl mb-3 leading-tight">{title}</h1>
        {subtitle && <p className="text-muted-foreground text-lg max-w-2xl">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}

function Welcome({ onNext }: { onNext: () => void }) {
  return (
    <div className="rounded-3xl bg-gradient-to-br from-accent/20 via-primary/10 to-background border border-border/50 p-12 md:p-16 text-center">
      <div className="w-16 h-16 rounded-2xl bg-accent/20 flex items-center justify-center mx-auto mb-6">
        <Sparkles className="w-8 h-8 text-accent" />
      </div>
      <h1 className="font-heading text-4xl md:text-5xl mb-5 leading-tight">Tu música dice más de ti<br />de lo que crees.</h1>
      <p className="text-muted-foreground text-lg max-w-xl mx-auto mb-8">
        Vamos a analizar tu biblioteca y convertirla en playlists que realmente tengan sentido.
      </p>
      <Button variant="hero" size="lg" onClick={onNext}>
        Empezar <ArrowRight className="w-4 h-4 ml-2" />
      </Button>
    </div>
  );
}

function ScanSummary({ dna }: { dna: ReturnType<typeof useMusicDna> }) {
  const items = [
    { label: "Canciones likeadas", value: dna.totals.liked, icon: Music2 },
    { label: "Playlists", value: dna.totals.playlists, icon: Library },
    { label: "Artistas seguidos", value: dna.totals.artists, icon: Users },
    { label: "Álbumes guardados", value: dna.totals.albums, icon: Library },
    { label: "Listas para analizar", value: dna.totals.analyzed || dna.totals.liked, icon: Brain },
  ];
  return (
    <StepShell eyebrow="Library Scan" title="Esto es lo que encontramos en tu biblioteca." subtitle="Datos reales importados directamente desde tu cuenta de Spotify.">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        {items.map(({ label, value, icon: Icon }) => (
          <div key={label} className="rounded-2xl border border-border/50 bg-card/50 p-5">
            <Icon className="w-5 h-5 text-accent mb-3" />
            <p className="text-3xl font-heading">{value.toLocaleString()}</p>
            <p className="text-xs text-muted-foreground mt-1">{label}</p>
          </div>
        ))}
      </div>
    </StepShell>
  );
}

function YourDna({ dna }: { dna: ReturnType<typeof useMusicDna> }) {
  const dominantMood = dna.topMoods[0]?.name ?? "—";
  const hasAudio = dna.totals.analyzed > 0;
  return (
    <StepShell eyebrow="Your Music DNA" title="Tu perfil sonoro." subtitle={hasAudio ? "Construido a partir de las características de audio de tus canciones." : "El análisis profundo está en proceso. Por ahora usamos los metadatos reales de Spotify."}>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <DnaCard title="Energía" value={`${Math.round(dna.avgEnergy * 100)}%`} hint={dna.avgEnergy > 0.6 ? "Alta" : dna.avgEnergy > 0.4 ? "Media" : "Baja"} />
        <DnaCard title="Mood dominante" value={dominantMood} hint={dna.topMoods[1]?.name ? `también ${dna.topMoods[1].name}` : ""} />
        <DnaCard title="Positividad" value={`${Math.round(dna.avgValence * 100)}%`} hint={dna.avgValence > 0.55 ? "Luminoso" : "Introspectivo"} />
        <DnaCard title="Géneros principales" value={dna.topGenres.slice(0, 3).map(g => g.name).join(" · ") || "—"} />
        <DnaCard title="Vibes principales" value={dna.topVibes.slice(0, 3).map(v => v.name).join(" · ") || "Aún sin análisis IA"} />
        <DnaCard title="Contextos" value={dna.contexts.slice(0, 3).map(c => c.name).join(" · ") || "—"} />
      </div>

      <div className="rounded-2xl border border-border/50 bg-card/50 p-6">
        <p className="text-xs uppercase tracking-wider text-muted-foreground mb-4">Calmado vs Enérgico</p>
        <div className="flex h-3 rounded-full overflow-hidden">
          <div className="bg-blue-400/70" style={{ width: `${dna.calmVsEnergetic.calm}%` }} />
          <div className="bg-orange-500/80" style={{ width: `${dna.calmVsEnergetic.energetic}%` }} />
        </div>
        <div className="flex justify-between mt-2 text-xs text-muted-foreground">
          <span><Snowflake className="w-3 h-3 inline mr-1" />Calmado · {dna.calmVsEnergetic.calm}%</span>
          <span>Enérgico · {dna.calmVsEnergetic.energetic}% <Flame className="w-3 h-3 inline ml-1" /></span>
        </div>
      </div>
    </StepShell>
  );
}

function DnaCard({ title, value, hint }: { title: string; value: string; hint?: string }) {
  return (
    <div className="rounded-2xl border border-border/50 bg-card/50 p-5">
      <p className="text-xs uppercase tracking-wider text-muted-foreground mb-2">{title}</p>
      <p className="font-heading text-xl leading-tight">{value}</p>
      {hint && <p className="text-xs text-muted-foreground mt-1">{hint}</p>}
    </div>
  );
}

function BarList({ items, empty }: { items: { name: string; pct?: number; count: number }[]; empty: string }) {
  if (items.length === 0) return <p className="text-sm text-muted-foreground">{empty}</p>;
  const max = Math.max(...items.map(i => i.count));
  return (
    <div className="space-y-3">
      {items.map(i => (
        <div key={i.name}>
          <div className="flex justify-between text-sm mb-1">
            <span className="capitalize">{i.name}</span>
            <span className="text-muted-foreground text-xs">{i.pct != null ? `${i.pct}%` : i.count}</span>
          </div>
          <div className="h-2 rounded-full bg-border/40 overflow-hidden">
            <div className="h-full bg-gradient-to-r from-accent to-primary" style={{ width: `${(i.count / max) * 100}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function GenresStep({ dna }: { dna: ReturnType<typeof useMusicDna> }) {
  return (
    <StepShell eyebrow="Main Genres" title="Los géneros que sostienen tu sonido." subtitle="Inferido de tus canciones likeadas y artistas seguidos.">
      <BarList items={dna.topGenres} empty="No hay suficiente información de géneros todavía." />
    </StepShell>
  );
}

function MoodsStep({ dna }: { dna: ReturnType<typeof useMusicDna> }) {
  return (
    <StepShell eyebrow="Main Moods" title="Los estados emocionales que más buscas.">
      <BarList items={dna.topMoods} empty="Aún no tenemos suficientes señales de mood. El análisis IA está en proceso." />
    </StepShell>
  );
}

function EnergyStep({ dna }: { dna: ReturnType<typeof useMusicDna> }) {
  const e = Math.round(dna.avgEnergy * 100);
  return (
    <StepShell eyebrow="Energy Profile" title="¿Cómo se siente tu energía musical?">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <DnaCard title="Energía promedio" value={`${e}%`} hint={e > 60 ? "Inclinado a lo intenso" : e > 40 ? "Balanceado" : "Inclinado a lo tranquilo"} />
        <DnaCard title="Tempo promedio" value={dna.avgTempo ? `${Math.round(dna.avgTempo)} BPM` : "—"} />
        <DnaCard title="Positividad" value={`${Math.round(dna.avgValence * 100)}%`} />
      </div>
      <div className="rounded-2xl border border-border/50 bg-card/50 p-6">
        <p className="text-xs uppercase tracking-wider text-muted-foreground mb-4">Distribución</p>
        <div className="flex h-3 rounded-full overflow-hidden">
          <div className="bg-blue-400/70" style={{ width: `${dna.calmVsEnergetic.calm}%` }} />
          <div className="bg-orange-500/80" style={{ width: `${dna.calmVsEnergetic.energetic}%` }} />
        </div>
        <div className="flex justify-between mt-2 text-xs text-muted-foreground">
          <span>Calmado {dna.calmVsEnergetic.calm}%</span>
          <span>Enérgico {dna.calmVsEnergetic.energetic}%</span>
        </div>
      </div>
    </StepShell>
  );
}

function LanguageStep({ dna }: { dna: ReturnType<typeof useMusicDna> }) {
  return (
    <StepShell eyebrow="Language Mix" title="Los idiomas en tu rotación." subtitle="El idioma es solo un dato de contexto. Nunca agrupamos playlists por idioma.">
      {dna.languageMix.length > 0 ? (
        <BarList items={dna.languageMix} empty="" />
      ) : (
        <div className="rounded-2xl border border-border/50 bg-card/50 p-8 flex items-start gap-4">
          <Globe2 className="w-6 h-6 text-accent shrink-0 mt-1" />
          <div>
            <p className="font-medium mb-1">Análisis de idioma en proceso</p>
            <p className="text-sm text-muted-foreground">Cuando el análisis IA termine de procesar tus canciones, verás aquí la mezcla de idiomas detectada.</p>
          </div>
        </div>
      )}
    </StepShell>
  );
}

function ArtistsStep({ dna }: { dna: ReturnType<typeof useMusicDna> }) {
  return (
    <StepShell eyebrow="Top Artists" title="Los artistas que construyen tu identidad sonora.">
      {dna.topArtists.length === 0 ? (
        <p className="text-sm text-muted-foreground">No tienes artistas seguidos todavía.</p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
          {dna.topArtists.map(a => (
            <div key={a.name} className="rounded-2xl border border-border/50 bg-card/50 p-4 text-center">
              <div className="aspect-square rounded-full overflow-hidden bg-muted mb-3 mx-auto w-24">
                {a.image_url ? <img src={a.image_url} alt={a.name} className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center"><Users className="w-6 h-6 text-muted-foreground" /></div>}
              </div>
              <p className="font-medium text-sm truncate">{a.name}</p>
              {a.genres[0] && <p className="text-xs text-muted-foreground capitalize truncate mt-0.5">{a.genres[0]}</p>}
            </div>
          ))}
        </div>
      )}
    </StepShell>
  );
}

function PatternsStep({ dna }: { dna: ReturnType<typeof useMusicDna> }) {
  return (
    <StepShell eyebrow="Hidden Patterns" title="Lo que tu biblioteca revela sobre ti.">
      {dna.patterns.length === 0 ? (
        <div className="rounded-2xl border border-border/50 bg-card/50 p-8 flex items-start gap-4">
          <Eye className="w-6 h-6 text-accent shrink-0 mt-1" />
          <div>
            <p className="font-medium mb-1">Aún sin patrones claros</p>
            <p className="text-sm text-muted-foreground">A medida que analicemos más canciones, aparecerán insights sobre tus hábitos.</p>
          </div>
        </div>
      ) : (
        <ul className="space-y-3">
          {dna.patterns.map(p => (
            <li key={p} className="rounded-2xl border border-border/50 bg-card/50 p-4 flex gap-3 items-start">
              <Sparkles className="w-4 h-4 text-accent shrink-0 mt-1" />
              <span className="text-sm">{p}</span>
            </li>
          ))}
        </ul>
      )}
    </StepShell>
  );
}

function SuggestionsStep({ dna }: { dna: ReturnType<typeof useMusicDna> }) {
  const navigate = useNavigate();
  return (
    <StepShell eyebrow="Suggested AI Playlists" title="Playlists pensadas a partir de tu DNA." subtitle="Conceptos basados en tus patrones reales. Edita o crea cuando quieras.">
      {dna.suggestions.length === 0 ? (
        <div className="rounded-2xl border border-border/50 bg-card/50 p-8 flex items-start gap-4">
          <Wand2 className="w-6 h-6 text-accent shrink-0 mt-1" />
          <div>
            <p className="font-medium mb-1">El análisis profundo está en proceso</p>
            <p className="text-sm text-muted-foreground">Necesitamos más señales de audio para sugerir playlists con precisión. Vuelve en unos minutos.</p>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {dna.suggestions.map(c => <ConceptCard key={c.id} concept={c} />)}
        </div>
      )}

      <div className="flex flex-wrap gap-3 pt-2">
        <Button variant="ghost" onClick={() => navigate("/dashboard")}>
          <SkipForward className="w-4 h-4 mr-2" /> Saltar por ahora
        </Button>
        <Button variant="hero" onClick={() => navigate("/ai-playlists")}>
          <Plus className="w-4 h-4 mr-2" /> Ir a AI Playlists
        </Button>
      </div>
    </StepShell>
  );
}

function ConceptCard({ concept }: { concept: PlaylistConcept }) {
  const navigate = useNavigate();
  const create = () => {
    toast.success(`"${concept.name}" listo para construirse`, { description: "Llévalo al editor en AI Playlists." });
    navigate("/ai-playlists");
  };
  return (
    <div className="rounded-2xl border border-border/50 bg-card/50 p-6 flex flex-col justify-between gap-4 hover:border-accent/50 transition-colors">
      <div>
        <p className="text-xs uppercase tracking-wider text-accent mb-2">{concept.tagline}</p>
        <h3 className="font-heading text-xl mb-2">{concept.name}</h3>
        <p className="text-sm text-muted-foreground">{concept.description}</p>
        <p className="text-xs text-muted-foreground mt-3">~{concept.match} canciones de tu biblioteca encajan</p>
      </div>
      <div className="flex gap-2">
        <Button variant="hero" size="sm" onClick={create} className="flex-1">
          <Plus className="w-3.5 h-3.5 mr-1.5" /> Crear
        </Button>
        <Button variant="outline" size="sm" onClick={create}>
          <Pencil className="w-3.5 h-3.5 mr-1.5" /> Editar
        </Button>
      </div>
    </div>
  );
}

export default MusicDNA;
