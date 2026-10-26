// Pure helpers the views share: complex arrays to plot curves, the ±2 dB judging band, and the
// plain-language reading of the probe. No React here, so everything is unit-tested in data.test.ts.

import type { AngleResult, CArray, Check, Design, Metrics, Results, UnitId } from "../types";
import { UNIT_IDS } from "../types";

export type TraceId = UnitId | "sum";
export const TRACES: TraceId[] = [...UNIT_IDS, "sum"];

/** Display names and colour tokens of the traces; the colours have a fixed meaning everywhere. */
export const TRACE_META: Record<TraceId, { name: string; short: string; color: string }> = {
  woof: { name: "Woofer", short: "Woof", color: "woof" },
  mid: { name: "Midrange", short: "Mid", color: "mid" },
  tw: { name: "Tweeter", short: "Tw", color: "tw" },
  sum: { name: "Sum", short: "Sum", color: "sum" },
};

/** The judging band of the metrics (Hz): flatness is measured over 150 Hz-15 kHz. */
export const JUDGE_BAND: [number, number] = [150, 15000];

// ---------------------------------------------------------------- complex arrays
/** 20 log10 |z|, with -inf replaced by NaN so a plot breaks the line instead of diving. */
export function db(z: CArray): Float64Array {
  const n = z.re.length, out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const v = 20 * Math.log10(Math.hypot(z.re[i], z.im[i]));
    out[i] = Number.isFinite(v) ? v : NaN;
  }
  return out;
}

/** |z| (e.g. an impedance in ohm). */
export function mag(z: CArray): Float64Array {
  const n = z.re.length, out = new Float64Array(n);
  for (let i = 0; i < n; i++) out[i] = Math.hypot(z.re[i], z.im[i]);
  return out;
}

/** Wrapped phase of z in degrees (-180..180]. */
export function phaseDeg(z: CArray): Float64Array {
  const n = z.re.length, out = new Float64Array(n);
  for (let i = 0; i < n; i++) out[i] = Math.atan2(z.im[i], z.re[i]) * 180 / Math.PI;
  return out;
}

/** Element-wise product a x b (x k). */
export function cmul(a: CArray, b: CArray, k = 1): CArray {
  const n = a.re.length, re = new Float64Array(n), im = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    re[i] = k * (a.re[i] * b.re[i] - a.im[i] * b.im[i]);
    im[i] = k * (a.re[i] * b.im[i] + a.im[i] * b.re[i]);
  }
  return { re, im };
}

/** Power sum of the three units, 10 log10 sum |u|^2 (dB): what the sum would be if the units were
 *  uncorrelated. The complex sum is +3 dB above it where two equal units are in phase. */
export function powerSumDb(out: Pick<AngleResult, UnitId>): Float64Array {
  const n = out.woof.re.length, y = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let p = 0;
    for (const u of UNIT_IDS) p += out[u].re[i] ** 2 + out[u].im[i] ** 2;
    y[i] = p > 0 ? 10 * Math.log10(p) : NaN;
  }
  return y;
}

/** Complex sum minus power sum (dB): +3 = two units in phase, 0 = uncorrelated, < 0 = cancelling. */
export function summingGainDb(out: Pick<AngleResult, UnitId | "sum">): Float64Array {
  const ps = powerSumDb(out), s = db(out.sum), y = new Float64Array(s.length);
  for (let i = 0; i < s.length; i++) y[i] = s[i] - ps[i];
  return y;
}

/** Element-wise difference a - b, NaN where either is not finite. */
export function diff(a: ArrayLike<number>, b: ArrayLike<number>): Float64Array {
  const n = Math.min(a.length, b.length), y = new Float64Array(n);
  for (let i = 0; i < n; i++) y[i] = Number.isFinite(a[i]) && Number.isFinite(b[i]) ? a[i] - b[i] : NaN;
  return y;
}

/** Index of the grid point nearest x on a log axis (grid ascending, positive). */
export function nearest(f: ArrayLike<number>, x: number): number {
  let lo = 0, hi = f.length - 1;
  if (hi < 0) return -1;
  if (x <= f[0]) return 0;
  if (x >= f[hi]) return hi;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (f[m] < x) lo = m; else hi = m; }
  return Math.log(x / f[lo]) < Math.log(f[hi] / x) ? lo : hi;
}

/** Minimum of y over the x range [lo, hi], with its frequency. */
export function minIn(x: ArrayLike<number>, y: ArrayLike<number>, lo: number, hi: number): { x: number; y: number } | null {
  let best: { x: number; y: number } | null = null;
  for (let i = 0; i < x.length; i++) {
    if (x[i] < lo || x[i] > hi || !Number.isFinite(y[i])) continue;
    if (!best || y[i] < best.y) best = { x: x[i], y: y[i] };
  }
  return best;
}

