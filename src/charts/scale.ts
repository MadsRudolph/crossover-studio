// Pure numeric helpers for the chart library: axis ticks, coordinate mapping, view zoom/pan and
// min/max decimation. No DOM, so everything here is unit-tested in node (scale.test.ts).

export type Range = [number, number];

// ---------------------------------------------------------------- formatting

/** Typographic minus, so negative tick labels line up with positive ones in a tabular face. */
const MINUS = "−";

/** Trim a fixed-point string: "2.50" -> "2.5", "3.00" -> "3". */
function trimZeros(s: string): string {
  return s.includes(".") ? s.replace(/\.?0+$/, "") : s;
}

/** Compact frequency label for axis ticks: 20, 500, 1k, 1.5k, 20k. */
export function formatHzTick(fHz: number): string {
  if (fHz >= 1000) return trimZeros((fHz / 1000).toFixed(fHz >= 10000 ? 1 : 2)) + "k";
  if (fHz >= 100) return trimZeros(fHz.toFixed(0));
  if (fHz >= 10) return trimZeros(fHz.toFixed(1));
  return trimZeros(fHz.toPrecision(2));
}

/** Frequency with its unit for readouts: "48.3 Hz", "1.25 kHz", "12.6 kHz" (3 significant digits). */
export function formatHz(fHz: number): string {
  if (!Number.isFinite(fHz)) return "—";
  if (fHz >= 1000) {
    const k = fHz / 1000;
    return `${k.toFixed(k >= 100 ? 0 : k >= 10 ? 1 : 2)} kHz`;
  }
  return `${fHz.toFixed(fHz >= 100 ? 0 : 1)} Hz`;
}

/** Number with a proper minus sign and a fixed number of decimals. */
export function formatNumber(v: number, decimals: number): string {
  if (!Number.isFinite(v)) return "—";
  const s = Math.abs(v).toFixed(decimals);
  // Avoid "−0.0": a value that rounds to zero is shown unsigned.
  return v < 0 && Number(s) !== 0 ? MINUS + s : s;
}

/** Decimals needed to tell ticks `step` apart: step 5 -> 0, 0.5 -> 1, 0.25 -> 2. */
export function decimalsForStep(step: number): number {
  if (!(step > 0) || !Number.isFinite(step)) return 0;
  for (let d = 0; d < 8; d++) {
    const scaled = step * 10 ** d;
    if (Math.abs(scaled - Math.round(scaled)) < 1e-6 * scaled) return d;
  }
  return 8;
}

// ---------------------------------------------------------------- ticks

export interface Tick {
  value: number;
  label: string;
  /** Label priority for collision culling: 0 = decade (always kept first), 1 = 5s, 2 = 2s, 3 = others. */
  rank: number;
}

export interface LogTicks {
  /** Labelled ticks, ascending. */
  labelled: Tick[];
  /** Every gridline position (decades + intermediate), ascending; a decade is flagged `strong`. */
  grid: { value: number; strong: boolean }[];
}

/**
 * Ticks for a log-frequency axis. Over wide spans: gridlines at 1..9 x 10^n, labels at 1-2-5
 * (20, 50, 100, 200, 500, 1k, ...). When zoomed into less than about a decade the 1-2-5 set gets too
 * sparse, so every integer multiple is labelled, and inside a single octave linear nice ticks take over.
 */
