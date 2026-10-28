// Part sensitivity: which part of the design moves the on-axis sum most, so a group knows which value
// to choose with care and which part to measure with the LCR meter before soldering.
//
// Every passive part of the midrange and tweeter branches (filter parts, L-pad resistors, Zobel R and
// C), the MiniDSP crossover frequency, the woofer gain and the vent length is changed on its own, all
// else held, in two ways:
//   - one basket step down and up (stockNeighbours of the profile's component list; for the digital
//     controls the step the suggestions use: f_c x 2^(+-1/6) rounded to 5 Hz, gain +-0.5 dB; the vent
//     +-10 mm);
//   - its tolerance down and up, as tolerance() in optimise.ts draws them: L +-5 %, C +-10 %, R +-5 %.
//     The MiniDSP values are exact (no tolerance); the vent length is assumed cut to +-2 mm.
// For each change: the largest change of the 1/6-octave smoothed on-axis sum over the judging band
// 150 Hz-15 kHz (signed, with its frequency), the largest within 1/3 octave of either acoustic crossover,
// and, when asked for, the change of the verdict score (assess). The on-axis changes cost one evaluate()
// each (~0.1 ms with the engine's memo); the verdict needs a full compute + assess per change, so it is
// optional and the view runs it after the design settles.

import type { Design, Results, UnitId } from "../types";
import { dbArray } from "./complex";
import { boxConfig } from "./box";
import { passiveParts } from "./passive";
import { assess, stockNeighbours } from "./assess";
import { boxRatio, compute, evaluate, smooth, type Prepared } from "./system";

export type SensKind = "L" | "C" | "R" | "fc" | "gain" | "vent";

/** Relative tolerance per part kind (the Monte Carlo band's values). */
export const PART_TOLERANCE = { L: 0.05, C: 0.10, R: 0.05 } as const;
/** Vent length cutting tolerance (m): an assumption, not from the guide. */
export const VENT_TOL_M = 0.002;
/** Basket step of the vent length (m). */
export const VENT_STEP_M = 0.01;

export interface SensVariant {
  /** The changed value (SI: H, F, ohm, Hz, dB, m). */
  value: number;
  /** Largest change of the smoothed on-axis sum, 150 Hz-15 kHz (dB, signed), and where it happens. */
  maxDb: number;
  atHz: number;
  /** Largest change within 1/3 octave of either crossover (dB, signed; 0 when neither is found), and where. */
  xoverDb: number;
  xoverHz: number;
  /** Change of the verdict score (points), when computed. */
  dScore: number | null;
  /** The changed design and its raw on-axis sum (dB), for the overlay band. */
  design: Design;
  sumDb: Float64Array;
}

export interface SensEntry {
  /** Unique id ("tw.C1", "tw.pad.Rs", "tw.zobel.C", "digital.fc", "box.L"). */
  id: string;
  /** Inspector control (focus id) it belongs to. */
  focus: string;
  /** Unit whose sound it acts on (its colour in the tornado). */
  unit: UnitId;
  kind: SensKind;
  /** Short label ("C1", "Rs", "Zobel C", "f_c", "Gain", "Vent") and the full name. */
  label: string;
  name: string;
  /** Whether it is a passive part (something to measure with an LCR meter). */
  passive: boolean;
  value: number;
  step: { lo: SensVariant | null; hi: SensVariant | null };
  /** null for the MiniDSP controls (exact). */
  tol: { lo: SensVariant; hi: SensVariant; rel: number | null } | null;
  /** max |maxDb| of the step and the tolerance changes (dB). */
  stepDb: number;
  tolDb: number;
  /** max |xoverDb| of the step changes (dB). */
  xoverDb: number;
}

export interface Sensitivity {
  /** The design's own smoothed and raw on-axis sum (dB) and verdict score (when computed). */
  base: { smoothDb: Float64Array; sumDb: Float64Array; score: number | null };
  /** Ranked by stepDb, largest first. */
  entries: SensEntry[];
  /** The passive part that moves the sum most near a crossover (one basket step), if any. */
  topXover: SensEntry | null;
  /** The two passive parts most sensitive to their tolerance: the ones to measure. */
  measure: SensEntry[];
  /** Run time (ms). */
  ms: number;
}