/** RMS of the dB difference between a measured and a modelled complex curve over [lo, hi] Hz. */
export function rmsDbError(f: ArrayLike<number>, meas: CArray, model: CArray, lo = 0, hi = Infinity): number {
  let s = 0, n = 0;
  for (let i = 0; i < f.length; i++) {
    if (f[i] < lo || f[i] > hi) continue;
    const a = Math.hypot(meas.re[i], meas.im[i]), b = Math.hypot(model.re[i], model.im[i]);
    if (!(a > 0) || !(b > 0)) continue;
    s += (20 * Math.log10(a / b)) ** 2; n++;
  }
  return n ? Math.sqrt(s / n) : NaN;
}

// ---------------------------------------------------------------- angles
/** The measurement angles a curve view shows for the workspace's angle choice ("0", "30", "both").
 *  "both" means on axis plus 30° (or the first off-axis angle there is). */
export function shownAngles(results: Pick<Results, "angles">, choice: string): string[] {
  const all = Object.keys(results.angles).sort((a, b) => +a - +b);
  if (choice === "both") {
    const off = all.includes("30") ? "30" : all.find(a => a !== "0");
    return off ? ["0", off] : ["0"];
  }
  return all.includes(choice) ? [choice] : ["0"];
}

/** System level of an angle (median of the smoothed sum over 150 Hz-15 kHz). */
export function levelAt(m: Metrics, angle: string): number {
  return angle !== "0" && angle === m.offAngle && m.off30 ? m.off30.level : m.on.level;
}

/** A y window around the system level that keeps the crossover slopes readable. */
export function responseRange(level: number, below = 42, above = 9): [number, number] {
  const top = Math.ceil((level + above) / 3) * 3;
  return [top - below - above, top];
}

// ---------------------------------------------------------------- drive voltages
/** Voltage at each unit's terminals per 1 V into the MiniDSP (complex): woofer = gain x low-pass,
 *  mid and tweeter = high-pass x their passive ladder (loaded by the real driver). */
export function terminalDrive(out: AngleResult, design: Design): Record<UnitId, CArray> {
  const g = 10 ** (design.digital.g_woof_dB / 20);
  const woof = { re: Float64Array.from(out.HL.re, v => v * g), im: Float64Array.from(out.HL.im, v => v * g) };
  return { woof, mid: cmul(out.HH, out.Tm), tw: cmul(out.HH, out.Tt) };
}

// ---------------------------------------------------------------- probe reading
export interface UnitAtProbe { id: UnitId; relDb: number; phaseRad: number }
export interface ProbeReading { headline: string; detail: string | null; tone: "neutral" | "good" | "warn" | "bad" }

const NAME: Record<UnitId, string> = { woof: "woofer", mid: "midrange", tw: "tweeter" };
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
const dB = (x: number) => `${Math.abs(x) < 0.05 ? "0" : Math.abs(x).toFixed(Math.abs(x) < 10 ? 1 : 0)} dB`;
const wrap = (r: number) => Math.atan2(Math.sin(r), Math.cos(r));

/**
 * One line of plain language about what happens at the probe frequency, e.g.
 * "Midrange carries the sound; tweeter 18 dB down". Inputs are each unit's level relative to the
 * system level and its display phase, plus the summing gain (sum minus power sum, dB).
 */
export function readProbe(units: UnitAtProbe[], summingDb: number, opts: { fHz: number; twFsHz?: number; twRelAtFs?: number } = { fHz: 1000 }): ProbeReading {
  const live = units.filter(u => Number.isFinite(u.relDb));
  if (!live.length) return { headline: "No output here", detail: null, tone: "neutral" };
  const sorted = [...live].sort((a, b) => b.relDb - a.relDb);
  const [a, b] = sorted;
  const gap = b ? a.relDb - b.relDb : Infinity;

  let headline: string;
  let detail: string | null = null;
  let tone: ProbeReading["tone"] = "neutral";

  if (gap <= 6) {
    // a crossover region: say how the two leading units combine
    const dphi = Math.abs(wrap(a.phaseRad - b.phaseRad)) * 180 / Math.PI;
    headline = `Crossover region: ${NAME[a.id]} and ${NAME[b.id]} within ${dB(gap)}`;
    const how = dphi <= 45 ? "they add in phase" : dphi <= 110 ? "they partly add" : "they work against each other";
    detail = `${Math.round(dphi)}° apart, ${how} (${summingDb >= 0 ? "+" : "−"}${dB(summingDb)} against their power sum).`;
    tone = summingDb < -1 ? "bad" : dphi <= 45 ? "good" : "warn";
  } else {
    const rest = sorted.slice(1).map(u => `${NAME[u.id]} ${dB(a.relDb - u.relDb)} down`);
    headline = `${cap(NAME[a.id])} carries the sound${rest.length ? "; " + rest[0] : ""}`;
    if (rest[1]) detail = `${cap(rest[1])}.`;
    if (summingDb < -1) { detail = `The units cancel here: ${dB(summingDb)} below their power sum.`; tone = "bad"; }
  }

  // near the tweeter's resonance the question is whether it is protected
  if (opts.twFsHz && opts.twRelAtFs !== undefined && Math.abs(Math.log2(opts.fHz / opts.twFsHz)) < 1 / 6) {
    const ok = opts.twRelAtFs <= -12;
    detail = `Tweeter resonance: it sits ${dB(opts.twRelAtFs)} ${opts.twRelAtFs <= 0 ? "below" : "above"} the system level (aim at least 12 dB below).`;
    tone = ok ? (tone === "bad" ? "bad" : "good") : "warn";
  }
  return { headline, detail, tone };
}