export function logTicks(lo: number, hi: number): LogTicks {
  if (!(lo > 0) || !(hi > lo)) return { labelled: [], grid: [] };
  const decades = Math.log10(hi / lo);

  // Very narrow window: a log axis is locally linear, so use nice linear steps.
  if (decades < 0.3) {
    const values = niceTicks(lo, hi, 6);
    const step = values.length > 1 ? values[1] - values[0] : hi - lo;
    const dec = decimalsForStep(step);
    const decK = decimalsForStep(step / 1000);
    const label = (v: number) => (v >= 1000 ? trimZeros((v / 1000).toFixed(decK)) + "k" : trimZeros(v.toFixed(dec)));
    return {
      labelled: values.map((value) => ({ value, label: label(value), rank: 1 })),
      grid: values.map((value) => ({ value, strong: false })),
    };
  }

  const labelledSet = decades < 1.2 ? [1, 2, 3, 4, 5, 6, 7, 8, 9] : [1, 2, 5];
  const labelled: Tick[] = [];
  const grid: { value: number; strong: boolean }[] = [];
  const eps = 1e-9;
  for (let p = Math.floor(Math.log10(lo)); 10 ** p <= hi * (1 + eps); p++) {
    const dec = 10 ** p;
    for (let k = 1; k <= 9; k++) {
      // Rebuild from the exponent to keep values exact (2 * 10^3 = 2000, not 1999.9999).
      const v = Number((k * dec).toPrecision(12));
      if (v < lo * (1 - eps) || v > hi * (1 + eps)) continue;
      grid.push({ value: v, strong: k === 1 });
      if (labelledSet.includes(k)) {
        labelled.push({ value: v, label: formatHzTick(v), rank: k === 1 ? 0 : k === 5 ? 1 : k === 2 ? 2 : 3 });
      }
    }
  }
  return { labelled, grid };
}

/** "Nice" linear ticks (steps of 1, 2, 2.5, 5 x 10^n) covering [lo, hi] with about `target` intervals. */
export function niceTicks(lo: number, hi: number, target = 6): number[] {
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi <= lo) return [];
  const step = niceStep((hi - lo) / Math.max(1, target));
  const out: number[] = [];
  const first = Math.ceil(lo / step - 1e-9) * step;
  for (let v = first; v <= hi + step * 1e-9; v += step) {
    out.push(Number(v.toFixed(10)) + 0); // `+ 0` folds -0 into 0
    if (out.length > 200) break;
  }
  return out;
}

export function niceStep(raw: number): number {
  if (!(raw > 0)) return 1;
  const mag = 10 ** Math.floor(Math.log10(raw));
  for (const s of [1, 2, 2.5, 5, 10]) if (s * mag >= raw * (1 - 1e-9)) return s * mag;
  return 10 * mag;
}

/** Steps that read naturally on a phase axis, in degrees. */
const ANGLE_STEPS = [1, 2, 5, 10, 15, 30, 45, 90, 180, 360];

/** Ticks for an axis in degrees: multiples of 15/30/45/90 rather than 20/50/100. */
export function angleTicks(lo: number, hi: number, target = 6): number[] {
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi <= lo) return [];
  const raw = (hi - lo) / Math.max(1, target);
  const step = ANGLE_STEPS.find((s) => s >= raw * (1 - 1e-9)) ?? niceStep(raw);
  const out: number[] = [];
  for (let v = Math.ceil(lo / step - 1e-9) * step; v <= hi + step * 1e-9; v += step) out.push(Number(v.toFixed(10)) + 0);
  return out;
}

/**
 * Value ticks for a y axis of `heightPx`: about one per `pxPerTick`, but never fewer than three labels
 * (a short phase plot would otherwise get only "0").
 */
export function axisTicks(lo: number, hi: number, heightPx: number, angular: boolean, pxPerTick = angular ? 26 : 34): number[] {
  const gen = angular ? angleTicks : niceTicks;
  let target = Math.max(2, Math.round(heightPx / pxPerTick));
  let t = gen(lo, hi, target);
  while (t.length < 3 && target < 12) t = gen(lo, hi, ++target);
  return t;
}

/** Expand [lo, hi] outward to nice tick boundaries, e.g. for auto-ranged y axes. */
export function niceDomain(lo: number, hi: number, target = 6): Range {
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return [0, 1];
  if (hi - lo < 1e-12) {
    const pad = Math.abs(lo) > 1e-12 ? Math.abs(lo) * 0.1 : 1;
    lo -= pad;
    hi += pad;
  }
  const step = niceStep((hi - lo) / Math.max(1, target));
  return [Math.floor(lo / step + 1e-9) * step + 0, Math.ceil(hi / step - 1e-9) * step + 0];
}

// ---------------------------------------------------------------- mapping

export interface Scale {
  toPx(v: number): number;
  fromPx(px: number): number;
}

