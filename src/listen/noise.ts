// Test signals for the Listen view, rendered once into plain arrays (the player copies them into
// AudioBuffers): looping pink noise, a logarithmic sweep, and the centre of each band-noise octave.
// Pure maths, no DOM: unit-tested in noise.test.ts.

import type { Metrics, Profile } from "../types";

/** Level of every rendered test signal (dBFS RMS). */
export const SIGNAL_DBFS = -12;
const TARGET_RMS = 10 ** (SIGNAL_DBFS / 20);

/** Small deterministic PRNG (mulberry32), so the noise and the tests are repeatable. */
export function rng(seed = 0x5eed): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function normaliseRms(x: Float32Array, rms = TARGET_RMS): Float32Array {
  let s = 0;
  for (let i = 0; i < x.length; i++) s += x[i] * x[i];
  const k = s > 0 ? rms / Math.sqrt(s / x.length) : 0;
  for (let i = 0; i < x.length; i++) x[i] *= k;
  return x;
}

/**
 * Pink noise (-3 dB/octave power density) by Paul Kellet's refined 7-pole filter on white noise,
 * `seconds` long at fs, at -12 dBFS RMS. The last 50 ms are cross-faded into the start so the buffer
 * loops without a click.
 */
export function pinkNoise(fs: number, seconds = 10, seed = 0x5eed): Float32Array {
  const n = Math.round(fs * seconds), xf = Math.round(0.05 * fs), rand = rng(seed);
  const raw = new Float32Array(n + xf);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  // run the filter in for a second so it starts in its steady state
  for (let i = -fs; i < n + xf; i++) {
    const w = rand() * 2 - 1;
    b0 = 0.99886 * b0 + w * 0.0555179;
    b1 = 0.99332 * b1 + w * 0.0750759;
    b2 = 0.969 * b2 + w * 0.153852;
    b3 = 0.8665 * b3 + w * 0.3104856;
    b4 = 0.55 * b4 + w * 0.5329522;
    b5 = -0.7616 * b5 - w * 0.016898;
    const y = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
    b6 = w * 0.115926;
    if (i >= 0) raw[i] = y;
  }
  const out = raw.slice(0, n);
  // equal-power cross-fade of the tail (n .. n+xf) into the head (0 .. xf)
  for (let i = 0; i < xf; i++) {
    const t = (i + 0.5) / xf, a = Math.sin(0.5 * Math.PI * t), b = Math.cos(0.5 * Math.PI * t);
    out[i] = a * raw[i] + b * raw[n + i];
  }
  return normaliseRms(out);
}

/**
 * Exponential sine sweep f1 -> f2 over `seconds` (Farina), at -12 dBFS RMS, with 20 ms raised-cosine
 * fades at both ends and `gap` seconds of silence after it before the loop starts again.
 */
export function logSweep(fs: number, seconds = 10, f1 = 20, f2 = 20000, gap = 0.5): Float32Array {
  const n = Math.round(fs * seconds), out = new Float32Array(n + Math.round(gap * fs));
  const L = seconds / Math.log(f2 / f1), fadeN = Math.round(0.02 * fs);
  for (let i = 0; i < n; i++) {
    const t = i / fs;
    let v = Math.sin(2 * Math.PI * f1 * L * (Math.exp(t / L) - 1));
    if (i < fadeN) v *= 0.5 * (1 - Math.cos(Math.PI * i / fadeN));
    else if (i >= n - fadeN) v *= 0.5 * (1 - Math.cos(Math.PI * (n - 1 - i) / fadeN));
    out[i] = v;
  }
  // a sine of RMS -12 dBFS (the fades and the silence are left out of the RMS)
  const k = TARGET_RMS * Math.SQRT2;
  for (let i = 0; i < n; i++) out[i] *= k;
  return out;
}

/** Instantaneous frequency of the sweep at time t (s), for the transport read-out. */
export function sweepFrequency(t: number, seconds = 10, f1 = 20, f2 = 20000): number | null {
  if (t < 0 || t > seconds) return null;
  return f1 * (f2 / f1) ** (t / seconds);
}

export type Band = "wm" | "mt";

/**
 * Centre (Hz) of the one-octave band noise around a crossover: the acoustic crossing when there is
 * one, else the geometric centre of the profile's search window for it.
 */
export function bandCentre(m: Metrics | null | undefined, limits: Profile["limits"] | null | undefined, band: Band): number {
  const x = band === "wm" ? m?.x_wm : m?.x_mt;
  if (x && Number.isFinite(x) && x > 0) return x;
  const r = limits?.[band] ?? (band === "wm" ? [250, 600] : [2200, 4000]);
  return Math.sqrt(r[0] * r[1]);
}

/** The high-pass and low-pass corners (Hz) of the one-octave band around fc: fc/sqrt2 .. fc*sqrt2. */
export function octaveEdges(fc: number): [number, number] {
  return [fc / Math.SQRT2, fc * Math.SQRT2];
}
