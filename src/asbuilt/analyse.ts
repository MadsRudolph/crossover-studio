// As built: the measured finished system (Task 3) against the exact prediction of the design.
//
// The guide measures the finished speaker with the vents covered, so the prediction is the design with
// the box plugged (or the design's own box when the vents were open). Both curves are compared on the
// engine grid, 1/6-octave smoothed in dB, after removing one level offset (mic distance, amplifier gain):
//   g   = median over 200 Hz-10 kHz of (S_meas - S_pred), taken around the densest level (levelOffset)
//   RMS = sqrt(mean((S_meas - S_pred - g)^2)) over 150 Hz-15 kHz
// The phase difference is shown after removing a delay fitted to the unwrapped phase over 1-8 kHz.
// Pure functions, no React: everything here is unit-tested in analyse.test.ts.

import type { AngleResult, CArray, Design, Results, Series, UnitId } from "../types";
import { compute, interpLogF, smooth, type Prepared } from "../engine";

export type TraceKey = UnitId | "sum";

/** Everything imported for one profile: the system response per angle and, optionally, single units on axis. */
export interface AsBuiltData {
  /** Measured p/V of the finished system, keyed by angle ("0", "30"). */
  sum: Record<string, Series>;
  /** Optional single-unit measurements on axis (the others disconnected). */
  units: Partial<Record<UnitId, Series>>;
}

export const emptyData = (): AsBuiltData => ({ sum: {}, units: {} });
export const hasData = (d: AsBuiltData): boolean => Object.keys(d.sum).length > 0 || Object.keys(d.units).length > 0;

/** One measured curve and the predicted curve it is compared with. */
export interface Target { key: string; angle: string; trace: TraceKey; meas: Series }

/** Judging bands (Hz). */
export const RMS_BAND: [number, number] = [150, 15000];
export const OFFSET_BAND: [number, number] = [200, 10000];
export const DELAY_BAND: [number, number] = [1000, 8000];
/** Phase is compared only where both curves are within this many dB of their maximum. */
export const PHASE_WINDOW_DB = 30;
/** Verdict thresholds on the RMS deviation (dB). */
export const MATCH_GOOD_DB = 1.5;
export const MATCH_CLOSE_DB = 3;

export function targetsOf(data: AsBuiltData, angles: readonly string[]): Target[] {
  const out: Target[] = [];
  for (const a of Object.keys(data.sum).sort((x, y) => +x - +y))
    if (angles.includes(a)) out.push({ key: `sum@${a}`, angle: a, trace: "sum", meas: data.sum[a] });
  for (const u of ["woof", "mid", "tw"] as const)
    if (data.units[u] && angles.includes("0")) out.push({ key: `${u}@0`, angle: "0", trace: u, meas: data.units[u]! });
  return out;
}

/** The design as it should measure in Task 3: vents covered unless they were left open. */
export function predictedDesign(design: Design, ventsOpen: boolean): Design {
  return ventsOpen ? design : { ...design, box: { ...design.box, mode: "plugged" } };
}

// ---------------------------------------------------------------- the measurement on the grid
/** A measurement brought onto the engine grid once (independent of the design). */
export interface MeasOnGrid {
  target: Target;
  /** Complex value on the grid (garbage outside `cover`). */
  c: CArray;
  /** 1 where the measurement covers the grid point. */
  cover: Uint8Array;
  /** 1/6-octave smoothed dB, NaN outside the coverage. */
  sdb: Float64Array;
  /** Grid indices in the RMS and offset bands that the measurement covers. */
  kRms: number[];
  kOff: number[];
}