/** Linear or log10 mapping from a data domain to a pixel range (the range may run backwards, as y does). */
export function makeScale(domain: Range, range: Range, log: boolean): Scale {
  const t = log ? Math.log10 : (v: number) => v;
  const inv = log ? (u: number) => 10 ** u : (u: number) => u;
  const d0 = t(domain[0]);
  const d1 = t(domain[1]);
  const k = (range[1] - range[0]) / (d1 - d0 || 1);
  return {
    toPx: (v) => range[0] + (t(v) - d0) * k,
    fromPx: (px) => inv(d0 + (px - range[0]) / k),
  };
}

// ---------------------------------------------------------------- view manipulation

const fwd = (v: number, log: boolean) => (log ? Math.log10(v) : v);
const back = (u: number, log: boolean) => (log ? 10 ** u : u);

/** Zoom a view about `center` (data units). factor < 1 zooms in. */
export function zoomAt(view: Range, center: number, factor: number, log: boolean): Range {
  const c = fwd(center, log);
  const a = fwd(view[0], log);
  const b = fwd(view[1], log);
  return [back(c + (a - c) * factor, log), back(c + (b - c) * factor, log)];
}

/** Shift a view by a pixel distance (positive = content moves right, so the view moves left). */
export function panBy(view: Range, deltaPx: number, spanPx: number, log: boolean): Range {
  const a = fwd(view[0], log);
  const b = fwd(view[1], log);
  const d = ((b - a) * deltaPx) / (spanPx || 1);
  return [back(a - d, log), back(b - d, log)];
}

/**
 * Keep a view inside `bounds` and no narrower than `minSpan` (in transformed units: decades for log).
 * A view wider than the bounds collapses to the bounds; otherwise it slides back inside.
 */
export function clampView(view: Range, bounds: Range, minSpan: number, log: boolean): Range {
  let a = fwd(view[0], log);
  let b = fwd(view[1], log);
  const A = fwd(bounds[0], log);
  const B = fwd(bounds[1], log);
  if (b - a < minSpan) {
    const c = (a + b) / 2;
    a = c - minSpan / 2;
    b = c + minSpan / 2;
  }
  if (b - a >= B - A) return [bounds[0], bounds[1]];
  if (a < A) {
    b += A - a;
    a = A;
  }
  if (b > B) {
    a -= b - B;
    b = B;
  }
  return [back(a, log), back(b, log)];
}

/** Interpolate between two views (log-space for log axes) for animated transitions. */
export function lerpView(from: Range, to: Range, t: number, log: boolean): Range {
  const l = (p: number, q: number) => back(fwd(p, log) + (fwd(q, log) - fwd(p, log)) * t, log);
  return [l(from[0], to[0]), l(from[1], to[1])];
}

export function sameRange(a: Range | undefined, b: Range | undefined, tol = 1e-9): boolean {
  if (!a || !b) return a === b;
  const s = Math.max(Math.abs(a[1] - a[0]), 1e-12);
  return Math.abs(a[0] - b[0]) <= tol * s && Math.abs(a[1] - b[1]) <= tol * s;
}

/** Ease matching the design token --ease: cubic-bezier(.2,.8,.2,1). */
export function easeOut(t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  // Solve the bezier x(s) = t by Newton iteration, then return y(s).
  const x1 = 0.2, y1 = 0.8, x2 = 0.2, y2 = 1;
  const bx = (s: number) => 3 * (1 - s) ** 2 * s * x1 + 3 * (1 - s) * s ** 2 * x2 + s ** 3;
  const dbx = (s: number) => 3 * (1 - s) ** 2 * x1 + 6 * (1 - s) * s * (x2 - x1) + 3 * s ** 2 * (1 - x2);
  let s = t;
  for (let i = 0; i < 6; i++) {
    const d = dbx(s);
    if (Math.abs(d) < 1e-6) break;
    s = Math.min(1, Math.max(0, s - (bx(s) - t) / d));
  }
  return 3 * (1 - s) ** 2 * s * y1 + 3 * (1 - s) * s ** 2 * y2 + s ** 3;
}

// ---------------------------------------------------------------- data lookup

/**
 * Index of the sample nearest to `x` in an ascending array (binary search, O(log n)).
 * Returns -1 for an empty array.
 */
