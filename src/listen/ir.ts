// Impulse responses for listening to a design: the measured-and-filtered complex response of each unit
// (Results.angles[a].woof/mid/tw, 50 Hz-19.7 kHz on the profile grid) turned into a 16384-tap FIR at
// 48 kHz that a ConvolverNode plays.
//
// Pipeline (one tau and one level for all units, so their relative timing and level stay real):
//   1. tau: the bulk delay of the SUM, fitted to its unwrapped phase over 1-8 kHz (phi = phi0 - 2 pi f tau),
//      and removed from every unit (the 2.44 m flight time would otherwise be 7 ms of silence).
//   2. Each unit on the linear FFT grid: magnitude in dB and unwrapped phase, each linear in log f.
//      Below the first grid point the woofer follows the box model (scaled to meet the data at 50 Hz),
//      mid and tweeter fall at 12 dB/octave with the phase held; above the last point the level fades to 0
//      at 22 kHz with a raised cosine. DC and Nyquist are 0.
//   3. Inverse real FFT, circular shift by N/8 (room for pre-ringing), half-Hann fade over the last 25 %.
//   4. One scale for all: the full sum has median magnitude 0 dB over 300 Hz-3 kHz.
// The sum IR is the weighted sum of the unit IRs (linearity): weights 1, 0 (muted) or -1 (inverted).
// Pure maths, no DOM: unit-tested in ir.test.ts.

import type { CArray, Design, Results, UnitId } from "../types";
import { UNIT_IDS } from "../types";
import { boxResponse, type Prepared } from "../engine";
import { dtft, irfft, isPow2, rfft } from "./fft";

export const IR_FS = 48000;
export const IR_N = 16384;
/** Where the main impulse sits in the IR (samples): N/8 leaves room for the linear-phase pre-ringing. */
export const preDelay = (n: number) => n >> 3;
/** The top fade reaches zero here (Hz). */
export const FADE_END_HZ = 22000;

export type UnitWeights = Record<UnitId, number>;
export const ALL_ON: UnitWeights = { woof: 1, mid: 1, tw: 1 };

/** Woofer shape below the measured grid: complex response at the given frequencies (any scale). */
export type LowShape = (freqs: number[]) => CArray;

export interface IrSet {
  fs: number;
  n: number;
  /** Position of the main impulse (samples). */
  delay: number;
  /** Bulk delay removed from every unit (s). */
  tau: number;
  /** Linear factor applied to every unit so the full sum sits at 0 dB (median, 300 Hz-3 kHz). */
  scale: number;
  /** -20 log10(scale): add it to an IR spectrum in dB to get back to the design's own level (dB). */
  offsetDb: number;
  units: Record<UnitId, Float64Array>;
}

// ---------------------------------------------------------------- phase helpers
/** Unwrapped copy of a phase sequence (rad): steps over pi become steps under pi. */
export function unwrap(ph: ArrayLike<number>): Float64Array {
  const out = new Float64Array(ph.length);
  let off = 0;
  for (let i = 0; i < ph.length; i++) {
    if (i > 0) {
      const d = ph[i] + off - out[i - 1];
      off -= 2 * Math.PI * Math.round(d / (2 * Math.PI));
    }
    out[i] = ph[i] + off;
  }
  return out;
}

/**
 * Bulk delay of a response: phi(f) = phi0 - 2 pi f tau fitted by least squares to the unwrapped phase
 * over [lo, hi] Hz. A coarse search for the delay that makes the band most phase-coherent comes
 * first, because a 7 ms flight time turns the phase by more than pi between two grid points at
 * 8 kHz and a plain unwrap would miss whole turns.
 */
export function estimateDelay(f: ArrayLike<number>, z: CArray, lo = 1000, hi = 8000,
                              search: [number, number] = [-0.01, 0.05]): { tau: number; phi0: number } {
  const ks: number[] = [];
  for (let i = 0; i < f.length; i++) if (f[i] >= lo && f[i] <= hi && Math.hypot(z.re[i], z.im[i]) > 0) ks.push(i);
  if (ks.length < 3) return { tau: 0, phi0: 0 };
  const ph = ks.map(i => Math.atan2(z.im[i], z.re[i])), fk = ks.map(i => f[i]);
  // 1) coarse: the tau whose removal lines the unit phasors up best (step keeps < 0.3 rad at hi)
  const step = 0.3 / (2 * Math.PI * hi);
  let best = search[0], bestC = -1;
  for (let t = search[0]; t <= search[1]; t += step) {
    let sr = 0, si = 0;
    for (let j = 0; j < ks.length; j++) { const a = ph[j] + 2 * Math.PI * fk[j] * t; sr += Math.cos(a); si += Math.sin(a); }
    const c = sr * sr + si * si;
    if (c > bestC) { bestC = c; best = t; }
  }
  // 2) fine: least squares on the residual phase, unwrapped now that it turns slowly
  const r = unwrap(ph.map((p, j) => Math.atan2(Math.sin(p + 2 * Math.PI * fk[j] * best), Math.cos(p + 2 * Math.PI * fk[j] * best))));
  const m = ks.length;
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (let j = 0; j < m; j++) { const x = -2 * Math.PI * fk[j]; sx += x; sy += r[j]; sxx += x * x; sxy += x * r[j]; }
  const b = (m * sxy - sx * sy) / (m * sxx - sx * sx), a = (sy - b * sx) / m;
  return { tau: best + b, phi0: a };
}

