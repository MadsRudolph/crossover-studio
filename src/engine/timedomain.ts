// Time domain of the design at one angle: group delay of each unit and of the sum, the impulse and step
// responses, and the few numbers a group quotes from them (delay at the crossovers, which unit arrives
// first, whether the bass delay is audible).
//
// Conventions (the same as the Phase view, so the two agree):
//   - Time zero is the profile's phase reference: the propagation delay over phase_ref_distance_m at
//     c = 345 m/s is taken out of every curve (displayPhase's Matlab2LTspice convention). Only the
//     differences between units carry meaning; the absolute value depends on that distance.
//   - Group delay tau_g = -d phi / d omega, from neighbouring grid points: the phase step between two
//     points is the angle of z[i+1] conj(z[i]) AFTER the reference delay is removed, so it stays well
//     under pi and no unwrapping across the flight time is needed. The derivative is then averaged
//     over 1/6 octave, weighted by |z|^2 so the quiet stretches of a unit's stop band count little.
//   - Off-axis runs do not share the on-axis run's time origin (the bundled 30° data sits 18 ms early),
//     so every angle but 0° is shifted by one delay: the median group delay of (sum at that angle) x
//     conj(sum at 0°) over 150 Hz-1 kHz. Within one angle the units keep their relative timing.
//   - Below BASS_JOIN_HZ the measured woofer phase is too noisy to differentiate (the anechoic room's
//     low-frequency limit), so the woofer and the sum follow the box model times the digital low-pass
//     there, shifted by one constant so the model meets the measured group delay over 80-160 Hz.
//   - Impulse and step responses reuse the listening FIRs (src/listen/ir.ts): 16384 taps at 48 kHz,
//     one common delay and level for all units, the box model below 50 Hz. The step is the running sum
//     of the impulse, in units of a flat system at the same level (a perfect speaker steps to 1). They
//     take about 60 ms (the FIRs' bulk-delay search), so they are a separate, lazily used call.
// Pure maths, no DOM: unit-tested in timedomain.test.ts.

import type { CArray, Design, Results, UnitId } from "../types";
import { UNIT_IDS } from "../types";
import { buildIrs, mixIr } from "../listen/ir";
import { hDigital } from "./digital";
import { logspace } from "./complex";
import { boxResponse, type Prepared } from "./system";

export type TimeTrace = UnitId | "sum";
export const TIME_TRACES: TimeTrace[] = [...UNIT_IDS, "sum"];

/** Speed of sound of the display convention (m/s), as displayPhase. */
const C_REF = 345;
/** Smoothing of the group delay (octaves). */
export const GD_SMOOTH_OCT = 1 / 6;
/** A unit's group delay is drawn only where it is within this many dB of the sum (elsewhere it is
 *  stop-band noise and does not shape what you hear). */
export const GD_FLOOR_DB = 20;
/** Lowest frequency of the group-delay curves (Hz). */
export const GD_LOW_HZ = 20;
/** Below this the woofer's group delay comes from the box model (Hz); the model is matched over
 *  BASS_JOIN_HZ to 2 x BASS_JOIN_HZ. */
export const BASS_JOIN_HZ = 80;

// ---------------------------------------------------------------- group delay
/**
 * Group delay (s) of a response on the ascending grid f, with `refDelay` seconds of pure delay taken out
 * first (positive = the response is that much later than the reference). Smoothed over `oct` octaves
 * (0 = the mean of the two neighbouring intervals). Points with |z| = 0 give NaN.
 */
export function groupDelay(f: ArrayLike<number>, z: CArray, refDelay = 0, oct = GD_SMOOTH_OCT): Float64Array {
  const n = f.length, out = new Float64Array(n).fill(NaN);
  if (n < 2) return out;
  // per interval: the phase step of the delay-compensated response, and a weight
  const m = n - 1, gd = new Float64Array(m), w = new Float64Array(m), fm = new Float64Array(m);
  for (let i = 0; i < m; i++) {
    const df = f[i + 1] - f[i];
    // z[i+1] conj(z[i]), times e^{+j 2 pi df refDelay} to take the reference delay out
    const ar = z.re[i + 1], ai = z.im[i + 1], br = z.re[i], bi = z.im[i];
    const pr0 = ar * br + ai * bi, pi0 = ai * br - ar * bi;
    const k = 2 * Math.PI * df * refDelay, c = Math.cos(k), s = Math.sin(k);
    const pr = pr0 * c - pi0 * s, pi = pr0 * s + pi0 * c, mag = Math.hypot(pr, pi);
    gd[i] = mag > 0 && df > 0 ? -Math.atan2(pi, pr) / (2 * Math.PI * df) : NaN;
    w[i] = Number.isFinite(gd[i]) ? mag : 0;                               // |z[i]| |z[i+1]|
    fm[i] = Math.sqrt(f[i] * f[i + 1]);
  }
  // weighted average of the interval values within +-oct/2 octave of each grid point (two pointers)
  const half = 2 ** (oct / 2);
  let a = 0, b = 0, sw = 0, swg = 0;
  for (let i = 0; i < n; i++) {
    const lo = oct > 0 ? f[i] / half : fm[Math.max(0, i - 1)], hi = oct > 0 ? f[i] * half : fm[Math.min(m - 1, i)];
    while (b < m && fm[b] <= hi) { if (w[b] > 0) { sw += w[b]; swg += w[b] * gd[b]; } b++; }
    while (a < b && fm[a] < lo) { if (w[a] > 0) { sw -= w[a]; swg -= w[a] * gd[a]; } a++; }
    out[i] = sw > 0 ? swg / sw : NaN;
  }
  return out;
}