/** The measurement without non-positive or non-finite points, sorted by frequency, duplicates dropped. */
export function cleanSeries(s: Series): Series {
  const idx: number[] = [];
  for (let i = 0; i < s.f.length; i++)
    if (s.f[i] > 0 && Number.isFinite(s.f[i]) && Number.isFinite(s.re[i]) && Number.isFinite(s.im[i])) idx.push(i);
  idx.sort((a, b) => s.f[a] - s.f[b]);
  const keep = idx.filter((i, k) => k === 0 || s.f[i] > s.f[idx[k - 1]]);
  return { ...s, f: keep.map(i => s.f[i]), re: keep.map(i => s.re[i]), im: keep.map(i => s.im[i]) };
}

function dbOf(z: CArray, i: number): number {
  const v = 20 * Math.log10(Math.hypot(z.re[i], z.im[i]));
  return v === -Infinity ? -300 : v;
}

export function measOnGrid(p: Prepared, target: Target): MeasOnGrid {
  const s = cleanSeries(target.meas), f = p.f, N = f.length;
  if (s.f.length < 2) throw new Error(`${target.meas.source?.file ?? "the measurement"} has fewer than two usable points`);
  const lo = s.f[0], hi = s.f[s.f.length - 1];
  const c = interpLogF(s, f), cover = new Uint8Array(N), y = new Float64Array(N);
  // a tiny tolerance so a grid point that equals the measurement's last frequency still counts
  for (let i = 0; i < N; i++) {
    cover[i] = f[i] >= lo * (1 - 1e-9) && f[i] <= hi * (1 + 1e-9) ? 1 : 0;
    y[i] = cover[i] ? dbOf(c, i) : NaN;
  }
  const sdb = smooth(p, y);
  for (let i = 0; i < N; i++) if (!cover[i]) sdb[i] = NaN;
  const band = ([a, b]: [number, number]) => { const k: number[] = []; for (let i = 0; i < N; i++) if (cover[i] && f[i] >= a && f[i] <= b) k.push(i); return k; };
  return { target, c, cover, sdb, kRms: band(RMS_BAND), kOff: band(OFFSET_BAND) };
}

/** The predicted complex curve a target compares with. */
export function predictedCurve(r: Results, t: Target): CArray {
  const out: AngleResult | undefined = r.angles[t.angle];
  if (!out) throw new Error(`no prediction at ${t.angle}°`);
  return out[t.trace];
}

export function smoothedDb(p: Prepared, z: CArray): Float64Array {
  const y = new Float64Array(z.re.length);
  for (let i = 0; i < y.length; i++) y[i] = dbOf(z, i);
  return smooth(p, y);
}