// ---------------------------------------------------------------- one unit, any frequency
/**
 * The continuous target of one unit (delay removed) as a function of frequency: interpolated on the
 * grid, extended below and faded above it. freqs must be ascending.
 */
export function makeTarget(f: ArrayLike<number>, h: CArray, tau: number, low?: LowShape, fs = IR_FS) {
  const n = f.length, lf = new Float64Array(n), mag = new Float64Array(n), raw = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const w = 2 * Math.PI * f[i] * tau, c = Math.cos(w), s = Math.sin(w);
    const re = h.re[i] * c - h.im[i] * s, im = h.re[i] * s + h.im[i] * c;
    lf[i] = Math.log(f[i]);
    mag[i] = 20 * Math.log10(Math.max(Math.hypot(re, im), 1e-15));
    raw[i] = Math.atan2(im, re);
  }
  const ph = unwrap(raw);
  const f0 = f[0], fTop = f[n - 1];
  const fadeStart = Math.min(fTop, 0.41 * fs), fadeEnd = Math.min(Math.max(FADE_END_HZ, fadeStart * 1.05), fs / 2);
  const fade = (x: number) => x <= fadeStart ? 1 : x >= fadeEnd ? 0 : 0.5 * (1 + Math.cos(Math.PI * (x - fadeStart) / (fadeEnd - fadeStart)));
  const atGrid = (i: number): [number, number] => { const m = 10 ** (mag[i] / 20); return [m * Math.cos(ph[i]), m * Math.sin(ph[i])]; };

  return (freqs: ArrayLike<number>): CArray => {
    const out = { re: new Float64Array(freqs.length), im: new Float64Array(freqs.length) };
    const below: number[] = [], belowIdx: number[] = [];
    let j = 0;
    for (let k = 0; k < freqs.length; k++) {
      const x = freqs[k];
      if (!(x > 0)) continue;                                             // DC = 0
      if (x < f0) { below.push(x); belowIdx.push(k); continue; }
      const xc = Math.min(x, fTop), lx = Math.log(xc);
      while (j < n - 2 && lf[j + 1] < lx) j++;
      const t = lf[j + 1] === lf[j] ? 0 : Math.min(1, Math.max(0, (lx - lf[j]) / (lf[j + 1] - lf[j])));
      const m = 10 ** ((mag[j] + t * (mag[j + 1] - mag[j])) / 20) * fade(x), p = ph[j] + t * (ph[j + 1] - ph[j]);
      out.re[k] = m * Math.cos(p); out.im[k] = m * Math.sin(p);
    }
    if (below.length) {
      const [gr, gi] = atGrid(0);
      if (low) {
        // the box model's shape, scaled (complex) so it meets the data at the first grid point
        const L = low([...below, f0]), e = below.length, lr = L.re[e], li = L.im[e], d = lr * lr + li * li;
        const cr = d ? (gr * lr + gi * li) / d : 0, ci = d ? (gi * lr - gr * li) / d : 0;
        for (let q = 0; q < e; q++) {
          out.re[belowIdx[q]] = cr * L.re[q] - ci * L.im[q];
          out.im[belowIdx[q]] = cr * L.im[q] + ci * L.re[q];
        }
      } else {
        // a second-order high-pass continuation: 12 dB/octave, phase held
        for (let q = 0; q < below.length; q++) {
          const k = (below[q] / f0) ** 2;
          out.re[belowIdx[q]] = gr * k; out.im[belowIdx[q]] = gi * k;
        }
      }
    }
    return out;
  };
}

/** Half-Hann fade over the last quarter, in place. */
function fadeTail(x: Float64Array): void {
  const n = x.length, a = Math.floor(0.75 * n), len = n - a;
  for (let i = a; i < n; i++) x[i] *= 0.5 * (1 + Math.cos(Math.PI * (i - a) / len));
}

/** The IR of one unit target (unscaled): spectrum on the FFT bins, shifted by `delay` samples. */
export function unitIr(target: (freqs: ArrayLike<number>) => CArray, fs = IR_FS, n = IR_N, delay = preDelay(n)): Float64Array {
  if (!isPow2(n)) throw new Error(`IR length ${n} is not a power of two`);
  const h = n >> 1, bins = new Float64Array(h + 1);
  for (let k = 0; k <= h; k++) bins[k] = k * fs / n;
  const H = target(bins), re = new Float64Array(h + 1), im = new Float64Array(h + 1);
  for (let k = 1; k < h; k++) {
    // e^{-j 2 pi k delay / n}: the circular shift, done in the spectrum
    const w = -2 * Math.PI * k * delay / n, c = Math.cos(w), s = Math.sin(w);
    re[k] = H.re[k] * c - H.im[k] * s; im[k] = H.re[k] * s + H.im[k] * c;
  }
  const x = irfft(re, im, n);                                              // DC and Nyquist stay 0
  fadeTail(x);
  return x;
}

