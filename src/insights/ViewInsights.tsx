// Hint strip a view shows under its header: one slim row with the most important insight that points at
// this view ("probe it", "apply the tested fix", "show the control"), and "+N more" that unfolds the
// others in place (remembered for the session). Plots are the hero, so the strip never takes more than
// one row unless asked. Dismissed hints stay hidden for the session until their finding changes.
//
// Also the shared insight actions the Guide uses (apply a fix with an undo toast, show an insight in
// its view), and useSettledInsights(): the insights of the design once it has settled, so a live
// slider drag never pays for the providers (the verdict's suggestions take about 30 ms).

import { useEffect, useState, type ReactNode } from "react";
import { ArrowUpRight, Crosshair, Wand2, X } from "lucide-react";
import { create } from "zustand";
import { useStore, type ViewId } from "../state/store";
import type { Results } from "../types";
import { Button, fmtFreq, toast } from "../ui";
import { focusControl } from "../ui/shell/commands";
import { VIEWS } from "../views";
import { collectInsights, type Insight } from "./index";
import { onInsightsInvalidated, useInsightsVersion } from "./invalidate";
import "./insights.css";

// ---------------------------------------------------------------- settled insights
let cache = new WeakMap<Results, Insight[]>();
const SETTLE_MS = 150;

// Inputs outside the design (data-sheet values, listening-test ratings) drop the cache, so the hints
// follow them without a design change.
onInsightsInvalidated(() => { cache = new WeakMap(); });

function insightsFor(): { results: Results; list: Insight[] } | null {
  const { profile, fit, prep, design, results } = useStore.getState();
  if (!profile || !fit || !prep || !results) return null;
  let list = cache.get(results);
  if (!list) { list = collectInsights({ profile, fit, prep, design, results }); cache.set(results, list); }
  return { results, list };
}

/** The current design's insights, most important first. During a live gesture (a drag, an optimiser
 *  or autopilot preview) and for a moment after each change it keeps showing the previous list. */
export function useSettledInsights(): Insight[] {
  const results = useStore(s => s.results);
  const live = useStore(s => s.gestureBase !== null);
  const v = useInsightsVersion();
  const [state, setState] = useState<{ results: Results | null; list: Insight[]; v?: number }>(() => {
    if (useStore.getState().gestureBase) return { results: null, list: [] };
    return insightsFor() ?? { results: null, list: [] };
  });
  useEffect(() => {
    if (!results) { setState({ results: null, list: [] }); return; }
    if (live || (state.results === results && state.v === v)) return;
    const ready = cache.get(results);
    if (ready) { setState({ results, list: ready, v }); return; }
    const t = window.setTimeout(() => {
      try { const r = insightsFor(); if (r) setState({ ...r, v }); } catch { /* keep the previous list */ }
    }, SETTLE_MS);
    return () => window.clearTimeout(t);
  }, [results, live, v]); // eslint-disable-line react-hooks/exhaustive-deps
  return state.list;
}

// ---------------------------------------------------------------- actions
export const viewTitle = (id: ViewId) => VIEWS.find(v => v.id === id)?.title ?? id;

/** The frequency "Show me" probes: the insight's own, else the middle of its band (log scale). */
export function insightProbe(ins: Insight): number | undefined {
  if (ins.at) return ins.at;
  if (ins.band) return Math.sqrt(Math.max(20, ins.band[0]) * Math.min(20000, ins.band[1]));
  return undefined;
}

/** Apply an insight's tested fix as one undo step, with an Undo toast. */
export function applyInsightFix(ins: Insight) {
  if (!ins.fix) return;
  const s = useStore.getState();
  s.setDesign(structuredClone(ins.fix.design));
  toast({ id: "insight-fix", tone: "good", title: ins.fix.label, description: "Applied. The checks and plots now show the change.",
          action: { label: "Undo", onClick: () => useStore.getState().undo() } });
}

/** Open the view that explains an insight, probe its frequency and point the inspector at its control. */
export function showInsight(ins: Insight, view: ViewId = ins.view) {
  const s = useStore.getState();
  if (s.view !== view) s.setView(view);
  const f = insightProbe(ins);
  if (f) s.setProbe(f);
  if (ins.focus) focusControl(ins.focus);
}

