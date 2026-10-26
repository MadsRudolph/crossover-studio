// The three-way system: woofer = digital low-pass x gain x measured p/V x box change; midrange and
// tweeter = digital high-pass x passive ladder x measured p/V. Port of design/xover.py evaluate(),
// metrics() and the artifact's checks, generalised to any set of measured angles.
//
// The measured transfer functions already contain each driver's acoustic position (one Lab E run per
// angle), so summing them complex-valued gives the real acoustic sum including the driver offsets.
// The woofer TF was measured with the vent plugged; the box model supplies the ratio
// p(design box) / p(plugged box) that turns it into the designed box.

import type { BoxFit, CArray, Check, Design, Metrics, Profile, Results, Series, UnitId } from "../types";
import { UNIT_IDS } from "../types";
import { cabsAt, carray, dbAt, dbArray, fromSeries, interpLogF, logspace, nearestIndex } from "./complex";
import { hDigital, type FilterKind } from "./digital";
import { ladder, ladderNodes, passiveParts, type LadderResult } from "./passive";
import {
  boxConfig, boxElements, boxSystem, configElements, f3Ripple, mapAt, tuningHz, ventedElements,
  type BoxConfig, type BoxFitEx, type BoxSystemResult,
} from "./box";

// ---------------------------------------------------------------- prepared state
/** Precomputed, design-independent state of one profile. Build once per profile with prepare(). */
export interface EngineState {
  /** Measured p/V per angle and unit, on the common grid. */
  tf: Record<string, Record<UnitId, CArray>>;
  /** Plugged-box far field of the fitted model, the reference for the box ratio. */
  closedRef: CArray;
  /** 1/6-octave smoothing window [first, last] index per grid point. */
  win: Int32Array;
  /** Grid indices in 150 Hz-15 kHz (judging band) and 300 Hz-15 kHz (level reference). */
  K: number[];
  K300: number[];
  /** Grid index nearest the tweeter resonance (linear distance, as xover.py). */
  iFs: number;
  /** Memo of digital responses and passive ladders, so the optimiser does not redo unchanged parts. */
  memo: { digital: Map<string, CArray>; ladder: Map<string, LadderResult> };
}

export interface Prepared {
  profile: Profile;
  fit: BoxFit;
  /** The common frequency grid (the 0° TF grid of the profile), Hz. */
  f: Float64Array;
  /** Angles evaluated ("0", "30", ...), ascending. Angles missing a unit are left out (see skipped). */
  angles: string[];
  /** Angles present in the profile but not complete (missing a unit), with the reason. */
  skipped: { angle: string; reason: string }[];
  /** Zi of the passive units, interpolated onto f. */
  zi: { mid: CArray; tw: CArray };
  _e: EngineState;
}

const UNIT_NAMES: Record<UnitId, string> = { woof: "woofer", mid: "midrange", tw: "tweeter" };

function sameGrid(a: number[], f: Float64Array): boolean {
  if (a.length !== f.length) return false;
  for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - f[i]) > 1e-9 * f[i]) return false;
  return true;
}
/** The series without points at or below 0 Hz (returned as is when it has none). */
function positive(s: Series): Series {
  if (!(s.f[0] <= 0)) return s;
  const keep = s.f.map((x, i) => (x > 0 ? i : -1)).filter(i => i >= 0);
  return { ...s, f: keep.map(i => s.f[i]), re: keep.map(i => s.re[i]), im: keep.map(i => s.im[i]) };
}
const onGrid = (s: Series, f: Float64Array): CArray => sameGrid(s.f, f) ? fromSeries(s) : interpLogF(s, f);

/** Build the design-independent state. Throws an Error with a plain-language message when the
 *  profile lacks something the system model needs. */