/** The pure delay over the profile's phase reference distance (s), the zero of every time axis here. */
export const refDelayOf = (p: Prepared): number => p.profile.conditions.phase_ref_distance_m / C_REF;

/** Extra delay (s) of an off-axis run against the on-axis one: the median group delay of
 *  sum(angle) x conj(sum(0°)) over 150 Hz-1 kHz, where the grid is fine enough (< 25 Hz steps) that a
 *  phase step of up to +-20 ms cannot wrap. 0 for the on-axis angle itself. */
export function angleOffset(results: Results, angle: string): number {
  const a = results.angles[angle], o = results.angles["0"];
  if (!a || !o || angle === "0") return 0;
  const f = results.f, n = f.length, z = { re: new Float64Array(n), im: new Float64Array(n) };
  for (let i = 0; i < n; i++) {
    z.re[i] = a.sum.re[i] * o.sum.re[i] + a.sum.im[i] * o.sum.im[i];
    z.im[i] = a.sum.im[i] * o.sum.re[i] - a.sum.re[i] * o.sum.im[i];
  }
  const g = groupDelay(f, z, 0, 0), v: number[] = [];
  for (let i = 0; i < n; i++) if (f[i] >= 150 && f[i] <= 1000 && Number.isFinite(g[i])) v.push(g[i]);
  const m = medianOf(v);
  return Number.isFinite(m) ? m : 0;
}

// ---------------------------------------------------------------- audibility
/**
 * Threshold of audibility of group-delay distortion (s) at f Hz, after Blauert & Laws, "Group delay
 * distortions in electroacoustical systems", JASA 63(5), 1978 (the values usually quoted from it:
 * 3.2 ms at 500 Hz, 2 ms at 1 kHz, 1 ms at 2 kHz, 1.5 ms at 4 kHz, 2 ms at 8 kHz; linear in log f between).
 * They measured nothing below 500 Hz. Below it we assume the threshold stays at the same number of
 * periods as at 500 Hz (1.6 cycles, i.e. 1.6 / f), a common rule of thumb, not a measured value.
 */
export function gdThreshold(fHz: number): number {
  const T: [number, number][] = [[500, 3.2e-3], [1000, 2e-3], [2000, 1e-3], [4000, 1.5e-3], [8000, 2e-3]];
  if (fHz <= T[0][0]) return 1.6 / fHz;
  if (fHz >= T[T.length - 1][0]) return T[T.length - 1][1];
  let k = 0;
  while (T[k + 1][0] < fHz) k++;
  const t = Math.log(fHz / T[k][0]) / Math.log(T[k + 1][0] / T[k][0]);
  return T[k][1] + t * (T[k + 1][1] - T[k][1]);
}

export interface GdAudibility {
  /** Where the sum's group-delay distortion comes closest to (or furthest over) the threshold. */
  atHz: number;
  /** Sum group delay there minus its median over 1-4 kHz (ms). */
  excessMs: number;
  thresholdMs: number;
  /** |excess| / threshold: >= 1 means likely audible. */
  ratio: number;
  audible: boolean;
}

// ---------------------------------------------------------------- group-delay analysis (cheap)
export interface XoverTiming {
  /** Acoustic crossover (Hz, the grid point nearest it). */
  f: number;
  /** The lower and the upper unit of the pair. */
  lo: UnitId;
  hi: UnitId;
  /** Group delay at the crossover (ms): each unit and the sum. */
  gdLo: number;
  gdHi: number;
  gdSum: number;
  /** How much earlier the upper unit arrives (ms, group delay lo - hi): > 0 = the upper unit leads. */
  leadMs: number;
  /** Phase of the upper unit minus the lower (degrees, -180..180] at the crossover. */
  phaseDeg: number;
}

