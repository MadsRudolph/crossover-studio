// Design score and the coordinate-descent search over the discrete choices (design/xover.py score(),
// penalty(), optimise()), plus the Monte Carlo tolerance band. Every passive value the search picks
// comes from the profile's component list (Appendix 1 of the project guide by default).

import type { Align, Design, Results } from "../types";
import { UNIT_IDS } from "../types";
import { dbAt, dbArray } from "./complex";
import { boxConfig } from "./box";
import { topology } from "./passive";
import { boxRatio, crossing, evaluate, median, offAxisAngle, smooth, type Prepared } from "./system";

/** Angles that enter the score, with their weights: on axis counts fully, the judged off-axis angle
 *  (30 degrees when measured, else the first one) half. */
const scoreWeights = (p: Prepared): [string, number][] => {
  const off = offAxisAngle(p.angles);
  return off ? [["0", 1], [off, 0.5]] : [["0", 1]];
};

/** Engineering rules the flatness score alone does not know about: both acoustic crossovers inside
 *  their windows (profile.limits), and the tweeter >= 12 dB below the system level at its resonance. */
export function penalty(p: Prepared, on: Results["angles"][string]): number {
  let pen = 0;
  const L = p.profile.limits;
  for (const [lim, a, b] of [[L.wm, "woof", "mid"], [L.mt, "mid", "tw"]] as const) {
    const [lo, hi] = lim, fx = crossing(p, on, lo / 1.5, hi * 1.5, a, b);
    pen += fx === null ? 5 : 3 * Math.max(0, Math.log2(lo / fx), Math.log2(fx / hi));
  }
  const ys = smooth(p, dbArray(on.sum)), ref = median(p._e.K300.map(i => ys[i]));
  pen += 0.3 * Math.max(0, dbAt(on.tw, p._e.iFs) - (ref - 12));
  return pen;
}

/** Lower is better: RMS deviation of the smoothed sum from flat (150 Hz-15 kHz) plus 0.3 x the RMS
 *  cancellation (power sum above the complex sum), on axis and half-weighted at 30 degrees, plus
 *  the penalty. */
export function score(p: Prepared, design: Design): number {
  const ratio = boxRatio(p, boxConfig(p.fit, design.box, p.profile.woofer_box.vents.length)), K = p._e.K;
  let s = 0, on: Results["angles"][string] | null = null;
  for (const [ang, wgt] of scoreWeights(p)) {
    if (!p._e.tf[ang]) continue;
    const out = evaluate(p, design, ang, ratio);
    if (ang === "0") on = out;
    const ys = smooth(p, dbArray(out.sum)), y = K.map(i => ys[i]), m = median(y);
    const dev = Math.sqrt(y.reduce((a, v) => a + (v - m) ** 2, 0) / y.length);
    let c2 = 0;
    for (const i of K) {
      const pw = 10 * Math.log10(UNIT_IDS.reduce((a, u) => a + out[u].re[i] ** 2 + out[u].im[i] ** 2, 0));
      c2 += Math.max(0, pw - dbAt(out.sum, i)) ** 2;
    }
    s += wgt * (dev + 0.3 * Math.sqrt(c2 / K.length));
  }
  return s + penalty(p, on!);
}

export interface OptimiseStep { progress: number; score: number; des: Design }
export interface OptimiseOptions { rounds?: number; alignments?: Align[] }

type Path = (string | number)[];

/** Coordinate descent: for each choice in turn try every allowed value, keep the best; repeat for
 *  up to `rounds` passes or until a pass changes nothing. Yields after every choice. */