// ---------------------------------------------------------------- comparing designs
export interface MetricRow {
  id: string;
  label: string;
  unit: string;
  /** Which way is better, for colouring the difference. 0 = neither (a placement, not a quality). */
  better: -1 | 0 | 1;
  digits: number;
  get(r: Results): number | null;
}

/** The rows of the Compare view's metrics table. */
export const METRIC_ROWS: MetricRow[] = [
  { id: "spread", label: "Spread on axis", unit: "dB", better: -1, digits: 1, get: r => r.metrics.on.spread },
  { id: "rms", label: "RMS deviation on axis", unit: "dB", better: -1, digits: 2, get: r => r.metrics.on.rms },
  { id: "spread30", label: "Spread off axis", unit: "dB", better: -1, digits: 1, get: r => r.metrics.off30?.spread ?? null },
  { id: "level", label: "System level", unit: "dB", better: 1, digits: 1, get: r => r.metrics.on.level },
  { id: "xwm", label: "Woofer/mid crossover", unit: "Hz", better: 0, digits: 0, get: r => r.metrics.x_wm },
  { id: "xmt", label: "Mid/tweeter crossover", unit: "Hz", better: 0, digits: 0, get: r => r.metrics.x_mt },
  { id: "zmin", label: "Minimum load (ch. 2)", unit: "Ω", better: 1, digits: 2, get: r => r.metrics.Zamp2_min },
  { id: "f3", label: "Bass f3", unit: "Hz", better: -1, digits: 1, get: r => r.box.f3 },
  { id: "ripple", label: "Bass ripple", unit: "dB", better: -1, digits: 1, get: r => r.box.ripple },
  { id: "fb", label: "Box tuning fB", unit: "Hz", better: 0, digits: 1, get: r => r.box.fB },
];

/** Count of checks per state, for compact summaries. */
export function checkCounts(checks: Check[]): Record<Check["state"], number> {
  const c = { good: 0, warn: 0, bad: 0 };
  for (const k of checks) c[k.state]++;
  return c;
}

// ---------------------------------------------------------------- phase
/** Unwrap degrees along the grid; a gap (NaN) keeps the offset, so the curve continues where it reappears. */
export function unwrapDeg(y: Float64Array): Float64Array {
  const out = new Float64Array(y.length);
  let prev = NaN, offset = 0;
  for (let i = 0; i < y.length; i++) {
    const v = y[i];
    if (Number.isNaN(v)) { out[i] = NaN; continue; }
    if (!Number.isNaN(prev)) offset -= 360 * Math.round((v + offset - prev) / 360);
    out[i] = v + offset;
    prev = out[i];
  }
  return out;
}

/** `y` shifted by the whole turn (360° k) that brings it closest to `ref` where both are drawn (median
 *  difference), so independently unwrapped curves sit on top of each other where they overlap. */
export function alignTurns(y: Float64Array, ref: ArrayLike<number>): Float64Array {
  const d: number[] = [];
  for (let i = 0; i < y.length; i++) if (Number.isFinite(y[i]) && Number.isFinite(ref[i])) d.push(y[i] - ref[i]);
  if (!d.length) return y;
  d.sort((a, b) => a - b);
  const k = Math.round(d[d.length >> 1] / 360);
  return k ? y.map(v => v - 360 * k) : y;
}

/** A y range in whole multiples of 90° around every finite value, at least 360° tall (±180° when
 *  there is nothing to show), so a curve that has turned far negative does not leave the top empty. */
export function phaseRange(series: { y: ArrayLike<number> }[]): [number, number] {
  let lo = Infinity, hi = -Infinity;
  for (const s of series) {
    const y = s.y;
    for (let i = 0; i < y.length; i++) if (Number.isFinite(y[i])) { lo = Math.min(lo, y[i]); hi = Math.max(hi, y[i]); }
  }
  if (lo > hi) return [-180, 180];
  lo = Math.floor(lo / 90) * 90; hi = Math.ceil(hi / 90) * 90;
  const short = 360 - (hi - lo);
  if (short > 0) { const below = Math.ceil(short / 180) * 90; lo -= below; hi += short - below; }
  return [lo, hi];
}