export interface SensOptions {
  /** Also work out the verdict score change of every variant (about 1 ms each). Default false. */
  score?: boolean;
  /** Leave out the MiniDSP and vent controls (passive parts only). Default false. */
  passiveOnly?: boolean;
}

const UNIT_NAME: Record<UnitId, string> = { woof: "Woofer", mid: "Midrange", tw: "Tweeter" };

interface Knob {
  id: string; focus: string; unit: UnitId; kind: SensKind; label: string; passive: boolean; value: number;
  steps: number[];
  tolRel: number | null;
  tolAbs?: number;
  set: (d: Design, v: number) => void;
}

/** Every control the analysis varies, with its basket neighbours and its tolerance. */
function knobs(p: Prepared, design: Design, passiveOnly: boolean): Knob[] {
  const C = p.profile.components, out: Knob[] = [];
  const list = (k: "L" | "C" | "R") => C[k];
  for (const u of ["mid", "tw"] as const) {
    const b = design[u];
    for (const part of passiveParts(b, u)) {
      if (part.kind === "RC") {
        const [R, Cz] = part.value;
        out.push(
          { id: `${u}.zobel.R`, focus: `${u}.zobel`, unit: u, kind: "R", label: "Zobel R", passive: true, value: R, steps: stockNeighbours(list("R"), R),
            tolRel: PART_TOLERANCE.R, set: (d, v) => { d[u].zobel = { ...d[u].zobel!, R: v }; } },
          { id: `${u}.zobel.C`, focus: `${u}.zobel`, unit: u, kind: "C", label: "Zobel C", passive: true, value: Cz, steps: stockNeighbours(list("C"), Cz),
            tolRel: PART_TOLERANCE.C, set: (d, v) => { d[u].zobel = { ...d[u].zobel!, C: v }; } },
        );
        continue;
      }
      const kind = part.kind, v = part.value as number, name = part.id.slice(u.length + 1);
      const isPad = name.startsWith("pad.");
      out.push({
        id: part.id, focus: part.id, unit: u, kind, label: isPad ? name.slice(4) : name, passive: true, value: v,
        steps: stockNeighbours(list(kind), v), tolRel: PART_TOLERANCE[kind],
        set: isPad ? (d, x) => { d[u].pad = { ...d[u].pad, [name.slice(4)]: x }; } : (d, x) => { d[u].vals[name] = x; },
      });
    }
  }
  if (passiveOnly) return out;
  const fc = design.digital.fc;
  const fcSteps = [-1 / 6, 1 / 6].map(k => Math.round(fc * 2 ** k / 5) * 5).filter(x => x >= 100 && x <= 1000 && x !== fc);
  out.push({ id: "digital.fc", focus: "digital.fc", unit: "woof", kind: "fc", label: "fc", passive: false, value: fc, steps: fcSteps, tolRel: null,
             set: (d, v) => { d.digital.fc = v; } });
  const g = design.digital.g_woof_dB;
  out.push({ id: "digital.gain", focus: "digital.gain", unit: "woof", kind: "gain", label: "Gain", passive: false, value: g, steps: [g - 0.5, g + 0.5], tolRel: null,
             set: (d, v) => { d.digital.g_woof_dB = v; } });
  if (design.box.mode !== "plugged") {
    const L = design.box.L;
    out.push({ id: "box.L", focus: "box.L", unit: "woof", kind: "vent", label: "Vent", passive: false, value: L,
               steps: [L - VENT_STEP_M, L + VENT_STEP_M].filter(x => x > 0.005), tolRel: null, tolAbs: VENT_TOL_M,
               set: (d, v) => { d.box.L = v; } });
  }
  return out;
}