export function* optimise(p: Prepared, design0: Design, opts: OptimiseOptions = {}): Generator<OptimiseStep, { score: number; des: Design }> {
  const rounds = opts.rounds ?? 4, std = p.profile.components;
  const des: Design = structuredClone(design0);
  const pick = (kind: "L" | "C" | "R") => kind === "L" ? std.L : kind === "C" ? std.C : std.R;
  const choices: [Path, unknown[]][] = [
    [["digital", "fc"], Array.from({ length: 21 }, (_, k) => 200 + 25 * k)],
    [["digital", "align"], opts.alignments ?? ["BW2", "LR2", "LR4", "BW4"]],
    [["digital", "g_woof_dB"], Array.from({ length: 25 }, (_, k) => -10 + k / 2)],
  ];
  for (const u of ["mid", "tw"] as const)
    for (const part of topology(des[u].topo).parts) choices.push([[u, "vals", part.name], pick(part.kind)]);
  // the tweeter always may take an L-pad; the midrange only when the user has switched one on
  des.tw.pad = des.tw.pad ?? {};
  const padUnits: ("mid" | "tw")[] = des.mid.pad ? ["mid", "tw"] : ["tw"];
  for (const u of padUnits) choices.push([[u, "pad", "Rs"], [0, ...std.R]], [[u, "pad", "Rp"], [null, ...std.R]]);
  choices.push([["pol", "tw"], [1, -1]], [["pol", "mid"], [1, -1]]);

  const getP = (path: Path): unknown => path.reduce((o: any, k) => o[k], des);
  const putP = (path: Path, v: unknown) => { (path.slice(0, -1).reduce((o: any, k) => o[k], des) as any)[path[path.length - 1]] = v; };
  let best = score(p, des), done = 0;
  const total = rounds * choices.length;
  for (let r = 0; r < rounds; r++) {
    let changed = false;
    for (const [path, options] of choices) {
      let cur = getP(path);
      for (const v of options) {
        putP(path, v);
        const s = score(p, des);
        if (s < best - 1e-9) { best = s; cur = v; changed = true; }
      }
      putP(path, cur);
      done++;
      yield { progress: done / total, score: best, des: structuredClone(des) };
    }
    if (!changed) break;
  }
  return { score: best, des };
}

/** Fresh values for the parts a topology switch has just added: coordinate descent over only those
 *  parts of one branch, everything else held, starting from the values they were seeded with. A new
 *  3rd-order part copied from its 2nd-order sibling (L2 = L1) can wreck the response; this puts it
 *  where the score wants it. Returns the branch's new value map. */
export function seedParts(p: Prepared, design: Design, unit: "mid" | "tw", names: string[], rounds = 2): Record<string, number> {
  const des: Design = structuredClone(design), std = p.profile.components;
  const parts = topology(des[unit].topo).parts.filter(t => names.includes(t.name));
  let best = score(p, des);
  for (let r = 0; r < rounds; r++) {
    let changed = false;
    for (const part of parts) {
      const list = part.kind === "L" ? std.L : part.kind === "C" ? std.C : std.R;
      let cur = des[unit].vals[part.name];
      for (const v of list) {
        des[unit].vals[part.name] = v;
        const s = score(p, des);
        if (s < best - 1e-9) { best = s; cur = v; changed = true; }
      }
      des[unit].vals[part.name] = cur;
    }
    if (!changed) break;
  }
  return des[unit].vals;
}

/** Monte Carlo band (2.5-97.5 %) of the on-axis sum in dB with the passive parts drawn uniformly
 *  within L +-5 %, C +-10 %, R +-5 %. Deterministic (fixed LCG seed) so the band does not flicker. */
export function tolerance(p: Prepared, design: Design, runs = 120, tol = { L: 0.05, C: 0.10, R: 0.05 }): { lo: Float64Array; hi: Float64Array } {
  const ratio = boxRatio(p, boxConfig(p.fit, design.box, p.profile.woofer_box.vents.length)), N = p.f.length;
  let seed = 12345;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 * 2 - 1; };
  const all: Float64Array[] = [];
  for (let r = 0; r < runs; r++) {
    const t: Design = structuredClone(design);
    for (const u of ["mid", "tw"] as const) {
      for (const part of topology(t[u].topo).parts) t[u].vals[part.name] *= 1 + tol[part.kind] * rnd();
      const pad = t[u].pad as Record<string, number | null | undefined> | undefined;
      for (const k of Object.keys(pad ?? {})) if (pad![k]) pad![k] = pad![k]! * (1 + tol.R * rnd());
      if (t[u].zobel) { t[u].zobel!.R *= 1 + tol.R * rnd(); t[u].zobel!.C *= 1 + tol.C * rnd(); }
    }
    all.push(dbArray(evaluate(p, t, "0", ratio).sum));
  }
  const lo = new Float64Array(N), hi = new Float64Array(N), col = new Float64Array(runs);
  for (let i = 0; i < N; i++) {
    for (let r = 0; r < runs; r++) col[r] = all[r][i];
    col.sort();
    lo[i] = col[Math.floor(0.025 * (runs - 1))]; hi[i] = col[Math.ceil(0.975 * (runs - 1))];
  }
  return { lo, hi };
}