export interface GroupDelayAnalysis {
  angle: string;
  /** Frequency axis (Hz): GD_LOW_HZ up to the top of the grid. */
  f: Float64Array;
  /** Group delay (ms, re the reference). Units are NaN where more than GD_FLOOR_DB below the sum. */
  gd: Record<TimeTrace, Float64Array>;
  /** The reference: distance (m) and its pure delay (ms), taken out of everything. */
  ref: { distance: number; ms: number };
  xover: { wm: XoverTiming | null; mt: XoverTiming | null };
  /** Median group delay of the sum over 1-4 kHz (ms): the midband the distortion is measured from. */
  midbandMs: number;
  /** The sum's worst group-delay distortion against Blauert & Laws, 20 Hz-8 kHz, and below 500 Hz. */
  audibility: GdAudibility;
  bass: GdAudibility;
}

function nearestIdx(f: ArrayLike<number>, x: number): number {
  let best = 0;
  for (let i = 1; i < f.length; i++) if (Math.abs(Math.log(f[i] / x)) < Math.abs(Math.log(f[best] / x))) best = i;
  return best;
}
function medianOf(v: number[]): number {
  if (!v.length) return NaN;
  const s = [...v].sort((a, b) => a - b), k = s.length >> 1;
  return s.length % 2 ? s[k] : (s[k - 1] + s[k]) / 2;
}

/**
 * Model group delay (s) of the woofer path at the frequencies fl: the fitted box model of the designed
 * box times the digital low-pass. Assumes the driver follows its Thiele-Small fit down there and the
 * passive units add nothing (they are 40 dB down).
 */
function bassModelGd(p: Prepared, design: Design, fl: number[], oct: number): Float64Array {
  const box = boxResponse(p, design, fl).p1m, lp = hDigital(fl, design.digital.fc, "LPF", design.digital.align);
  const z = { re: new Float64Array(fl.length), im: new Float64Array(fl.length) };
  for (let i = 0; i < fl.length; i++) {
    z.re[i] = box.re[i] * lp.re[i] - box.im[i] * lp.im[i];
    z.im[i] = box.re[i] * lp.im[i] + box.im[i] * lp.re[i];
  }
  return groupDelay(fl, z, 0, oct);
}

function worstAgainstThreshold(f: Float64Array, gdMs: Float64Array, refMs: number, lo: number, hi: number): GdAudibility {
  let best: GdAudibility = { atHz: NaN, excessMs: 0, thresholdMs: NaN, ratio: 0, audible: false };
  for (let i = 0; i < f.length; i++) {
    if (f[i] < lo || f[i] > hi || !Number.isFinite(gdMs[i])) continue;
    const ex = gdMs[i] - refMs, th = gdThreshold(f[i]) * 1e3, r = Math.abs(ex) / th;
    if (!Number.isFinite(best.atHz) || r > best.ratio) best = { atHz: f[i], excessMs: ex, thresholdMs: th, ratio: r, audible: r >= 1 };
  }
  return best;
}

/** Group delay of every unit and the sum, the timing at both crossovers and the audibility check
 *  (well under a millisecond: a few passes over the grid plus the box model on ~100 points). */
