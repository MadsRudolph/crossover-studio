// Building blocks every view uses: the header (title, one sentence, tools), a size hook so the canvas
// plots can fill their pane, the read-outs and chips, and the plot decorations that mean the same
// thing in every view (probe, crossover markers, the ±2 dB band, snapshot overlays).

import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import type { PlotBand, PlotSeries, PlotVLine } from "../charts";
import { fmtFreq, withUnits } from "../ui";
import { focusControl } from "../ui/shell/commands";
import { useStore, type Snapshot } from "../state/store";
import type { Metrics } from "../types";
import { JUDGE_BAND, db } from "./data";
import "./views.css";

// ---------------------------------------------------------------- layout
export function ViewHeader({ title, children, actions }: { title: string; children?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="vw-head">
      <div className="vw-head-text">
        <h1 className="vw-title">{withUnits(title)}</h1>
        {children && <p className="vw-lede">{children}</p>}
      </div>
      {actions && <div className="vw-head-actions">{actions}</div>}
    </header>
  );
}

/** Content box size of an element, updated on resize (for canvas plots that need a pixel height). */
export function useSize<T extends HTMLElement>(): [RefObject<T | null>, { width: number; height: number }] {
  const ref = useRef<T | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => {
      const r = el.getBoundingClientRect();
      // whole pixels, so sub-pixel layout jitter does not re-render the plots
      setSize(s => (Math.round(r.width) === s.width && Math.round(r.height) === s.height ? s : { width: Math.round(r.width), height: Math.round(r.height) }));
    };
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size];
}

/** Split a pane height between stacked plots by weight, never below `min` px each. */
export function splitHeights(total: number, weights: number[], gap = 8, min = 140): number[] {
  const n = weights.length, avail = Math.max(0, total - gap * (n - 1));
  const sum = weights.reduce((a, b) => a + b, 0);
  // The heights always add up to the space there is (a small window must not push a plot out of
  // view): the minimum never exceeds an equal share, and what a small plot is raised by comes off
  // the larger ones in proportion to their surplus.
  const lo = Math.min(min, Math.floor(avail / n));
  const h = weights.map(w => avail * w / sum);
  const short = h.reduce((a, v) => a + Math.max(0, lo - v), 0);
  const spare = h.reduce((a, v) => a + Math.max(0, v - lo), 0);
  return h.map(v => Math.floor(v < lo ? lo : v - (spare ? short * (v - lo) / spare : 0)));
}

// ---------------------------------------------------------------- read-outs
export function Readout({ label, value, unit, tone, hint, onClick }: {
  label: ReactNode; value: ReactNode; unit?: string; tone?: "good" | "warn" | "bad" | "accent";
  hint?: string; onClick?: () => void;
}) {
  const body = (
    <>
      <span className="vw-ro-label">{withUnits(label)}</span>
      <span className="vw-ro-value mono">{value}{unit && <span className="vw-ro-unit">{unit}</span>}</span>
    </>
  );
  const cls = `vw-ro${tone ? " is-" + tone : ""}`;
  return onClick
    ? <button type="button" className={cls + " is-action"} title={hint} onClick={onClick}>{body}</button>
    : <div className={cls} title={hint}>{body}</div>;
}

/** A small clickable value that jumps to the inspector control it comes from. */
export function PartChip({ focus, color, children, hint }: { focus: string; color?: string; children: ReactNode; hint?: string }) {
  return (
    <button type="button" className="vw-chip" title={hint ?? "Show this control in the inspector"}
            style={color ? { ["--chip-color" as string]: `var(--${color})` } : undefined}
            onClick={() => focusControl(focus)}>
      {children}
    </button>
  );
}

export function Card({ title, actions, children, className }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={"vw-card" + (className ? " " + className : "")}>
      {(title || actions) && (
        <header className="vw-card-head">
          {title && <h2 className="vw-card-title">{withUnits(title)}</h2>}
          {actions && <div className="vw-card-actions">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

// ---------------------------------------------------------------- shared plot decorations
export function useProbe(): [number, (f: number) => void] {
  return [useStore(s => s.probe), useStore(s => s.setProbe)];
}

/** Dashed lines at the two acoustic crossovers. */
export function crossoverLines(m: Metrics, withLabels = true): PlotVLine[] {
  const out: PlotVLine[] = [];
  if (m.x_wm) out.push({ x: m.x_wm, style: "dashed", color: "text-3", label: withLabels ? `W/M ${fmtFreq(m.x_wm)}` : undefined });
  if (m.x_mt) out.push({ x: m.x_mt, style: "dashed", color: "text-3", label: withLabels ? `M/T ${fmtFreq(m.x_mt)}` : undefined });
  return out;
}

/** The ±2 dB target around the system level, drawn only over the band the metrics judge. */
export function judgeBand(level: number, halfWidth = 2): PlotBand {
  return { id: "judge", x: JUDGE_BAND, lower: [level - halfWidth, level - halfWidth], upper: [level + halfWidth, level + halfWidth], color: "band" };
}

/** Snapshot sums as dashed overlays, each in its own colour. */
export function snapshotSeries(snapshots: Snapshot[], angle = "0"): PlotSeries[] {
  return snapshots.flatMap(s => {
    const out = s.results.angles[angle] ?? s.results.angles["0"];
    if (!out) return [];
    return [{ id: `snap:${s.id}`, label: s.name, x: s.results.f, y: db(out.sum), color: s.color, dash: [5, 4], width: 1.25, opacity: 0.9 }];
  });
}

export const fmtSigned = (x: number, digits = 1) => `${x > 0 ? "+" : x < 0 ? "−" : ""}${Math.abs(x).toFixed(digits)}`;