export function prepare(profile: Profile, fit: BoxFit): Prepared {
  const M = profile.measurements;
  const on = M.tf["0"];
  const missing = UNIT_IDS.filter(u => !on?.[u] || on[u]!.f.length < 2);
  if (missing.length)
    throw new Error(`The on-axis (0°) response is missing for the ${missing.map(u => UNIT_NAMES[u]).join(", ")}. Import the Lab E system measurement at 0°.`);
  for (const u of ["mid", "tw"] as const)
    if (!M.zi[u] || M.zi[u]!.f.length < 2)
      throw new Error(`The input impedance of the ${UNIT_NAMES[u]} is missing (measurements.zi.${u}). Import its Lab D impedance: the passive crossover needs it as the load.`);

  // The grid is logarithmic: a DC bin (MATLAB FFT axes start at 0 Hz) has no place on it and would
  // divide by w = 0 in the models, so points at or below 0 Hz are left out of every series.
  const f = Float64Array.from(on!.woof!.f.filter(x => x > 0));
  if (f.length < 2) throw new Error("The on-axis woofer response has fewer than two points above 0 Hz.");
  const zi = { mid: interpLogF(positive(M.zi.mid!), f), tw: interpLogF(positive(M.zi.tw!), f) };
  const tf: EngineState["tf"] = {};
  const skipped: Prepared["skipped"] = [];
  for (const ang of Object.keys(M.tf).sort((a, b) => +a - +b)) {
    const set = M.tf[ang];
    const lack = UNIT_IDS.filter(u => !set[u] || set[u]!.f.length < 2);
    if (lack.length) { skipped.push({ angle: ang, reason: `no ${lack.map(u => UNIT_NAMES[u]).join(", ")} response` }); continue; }
    tf[ang] = { woof: onGrid(positive(set.woof!), f), mid: onGrid(positive(set.mid!), f), tw: onGrid(positive(set.tw!), f) };
  }
  const angles = Object.keys(tf).sort((a, b) => +a - +b);

  const N = f.length, lf = Array.from(f, Math.log2), win = new Int32Array(2 * N);
  for (let i = 0; i < N; i++) {
    let a = 0;
    while (Math.abs(lf[a] - lf[i]) > 0.5 / 6) a++;
    let b = a;
    while (b + 1 < N && Math.abs(lf[b + 1] - lf[i]) <= 0.5 / 6) b++;
    win[2 * i] = a; win[2 * i + 1] = b;
  }
  const idx = (lo: number, hi: number) => { const k: number[] = []; for (let i = 0; i < N; i++) if (f[i] >= lo && f[i] <= hi) k.push(i); return k; };
  const closedRef = boxSystem(fit, fit.drv, boxElements(fit, { RAB: fit.RAB }), f).p1m;
  return {
    profile, fit, f, angles, skipped, zi,
    _e: {
      tf, closedRef, win, K: idx(150, 15000), K300: idx(300, 15000),
      iFs: nearestIndex(f, profile.limits.tw_fs_hz, "lin"),
      memo: { digital: new Map(), ladder: new Map() },
    },
  };
}

// ---------------------------------------------------------------- building blocks
function remember<T>(m: Map<string, T>, key: string, make: () => T): T {
  let v = m.get(key);
  if (v === undefined) {
    if (m.size > 256) m.clear();
    v = make(); m.set(key, v);
  }
  return v;
}

export function digitalResponse(p: Prepared, fc: number, kind: FilterKind, align: Design["digital"]["align"]): CArray {
  return remember(p._e.memo.digital, `${kind}|${align}|${fc}`, () => hDigital(p.f, fc, kind, align));
}

export function branchResponse(p: Prepared, d: Design, unit: "mid" | "tw"): LadderResult {
  const b = d[unit];
  return remember(p._e.memo.ladder, `${unit}|${d.Rdcr ?? 0}|${JSON.stringify(b)}`,
    () => ladder(p.f, passiveParts(b, unit), p.zi[unit], d.Rdcr || 0));
}