export function groupDelayAnalysis(p: Prepared, design: Design, results: Results, angle = "0", oct = GD_SMOOTH_OCT): GroupDelayAnalysis {
  const ang = results.angles[angle] ? angle : "0", out = results.angles[ang];
  if (!out) throw new Error(`No response at ${angle}°.`);
  const fg = results.f, n = fg.length, tRef = refDelayOf(p) + angleOffset(results, ang);
  const units: Record<UnitId, CArray> = { woof: out.woof, mid: out.mid, tw: out.tw };

  // ---- on the grid
  const raw = {} as Record<TimeTrace, Float64Array>;
  for (const u of TIME_TRACES) raw[u] = groupDelay(fg, u === "sum" ? out.sum : units[u], tRef, oct);

  // ---- the bass from the model: on a log grid below the measured one and on the grid points below
  // the join; one offset (median over join..2 x join) puts it onto the measured woofer
  const below = fg[0] > GD_LOW_HZ * 1.05 ? logspace(GD_LOW_HZ, fg[0], 40).slice(0, -1) : [];
  const nJoin = Array.from(fg).findIndex(x => x >= BASS_JOIN_HZ), e = below.length;
  const fl = [...below, ...Array.from(fg).filter(x => x < 2 * BASS_JOIN_HZ)];
  const model = fl.length > 2 ? bassModelGd(p, design, fl, oct) : new Float64Array(0);
  const diffs: number[] = [];
  for (let i = 0; i < n && fg[i] < 2 * BASS_JOIN_HZ; i++) if (fg[i] >= BASS_JOIN_HZ && Number.isFinite(raw.woof[i])) diffs.push(raw.woof[i] - model[e + i]);
  const off = medianOf(diffs), useModel = Number.isFinite(off) && nJoin > 0;

  const f = new Float64Array(e + n);
  f.set(below, 0); f.set(fg, e);
  const gd = {} as Record<TimeTrace, Float64Array>;
  const floor = 10 ** (-GD_FLOOR_DB / 20);
  for (const u of TIME_TRACES) {
    const y = new Float64Array(e + n).fill(NaN);
    for (let i = 0; i < n; i++) {
      const quiet = u !== "sum" && Math.hypot(units[u].re[i], units[u].im[i]) < floor * Math.hypot(out.sum.re[i], out.sum.im[i]);
      y[e + i] = quiet ? NaN : raw[u][i] * 1e3;
    }
    if ((u === "woof" || u === "sum") && useModel) {
      for (let i = 0; i < e; i++) y[i] = (model[i] + off) * 1e3;
      for (let i = 0; i < nJoin; i++) y[e + i] = (model[e + i] + off) * 1e3;
    }
    gd[u] = y;
  }

  // ---- the crossovers (unmasked unit delays: at the crossover both are within 6 dB of the sum)
  const m = results.metrics;
  const xo = (fx: number | null, lo: UnitId, hi: UnitId): XoverTiming | null => {
    if (!fx) return null;
    const i = nearestIdx(fg, fx), a = units[lo], b = units[hi];
    const ga = raw[lo][i] * 1e3, gb = raw[hi][i] * 1e3;
    const re = b.re[i] * a.re[i] + b.im[i] * a.im[i], im = b.im[i] * a.re[i] - b.re[i] * a.im[i];
    return { f: fg[i], lo, hi, gdLo: ga, gdHi: gb, gdSum: raw.sum[i] * 1e3, leadMs: ga - gb, phaseDeg: Math.atan2(im, re) * 180 / Math.PI };
  };

  // ---- audibility of the sum's group delay against Blauert & Laws
  const midband: number[] = [];
  for (let i = 0; i < f.length; i++) if (f[i] >= 1000 && f[i] <= 4000 && Number.isFinite(gd.sum[i])) midband.push(gd.sum[i]);
  const refMs = medianOf(midband);
  return {
    angle: ang, f, gd, midbandMs: refMs,
    ref: { distance: p.profile.conditions.phase_ref_distance_m, ms: tRef * 1e3 },
    xover: { wm: xo(m.x_wm, "woof", "mid"), mt: xo(m.x_mt, "mid", "tw") },
    audibility: worstAgainstThreshold(f, gd.sum, refMs, GD_LOW_HZ, 8000),
    bass: worstAgainstThreshold(f, gd.sum, refMs, GD_LOW_HZ, 500),
  };
}

// ---------------------------------------------------------------- impulse and step (about 60 ms)
export interface ImpulseAnalysis {
  angle: string;
  /** Time axis (ms re the reference). */
  t: Float64Array;
  /** Impulse responses, scaled so the sum's largest sample in the window is 1. */
  impulse: Record<TimeTrace, Float64Array>;
  /** Step responses, re a flat system at the same level (it would step to 1). */
  step: Record<TimeTrace, Float64Array>;
  /** Time of each unit's largest impulse sample (ms re the reference): when its energy arrives. */
  arrival: Record<UnitId, number>;
  coherence: {
    /** true when all three impulse peaks lie within 0.1 ms (practically never with LR/BW filters). */
    coherent: boolean;
    /** Units in order of arrival, and the spread first-to-last (ms). */
    order: UnitId[];
    spreadMs: number;
    /** One plain sentence for the readout. */
    text: string;
  };
}

const NAME: Record<UnitId, string> = { woof: "woofer", mid: "midrange", tw: "tweeter" };

