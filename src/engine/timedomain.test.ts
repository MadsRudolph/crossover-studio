// Time domain: the group-delay estimator against analytic all-pass and pure-delay responses, the
// audibility threshold, and sanity of the bundled design's group delay, impulse and step.
import { describe, expect, it } from "vitest";
import profileJson from "../../profiles/system-d-group10/profile.json";
import { defaultDesign } from "../state/store";
import type { CArray, Profile } from "../types";
import { compute, fitBox, prepare } from ".";
import { hDigital } from "./digital";
import { logspace } from "./complex";
import { gdThreshold, groupDelay, groupDelayAnalysis, impulseAnalysis, refDelayOf } from "./timedomain";

const profile = profileJson as unknown as Profile;
const p = prepare(profile, fitBox(profile));
const design = defaultDesign(profile);
const results = compute(p, design);

/** Group delay of the 2nd-order all-pass an ideal LR4 sum equals (Q = 1/sqrt 2):
 *  tau(w) = 2 (w0/Q)(w0^2 + w^2) / ((w0^2 - w^2)^2 + (w0 w / Q)^2). */
function lr4SumGd(fHz: number, f0: number): number {
  const w = 2 * Math.PI * fHz, w0 = 2 * Math.PI * f0, Q = Math.SQRT1_2;
  return 2 * (w0 / Q) * (w0 * w0 + w * w) / ((w0 * w0 - w * w) ** 2 + (w0 * w / Q) ** 2);
}

describe("group delay estimator", () => {
  it("a pure 7 ms delay reads 7 ms everywhere, and 0 once the same delay is the reference", () => {
    const f = Array.from(results.f), tau = 0.007;
    const z: CArray = { re: new Float64Array(f.map(x => Math.cos(-2 * Math.PI * x * tau))), im: new Float64Array(f.map(x => Math.sin(-2 * Math.PI * x * tau))) };
    // without a reference the neighbour phase step wraps above 1 / (2 tau) grid spacing: compare below it
    const g = groupDelay(f, z, 0, 0);
    f.forEach((x, i) => { if (f[i + 1] - x < 1 / (2 * tau) && i < f.length - 1) expect(g[i]).toBeCloseTo(tau, 9); });
    const r = groupDelay(f, z, tau);
    r.forEach(v => expect(Math.abs(v)).toBeLessThan(1e-9));
  });

  it("an ideal LR4 sum (digital biquads, 1 kHz) matches the analytic all-pass group delay within 1 %", () => {
    const f = logspace(50, 20000, 600), f0 = 1000;
    const L = hDigital(f, f0, "LPF", "LR4"), H = hDigital(f, f0, "HPF", "LR4");
    const s: CArray = { re: new Float64Array(f.length), im: new Float64Array(f.length) };
    for (let i = 0; i < f.length; i++) { s.re[i] = L.re[i] + H.re[i]; s.im[i] = L.im[i] + H.im[i]; }
    const g = groupDelay(f, s, 0, 0);
    for (let i = 1; i < f.length - 1; i++) {
      if (f[i] > 4000) continue;                                          // bilinear warping grows above
      expect(Math.abs(g[i] / lr4SumGd(f[i], f0) - 1)).toBeLessThan(0.01);
    }
    // at f0 and at DC the all-pass delay is 2 sqrt 2 / w0 = 0.45 ms
    expect(g[f.findIndex(x => x >= f0)] * 1e3).toBeCloseTo(2 * Math.SQRT2 / (2 * Math.PI * f0) * 1e3, 1);
  });

  it("smoothing keeps the analytic value where the curve is smooth", () => {
    const f = logspace(50, 20000, 600), L = hDigital(f, 325, "LPF", "LR4"), H = hDigital(f, 325, "HPF", "LR4");
    const s: CArray = { re: new Float64Array(f.length), im: new Float64Array(f.length) };
    for (let i = 0; i < f.length; i++) { s.re[i] = L.re[i] + H.re[i]; s.im[i] = L.im[i] + H.im[i]; }
    const g = groupDelay(f, s, 0, 1 / 6), i = f.findIndex(x => x >= 325);
    expect(Math.abs(g[i] / lr4SumGd(f[i], 325) - 1)).toBeLessThan(0.03);
  });
});

