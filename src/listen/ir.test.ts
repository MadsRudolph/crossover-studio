import { describe, expect, it } from "vitest";
import profileJson from "../../profiles/system-d-group10/profile.json";
import { defaultDesign } from "../state/store";
import { boxResponse, compute, fitBox, prepare } from "../engine";
import type { CArray, Profile } from "../types";
import { UNIT_IDS } from "../types";
import { dtft } from "./fft";
import {
  IR_FS, IR_N, buildIrs, estimateDelay, flatIr, irMagnitude, irResponseAt, irsFromResults, makeTarget, mixIr, preDelay, unitIr,
} from "./ir";

const profile = profileJson as unknown as Profile;
const prep = prepare(profile, fitBox(profile));
const design = defaultDesign(profile);
const results = compute(prep, design);
const f = results.f;
const dB = (r: number, i: number) => 20 * Math.log10(Math.hypot(r, i));
const wrapDeg = (x: number) => ((x * 180 / Math.PI + 540) % 360) - 180;
const ones = (n: number): CArray => ({ re: new Float64Array(n).fill(1), im: new Float64Array(n) });
const zeros = (n: number): CArray => ({ re: new Float64Array(n), im: new Float64Array(n) });

describe("bulk delay", () => {
  it("finds a synthetic 2.44 m / 343 m/s flight time within one sample", () => {
    const tau = 2.44 / 343, z = zeros(f.length);
    for (let i = 0; i < f.length; i++) { z.re[i] = Math.cos(-2 * Math.PI * f[i] * tau + 0.3); z.im[i] = Math.sin(-2 * Math.PI * f[i] * tau + 0.3); }
    const fit = estimateDelay(f, z);
    expect(Math.abs(fit.tau - tau) * IR_FS).toBeLessThan(1);
    expect(Math.abs(fit.tau - tau)).toBeLessThan(1e-7);
  });
});

describe("flat reference", () => {
  it("H = 1 on the profile grid gives a flat spectrum (±0.1 dB, 100 Hz-18 kHz) with its peak at N/8", () => {
    const set = buildIrs({ f, units: { woof: ones(f.length), mid: zeros(f.length), tw: zeros(f.length) } });
    expect(Math.abs(set.tau)).toBeLessThan(1e-9);
    const x = mixIr(set);
    let peak = 0;
    for (let i = 1; i < x.length; i++) if (Math.abs(x[i]) > Math.abs(x[peak])) peak = i;
    expect(peak).toBe(IR_N / 8);
    for (let fr = 100; fr <= 18000; fr *= 1.07) {
      const [r, i] = dtft(x, fr, IR_FS);
      expect(Math.abs(dB(r, i))).toBeLessThan(0.1);
    }
  });
  it("the flat IR is a unit impulse at the same delay as the design IRs", () => {
    const x = flatIr();
    expect(x[preDelay(IR_N)]).toBe(1);
    expect(x.reduce((a, v) => a + Math.abs(v), 0)).toBe(1);
  });
});