/** p(design box) / p(plugged box, empty) of the fitted model on the grid: the woofer correction. */
export function boxRatio(p: Prepared, cfg: BoxConfig): CArray {
  const N = p.f.length, r = carray(N);
  if (!cfg.MAP && (cfg.fill ?? 1) === 1) { r.re.fill(1); return r; }
  const pr = boxSystem(p.fit, p.fit.drv, configElements(p.fit, cfg), p.f).p1m, ref = p._e.closedRef;
  for (let i = 0; i < N; i++) {
    const ar = pr.re[i], ai = pr.im[i], br = ref.re[i], bi = ref.im[i], d = br * br + bi * bi;
    r.re[i] = (ar * br + ai * bi) / d; r.im[i] = (ai * br - ar * bi) / d;
  }
  return r;
}

/** Every unit's acoustic output (p/V re the amplifier input), their sum, and the channel-2 load. */
export function evaluate(p: Prepared, d: Design, angle: string, ratio: CArray): Results["angles"][string] {
  const tf = p._e.tf[angle];
  if (!tf) throw new Error(`no complete measurement at ${angle}°`);
  const dg = d.digital, N = p.f.length;
  const HL = digitalResponse(p, dg.fc, "LPF", dg.align), HH = digitalResponse(p, dg.fc, "HPF", dg.align);
  const m = branchResponse(p, d, "mid"), t = branchResponse(p, d, "tw");
  const gw = d.pol.woof * 10 ** (dg.g_woof_dB / 20), pm = d.pol.mid, pt = d.pol.tw;
  const woof = carray(N), mid = carray(N), tw = carray(N), sum = carray(N), Zamp2 = carray(N);
  for (let i = 0; i < N; i++) {
    // woofer: gain x H_L x TF x box ratio
    let ar = HL.re[i] * tf.woof.re[i] - HL.im[i] * tf.woof.im[i], ai = HL.re[i] * tf.woof.im[i] + HL.im[i] * tf.woof.re[i];
    const wr = gw * (ar * ratio.re[i] - ai * ratio.im[i]), wi = gw * (ar * ratio.im[i] + ai * ratio.re[i]);
    // mid / tweeter: polarity x H_H x T_ladder x TF
    ar = HH.re[i] * m.T.re[i] - HH.im[i] * m.T.im[i]; ai = HH.re[i] * m.T.im[i] + HH.im[i] * m.T.re[i];
    const mr = pm * (ar * tf.mid.re[i] - ai * tf.mid.im[i]), mi = pm * (ar * tf.mid.im[i] + ai * tf.mid.re[i]);
    ar = HH.re[i] * t.T.re[i] - HH.im[i] * t.T.im[i]; ai = HH.re[i] * t.T.im[i] + HH.im[i] * t.T.re[i];
    const tr = pt * (ar * tf.tw.re[i] - ai * tf.tw.im[i]), ti = pt * (ar * tf.tw.im[i] + ai * tf.tw.re[i]);
    woof.re[i] = wr; woof.im[i] = wi; mid.re[i] = mr; mid.im[i] = mi; tw.re[i] = tr; tw.im[i] = ti;
    sum.re[i] = wr + mr + tr; sum.im[i] = wi + mi + ti;
    // amplifier channel 2 drives both passive branches in parallel
    const z1r = m.Zin.re[i], z1i = m.Zin.im[i], z2r = t.Zin.re[i], z2i = t.Zin.im[i];
    const d1 = z1r * z1r + z1i * z1i, d2 = z2r * z2r + z2i * z2i;
    const yr = z1r / d1 + z2r / d2, yi = -z1i / d1 - z2i / d2, dy = yr * yr + yi * yi;
    Zamp2.re[i] = yr / dy; Zamp2.im[i] = -yi / dy;
  }
  return { woof, mid, tw, sum, Zamp2, HL, HH, Tm: m.T, Tt: t.T };
}