/** A unit impulse at the same position as the design IRs: the flat (bypass) reference. */
export function flatIr(n = IR_N, delay = preDelay(n)): Float64Array {
  const x = new Float64Array(n);
  x[delay] = 1;
  return x;
}

export function median(v: number[]): number {
  if (!v.length) return NaN;
  const s = [...v].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export interface IrInput {
  f: ArrayLike<number>;
  units: Record<UnitId, CArray>;
  /** Woofer shape below the grid (the box model); without it the woofer falls at 12 dB/octave too. */
  wooferLow?: LowShape;
}

/** The three unit IRs of one design at one angle, with the common delay and level removed. */
export function buildIrs(input: IrInput, fs = IR_FS, n = IR_N): IrSet {
  const { f, units } = input, m = f.length, delay = preDelay(n);
  const sum = { re: new Float64Array(m), im: new Float64Array(m) };
  for (const u of UNIT_IDS) for (let i = 0; i < m; i++) { sum.re[i] += units[u].re[i]; sum.im[i] += units[u].im[i]; }
  const { tau } = estimateDelay(f, sum);
  // one scale: the full sum's median magnitude over 300 Hz-3 kHz becomes 0 dB
  const inBand: number[] = [], all: number[] = [];
  for (let i = 0; i < m; i++) {
    const a = Math.hypot(sum.re[i], sum.im[i]);
    all.push(a);
    if (f[i] >= 300 && f[i] <= 3000) inBand.push(a);
  }
  const med = median(inBand.length ? inBand : all);
  const scale = med > 0 && Number.isFinite(med) ? 1 / med : 1;
  const out = {} as Record<UnitId, Float64Array>;
  for (const u of UNIT_IDS) {
    const x = unitIr(makeTarget(f, units[u], tau, u === "woof" ? input.wooferLow : undefined, fs), fs, n, delay);
    for (let i = 0; i < n; i++) x[i] *= scale;
    out[u] = x;
  }
  return { fs, n, delay, tau, scale, offsetDb: -20 * Math.log10(scale), units: out };
}

/** The IR the listener hears: sum of the unit IRs with weights 1 (on), 0 (muted) or -1 (inverted). */
export function mixIr(set: IrSet, w: UnitWeights = ALL_ON): Float64Array {
  const x = new Float64Array(set.n);
  for (const u of UNIT_IDS) {
    const k = w[u];
    if (!k) continue;
    const y = set.units[u];
    for (let i = 0; i < x.length; i++) x[i] += k * y[i];
  }
  return x;
}

/** IRs for a design straight from the store: Results at one angle plus the box model below 50 Hz. */
export function irsFromResults(prep: Prepared | null, design: Design, results: Results, angle: string, fs = IR_FS, n = IR_N): IrSet {
  const out = results.angles[angle] ?? results.angles["0"];
  if (!out) throw new Error(`No response at ${angle}° to listen to.`);
  // the design's own box (its ratio is already in the woofer TF); the digital low-pass is ~1 down there
  const wooferLow: LowShape | undefined = prep ? freqs => boxResponse(prep, design, freqs).p1m : undefined;
  return buildIrs({ f: results.f, units: { woof: out.woof, mid: out.mid, tw: out.tw }, wooferLow }, fs, n);
}

/** Magnitude (dB) of an IR on a log-spaced grid of `points` frequencies over [lo, hi] Hz, for the plot. */
export function irMagnitude(x: ArrayLike<number>, fs = IR_FS, lo = 20, hi = 20000, points = 480): { f: Float64Array; db: Float64Array } {
  const S = rfft(x), n = x.length, f = new Float64Array(points), out = new Float64Array(points);
  for (let i = 0; i < points; i++) {
    const fr = lo * (hi / lo) ** (i / (points - 1));
    // linear interpolation of |X| between the two neighbouring bins
    const b = fr * n / fs, k = Math.min(Math.floor(b), S.re.length - 2), t = b - k;
    const a0 = Math.hypot(S.re[k], S.im[k]), a1 = Math.hypot(S.re[k + 1], S.im[k + 1]);
    f[i] = fr;
    const v = 20 * Math.log10(a0 + t * (a1 - a0));
    out[i] = Number.isFinite(v) ? v : NaN;
  }
  return { f, db: out };
}

/** The exact response of an IR at one frequency with the N/8 shift taken out (for tests and read-outs). */
export function irResponseAt(x: ArrayLike<number>, fHz: number, delay: number, fs = IR_FS): [number, number] {
  const [r, i] = dtft(x, fHz, fs), w = 2 * Math.PI * fHz * delay / fs, c = Math.cos(w), s = Math.sin(w);
  return [r * c - i * s, r * s + i * c];
}