describe("the bundled design", () => {
  const set = irsFromResults(prep, design, results, "0");
  const full = mixIr(set), sum = results.angles["0"].sum;

  it("the IR reproduces |sum| within 0.5 dB (100 Hz-15 kHz) and its phase within 10° (200 Hz-10 kHz)", () => {
    let worstDb = 0, worstDeg = 0;
    for (let i = 0; i < f.length; i++) {
      if (f[i] < 100 || f[i] > 15000) continue;
      const [r, im] = irResponseAt(full, f[i], set.delay);
      const want = dB(sum.re[i], sum.im[i]);
      worstDb = Math.max(worstDb, Math.abs(dB(r, im) + set.offsetDb - want));
      if (f[i] >= 200 && f[i] <= 10000) {
        // the target phase with the bulk delay removed
        const pw = Math.atan2(sum.im[i], sum.re[i]) + 2 * Math.PI * f[i] * set.tau;
        worstDeg = Math.max(worstDeg, Math.abs(wrapDeg(Math.atan2(im, r) - pw)));
      }
    }
    expect(worstDb).toBeLessThan(0.5);
    expect(worstDeg).toBeLessThan(10);
  });
  it("is calibrated: the sum's median over 300 Hz-3 kHz is 0 dB", () => {
    const v: number[] = [];
    for (let i = 0; i < f.length; i++) if (f[i] >= 300 && f[i] <= 3000) v.push(dB(sum.re[i], sum.im[i]) - set.offsetDb);
    v.sort((a, b) => a - b);
    expect(Math.abs(v[v.length >> 1])).toBeLessThan(0.3);
  });
  it("the three solo IRs add up to the full IR within 1e-9", () => {
    const parts = UNIT_IDS.map(u => mixIr(set, { woof: 0, mid: 0, tw: 0, [u]: 1 }));
    for (let i = 0; i < full.length; i++) expect(Math.abs(parts[0][i] + parts[1][i] + parts[2][i] - full[i])).toBeLessThan(1e-9);
  });
  it("inverting a unit negates its IR exactly", () => {
    const on = mixIr(set, { woof: 0, mid: 0, tw: 1 }), inv = mixIr(set, { woof: 0, mid: 0, tw: -1 });
    for (let i = 0; i < on.length; i++) expect(inv[i]).toBe(-on[i]);
  });
  it("a muted unit keeps the others at their real level", () => {
    const noTw = mixIr(set, { woof: 1, mid: 1, tw: 0 });
    const [r, im] = irResponseAt(noTw, 300, set.delay), i300 = f.findIndex(x => x >= 300);
    const mid = results.angles["0"], want = dB(mid.woof.re[i300] + mid.mid.re[i300], mid.woof.im[i300] + mid.mid.im[i300]);
    expect(Math.abs(dB(r, im) + set.offsetDb - want)).toBeLessThan(0.5);
  });
  it("the woofer's box-model extension is continuous at 50 Hz (< 0.2 dB)", () => {
    const w = results.angles["0"].woof;
    const t = makeTarget(f, w, set.tau, boxLow);
    const v = t([f[0] - 0.01, f[0], f[0] + 0.01]);
    expect(Math.abs(dB(v.re[0], v.im[0]) - dB(v.re[1], v.im[1]))).toBeLessThan(0.2);
    expect(Math.abs(dB(v.re[2], v.im[2]) - dB(v.re[1], v.im[1]))).toBeLessThan(0.2);
    // and the extension is the vented box: well down by 20 Hz
    const lo = t([20, f[0]]);
    expect(dB(lo.re[0], lo.im[0]) - dB(lo.re[1], lo.im[1])).toBeLessThan(-6);
  });
  it("the 30° IRs build too, and a design change changes the IR", () => {
    const s30 = irsFromResults(prep, design, results, "30");
    expect(s30.units.tw.some(v => v !== 0)).toBe(true);
    const d2 = structuredClone(design); d2.pol.tw = -d2.pol.tw as 1 | -1;
    const s2 = irsFromResults(prep, d2, compute(prep, d2), "0");
    expect(mixIr(s2).some((v, i) => Math.abs(v - full[i]) > 1e-6)).toBe(true);
  });
  it("the plotted magnitude of the IR follows the sum", () => {
    const m = irMagnitude(full);
    const k = m.f.findIndex(x => x >= 1000), i = f.findIndex(x => x >= m.f[k]);
    expect(Math.abs(m.db[k] + set.offsetDb - dB(sum.re[i], sum.im[i]))).toBeLessThan(1);
  });
  it("unitIr is linear in its target", () => {
    const t = makeTarget(f, results.angles["0"].mid, set.tau), x = unitIr(t), y = unitIr(fr => { const z = t(fr); return { re: z.re.map(v => 2 * v), im: z.im.map(v => 2 * v) }; });
    for (let i = 0; i < x.length; i += 97) expect(y[i]).toBeCloseTo(2 * x[i], 12);
  });
});

function boxLow(freqs: number[]) { return boxResponse(prep, design, freqs).p1m; }