// ---------------------------------------------------------------- judging
/** 1/6-octave moving average (for judging, not display) of a dB curve on the grid. */
export function smooth(p: Prepared, y: Float64Array): Float64Array {
  // Running sums over the usable samples only, so one bad point cannot poison every later window:
  // a zero response (-Inf dB) counts as the floor, NaN and +Inf are skipped.
  const N = y.length, cs = new Float64Array(N + 1), cn = new Int32Array(N + 1), w = p._e.win, out = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const v = y[i] === -Infinity ? SMOOTH_FLOOR_DB : y[i], ok = Number.isFinite(v);
    cs[i + 1] = cs[i] + (ok ? Math.max(SMOOTH_FLOOR_DB, v) : 0);
    cn[i + 1] = cn[i] + (ok ? 1 : 0);
  }
  for (let i = 0; i < N; i++) {
    const a = w[2 * i], b = w[2 * i + 1], n = cn[b + 1] - cn[a];
    out[i] = n ? (cs[b + 1] - cs[a]) / n : NaN;
  }
  return out;
}
/** Lowest level the judging smoother uses (dB): a response of exactly zero sits here, not at -Infinity. */
const SMOOTH_FLOOR_DB = -300;

export function median(v: ArrayLike<number>): number {
  const s = Array.from(v).sort((a, b) => a - b), n = s.length;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

/** Acoustic crossover between units a and b: where their smoothed levels cross inside [lo, hi],
 *  nearest the geometric centre. null if they never cross there. */
export function crossing(p: Prepared, out: Results["angles"][string], lo: number, hi: number, a: UnitId, b: UnitId): number | null {
  const f = p.f, sa = smooth(p, dbArray(out[a])), sb = smooth(p, dbArray(out[b]));
  const k: number[] = [];
  for (let i = 0; i < f.length; i++) if (f[i] >= lo && f[i] <= hi) k.push(i);
  const xs = k.slice(0, -1).filter(i => Math.sign(sa[i] - sb[i]) !== Math.sign(sa[i + 1] - sb[i + 1]));
  if (!xs.length) return null;
  const c = Math.sqrt(lo * hi);
  return f[xs.reduce((best, i) => Math.abs(Math.log(f[i] / c)) < Math.abs(Math.log(f[best] / c)) ? i : best, xs[0])];
}

/** The metric windows for the two crossovers: the design limits widened (wm 250-600 -> 150-900 Hz). */
export function crossoverWindows(profile: Profile): { wm: [number, number]; mt: [number, number] } {
  const L = profile.limits;
  return { wm: [L.wm[0] * 0.6, L.wm[1] * 1.5], mt: [L.mt[0] * 0.6, L.mt[1] * 1.5] };
}

function levelStats(p: Prepared, sum: CArray) {
  const ys = smooth(p, dbArray(sum)), y = p._e.K.map(i => ys[i]);
  const mean = y.reduce((a, b) => a + b, 0) / y.length;
  return { spread: Math.max(...y) - Math.min(...y), rms: Math.sqrt(y.reduce((a, v) => a + (v - mean) ** 2, 0) / y.length), level: median(y) };
}

/** The off-axis angle the metrics, checks and score judge: 30° when measured, else the first off-axis one. */
export function offAxisAngle(angles: readonly string[]): string | undefined {
  return angles.includes("30") ? "30" : angles.find(a => a !== "0");
}

export function metrics(p: Prepared, angles: Results["angles"]): Metrics {
  const on = angles["0"], W = crossoverWindows(p.profile);
  let zmin = Infinity;
  for (let i = 0; i < p.f.length; i++) if (p.f[i] > 200 && p.f[i] < 15000) zmin = Math.min(zmin, cabsAt(on.Zamp2, i));
  const off = offAxisAngle(Object.keys(angles));
  return {
    on: levelStats(p, on.sum),
    off30: off ? levelStats(p, angles[off].sum) : undefined,
    offAngle: off,
    x_wm: crossing(p, on, W.wm[0], W.wm[1], "woof", "mid"),
    x_mt: crossing(p, on, W.mt[0], W.mt[1], "mid", "tw"),
    Zamp2_min: zmin,
  };
}

const fmtHz = (x: number) => x >= 1000 ? `${(x / 1000).toFixed(2)} kHz` : `${x.toFixed(0)} Hz`;

/** Spread (max - min, dB) of the 1/6-octave smoothed sum over 150 Hz-10 kHz: the off-axis judging band
 *  (above 10 kHz every tweeter beams), shared by the Check panel and the verdict. */
export function offAxisSpread(p: Prepared, out: Results["angles"][string]): number {
  const ys = smooth(p, dbArray(out.sum));
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < p.f.length; i++) if (p.f[i] >= 150 && p.f[i] <= 10000) { lo = Math.min(lo, ys[i]); hi = Math.max(hi, ys[i]); }
  return hi - lo;
}

