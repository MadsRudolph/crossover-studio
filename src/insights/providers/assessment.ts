// Insight provider: assessment. Every verdict criterion (assess() in src/engine/assess.ts) becomes one
// insight, pointed at the view that explains it best, and the verdict's tested suggestions (suggest())
// are attached as fixes to the criteria they improve. Both are cached per Results object: assess takes
// about 1 ms, suggest about 30 ms, so a committed change costs one run and every later call is free.
import { assess, suggest, type Assessment, type Criterion, type Suggestion } from "../../engine";
import type { Results } from "../../types";
import type { ViewId } from "../../state/store";
import type { Insight, InsightContext, InsightProvider } from "../types";

/** Criterion id -> the view that shows it best, and the views that should also hint at it. */
const VIEW_OF: Record<string, { view: ViewId; alsoIn?: ViewId[] }> = {
  flat: { view: "response", alsoIn: ["system"] },
  balance: { view: "response", alsoIn: ["filters"] },
  bass: { view: "box", alsoIn: ["response"] },
  blend_wm: { view: "phase", alsoIn: ["response"] },
  blend_mt: { view: "phase", alsoIn: ["response"] },
  canc: { view: "response", alsoIn: ["phase"] },
  xover: { view: "response", alsoIn: ["filters"] },
  off: { view: "directivity", alsoIn: ["response"] },
  twfs: { view: "filters", alsoIn: ["response"] },
  load: { view: "impedance", alsoIn: ["system"] },
  vent: { view: "box" },
  resistors: { view: "verdict", alsoIn: ["filters"] },
  stock: { view: "verdict", alsoIn: ["filters", "system"] },
  parts: { view: "verdict" },
};

const cache = new WeakMap<Results, { a: Assessment; sugg: Suggestion[] }>();

/** The verdict of a design and its tested suggestions, once per Results. */
export function assessmentOf(ctx: InsightContext): { a: Assessment; sugg: Suggestion[] } {
  let hit = cache.get(ctx.results);
  if (!hit) {
    const a = assess(ctx.prep, ctx.design, ctx.results);
    let sugg: Suggestion[] = [];
    // suggestions only matter when something is below target
    if (a.issues.length) { try { sugg = suggest(ctx.prep, ctx.design, a, 8); } catch { sugg = []; } }
    hit = { a, sugg };
    cache.set(ctx.results, hit);
  }
  return hit;
}

/** The tested change that helps this criterion most (it must raise the overall score too). */
function fixFor(c: Criterion, sugg: Suggestion[]): Insight["fix"] {
  let best: { s: Suggestion; d: number } | null = null;
  for (const s of sugg) {
    const e = s.effects.find(x => x.id === c.id);
    if (e && e.delta > 0 && (!best || e.delta > best.d || (e.delta === best.d && s.gain > best.s.gain))) best = { s, d: e.delta };
  }
  return best ? { label: `${best.s.label} (score +${best.s.gain})`, design: best.s.design } : undefined;
}

export const assessmentInsights: InsightProvider = (ctx) => {
  const { a, sugg } = assessmentOf(ctx);
  // how many points each criterion costs, so the worst one leads within its severity
  const lost = (c: Criterion) => c.weight * (1 - c.score);
  const maxLost = Math.max(1e-9, ...a.criteria.map(lost));
  return a.criteria.filter(c => c.weight > 0 || c.state !== "good").map((c): Insight => {
    const where = VIEW_OF[c.id] ?? { view: "verdict" as ViewId };
    const good = c.state === "good";
    return {
      id: `assess.${c.id}`,
      severity: c.state,
      title: good ? `${c.title}: ${c.summary.charAt(0).toLowerCase()}${c.summary.slice(1)}` : c.summary,
      detail: good || !c.fix ? c.finding : `${c.finding} ${c.fix}`,
      view: where.view,
      alsoIn: where.alsoIn,
      at: c.at,
      band: c.band,
      focus: c.focus,
      fix: good ? undefined : fixFor(c, sugg),
      weight: good ? Math.min(1, c.weight / 3) : lost(c) / maxLost,
    };
  });
};