describe("audibility threshold (Blauert & Laws)", () => {
  it("has the published points and the 1.6-cycle extension below 500 Hz", () => {
    expect(gdThreshold(500)).toBeCloseTo(3.2e-3, 9);
    expect(gdThreshold(1000)).toBeCloseTo(2e-3, 9);
    expect(gdThreshold(2000)).toBeCloseTo(1e-3, 9);
    expect(gdThreshold(4000)).toBeCloseTo(1.5e-3, 9);
    expect(gdThreshold(16000)).toBeCloseTo(2e-3, 9);
    expect(gdThreshold(50)).toBeCloseTo(0.032, 9);
  });
});

describe("the bundled design", () => {
  const a = groupDelayAnalysis(p, design, results, "0");
  const at = (x: number) => { let i = 0; while (a.f[i] < x) i++; return i; };

  it("runs fast and covers 20 Hz to the top of the grid", () => {
    // best of five, so a busy test machine does not fail it
    const best = Math.min(...[0, 1, 2, 3, 4].map(() => { const t = performance.now(); groupDelayAnalysis(p, design, results, "0"); return performance.now() - t; }));
    expect(best).toBeLessThan(10);
    expect(a.f[0]).toBeCloseTo(20, 6);
    expect(a.f[a.f.length - 1]).toBe(results.f[results.f.length - 1]);
  });

  it("the bass delay rises towards the box tuning and stays inside what is plausible for a vented box", () => {
    const g30 = a.gd.sum[at(30)], g100 = a.gd.sum[at(100)], g1k = a.gd.sum[at(1000)];
    expect(g30).toBeGreaterThan(g100);
    expect(g100).toBeGreaterThan(g1k);
    expect(g30).toBeGreaterThan(5);
    expect(g30).toBeLessThan(40);
    // high up the sum is the tweeter: a fraction of a millisecond around the reference
    expect(Math.abs(a.gd.sum[at(10000)])).toBeLessThan(0.5);
    expect(a.bass.audible).toBe(false);
  });

  it("reports both crossovers with the units close in phase there", () => {
    expect(a.xover.wm?.f).toBeCloseTo(results.metrics.x_wm!, -1);
    expect(a.xover.mt?.f).toBeCloseTo(results.metrics.x_mt!, -1);
    expect(Math.abs(a.xover.wm!.phaseDeg)).toBeLessThan(60);
    expect(Math.abs(a.xover.mt!.phaseDeg)).toBeLessThan(60);
    expect(Number.isFinite(a.xover.mt!.leadMs)).toBe(true);
  });

  it("impulse peaks near 0 ms with the tweeter first and the woofer last; the step settles to 0", () => {
    const r = impulseAnalysis(p, design, results, "0");
    let j = 0;
    for (let q = 1; q < r.t.length; q++) if (Math.abs(r.impulse.sum[q]) > Math.abs(r.impulse.sum[j])) j = q;
    expect(Math.abs(r.t[j])).toBeLessThan(0.5);
    expect(Math.abs(r.impulse.sum[j])).toBeCloseTo(1, 9);
    expect(r.coherence.order[2]).toBe("woof");
    expect(r.coherence.coherent).toBe(false);
    // no DC through a loudspeaker: the step decays back towards zero by the end of the window
    expect(Math.abs(r.step.sum[r.t.length - 1])).toBeLessThan(0.1);
    expect(r.t[0]).toBeCloseTo(-2, 1);
    expect(r.t[r.t.length - 1]).toBeCloseTo(40, 1);
  });

  it("puts the 30° run (18 ms early in the bundled data) on the on-axis time base", () => {
    const off = groupDelayAnalysis(p, design, results, "30"), on = a;
    expect(Math.abs(off.xover.mt!.gdSum - on.xover.mt!.gdSum)).toBeLessThan(0.2);
    expect(Math.abs(off.xover.wm!.gdSum - on.xover.wm!.gdSum)).toBeLessThan(1);
    const r = impulseAnalysis(p, design, results, "30");
    expect(r.coherence.order[0]).toBe("tw");
    expect(Math.abs(r.arrival.tw)).toBeLessThan(0.5);
  });

  it("time zero is the profile's reference distance", () => {
    expect(refDelayOf(p)).toBeCloseTo(profile.conditions.phase_ref_distance_m / 345, 12);
  });
});