/** Impulse and step responses of every unit and the sum over `window` (ms re the reference). */
export function impulseAnalysis(p: Prepared, design: Design, results: Results, angle = "0", window: [number, number] = [-2, 40]): ImpulseAnalysis {
  const ang = results.angles[angle] ? angle : "0", out = results.angles[ang];
  if (!out) throw new Error(`No response at ${angle}°.`);
  // an off-axis run is first moved onto the on-axis time base (the FIRs' delay search covers -10 to
  // +50 ms only); then the same FIRs as the Listen view: irsFromResults() with shifted units
  const dt = angleOffset(results, ang), tRef = refDelayOf(p), f = results.f;
  const shift = (z: CArray): CArray => {
    if (!dt) return z;
    const r = { re: new Float64Array(f.length), im: new Float64Array(f.length) };
    for (let i = 0; i < f.length; i++) {
      const w = 2 * Math.PI * f[i] * dt, c = Math.cos(w), s = Math.sin(w);
      r.re[i] = z.re[i] * c - z.im[i] * s; r.im[i] = z.re[i] * s + z.im[i] * c;
    }
    return r;
  };
  const set = buildIrs({ f, units: { woof: shift(out.woof), mid: shift(out.mid), tw: shift(out.tw) },
                         wooferLow: freqs => boxResponse(p, design, freqs).p1m });
  const fs = set.fs, [t0, t1] = window;
  // sample k of an IR sits at (k - delay) / fs + tau in the (shifted) measurement's time; the reference
  // delay then comes out, as for the phase
  const kOf = (ms: number) => Math.round(set.delay + (ms / 1e3 - set.tau + tRef) * fs);
  const k0 = Math.max(0, kOf(t0)), k1 = Math.min(set.n - 1, kOf(t1)), len = Math.max(0, k1 - k0 + 1);
  const t = new Float64Array(len);
  for (let j = 0; j < len; j++) t[j] = ((k0 + j - set.delay) / fs + set.tau - tRef) * 1e3;
  const full: Record<TimeTrace, Float64Array> = { woof: set.units.woof, mid: set.units.mid, tw: set.units.tw, sum: mixIr(set) };
  let peak = 0;
  for (let j = 0; j < len; j++) peak = Math.max(peak, Math.abs(full.sum[k0 + j]));
  const impulse = {} as Record<TimeTrace, Float64Array>, step = {} as Record<TimeTrace, Float64Array>;
  for (const u of TIME_TRACES) {
    const x = full[u], imp = new Float64Array(len), st = new Float64Array(len);
    // the step integrates from the start of the FIR, so pre-ringing before the window counts
    let acc = 0;
    for (let k = 0; k < k0; k++) acc += x[k];
    for (let j = 0; j < len; j++) { acc += x[k0 + j]; st[j] = acc; imp[j] = peak > 0 ? x[k0 + j] / peak : 0; }
    impulse[u] = imp; step[u] = st;
  }

  const arrival = {} as Record<UnitId, number>;
  for (const u of UNIT_IDS) {
    const imp = impulse[u];
    let j = 0;
    for (let q = 1; q < len; q++) if (Math.abs(imp[q]) > Math.abs(imp[j])) j = q;
    arrival[u] = len ? t[j] : NaN;
  }
  const order = [...UNIT_IDS].sort((a, b) => arrival[a] - arrival[b]);
  const spreadMs = arrival[order[2]] - arrival[order[0]], coherent = spreadMs <= 0.1;
  const later = order.slice(1).map(u => `the ${NAME[u]} ${(arrival[u] - arrival[order[0]]).toFixed(2)} ms later`).join(" and ");
  const text = coherent
    ? "Close to time-coherent: all three units arrive within 0.1 ms."
    : `Not time-coherent: the ${NAME[order[0]]} arrives first, ${later}.`;
  return { angle: ang, t, impulse, step, arrival, coherence: { coherent, order, spreadMs, text } };
}

// ---------------------------------------------------------------- shared caches
// One analysis per Results object (immutable per design) and angle: the Time view and the insight
// provider share them.
const gdCache = new WeakMap<Results, Map<string, GroupDelayAnalysis>>();
const irCache = new WeakMap<Results, Map<string, ImpulseAnalysis>>();

function cached<T>(c: WeakMap<Results, Map<string, T>>, r: Results, key: string, make: () => T): T {
  let m = c.get(r);
  if (!m) c.set(r, (m = new Map()));
  let v = m.get(key);
  if (v === undefined) m.set(key, (v = make()));
  return v;
}

/** groupDelayAnalysis() with the default smoothing, cached per Results and angle. */
export function cachedGroupDelay(p: Prepared, design: Design, results: Results, angle = "0"): GroupDelayAnalysis {
  return cached(gdCache, results, angle, () => groupDelayAnalysis(p, design, results, angle));
}

/** impulseAnalysis() with the default window, cached per Results and angle. */
export function cachedImpulse(p: Prepared, design: Design, results: Results, angle = "0"): ImpulseAnalysis {
  return cached(irCache, results, angle, () => impulseAnalysis(p, design, results, angle));
}
