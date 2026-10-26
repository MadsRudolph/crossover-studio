// Complex arithmetic for the engine. Two representations:
//  - Cx, a [re, im] pair, for per-point maths in loops (short-lived, V8 handles these well);
//  - CArray (types.ts), two Float64Arrays, for whole curves that leave the engine.
// Hot loops that run millions of times (the box fit) inline the real arithmetic instead.

import type { CArray, Series } from "../types";

export type Cx = [number, number];

export const cx = (re: number, im = 0): Cx => [re, im];
export const cadd = (a: Cx, b: Cx): Cx => [a[0] + b[0], a[1] + b[1]];
export const csub = (a: Cx, b: Cx): Cx => [a[0] - b[0], a[1] - b[1]];
export const cmul = (a: Cx, b: Cx): Cx => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];
export const cscale = (a: Cx, k: number): Cx => [a[0] * k, a[1] * k];
export function cdiv(a: Cx, b: Cx): Cx {
  const d = b[0] * b[0] + b[1] * b[1];
  return [(a[0] * b[0] + a[1] * b[1]) / d, (a[1] * b[0] - a[0] * b[1]) / d];
}
export function cinv(a: Cx): Cx {
  const d = a[0] * a[0] + a[1] * a[1];
  return [a[0] / d, -a[1] / d];
}
export const cabs = (a: Cx): number => Math.hypot(a[0], a[1]);
/** Parallel combination of two impedances, Z1 Z2 / (Z1 + Z2), via admittances. */
export const cpar = (a: Cx, b: Cx): Cx => cinv(cadd(cinv(a), cinv(b)));

// ---------------------------------------------------------------- arrays
export function carray(n: number): CArray {
  return { re: new Float64Array(n), im: new Float64Array(n) };
}
export const cget = (z: CArray, i: number): Cx => [z.re[i], z.im[i]];
export function cset(z: CArray, i: number, v: Cx): void {
  z.re[i] = v[0]; z.im[i] = v[1];
}
export const cabsAt = (z: CArray, i: number): number => Math.hypot(z.re[i], z.im[i]);
/** 20 log10 |z_i|. */
export const dbAt = (z: CArray, i: number): number => 20 * Math.log10(Math.hypot(z.re[i], z.im[i]));
export function dbArray(z: CArray): Float64Array {
  const out = new Float64Array(z.re.length);
  for (let i = 0; i < out.length; i++) out[i] = dbAt(z, i);
  return out;
}
export function ones(n: number): CArray {
  const z = carray(n);
  z.re.fill(1);
  return z;
}
export function fromSeries(s: Series): CArray {
  return { re: Float64Array.from(s.re), im: Float64Array.from(s.im) };
}
export function scaleArray(z: CArray, k: number): CArray {
  return { re: z.re.map(v => v * k), im: z.im.map(v => v * k) };
}

/** Linear interpolation of re and im on a log-frequency axis (numpy.interp on log f, ends held),
 *  which is how xover.py puts the Lab D impedances onto the Lab E grid. */
export function interpLogF(src: Series, f: ArrayLike<number>): CArray {
  const n = src.f.length;
  if (n === 0) throw new Error("cannot interpolate an empty series");
  const lf = src.f.map(Math.log), out = carray(f.length);
  if (n === 1) { out.re.fill(src.re[0]); out.im.fill(src.im[0]); return out; }
  let k = 0;
  for (let i = 0; i < f.length; i++) {
    const x = Math.log(f[i]);
    // the target grid is ascending, so the bracket only moves forward
    if (i > 0 && f[i] < f[i - 1]) k = 0;
    while (k < n - 2 && lf[k + 1] < x) k++;
    const t = Math.min(1, Math.max(0, (x - lf[k]) / (lf[k + 1] - lf[k])));
    out.re[i] = src.re[k] + t * (src.re[k + 1] - src.re[k]);
    out.im[i] = src.im[k] + t * (src.im[k + 1] - src.im[k]);
  }
  return out;
}

/** Index of the grid point nearest to x, on a log axis (default, for display) or a linear one
 *  (numpy.argmin(|f - x|), as xover.py picks the tweeter-resonance point). First match wins ties. */
export function nearestIndex(f: ArrayLike<number>, x: number, scale: "log" | "lin" = "log"): number {
  let best = 0, bd = Infinity;
  const lx = Math.log(x);
  for (let i = 0; i < f.length; i++) {
    const d = scale === "log" ? Math.abs(Math.log(f[i]) - lx) : Math.abs(f[i] - x);
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

/** n log-spaced points from a to b inclusive. */
export function logspace(a: number, b: number, n: number): number[] {
  return Array.from({ length: n }, (_, i) => a * (b / a) ** (i / (n - 1)));
}