/** Rank every control of the design by how much it moves the on-axis sum (and, optionally, the verdict). */
export function sensitivity(p: Prepared, design: Design, results: Results, opts: SensOptions = {}): Sensitivity {
  const t0 = performance.now();
  const K = p._e.K, f = p.f, m = results.metrics;
  const on = results.angles["0"];
  const base = { smoothDb: smooth(p, dbArray(on.sum)), sumDb: dbArray(on.sum), score: null as number | null };
  if (opts.score) { try { base.score = assess(p, design, results).score; } catch { base.score = null; } }
  // grid points within 1/3 octave of either crossover
  const nearX = new Uint8Array(f.length);
  for (const x of [m.x_wm, m.x_mt]) if (x) for (const i of K) if (Math.abs(Math.log2(f[i] / x)) <= 1 / 3) nearX[i] = 1;
  const ratio0 = boxRatio(p, boxConfig(p.fit, design.box, p.profile.woofer_box.vents.length));

  const variant = (k: Knob, v: number): SensVariant | null => {
    const d: Design = structuredClone(design);
    k.set(d, v);
    let sum;
    try {
      const ratio = k.kind === "vent" ? boxRatio(p, boxConfig(p.fit, d.box, p.profile.woofer_box.vents.length)) : ratio0;
      sum = evaluate(p, d, "0", ratio).sum;
    } catch { return null; }
    const sm = smooth(p, dbArray(sum));
    let maxDb = 0, atHz = NaN, xoverDb = 0, xoverHz = NaN;
    for (const i of K) {
      const dd = sm[i] - base.smoothDb[i];
      if (!Number.isFinite(dd)) continue;
      if (Math.abs(dd) > Math.abs(maxDb) || Number.isNaN(atHz)) { maxDb = dd; atHz = f[i]; }
      if (nearX[i] && Math.abs(dd) > Math.abs(xoverDb)) { xoverDb = dd; xoverHz = f[i]; }
    }
    let dScore: number | null = null;
    if (opts.score && base.score !== null) { try { dScore = assess(p, d, compute(p, d)).score - base.score; } catch { dScore = null; } }
    return { value: v, maxDb, atHz, xoverDb, xoverHz, dScore, design: d, sumDb: dbArray(sum) };
  };

  const entries: SensEntry[] = knobs(p, design, !!opts.passiveOnly).map(k => {
    const lo = k.steps.filter(x => x < k.value).pop(), hi = k.steps.find(x => x > k.value);
    const step = { lo: lo !== undefined ? variant(k, lo) : null, hi: hi !== undefined ? variant(k, hi) : null };
    let tol: SensEntry["tol"] = null;
    const dv = k.tolRel !== null ? k.value * k.tolRel : k.tolAbs;
    if (dv) {
      const a = variant(k, k.value - dv), b = variant(k, k.value + dv);
      if (a && b) tol = { lo: a, hi: b, rel: k.tolRel };
    }
    const abs = (...v: (SensVariant | null | undefined)[]) => Math.max(0, ...v.map(x => (x ? Math.abs(x.maxDb) : 0)));
    return {
      id: k.id, focus: k.focus, unit: k.unit, kind: k.kind, label: k.label, passive: k.passive, value: k.value,
      name: k.passive ? `${UNIT_NAME[k.unit]} ${k.label}` : k.kind === "fc" ? "Crossover frequency" : k.kind === "gain" ? "Woofer gain" : "Vent length",
      step, tol, stepDb: abs(step.lo, step.hi), tolDb: abs(tol?.lo, tol?.hi),
      xoverDb: Math.max(0, ...[step.lo, step.hi].map(x => (x ? Math.abs(x.xoverDb) : 0))),
    };
  });
  entries.sort((a, b) => b.stepDb - a.stepDb);
  const passive = entries.filter(e => e.passive);
  const topXover = passive.reduce<SensEntry | null>((best, e) => (e.xoverDb > (best?.xoverDb ?? 0) ? e : best), null);
  const measure = [...passive].sort((a, b) => b.tolDb - a.tolDb).slice(0, 2);
  return { base, entries, topXover, measure, ms: performance.now() - t0 };
}

// One analysis per Results object: the Sensitivity view and the insight provider share the cheap one.
const cache = new WeakMap<Results, Sensitivity>();

/** sensitivity() without the verdict scores (on-axis only, a few ms), cached per Results object. */
export function cachedSensitivity(p: Prepared, design: Design, results: Results): Sensitivity {
  let s = cache.get(results);
  if (!s) cache.set(results, (s = sensitivity(p, design, results)));
  return s;
}