// ---------------------------------------------------------------- dismissals and unfolding (per session)
const keyOf = (ins: Insight) => `${ins.id}|${ins.severity}|${ins.title}`;
const useDismissed = create<{ ids: Set<string>; dismiss(k: string): void; unfolded: boolean; setUnfolded(v: boolean): void }>(set => ({
  ids: new Set(),
  dismiss: k => set(s => ({ ids: new Set(s.ids).add(k) })),
  unfolded: false,
  setUnfolded: unfolded => set({ unfolded }),
}));

// ---------------------------------------------------------------- the strip
/** Unfolded, the strip lists at most this many; the rest are in the Guide. */
const MAX_UNFOLDED = 4;

export function ViewInsights({ view }: { view: ViewId }) {
  const all = useSettledInsights();
  const dismissed = useDismissed(s => s.ids);
  const dismiss = useDismissed(s => s.dismiss);
  const unfolded = useDismissed(s => s.unfolded);
  const setUnfolded = useDismissed(s => s.setUnfolded);
  const setView = useStore(s => s.setView);
  // the Verdict lists every criterion itself: only other features' hints go above it
  const here = all.filter(i => i.severity !== "good" && (i.view === view || i.alsoIn?.includes(view)) && !dismissed.has(keyOf(i))
                              && !(view === "verdict" && i.id.startsWith("assess.")));
  if (!here.length) return null;
  const shown = unfolded ? here.slice(0, MAX_UNFOLDED) : here.slice(0, 1);
  const hidden = here.length - 1;
  const toggle = hidden > 0 && (
    <button type="button" className="ins-more" aria-expanded={unfolded} onClick={() => setUnfolded(!unfolded)}
            title={unfolded ? "Show only the most important hint" : "Show the other hints for this view"}>
      {unfolded ? "Fewer" : `+${hidden} more`}
    </button>
  );
  return (
    <div className={"ins-strip" + (unfolded ? " is-unfolded" : "")} role="region" aria-label="Hints for this view">
      {shown.map((ins, i) => (
        <HintRow key={ins.id} ins={ins} view={view} onDismiss={() => dismiss(keyOf(ins))} extra={i === 0 ? toggle : undefined} />
      ))}
      {unfolded && here.length > MAX_UNFOLDED && (
        <button type="button" className="ins-guide" onClick={() => setView("guide")}>
          {here.length - MAX_UNFOLDED} more in the Guide
        </button>
      )}
    </div>
  );
}

function HintRow({ ins, view, onDismiss, extra }: { ins: Insight; view: ViewId; onDismiss(): void; extra?: ReactNode }) {
  const f = insightProbe(ins);
  const setProbe = useStore(s => s.setProbe);
  return (
    <div className={`ins-hint is-${ins.severity}`}>
      <span className="ins-dot" aria-hidden />
      <span className="ins-hint-text" title={ins.detail}>
        <span className="ins-hint-title">{ins.title}</span>
        <span className="ins-hint-detail">{ins.detail}</span>
      </span>
      {extra}
      <span className="ins-hint-actions">
        {f && <Button size="sm" variant="ghost" icon={Crosshair} onClick={() => setProbe(f)} title={`Move the probe to ${fmtFreq(f)}`}>{fmtFreq(f)}</Button>}
        {ins.fix && <Button size="sm" variant="subtle" icon={Wand2} onClick={() => applyInsightFix(ins)} title={ins.fix.label}>Apply fix</Button>}
        {ins.focus && <Button size="sm" variant="ghost" icon={ArrowUpRight} onClick={() => focusControl(ins.focus!)} title="Show the control in the inspector">Control</Button>}
        {ins.view !== view && <Button size="sm" variant="ghost" onClick={() => showInsight(ins)} title={`Open the ${viewTitle(ins.view)} view, which explains this`}>{viewTitle(ins.view)}</Button>}
        <Button size="sm" variant="ghost" icon={X} aria-label="Dismiss this hint" onClick={onDismiss} />
      </span>
    </div>
  );
}
