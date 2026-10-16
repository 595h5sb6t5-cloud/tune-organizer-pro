import { useState } from "react";
import { Loader2, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Slider } from "@/components/ui/slider";
import type { TrackProfile } from "@/lib/playlist/features";
import { applyManualSound, saveManualSound } from "@/lib/playlist/ai";
import { SCENES, FEELINGS, ARCS } from "@/lib/playlist/organize";

const INSTRUMENTS = ["analog-synth-pads", "arpeggiated-synths", "epic-synth-leads", "acid-synth", "sub-bass", "electric-bass", "upright-bass", "808", "four-on-the-floor-kick", "broken-beat-drums", "live-drums", "organic-percussion", "afro-percussion", "marimba-kalimba", "acoustic-guitar", "electric-guitar", "piano", "rhodes-keys", "organ", "saxophone", "trumpet-brass", "strings", "flute-ethnic-winds", "vocal-chops", "lead-vocals", "choir"];
const label = (s: string) => s.replace(/-/g, " ");

function Dial({ name, low, high, value, onChange }: { name: string; low: string; high: string; value: number; onChange: (v: number) => void }) {
  return (
    <div className="space-y-2">
      <div className="flex justify-between text-sm"><span className="font-medium">{name}</span><span className="tabular-nums text-muted-foreground">{value.toFixed(2)}</span></div>
      <Slider value={[value]} min={0} max={1} step={0.05} onValueChange={([v]) => onChange(v)} aria-label={name} />
      <div className="flex justify-between text-xs text-muted-foreground"><span>{low}</span><span>{high}</span></div>
    </div>
  );
}

/** "Edit sound": hand-correct a song's scene, instruments, texture, warmth and scale. */
export default function EditSoundDialog({ track, onSaved, compact }: { track: TrackProfile; onSaved: (t: TrackProfile) => void; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const [scene, setScene] = useState<string>(track.scene ?? "");
  const [inst, setInst] = useState<string[]>(track.instruments);
  const [texture, setTexture] = useState(track.texture ?? 0.5);
  const [warmth, setWarmth] = useState(track.warmth ?? 0.5);
  const [scale, setScale] = useState(track.scale ?? 0.5);
  const [feeling, setFeeling] = useState<string>(track.feeling ?? "");
  const [melodic, setMelodic] = useState(track.melodicFocus ?? 0.5);
  const [arc, setArc] = useState<string>(track.arc ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const toggle = (x: string) => setInst((all) => all.includes(x) ? all.filter((y) => y !== x) : all.length >= 5 ? all : [...all, x]);

  async function save() {
    setBusy(true); setErr(null);
    const m = { scene: scene || null, instruments: inst, texture, warmth, scale, feeling: feeling || null, melodic_focus: melodic, arc: arc || null };
    try {
      await saveManualSound(track, m);
      onSaved(applyManualSound(track, m));
      setOpen(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't save.");
    } finally { setBusy(false); }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => {
      setOpen(o);
      if (o) { setScene(track.scene ?? ""); setInst(track.instruments); setTexture(track.texture ?? 0.5); setWarmth(track.warmth ?? 0.5); setScale(track.scale ?? 0.5); setFeeling(track.feeling ?? ""); setMelodic(track.melodicFocus ?? 0.5); setArc(track.arc ?? ""); }
    }}>
      <DialogTrigger asChild>
        {compact
          ? <button type="button" className="ml-1 text-muted-foreground hover:text-foreground" aria-label={`Edit sound of ${track.name}`}><SlidersHorizontal className="w-3 h-3" /></button>
          : <Button variant="ghost" size="icon" aria-label={`Edit sound of ${track.name}`} title="Edit sound"><SlidersHorizontal className="w-4 h-4" /></Button>}
      </DialogTrigger>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl">Edit sound</DialogTitle>
          <DialogDescription>{track.name} · {track.artists.join(", ")}. Your changes are always used and never replaced by the AI.</DialogDescription>
        </DialogHeader>
        <div className="space-y-5">
          <label className="block space-y-1 text-sm">
            <span className="font-medium">Scene</span>
            <select value={scene} onChange={(e) => setScene(e.target.value)} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
              <option value="">No scene</option>
              {SCENES.map((s) => <option key={s} value={s}>{label(s)}</option>)}
            </select>
          </label>
          <div className="space-y-2">
            <p className="text-sm font-medium">Instruments <span className="text-muted-foreground font-normal">({inst.length}/5)</span></p>
            <div className="flex flex-wrap gap-1.5">
              {INSTRUMENTS.map((x) => (
                <button key={x} type="button" onClick={() => toggle(x)} aria-pressed={inst.includes(x)}
                  className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${inst.includes(x) ? "border-primary bg-primary text-primary-foreground" : "border-border bg-muted/40 text-muted-foreground hover:text-foreground"}`}>
                  {label(x)}
                </button>
              ))}
            </div>
          </div>
          <Dial name="Texture" low="Organic" high="Synthetic" value={texture} onChange={setTexture} />
          <Dial name="Warmth" low="Cold / dark" high="Warm / sunny" value={warmth} onChange={setWarmth} />
          <label className="block space-y-1 text-sm">
            <span className="font-medium">Feeling</span>
            <select value={feeling} onChange={(e) => setFeeling(e.target.value)} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
              <option value="">Not set</option>
              {FEELINGS.map((s) => <option key={s} value={s}>{label(s)}</option>)}
            </select>
          </label>
          <Dial name="Melodic focus" low="Rhythm / groove" high="Melody / emotion" value={melodic} onChange={setMelodic} />
          <label className="block space-y-1 text-sm">
            <span className="font-medium">Arc</span>
            <select value={arc} onChange={(e) => setArc(e.target.value)} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
              <option value="">Not set</option>
              {ARCS.map((s) => <option key={s} value={s}>{label(s)}</option>)}
            </select>
          </label>
          <Dial name="Scale" low="Intimate" high="Epic" value={scale} onChange={setScale} />
          {err && <p role="alert" className="text-sm text-destructive">{err}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={save} disabled={busy}>{busy && <Loader2 className="w-4 h-4 mr-1 animate-spin" />} Save sound</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