export function nearestIndex(xs: ArrayLike<number>, x: number, log = false): number {
  const n = xs.length;
  if (n === 0) return -1;
  if (!(x > xs[0])) return 0;
  if (!(x < xs[n - 1])) return n - 1;
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (xs[m] < x) lo = m;
    else hi = m;
  }
  // On a log axis "nearest" means nearest in ratio, which is what the eye sees.
  const dl = log ? Math.log(x / xs[lo]) : x - xs[lo];
  const dh = log ? Math.log(xs[hi] / x) : xs[hi] - x;
  return dl <= dh ? lo : hi;
}

/** Index window [i0, i1] covering [lo, hi], widened by one sample each side so lines run off the edge. */
export function visibleSlice(xs: ArrayLike<number>, lo: number, hi: number): [number, number] {
  const n = xs.length;
  if (n === 0) return [0, -1];
  let a = 0;
  let b = n - 1;
  // Lower bound: first index with xs >= lo.
  let l = 0, h = n;
  while (l < h) {
    const m = (l + h) >> 1;
    if (xs[m] < lo) l = m + 1;
    else h = m;
  }
  a = Math.max(0, l - 1);
  l = 0; h = n;
  while (l < h) {
    const m = (l + h) >> 1;
    if (xs[m] <= hi) l = m + 1;
    else h = m;
  }
  b = Math.min(n - 1, l);
  return [a, b];
}

/**
 * Min/max decimation for drawing huge series: for every pixel column keeps the first, minimum,
 * maximum and last sample (in original order), so the drawn envelope is identical to drawing every
 * point. Non-finite samples are kept, because they mark line breaks.
 *
 * @param toPx maps an x value to a pixel column (fractional is fine)
 * @returns indices into x / y, ascending
 */
export function decimate(
  x: ArrayLike<number>,
  y: ArrayLike<number>,
  i0: number,
  i1: number,
  toPx: (v: number) => number,
): Int32Array {
  const out = new Int32Array(Math.max(0, (i1 - i0 + 1)));
  let n = 0;
  let col = NaN;
  let first = -1, last = -1, iMin = -1, iMax = -1;
  const flush = () => {
    if (first < 0) return;
    // Emit the bucket's samples in index order without duplicates.
    const pick = [first, iMin, iMax, last].sort((p, q) => p - q);
    let prev = -1;
    for (const i of pick) if (i !== prev && i >= 0) { out[n++] = i; prev = i; }
  };
  for (let i = i0; i <= i1; i++) {
    const yi = y[i];
    if (!Number.isFinite(yi)) {
      flush();
      first = last = iMin = iMax = -1;
      col = NaN;
      out[n++] = i;
      continue;
    }
    const c = Math.floor(toPx(x[i]));
    if (c !== col) {
      flush();
      col = c;
      first = last = iMin = iMax = i;
      continue;
    }
    last = i;
    if (yi < y[iMin]) iMin = i;
    if (yi > y[iMax]) iMax = i;
  }
  flush();
  return out.slice(0, n);
}

/** Wrap degrees into (-180, 180]. */
export function wrapDeg(d: number): number {
  const w = ((((d + 180) % 360) + 360) % 360) - 180;
  return w === -180 ? 180 : w;
}

/** Wrap radians into (-pi, pi]. */
export function wrapRad(r: number): number {
  return (wrapDeg((r * 180) / Math.PI) * Math.PI) / 180;
}

/** Finite min/max of y over the samples whose x lies in [lo, hi]; null when there are none. */
export function extentIn(
  x: ArrayLike<number>,
  y: ArrayLike<number>,
  lo: number,
  hi: number,
): Range | null {
  let mn = Infinity;
  let mx = -Infinity;
  const [a, b] = visibleSlice(x, lo, hi);
  for (let i = a; i <= b; i++) {
    const xi = x[i];
    if (xi < lo || xi > hi) continue;
    const v = y[i];
    if (!Number.isFinite(v)) continue;
    if (v < mn) mn = v;
    if (v > mx) mx = v;
  }
  return mn <= mx ? [mn, mx] : null;
}
