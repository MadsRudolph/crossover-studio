// Public engine API. Views, the store, the 3D viewport and the exporters use ONLY these functions.
//
// SEED IMPLEMENTATION: wraps the verified browser-artifact engine (legacy/engine.js) so the rest of the app
// has real numbers from day one. The engine work package replaces the internals with typed modules
// (complex.ts, digital.ts, passive.ts, box.ts, system.ts, optimise.ts) WITHOUT changing these signatures.

import type { Align, BoxFit, CArray, Check, Design, Metrics, Profile, Results, Series } from "../types";
import { makeEngine } from "./legacy/engine.js";
import boxfitRef from "../../fixtures/boxfit_reference.json";

export interface Prepared {
  profile: Profile;
  fit: BoxFit;
  /** The common frequency grid (the 0° TF grid of the profile). */
  f: Float64Array;
  /** Angles available ("0", "30", ...). */
  angles: string[];
  /** Zi of the passive units, interpolated onto f. */
  zi: { mid: CArray; tw: CArray };
  /** Opaque engine state. */
  _e: any;
}

/** Fit the woofer box model to the profile's woofer impedances (free, closed, vented). Pure, may take ~100 ms. */
export function fitBox(profile: Profile): BoxFit {
  if (profile.id === "system-d-group10") return boxfitRef as unknown as BoxFit;
  throw new Error("fitBox: not implemented in the seed engine");
}

function interpLogF(src: Series, f: Float64Array): CArray {
  const lf = src.f.map(Math.log), re = new Float64Array(f.length), im = new Float64Array(f.length);
  for (let i = 0; i < f.length; i++) {
    const x = Math.log(f[i]);
    let k = 0;
    while (k < lf.length - 2 && lf[k + 1] < x) k++;
    const t = Math.min(1, Math.max(0, (x - lf[k]) / (lf[k + 1] - lf[k])));
    re[i] = src.re[k] + t * (src.re[k + 1] - src.re[k]);
    im[i] = src.im[k] + t * (src.im[k + 1] - src.im[k]);
  }
  return { re, im };
}

export function prepare(profile: Profile, fit: BoxFit): Prepared {
  const on = profile.measurements.tf["0"];
  if (!on?.woof || !on.mid || !on.tw) throw new Error("profile needs 0° responses for all three units");
  const f = Float64Array.from(on.woof.f);
  const zi = { mid: interpLogF(profile.measurements.zi.mid!, f), tw: interpLogF(profile.measurements.zi.tw!, f) };
  const angles = Object.keys(profile.measurements.tf).sort((a, b) => +a - +b);
  const pair = (s: Series | undefined): [number[], number[]] => s ? [s.re, s.im] : [on.woof!.re.map(() => 1e-9), on.woof!.re.map(() => 0)];
  const off = profile.measurements.tf["30"] ?? on;
  const D = {
    f: Array.from(f),
    tf: {
      on: { woof: pair(on.woof), mid: pair(on.mid), tw: pair(on.tw) },
      off30: { woof: pair(off.woof), mid: pair(off.mid), tw: pair(off.tw) },
    },
    zi: { mid: [Array.from(zi.mid.re), Array.from(zi.mid.im)], tw: [Array.from(zi.tw.re), Array.from(zi.tw.im)] },
    box: { T: fit.T, c: fit.c, rho: fit.rho, RE: fit.RE, SD: fit.SD, AD: fit.AD, VB: fit.VB, AP: fit.AP,
           drv: fit.drv, RAB: fit.RAB, QL: fit.QL, QP: fit.QP, MAP: fit.MAP },
    std: profile.components,
    limits: { wm: profile.limits.wm, mt: profile.limits.mt },
    twFs: profile.limits.tw_fs_hz,
    design: null,
  };
  return { profile, fit, f, angles, zi, _e: makeEngine(D) };
}

/** Everything a view needs for one design. Fast (a few ms): call on every edit. */
export function compute(p: Prepared, design: Design): Results {
  const E = p._e;
  const cfg = E.boxConfig(design.box);
  const box = E.boxRatio(cfg);
  const angles: Results["angles"] = {};
  angles["0"] = E.evaluate(design, "on", box);
  if (p.profile.measurements.tf["30"]) angles["30"] = E.evaluate(design, "off30", box);
  const m = E.metrics(design, box);
  const metrics: Metrics = { on: m.on, off30: p.profile.measurements.tf["30"] ? m.off30 : undefined, x_wm: m.x_wm, x_mt: m.x_mt, Zamp2_min: m.Zamp2_min };
  const fb = Array.from({ length: 300 }, (_, i) => 10 * 40 ** (i / 299));
  const bx = cfg.MAP ? E.ventBox(cfg.MAP, cfg.fill) : E.boxDict({ RAB: p.fit.RAB, fill: cfg.fill });
  const lf = E.f3Ripple(fb, E.boxSystem(fb, bx).p1m);
  const fB = cfg.MAP ? 1 / (2 * Math.PI * Math.sqrt(cfg.MAP * p.fit.VB * cfg.fill / (p.fit.rho * p.fit.c ** 2))) : null;
  return { f: p.f, angles, metrics, checks: checks(p, angles["0"], metrics, lf), box: { MAP: cfg.MAP, fill: cfg.fill, label: cfg.label, fB, f3: lf.f3, ripple: lf.ripple } };
}