/** The design rules as pass/warn/fail items for the Check panel. Ids are stable (UI keys). The
 *  thresholds are the ones the verdict (assess.ts) uses, so the two never disagree on a state.
 *  `offSpread` is offAxisSpread() of the judged off-axis angle (falls back to m.off30.spread). */
export function checks(p: Prepared, on: Results["angles"][string], m: Metrics, lf: { f3: number; ripple: number }, offSpread?: number): Check[] {
  const f = p.f, L = p.profile.limits;
  const twAtFs = dbAt(on.tw, p._e.iFs) - m.on.level;
  let worst = 0;
  for (let k = 0; k < f.length; k++) if (f[k] >= 150 && f[k] <= 15000) {
    const pw = 10 * Math.log10(UNIT_IDS.reduce((a, u) => a + on[u].re[k] ** 2 + on[u].im[k] ** 2, 0));
    worst = Math.min(worst, dbAt(on.sum, k) - pw);
  }
  const inR = (x: number | null, [a, b]: [number, number]) => x !== null && x >= a && x <= b;
  const out: Check[] = [
    { id: "flat", state: m.on.spread <= 4 ? "good" : m.on.spread <= 6 ? "warn" : "bad", title: "Flat on axis",
      detail: `150 Hz–15 kHz within ${m.on.spread.toFixed(1)} dB (aim ±2 dB, 1/6 octave)` },
  ];
  const off = m.off30;
  if (off) {
    const sp = offSpread ?? off.spread;
    out.push({ id: "off", state: sp <= 6 ? "good" : sp <= 9 ? "warn" : "bad", title: "Even off axis", detail: `${m.offAngle ?? "30"}° within ${sp.toFixed(1)} dB to 10 kHz` });
  }
  out.push(
    { id: "xwm", state: inR(m.x_wm, L.wm) ? "good" : "warn", title: "Woofer/mid crossover placed",
      detail: m.x_wm ? `${fmtHz(m.x_wm)} (aim ${L.wm[0]}–${L.wm[1]} Hz)` : "the two never cross" },
    { id: "xmt", state: inR(m.x_mt, L.mt) ? "good" : "warn", title: "Mid/tweeter crossover placed",
      detail: m.x_mt ? `${fmtHz(m.x_mt)} (aim ${L.mt[0] / 1000}–${L.mt[1] / 1000} kHz)` : "the two never cross" },
    { id: "twfs", state: twAtFs <= -12 ? "good" : twAtFs <= -8 ? "warn" : "bad", title: "Tweeter protected",
      detail: `${twAtFs.toFixed(1)} dB at its ${fmtHz(L.tw_fs_hz)} resonance (aim ≤ −12 dB)` },
    { id: "canc", state: worst >= -1 ? "good" : worst >= -3 ? "warn" : "bad", title: "No cancellation",
      detail: `sum never more than ${(-worst).toFixed(1)} dB below the power sum` },
    { id: "load", state: m.Zamp2_min >= 4 ? "good" : m.Zamp2_min >= 3 ? "warn" : "bad", title: "Safe amplifier load",
      detail: `ch. 2 never below ${m.Zamp2_min.toFixed(2)} Ω` },
    { id: "bass", state: lf.ripple <= 1.5 ? "good" : lf.ripple <= 3 ? "warn" : "bad", title: "Smooth bass",
      detail: `f3 ${lf.f3.toFixed(1)} Hz, ripple ${lf.ripple >= 0 ? "+" : ""}${lf.ripple.toFixed(1)} dB` },
  );
  return out;
}

