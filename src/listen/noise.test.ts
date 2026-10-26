import { describe, expect, it } from "vitest";
import { fft } from "./fft";
import { SIGNAL_DBFS, bandCentre, logSweep, octaveEdges, pinkNoise, sweepFrequency } from "./noise";
import type { Metrics } from "../types";

/** Mean power density per FFT bin (Welch, Hann, 8192 points) of x. */
function psd(x: Float32Array, n = 8192): Float64Array {
  const out = new Float64Array(n / 2 + 1), re = new Float64Array(n), im = new Float64Array(n);
  let segs = 0;
  for (let s = 0; s + n <= x.length; s += n / 2, segs++) {
    for (let i = 0; i < n; i++) { re[i] = x[s + i] * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / n)); im[i] = 0; }
    fft(re, im);
    for (let k = 0; k <= n / 2; k++) out[k] += re[k] * re[k] + im[k] * im[k];
  }
  return out.map(v => v / segs);
}
const rmsDb = (x: Float32Array) => 10 * Math.log10(x.reduce((a, v) => a + v * v, 0) / x.length);

describe("pink noise", () => {
  const fs = 48000, x = pinkNoise(fs, 10);
  it("is -12 dBFS RMS and 10 s long", () => {
    expect(x.length).toBe(480000);
    expect(rmsDb(x)).toBeCloseTo(SIGNAL_DBFS, 6);
  });
  it("power density falls 3 ± 0.6 dB per octave from 125 Hz to 8 kHz", () => {
    const P = psd(x), n = 8192, centres = [125, 250, 500, 1000, 2000, 4000, 8000];
    // mean density over each octave band (energy per hertz)
    const band = centres.map(fc => {
      const a = Math.ceil(fc / Math.SQRT2 * n / fs), b = Math.floor(fc * Math.SQRT2 * n / fs);
      let s = 0; for (let k = a; k <= b; k++) s += P[k];
      return 10 * Math.log10(s / (b - a + 1));
    });
    for (let i = 1; i < band.length; i++) expect(Math.abs(band[i - 1] - band[i] - 3)).toBeLessThan(0.6);
  });
  it("loops without a step: the end runs into the start", () => {
    const step = Math.abs(x[x.length - 1] - x[0]), typical = 10 ** (SIGNAL_DBFS / 20);
    expect(step).toBeLessThan(2 * typical);
  });
});

describe("sweep and bands", () => {
  it("the log sweep is 10 s of -12 dBFS RMS sine plus a short gap", () => {
    const fs = 8000, s = logSweep(fs, 10, 20, 2000);
    expect(s.length).toBe(fs * 10.5);
    expect(rmsDb(s.slice(fs, fs * 9))).toBeCloseTo(SIGNAL_DBFS, 0);
    expect(sweepFrequency(5, 10, 20, 20000)).toBeCloseTo(Math.sqrt(20 * 20000), 6);
  });
  it("band noise centres on the crossing, else on the profile's window", () => {
    const m = { x_wm: 320, x_mt: null } as unknown as Metrics;
    expect(bandCentre(m, { wm: [250, 600], mt: [2200, 4000], tw_fs_hz: 1450 }, "wm")).toBe(320);
    expect(bandCentre(m, { wm: [250, 600], mt: [2200, 4000], tw_fs_hz: 1450 }, "mt")).toBeCloseTo(Math.sqrt(2200 * 4000), 9);
    const [lo, hi] = octaveEdges(1000);
    expect(hi / lo).toBeCloseTo(2, 12);
  });
});
