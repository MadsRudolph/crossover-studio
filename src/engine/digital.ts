// The MiniDSP crossover, as the course's DigitalCrossover.m designs it: cascaded RBJ ("Audio EQ
// Cookbook") biquads at fs = 96 kHz, evaluated exactly on the unit circle (no analog approximation),
// and the two text formats the MiniDSP plug-in and LTspice accept.

import type { Align, CArray } from "../types";
import { carray } from "./complex";

/** MiniDSP 2x4 sample rate (Hz). */
export const FS_DSP = 96e3;

export type FilterKind = "LPF" | "HPF";
/** One biquad section [b0, b1, b2, a1, a2], normalised to a0 = 1, MATLAB sign convention
 *  (H(z) = (b0 + b1 z^-1 + b2 z^-2) / (1 + a1 z^-1 + a2 z^-2)). */
export type Biquad = [number, number, number, number, number];

/** RBJ cookbook low- or high-pass biquad at f0 (Hz) with quality factor Q. */
export function biquad(f0: number, Q: number, kind: FilterKind, fs = FS_DSP): Biquad {
  const w0 = 2 * Math.PI * f0 / fs, al = Math.sin(w0) / (2 * Q), a0 = 1 + al, c = Math.cos(w0);
  const b0 = kind === "LPF" ? (1 - c) / 2 / a0 : (1 + c) / 2 / a0;
  const b1 = kind === "LPF" ? (1 - c) / a0 : -(1 + c) / a0;
  return [b0, b1, b0, -2 * c / a0, (1 - al) / a0];
}

/** Section Qs of each alignment, all at the same f0.
 *  - BW2: one Butterworth section (Q = 1/sqrt 2), -3 dB at fc; LP and HP are 180 degrees apart, so
 *    with one of them inverted the sum has a +3 dB bump at fc (flat power response).
 *  - LR2: one section with Q = 0.5, i.e. two coincident real poles = two cascaded first-order
 *    filters = 2nd-order Linkwitz-Riley. LP and HP are -6 dB at fc and 180 degrees apart at every
 *    frequency: invert the high-passed units (pol.mid = pol.tw = -1) for a flat sum.
 *  - LR4: two Butterworth sections (Linkwitz-Riley 4th order); LP and HP in phase, sum flat.
 *  - BW4: 4th-order Butterworth, Q = 1/(2 cos(pi/8)) and 1/(2 cos(3 pi/8)). */
export const ALIGN_Q: Record<Align, number[]> = {
  BW2: [Math.SQRT1_2],
  LR2: [0.5],
  LR4: [Math.SQRT1_2, Math.SQRT1_2],
  BW4: [1 / (2 * Math.cos(Math.PI / 8)), 1 / (2 * Math.cos(3 * Math.PI / 8))],
};

/** Human names for the alignment picker. */
export const ALIGNMENTS: { key: Align; name: string; order: number; note: string }[] = [
  { key: "BW2", name: "Butterworth 2nd", order: 2, note: "12 dB/oct, −3 dB at fc; invert the high-passed units" },
  { key: "LR2", name: "Linkwitz-Riley 2nd", order: 2, note: "12 dB/oct, −6 dB at fc; invert the high-passed units" },
  { key: "LR4", name: "Linkwitz-Riley 4th", order: 4, note: "24 dB/oct, −6 dB at fc, in phase" },
  { key: "BW4", name: "Butterworth 4th", order: 4, note: "24 dB/oct, −3 dB at fc" },
];

export function sections(f0: number, kind: FilterKind, align: Align): Biquad[] {
  const Qs = ALIGN_Q[align];
  if (!Qs) throw new Error(`unknown alignment "${align}"`);
  return Qs.map(Q => biquad(f0, Q, kind));
}

/** Frequency response of the cascade at the frequencies f (Hz): H(e^{j 2 pi f / fs}). */
export function hDigital(f: ArrayLike<number>, f0: number, kind: FilterKind, align: Align): CArray {
  const secs = sections(f0, kind, align), n = f.length, H = carray(n);
  for (let i = 0; i < n; i++) {
    const t = -2 * Math.PI * f[i] / FS_DSP;
    const c1 = Math.cos(t), s1 = Math.sin(t), c2 = Math.cos(2 * t), s2 = Math.sin(2 * t);
    let hr = 1, hi = 0;
    for (const [b0, b1, b2, a1, a2] of secs) {
      const nr = b0 + b1 * c1 + b2 * c2, ni = b1 * s1 + b2 * s2;
      const dr = 1 + a1 * c1 + a2 * c2, di = a1 * s1 + a2 * s2;
      const dd = dr * dr + di * di;
      const qr = (nr * dr + ni * di) / dd, qi = (ni * dr - nr * di) / dd;
      const r = hr * qr - hi * qi; hi = hr * qi + hi * qr; hr = r;
    }
    H.re[i] = hr; H.im[i] = hi;
  }
  return H;
}

/** MATLAB's %.15g (num2str(x, 15)), which the LTspice Laplace strings use. */
export function g15(x: number): string {
  if (x === 0) return "0";
  const [m, e] = x.toExponential(14).split("e"), ex = parseInt(e, 10);
  if (ex < -4 || ex >= 15) {
    const mm = m.replace(/\.?0+$/, "");
    return `${mm}e${ex < 0 ? "-" : "+"}${String(Math.abs(ex)).padStart(2, "0")}`;
  }
  let s = x.toPrecision(15);
  if (s.includes(".")) s = s.replace(/0+$/, "").replace(/\.$/, "");
  return s;
}

/** The biquad block DigitalCrossover.m prints for the MiniDSP "custom" filter (note the a-sign flip). */
export function minidspText(f0: number, kind: FilterKind, align: Align): string {
  return sections(f0, kind, align).map(([b0, b1, b2, a1, a2], k) =>
    `\n biquad${k + 1}, \n b0 = ${b0.toFixed(15)}, \n b1 = ${b1.toFixed(15)}, \n b2 = ${b2.toFixed(15)}, ` +
    `\n a1 = ${(-a1).toFixed(15)}, \n a2 = ${(-a2).toFixed(15)}, `).join("");
}

/** One LTspice behavioural-source Laplace expression per section (z^-1 = exp(-s T)). */
export function ltspiceText(f0: number, kind: FilterKind, align: Align): string[] {
  const T = g15(1 / FS_DSP);
  return sections(f0, kind, align).map(([b0, b1, b2, a1, a2]) =>
    `Laplace=(${g15(b0)}+${g15(b1)}*exp(-s*${T})+${g15(b2)}*exp(-2*s*${T}))/(1+${g15(a1)}*exp(-s*${T})+${g15(a2)}*exp(-2*s*${T}))`);
}