/** Grid for the bass summary (f3, ripple), 10-400 Hz. */
const BASS_GRID = logspace(10, 400, 300);

export function compute(p: Prepared, design: Design): Results {
  const cfg = boxConfig(p.fit, design.box, p.profile.woofer_box.vents.length), ratio = boxRatio(p, cfg);
  const angles: Results["angles"] = {};
  for (const a of p.angles) angles[a] = evaluate(p, design, a, ratio);
  const m = metrics(p, angles);
  const lf = f3Ripple(BASS_GRID, boxSystem(p.fit, p.fit.drv, configElements(p.fit, cfg), BASS_GRID).p1m);
  const offSpread = m.offAngle ? offAxisSpread(p, angles[m.offAngle]) : undefined;
  return {
    f: p.f, angles, metrics: m, checks: checks(p, angles["0"], m, lf, offSpread),
    box: { MAP: cfg.MAP, fill: cfg.fill, label: cfg.label, fB: tuningHz(p.fit, cfg.MAP, cfg.fill), f3: lf.f3, ripple: lf.ripple },
  };
}

// ---------------------------------------------------------------- display helpers
/** Phase for display (rad, wrapped): the measured phase with the propagation delay over the profile's
 *  reference distance removed (Matlab2LTspice convention, c = 345 m/s). */
export function displayPhase(p: Prepared, z: CArray, i: number): number {
  const d = p.profile.conditions.phase_ref_distance_m;
  const ph = Math.atan2(z.im[i], z.re[i]) + 2 * Math.PI * p.f[i] * d / 345;
  return Math.atan2(Math.sin(ph), Math.cos(ph));
}

export interface ProbeUnit {
  /** dB re 1 Pa/V at the measurement distance. */
  levelDb: number;
  /** dB relative to the system's on-axis level (median of the smoothed sum, 150 Hz-15 kHz). */
  relDb: number;
  /** Display phase (rad), see displayPhase. */
  phaseRad: number;
  /** Cone excursion relative to its largest value on the grid (|p| / f^2, 0..1), for the 3D view. */
  excursionRel: number;
  /** Vent volume velocity relative to the cone's (|U_P / U_D|) at the requested frequency itself
   *  (the box model is not limited to the measured grid); 0 for units without a vent. */
  ventRel: number;
}

export interface ProbeSample {
  /** Grid frequency used (Hz) and its index. */
  f: number;
  i: number;
  angle: string;
  units: Record<UnitId | "sum", ProbeUnit>;
}

/** Everything the probe readout and the 3D view need at one frequency (nearest grid point). */
export function probeSample(p: Prepared, results: Results, fHz: number, angle = "0"): ProbeSample {
  const i = nearestIndex(p.f, fHz), out = results.angles[angle] ?? results.angles["0"];
  const ref = (angle !== "0" && angle === results.metrics.offAngle ? results.metrics.off30?.level : undefined) ?? results.metrics.on.level;
  let ventRel = 0;
  if (results.box.MAP) {
    const fit = p.fit, bx = ventedElements(fit, results.box.MAP, results.box.fill);
    const r = boxSystem(fit, fit.drv, bx, [fHz]);       // the box model is valid below the TF grid too
    ventRel = cabsAt(r.UP, 0) / cabsAt(r.UD, 0);
  }
  const unit = (z: CArray, vent: number): ProbeUnit => {
    let xmax = 0;
    for (let k = 0; k < p.f.length; k++) xmax = Math.max(xmax, cabsAt(z, k) / p.f[k] ** 2);
    const level = dbAt(z, i);
    return { levelDb: level, relDb: level - ref, phaseRad: displayPhase(p, z, i),
             excursionRel: xmax > 0 ? cabsAt(z, i) / p.f[i] ** 2 / xmax : 0, ventRel: vent };
  };
  return {
    f: p.f[i], i, angle: results.angles[angle] ? angle : "0",
    units: { woof: unit(out.woof, ventRel), mid: unit(out.mid, 0), tw: unit(out.tw, 0), sum: unit(out.sum, 0) },
  };
}