function checks(p: Prepared, on: any, m: Metrics, lf: { f3: number; ripple: number }): Check[] {
  const f = p.f, L = p.profile.limits;
  const db = (z: CArray, i: number) => 20 * Math.log10(Math.hypot(z.re[i], z.im[i]));
  let iFs = 0; for (let i = 0; i < f.length; i++) if (Math.abs(f[i] - L.tw_fs_hz) < Math.abs(f[iFs] - L.tw_fs_hz)) iFs = i;
  const twAtFs = db(on.tw, iFs) - m.on.level;
  let worst = 0;
  for (let k = 0; k < f.length; k++) if (f[k] >= 150 && f[k] <= 15000) {
    const pw = 10 * Math.log10(["woof", "mid", "tw"].reduce((a, u) => a + on[u].re[k] ** 2 + on[u].im[k] ** 2, 0));
    worst = Math.min(worst, db(on.sum, k) - pw);
  }
  const inR = (x: number | null, [a, b]: [number, number]) => x !== null && x >= a && x <= b;
  const fmt = (x: number) => x >= 1000 ? `${(x / 1000).toFixed(2)} kHz` : `${x.toFixed(0)} Hz`;
  const off = m.off30;
  const out: Check[] = [
    { id: "flat", state: m.on.spread <= 4 ? "good" : m.on.spread <= 6 ? "warn" : "bad", title: "Flat on axis", detail: `150 Hz–15 kHz within ${m.on.spread.toFixed(1)} dB (aim ±2 dB, 1/6 octave)` },
  ];
  if (off) out.push({ id: "off", state: off.spread <= 6 ? "good" : off.spread <= 8 ? "warn" : "bad", title: "Even off axis", detail: `30° within ${off.spread.toFixed(1)} dB` });
  out.push(
    { id: "xwm", state: inR(m.x_wm, L.wm) ? "good" : "warn", title: "Woofer/mid crossover placed", detail: m.x_wm ? `${fmt(m.x_wm)} (aim ${L.wm[0]}–${L.wm[1]} Hz)` : "the two never cross" },
    { id: "xmt", state: inR(m.x_mt, L.mt) ? "good" : "warn", title: "Mid/tweeter crossover placed", detail: m.x_mt ? `${fmt(m.x_mt)} (aim ${L.mt[0] / 1000}–${L.mt[1] / 1000} kHz)` : "the two never cross" },
    { id: "twfs", state: twAtFs <= -12 ? "good" : twAtFs <= -8 ? "warn" : "bad", title: "Tweeter protected", detail: `${twAtFs.toFixed(1)} dB at its ${fmt(L.tw_fs_hz)} resonance (aim ≤ −12 dB)` },
    { id: "canc", state: worst >= -1 ? "good" : worst >= -3 ? "warn" : "bad", title: "No cancellation", detail: `sum never more than ${(-worst).toFixed(1)} dB below the power sum` },
    { id: "load", state: m.Zamp2_min >= 4 ? "good" : m.Zamp2_min >= 3 ? "warn" : "bad", title: "Safe amplifier load", detail: `ch. 2 never below ${m.Zamp2_min.toFixed(2)} Ω` },
    { id: "bass", state: lf.ripple <= 2 ? "good" : lf.ripple <= 3 ? "warn" : "bad", title: "Smooth bass", detail: `f3 ${lf.f3.toFixed(1)} Hz, ripple ${lf.ripple >= 0 ? "+" : ""}${lf.ripple.toFixed(1)} dB` },
  );
  return out;
}

/** Woofer-box model on any frequency grid (for the box view and the 3D air plug). */
export function boxResponse(p: Prepared, design: Design, freqs: number[]): { ZE: CArray; UD: CArray; UP: CArray; p1m: CArray } {
  const E = p._e, cfg = E.boxConfig(design.box);
  const bx = cfg.MAP ? E.ventBox(cfg.MAP, cfg.fill) : E.boxDict({ RAB: p.fit.RAB, fill: cfg.fill });
  return E.boxSystem(freqs, bx);
}

export function minidspText(p: Prepared, fc: number, kind: "LPF" | "HPF", align: Align): string {
  return p._e.minidspText(fc, kind, align);
}

export function ltspiceText(p: Prepared, fc: number, kind: "LPF" | "HPF", align: Align): string[] {
  return p._e.ltspiceText(fc, kind, align);
}

/** Passive topology library: key -> [position, kind, value name][]. */
export function topologies(p: Prepared): Record<string, [string, "L" | "C" | "R", string][]> {
  return p._e.TOPOLOGIES;
}

/** Score (lower = better) used by the optimiser. */
export function score(p: Prepared, design: Design): number {
  const E = p._e;
  return E.score(design, E.boxRatio(E.boxConfig(design.box)));
}

/** Coordinate-descent optimiser as a generator, so a worker or the UI can step it and report progress. */
export function* optimise(p: Prepared, design: Design): Generator<{ progress: number; score: number; des: Design }, { score: number; des: Design }> {
  const E = p._e;
  return yield* E.optimise(design, E.boxRatio(E.boxConfig(design.box)));
}

/** Monte Carlo tolerance band of the on-axis sum (dB). */
export function tolerance(p: Prepared, design: Design, runs = 120): { lo: Float64Array; hi: Float64Array } {
  const E = p._e;
  return E.tolerance(design, E.boxRatio(E.boxConfig(design.box)), runs);
}

/** The phase-display rotation used everywhere (Matlab2LTspice convention, c = 345 m/s). */
export function displayPhase(p: Prepared, z: CArray, i: number): number {
  const d = p.profile.conditions.phase_ref_distance_m;
  const ph = Math.atan2(z.im[i], z.re[i]) + 2 * Math.PI * p.f[i] * d / 345;
  return Math.atan2(Math.sin(ph), Math.cos(ph));
}
