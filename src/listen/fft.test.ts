import { describe, expect, it } from "vitest";
import { dtft, fft, irfft, rfft } from "./fft";
import { rng } from "./noise";

describe("fft", () => {
  it("ifft(fft(x)) returns a random 1024-point vector within 1e-12", () => {
    const r = rng(7), n = 1024, re = new Float64Array(n), im = new Float64Array(n);
    for (let i = 0; i < n; i++) { re[i] = r() * 2 - 1; im[i] = r() * 2 - 1; }
    const x = Float64Array.from(re), y = Float64Array.from(im);
    fft(re, im); fft(re, im, true);
    for (let i = 0; i < n; i++) { expect(Math.abs(re[i] - x[i])).toBeLessThan(1e-12); expect(Math.abs(im[i] - y[i])).toBeLessThan(1e-12); }
  });
  it("matches the direct DFT and the DTFT on the bins", () => {
    const r = rng(3), n = 64, x = Array.from({ length: n }, () => r() - 0.5);
    const S = rfft(x);
    for (const k of [0, 1, 5, 17, 32]) {
      let sr = 0, si = 0;
      for (let i = 0; i < n; i++) { sr += x[i] * Math.cos(-2 * Math.PI * k * i / n); si += x[i] * Math.sin(-2 * Math.PI * k * i / n); }
      expect(S.re[k]).toBeCloseTo(sr, 10); expect(S.im[k]).toBeCloseTo(si, 10);
      const [dr, di] = dtft(x, k * 1000 / n, 1000);
      expect(dr).toBeCloseTo(sr, 10); expect(di).toBeCloseTo(si, 10);
    }
  });
  it("irfft inverts rfft for a real signal", () => {
    const r = rng(11), n = 256, x = Array.from({ length: n }, () => r() - 0.5);
    const S = rfft(x), y = irfft(S.re, S.im, n);
    for (let i = 0; i < n; i++) expect(Math.abs(y[i] - x[i])).toBeLessThan(1e-13);
  });
  it("rejects lengths that are not a power of two", () => {
    expect(() => fft(new Float64Array(12), new Float64Array(12))).toThrow(/power of two/);
  });
});