export interface NodeVoltages {
  f: number;
  /** All magnitudes are V per 1 V at the MiniDSP input. */
  vin: number;
  /** Low-pass output before / after the woofer gain (amplifier channel 1 input). */
  lpOut: number;
  woofDrive: number;
  /** High-pass output (amplifier channel 2, feeding both passive branches). */
  hpOut: number;
  midTerminals: number;
  twTerminals: number;
  /** Voltage after every series element of each branch, keyed by part id ("mid.L1", "tw.pad.Rs"). */
  nodes: Record<string, number>;
  /** Current drawn from channel 2 by each branch (A per 1 V input). */
  current: { mid: number; tw: number };
}

/** Node voltage magnitudes at one frequency (nearest grid point) for the schematic view. */
export function nodeVoltages(p: Prepared, design: Design, fHz: number): NodeVoltages {
  const i = nearestIndex(p.f, fHz), f = p.f[i], dg = design.digital;
  const HL = digitalResponse(p, dg.fc, "LPF", dg.align), HH = digitalResponse(p, dg.fc, "HPF", dg.align);
  const lp = cabsAt(HL, i), hp = cabsAt(HH, i);
  const nodes: Record<string, number> = {};
  const branch = (u: "mid" | "tw") => {
    const zl: [number, number] = [p.zi[u].re[i], p.zi[u].im[i]];
    const ns = ladderNodes(f, passiveParts(design[u], u), zl, design.Rdcr || 0);
    for (const n of ns.slice(1)) nodes[n.after] = hp * Math.hypot(n.v[0], n.v[1]);
    const last = ns[ns.length - 1].v, zin = branchResponse(p, design, u).Zin;
    return { terminals: hp * Math.hypot(last[0], last[1]), current: hp / cabsAt(zin, i) };
  };
  const m = branch("mid"), t = branch("tw");
  return { f, vin: 1, lpOut: lp, woofDrive: lp * 10 ** (dg.g_woof_dB / 20), hpOut: hp,
           midTerminals: m.terminals, twTerminals: t.terminals, nodes, current: { mid: m.current, tw: t.current } };
}

// ---------------------------------------------------------------- box views
/** Drive level for the box view: 2.83 V rms (1 W into 8 ohm). */
export const V_REF = 2.83;

export interface BoxCurveSet {
  label: string;
  MAP: number | null;
  fB: number | null;
  /** Complex far-field pressure at 1 m, half space, for 2.83 V rms (Pa rms). */
  spl: CArray;
  /** 20 log10(|p| / 20 uPa), dB SPL. */
  spl_dB: Float64Array;
  /** Peak cone excursion for 2.83 V rms (mm). */
  excursion_mm: Float64Array;
  /** Peak air speed in the (fastest) vent for 2.83 V rms (m/s); zeros when closed. */
  ventSpeed_ms: Float64Array;
  /** Electrical input impedance (ohm). */
  ZE: CArray;
}

export interface BoxCurves extends BoxCurveSet {
  /** 5-400 Hz, log spaced. */
  f: number[];
  /** The same quantities with the vents plugged (the measured woofer TF's condition). */
  plugged: BoxCurveSet;
}

const BOX_GRID = logspace(5, 400, 400);

function curveSet(fit: BoxFit, cfg: BoxConfig, f: number[]): BoxCurveSet {
  const r = boxSystem(fit, fit.drv, configElements(fit, cfg), f), n = f.length;
  const spl = carray(n), db = new Float64Array(n), x = new Float64Array(n), v = new Float64Array(n);
  const ventArea = Math.PI * cfg.ap ** 2, vk = cfg.ventSpeedFactor ?? 1;
  for (let i = 0; i < n; i++) {
    spl.re[i] = r.p1m.re[i] * V_REF; spl.im[i] = r.p1m.im[i] * V_REF;
    db[i] = 20 * Math.log10(cabsAt(spl, i) / 20e-6);
    x[i] = cabsAt(r.UD, i) / (2 * Math.PI * f[i] * fit.SD) * V_REF * Math.SQRT2 * 1e3;
    v[i] = cfg.MAP ? cabsAt(r.UP, i) / ventArea * vk * V_REF * Math.SQRT2 : 0;
  }
  return { label: cfg.label, MAP: cfg.MAP, fB: tuningHz(fit, cfg.MAP, cfg.fill), spl, spl_dB: db, excursion_mm: x, ventSpeed_ms: v, ZE: r.ZE };
}