export function median(v: number[]): number {
  if (!v.length) return 0;
  const s = [...v].sort((a, b) => a - b), n = s.length;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

// ---------------------------------------------------------------- scoring
export interface Fit {
  /** Level offset measured - predicted (dB), removed before every comparison. */
  offset: number;
  /** RMS of the aligned smoothed deviation over 150 Hz-15 kHz (dB), all targets together. */
  rms: number;
  /** Points that went into the RMS. */
  n: number;
}

/** The level offset of a set of deviations (dB): the median of the points near the densest level.
 *  A plain median would be dragged by a fault that bends a large part of the curve (an inverted tweeter
 *  moves most of 1-10 kHz); the points that agree with each other mark the real offset. The densest
 *  0.5 dB window is found first, then the median is taken over everything within 1 dB of it. */
export function levelOffset(dev: number[]): number {
  if (!dev.length) return 0;
  const s = [...dev].sort((a, b) => a - b), n = s.length;
  let best = 0, bestCount = 0;
  for (let i = 0, j = 0; i < n; i++) {
    while (j < n && s[j] - s[i] <= MODE_WINDOW_DB) j++;
    if (j - i > bestCount) { bestCount = j - i; best = i; }
  }
  const mode = median(s.slice(best, best + bestCount));
  return median(s.filter(x => Math.abs(x - mode) <= MODE_KEEP_DB));
}
const MODE_WINDOW_DB = 0.5;
const MODE_KEEP_DB = 1;

/** Joint offset and RMS of a set of measurements against one prediction (one offset for all: the same
 *  microphone and amplifier). `preds` are the smoothed predicted dB curves, one per measurement, smoothed
 *  over the measurement's coverage (predictedDb). */
export function fitLevel(ms: MeasOnGrid[], preds: Float64Array[]): Fit {
  const devOff: number[] = [];
  ms.forEach((m, j) => { for (const i of m.kOff) { const d = m.sdb[i] - preds[j][i]; if (Number.isFinite(d)) devOff.push(d); } });
  // a measurement that misses the offset band entirely still gets an offset from the band it has
  if (!devOff.length) ms.forEach((m, j) => { for (const i of m.kRms) { const d = m.sdb[i] - preds[j][i]; if (Number.isFinite(d)) devOff.push(d); } });
  const offset = levelOffset(devOff);
  let s = 0, n = 0;
  ms.forEach((m, j) => { for (const i of m.kRms) { const d = m.sdb[i] - preds[j][i] - offset; if (Number.isFinite(d)) { s += d * d; n++; } } });
  return { offset, rms: n ? Math.sqrt(s / n) : NaN, n };
}

/** The predicted curve of a measurement, smoothed exactly like the measurement: over the grid points the
 *  measurement covers only, so the two agree at the edges of a partial measurement. */
export function predictedDb(p: Prepared, m: MeasOnGrid, z: CArray): Float64Array {
  const y = new Float64Array(z.re.length);
  for (let i = 0; i < y.length; i++) y[i] = m.cover[i] ? dbOf(z, i) : NaN;
  const s = smooth(p, y);
  for (let i = 0; i < y.length; i++) if (!m.cover[i]) s[i] = NaN;
  return s;
}

/** Score a prediction (the results of compute()) against the measurements. */
export function scoreResults(p: Prepared, ms: MeasOnGrid[], r: Results): Fit {
  return fitLevel(ms, ms.map(m => predictedDb(p, m, predictedCurve(r, m.target))));
}

// ---------------------------------------------------------------- per-trace detail for the plots
export interface TraceDetail {
  target: Target;
  /** Smoothed dB, measured with the offset removed, and predicted. NaN where not covered. */
  meas: Float64Array;
  pred: Float64Array;
  /** meas - pred (dB, offset removed). */
  dev: Float64Array;
  /** Phase difference measured - predicted after the fitted delay (degrees), NaN where not valid. */
  phase: Float64Array;
  /** Fitted delay of the measurement relative to the prediction (s); null when it could not be fitted. */
  delay: number | null;
  rms: number;
  /** Largest |deviation| in 150 Hz-15 kHz: frequency (Hz) and signed value (dB). */
  worst: { f: number; dB: number } | null;
}

const wrapPi = (x: number) => Math.atan2(Math.sin(x), Math.cos(x));

/** Least-squares delay (s) of meas relative to pred: the slope of the unwrapped phase difference over
 *  1-8 kHz against 2 pi f, sign flipped (a later arrival has a falling phase). */
export function fitDelay(f: ArrayLike<number>, meas: CArray, pred: CArray, ok: (i: number) => boolean): number | null {
  const xs: number[] = [], ys: number[] = [];
  let prev = NaN, acc = 0;
  for (let i = 0; i < f.length; i++) {
    if (f[i] < DELAY_BAND[0] || f[i] > DELAY_BAND[1] || !ok(i)) continue;
    // angle of meas x conj(pred)
    const re = meas.re[i] * pred.re[i] + meas.im[i] * pred.im[i], im = meas.im[i] * pred.re[i] - meas.re[i] * pred.im[i];
    const ph = Math.atan2(im, re);
    if (!Number.isFinite(ph)) continue;
    if (Number.isFinite(prev)) acc += wrapPi(ph - prev);
    else acc = ph;
    prev = ph;
    xs.push(2 * Math.PI * f[i]); ys.push(acc);
  }
  if (xs.length < 3) return null;
  const n = xs.length, mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0;
  for (let k = 0; k < n; k++) { sxy += (xs[k] - mx) * (ys[k] - my); sxx += (xs[k] - mx) ** 2; }
  return sxx > 0 ? -sxy / sxx : null;
}

function maxDb(z: CArray, ok: (i: number) => boolean): number {
  let m = -Infinity;
  for (let i = 0; i < z.re.length; i++) if (ok(i)) m = Math.max(m, dbOf(z, i));
  return m;
}

export function traceDetail(p: Prepared, m: MeasOnGrid, r: Results, offset: number): TraceDetail {
  const f = p.f, N = f.length, pc = predictedCurve(r, m.target), pred = smoothedDb(p, pc), predC = predictedDb(p, m, pc);
  const meas = new Float64Array(N), dev = new Float64Array(N), phase = new Float64Array(N).fill(NaN);
  // the prediction is drawn over the whole grid, compared only where the measurement covers it
  for (let i = 0; i < N; i++) {
    meas[i] = m.cover[i] ? m.sdb[i] - offset : NaN;
    dev[i] = m.cover[i] ? meas[i] - predC[i] : NaN;
  }
  const covered = (i: number) => m.cover[i] === 1;
  const topM = maxDb(m.c, covered), topP = maxDb(pc, covered);
  const valid = (i: number) => covered(i) && dbOf(m.c, i) >= topM - PHASE_WINDOW_DB && dbOf(pc, i) >= topP - PHASE_WINDOW_DB;
  const delay = fitDelay(f, m.c, pc, valid);
  for (let i = 0; i < N; i++) {
    if (!valid(i)) continue;
    const re = m.c.re[i] * pc.re[i] + m.c.im[i] * pc.im[i], im = m.c.im[i] * pc.re[i] - m.c.re[i] * pc.im[i];
    phase[i] = wrapPi(Math.atan2(im, re) + 2 * Math.PI * f[i] * (delay ?? 0)) * 180 / Math.PI;
  }
  let s = 0, n = 0, worst: TraceDetail["worst"] = null;
  for (const i of m.kRms) {
    const d = dev[i];
    if (!Number.isFinite(d)) continue;
    s += d * d; n++;
    if (!worst || Math.abs(d) > Math.abs(worst.dB)) worst = { f: f[i], dB: d };
  }
  return { target: m.target, meas, pred, dev, phase, delay, rms: n ? Math.sqrt(s / n) : NaN, worst };
}

// ---------------------------------------------------------------- the whole comparison
export interface Comparison {
  design: Design;
  results: Results;
  ms: MeasOnGrid[];
  fit: Fit;
  traces: TraceDetail[];
}

/** Compare every imported measurement with the prediction of `design` (vents plugged unless open). */
export function compare(p: Prepared, design: Design, data: AsBuiltData, ventsOpen = false): Comparison | null {
  const targets = targetsOf(data, p.angles);
  if (!targets.length) return null;
  const d = predictedDesign(design, ventsOpen), results = compute(p, d);
  const ms = targets.map(t => measOnGrid(p, t));
  const fit = scoreResults(p, ms, results);
  return { design: d, results, ms, fit, traces: ms.map(m => traceDetail(p, m, results, fit.offset)) };
}

export type MatchState = "good" | "warn" | "bad";
export function matchVerdict(rms: number): { state: MatchState; label: string } {
  if (!(rms <= MATCH_CLOSE_DB)) return { state: "bad", label: "Investigate" };
  return rms <= MATCH_GOOD_DB ? { state: "good", label: "Matches the model" } : { state: "warn", label: "Close" };
}

/** One plain sentence on the level offset. */
export function offsetSentence(offset: number): string {
  const a = Math.abs(offset);
  if (a < 0.5) return "The measurement has the predicted level.";
  return `The measurement is ${a.toFixed(1)} dB ${offset > 0 ? "louder" : "quieter"} than predicted: microphone distance or amplifier gain. It is removed before every comparison.`;
}
