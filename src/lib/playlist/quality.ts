// Shared final ear gate for both organizers, not a second playlist engine.
import { supabase } from "@/integrations/supabase/client";
import type { TrackProfile } from "./features";
import { averageFit, compatibility, sequence } from "./organize";
import { uniqueSongs } from "./identity";
import { withinBudget } from "./priority";

export interface Removal { id: string; name: string; artists: string[]; reason: string; kind: "intruder" | "anchors" | "transition"; pass: number }
export interface QualityReport { runId: string; removed: Removal[]; unheard: string[]; errors: string[]; reasons: Record<string, string>; checked: number; passes: number }

export function pickAnchors(tracks: TrackProfile[]): TrackProfile[] {
  const scored = tracks.map((t) => ({ t, fit: averageFit(t, tracks.filter((x) => x.id !== t.id)) })).sort((a, b) => b.fit - a.fit);
  const first = scored[0]?.t;
  if (!first) return [];
  const anchors = [first];
  while (anchors.length < Math.min(3, tracks.length)) {
    const next = scored.filter(({ t }) => !anchors.some((a) => a.id === t.id))
      .sort((a, b) => Math.max(...anchors.map((x) => compatibility(a.t, x))) - Math.max(...anchors.map((x) => compatibility(b.t, x))))[0]?.t;
    if (!next) break;
    anchors.push(next);
  }
  return anchors;
}

/** Twenty consecutive songs with one-song boundary overlap, including the final tail. */
export function overlappingGroups<T>(tracks: T[]): T[][] {
  const out: T[][] = [];
  for (let from = 0; from < tracks.length; from += 19) {
    out.push(tracks.slice(from, from + 20));
    if (from + 20 >= tracks.length) break;
  }
  return out;
}

/** A self-reference never substitutes for hearing two other distinct anchors. */
export function anchorVerdict(scores: Record<string, number>, anchors: string[], songId: string): "accepted" | "rejected" | "unheard" {
  const other = anchors.filter((id) => id !== songId);
  if (other.length < 2) return "unheard";
  const values = other.map((id) => scores[id]).filter(Number.isFinite);
  if (values.filter((n) => n >= 8).length >= 2) return "accepted";
  return values.length === other.length ? "rejected" : "unheard";
}

export async function checkFinalPlaylist(tracks: TrackProfile[], context: string, opts: { deadline?: number; startId?: string; runId?: string } = {}) {
  const report: QualityReport = { runId: opts.runId ?? crypto.randomUUID(), removed: [], unheard: [], errors: [], reasons: {}, checked: 0, passes: 0 };
  let current = uniqueSongs(tracks);
  const rejected: TrackProfile[] = [], pending: TrackProfile[] = [];
  const order = () => {
    const ordered = sequence(current, opts.startId);
    const keptIds = new Set(ordered.map((t) => t.id));
    for (const t of current) if (!keptIds.has(t.id)) {
      rejected.push(t); report.removed.push({ id: t.id, name: t.name, artists: t.artists, reason: "No existe una transición suave de instrumentos, producción, percusión y sentimiento.", kind: "transition", pass: report.passes });
    }
    current = ordered;
  };
  order();
  // Initial complete-listen audit; repeat exactly once if removal changes the list.
  for (let pass = 1; pass <= 2 && current.length; pass++) {
    const anchors = pickAnchors(current).map((t) => t.id);
    if (anchors.length < 3) {
      pending.push(...current); report.unheard.push(...current.map((t) => t.id)); current = []; break;
    }
    report.passes = pass;
    const snapshots = current;
    const responses = await Promise.all(overlappingGroups(snapshots).map(async (group) => {
      const call = () => supabase.functions.invoke("vibe-listen", { body: {
        mode: "playlist", ids: group.map((t) => t.id), anchor_ids: anchors, context,
        ordered_ids: snapshots.map((t) => t.id), run_id: report.runId,
      } });
      const invoke = () => opts.deadline ? withinBudget(call(), opts.deadline, { data: null, error: new Error("Tiempo de escucha agotado") }) : call();
      let response = await invoke();
      if ((response.error || response.data?.error) && (!opts.deadline || performance.now() < opts.deadline)) response = await invoke();
      return { group, ...response };
    }));
    const drop = new Map<string, { kind: "intruder" | "anchors"; reason: string }>();
    const unheard = new Set<string>();
    for (const { group, data, error } of responses) {
      if (error || data?.error || !data?.complete) {
        report.errors.push(error?.message ?? data?.error ?? "Escucha incompleta");
        group.forEach((t) => unheard.add(t.id)); continue;
      }
      report.checked += group.length;
      for (const id of data.unheard ?? []) unheard.add(id);
      const seen = new Set<string>();
      for (const row of data.results ?? []) {
        if (!group.some((t) => t.id === row.id)) continue;
        seen.add(row.id);
        const verdict = anchorVerdict(row.anchor_scores ?? {}, anchors, row.id);
        if (verdict === "unheard") unheard.add(row.id);
        if (verdict === "rejected") drop.set(row.id, { kind: "anchors", reason: row.why ?? "No alcanzó 8 contra dos de las tres anclas." });
        if (typeof row.why === "string") report.reasons[row.id] = row.why;
      }
      group.forEach((t) => { if (!seen.has(t.id)) unheard.add(t.id); });
      for (const row of data.intruders ?? []) if (group.some((t) => t.id === row.id) && typeof row.reason === "string") drop.set(row.id, { kind: "intruder", reason: row.reason });
    }
    // Missing audio/failed requests are unresolved, not ear rejections.
    for (const id of unheard) drop.delete(id);
    for (const t of snapshots) {
      const removal = drop.get(t.id);
      if (removal) { rejected.push(t); report.removed.push({ id: t.id, name: t.name, artists: t.artists, ...removal, pass }); }
      else if (unheard.has(t.id)) { pending.push(t); report.unheard.push(t.id); }
    }
    current = snapshots.filter((t) => !drop.has(t.id) && !unheard.has(t.id));
    if (!drop.size && !unheard.size) break;
    order();
  }
  return { tracks: current, rejected: uniqueSongs(rejected), pending: uniqueSongs(pending), report };
}