/** The box model of the design's box setting (and plugged) for the box view, 5-400 Hz. */
export function boxModelCurves(p: Prepared, design: Design): BoxCurves {
  const cfg = boxConfig(p.fit, design.box, p.profile.woofer_box.vents.length);
  const plugged = curveSet(p.fit, { MAP: null, fill: cfg.fill, label: "vents plugged (closed box)", ap: p.fit.AP }, BOX_GRID);
  return { f: BOX_GRID, ...curveSet(p.fit, cfg, BOX_GRID), plugged };
}

/** Woofer-box model on any frequency grid (1 V drive). */
export function boxResponse(p: Prepared, design: Design, freqs: number[]): BoxSystemResult {
  return boxSystem(p.fit, p.fit.drv, configElements(p.fit, boxConfig(p.fit, design.box, p.profile.woofer_box.vents.length)), freqs);
}

export interface ValidationCurve {
  f: Float64Array;
  meas: CArray;
  model: CArray;
}

export interface BoxValidation {
  label: string;
  vents: { id: string; length_m: number }[];
  MAP: number;
  fB: number;
  /** Impedance (ohm). */
  Z: ValidationCurve;
  /** Near field at the cone / vent centre (Pa/V), predicted, not fitted. */
  nfCone?: ValidationCurve;
  nfVent?: ValidationCurve;
}

/** Model vs measurement for every measured vented configuration (on each measurement's own grid). */
export function boxValidation(p: Prepared): BoxValidation[] {
  const fit = p.fit, ex = (fit as Partial<BoxFitEx>).ventFits;
  const configs = p.profile.measurements.woofer.vented.filter(m => m.vents.length > 0 && m.z && m.z.f.length > 0);
  return configs.map((m, j) => {
    const fitted = ex?.[j];
    const MAP = fitted?.MAP ?? mapAt(fit, m.vents[0].length_m), ap = fitted?.ap ?? fit.AP;
    const bx = ventedElements(fit, MAP, 1, ap);
    const curve = (s: Series, pick: (r: BoxSystemResult) => CArray): ValidationCurve =>
      ({ f: Float64Array.from(s.f), meas: fromSeries(s), model: pick(boxSystem(fit, fit.drv, bx, s.f)) });
    return {
      label: fitted?.label ?? m.vents.map(v => `${v.id} ${(v.length_m * 1e3).toFixed(0)} mm`).join(" + "),
      vents: m.vents, MAP, fB: tuningHz(fit, MAP)!,
      Z: curve(m.z, r => r.ZE),
      nfCone: m.nf_cone ? curve(m.nf_cone, r => r.nfCone) : undefined,
      nfVent: m.nf_vent ? curve(m.nf_vent, r => r.nfVent) : undefined,
    };
  });
}

/** Model vs measurement of the driver fit: free air and the plugged (closed) box. */
export function driverValidation(p: Prepared): { free?: ValidationCurve; closed?: ValidationCurve } {
  const fit = p.fit, W = p.profile.measurements.woofer;
  const curve = (s: Series, bx: ReturnType<typeof boxElements> | null): ValidationCurve =>
    ({ f: Float64Array.from(s.f), meas: fromSeries(s), model: boxSystem(fit, fit.drv, bx, s.f).ZE });
  return {
    free: W.free ? curve(W.free, null) : undefined,
    closed: W.closed ? curve(W.closed, boxElements(fit, { RAB: fit.RAB })) : undefined,
  };
}
