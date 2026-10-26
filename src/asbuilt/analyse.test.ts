// As built: alignment, interpolation, partial coverage and the text round trip, on the bundled System D.
import { describe, expect, it } from "vitest";
import { compute, fitBox, prepare } from "../engine";
import { BUNDLED_PROFILES, defaultDesign } from "../state/store";
import type { Design, Series } from "../types";
import { textToSeries } from "../wizard/parsers";
import { tableText } from "../export/ltspice";
import { compare, matchVerdict, offsetSentence, predictedDesign, targetsOf, type AsBuiltData } from "./analyse";
import { syntheticData } from "./demo";
import { findFaults } from "./faults";

const profile = BUNDLED_PROFILES[0];
const p = prepare(profile, fitBox(profile));
const design = defaultDesign(profile);
const same = (d: Design) => d;

/** The plugged prediction at 0° as a series. */
function predicted0(): Series {
  const z = compute(p, predictedDesign(design, false)).angles["0"].sum;
  return { f: Array.from(p.f), re: Array.from(z.re), im: Array.from(z.im), source: { file: "pred.txt", format: "ltspice" } };
}

describe("compare", () => {
  it("(1) a measurement equal to the prediction matches exactly and lists no faults", () => {
    const data = syntheticData(p, design, same);
    const c = compare(p, design, data)!;
    expect(c.design.box.mode).toBe("plugged");
    expect(c.fit.rms).toBeLessThan(0.01);
    expect(Math.abs(c.fit.offset)).toBeLessThan(1e-9);
    expect(c.traces).toHaveLength(p.angles.length);
    expect(findFaults(p, c.design, c.ms, c.fit.rms)).toEqual([]);
    expect(matchVerdict(c.fit.rms).state).toBe("good");
    // the identical curves have no delay and no phase difference
    const t = c.traces[0];
    expect(Math.abs(t.delay ?? 0)).toBeLessThan(1e-9);
    expect(Math.max(...Array.from(t.phase).filter(Number.isFinite).map(Math.abs))).toBeLessThan(1e-6);
  });

  it("(2) removes a 4 dB level offset of a tweeter-inverted build", () => {
    const data = syntheticData(p, design, d => ({ ...d, pol: { ...d.pol, tw: -1 } }), 4);
    const c = compare(p, design, data)!;
    expect(c.fit.offset).toBeGreaterThan(3.95);
    expect(c.fit.offset).toBeLessThan(4.05);
    expect(c.fit.rms).toBeGreaterThan(1);
    expect(offsetSentence(c.fit.offset)).toMatch(/4\.0 dB louder/);
  });

  it("the vents-open toggle predicts with the design's own box", () => {
    const data = syntheticData(p, design, same);
    expect(compare(p, design, data, true)!.design.box.mode).toBe(design.box.mode);
    // a plugged measurement against the vented prediction differs in the bass only: the RMS band starts at 150 Hz
    expect(compare(p, design, data, true)!.fit.rms).toBeGreaterThan(0.01);
  });

  it("(5) brings a measurement on another grid (1 Hz linear, 20 Hz-20 kHz) onto the engine grid", () => {
    const s = predicted0(), f: number[] = [];
    for (let x = 20; x <= 20000; x++) f.push(x);
    // resample the prediction like a lab FFT axis would hold it (log-f linear interpolation, ends held)
    const lf = s.f.map(Math.log), re: number[] = [], im: number[] = [];
    let k = 0;
    for (const x of f) {
      const l = Math.log(x);
      while (k < s.f.length - 2 && lf[k + 1] < l) k++;
      const t = Math.min(1, Math.max(0, (l - lf[k]) / (lf[k + 1] - lf[k])));
      re.push(s.re[k] + t * (s.re[k + 1] - s.re[k])); im.push(s.im[k] + t * (s.im[k + 1] - s.im[k]));
    }
    const data: AsBuiltData = { sum: { "0": { f, re, im } }, units: {} };
    const c = compare(p, design, data)!;
    expect(c.fit.rms).toBeLessThan(0.05);
    expect(Math.abs(c.fit.offset)).toBeLessThan(0.05);
  });

  it("(6) a measurement covering only 200 Hz-10 kHz is compared only there, without NaN", () => {
    const s = predicted0(), keep = s.f.map((x, i) => (x >= 200 && x <= 10000 ? i : -1)).filter(i => i >= 0);
    const part: Series = { f: keep.map(i => s.f[i]), re: keep.map(i => s.re[i] * 2), im: keep.map(i => s.im[i] * 2) };
    const c = compare(p, design, { sum: { "0": part }, units: {} })!;
    expect(Number.isFinite(c.fit.rms)).toBe(true);
    expect(c.fit.rms).toBeLessThan(0.01);
    expect(c.fit.offset).toBeCloseTo(20 * Math.log10(2), 6);
    const t = c.traces[0];
    for (let i = 0; i < p.f.length; i++) {
      const inside = p.f[i] >= s.f[keep[0]] && p.f[i] <= s.f[keep[keep.length - 1]];
      expect(Number.isFinite(t.dev[i]), `${p.f[i]} Hz`).toBe(inside);
      expect(Number.isFinite(t.pred[i])).toBe(true);
    }
    expect(t.worst!.f).toBeGreaterThanOrEqual(200);
    expect(t.worst!.f).toBeLessThanOrEqual(10000);
  });

  it("joins per-unit traces and both angles, and leaves out angles the profile has not measured", () => {
    const s = predicted0();
    const data: AsBuiltData = { sum: { "0": s, "45": s }, units: { tw: s } };
    expect(targetsOf(data, p.angles).map(t => t.key)).toEqual(["sum@0", "tw@0"]);
    expect(compare(p, design, { sum: {}, units: {} })).toBeNull();
  });

  it("(8) an LTspice export of the prediction round-trips through textToSeries", () => {
    const s = predicted0();
    const text = tableText("BvSys Pout 0  V=V(in,0) DB FREQ= ", s.f, s.re, s.im, ["As built round trip"]);
    const back = textToSeries("system_0deg.txt", text);
    expect(back.f.length).toBe(s.f.length);
    for (let i = 0; i < s.f.length; i += 7) {
      expect(back.f[i]).toBeCloseTo(s.f[i], 6);
      const a = Math.hypot(s.re[i], s.im[i]);
      expect(Math.abs(back.re[i] - s.re[i]) / a).toBeLessThan(1e-6);
      expect(Math.abs(back.im[i] - s.im[i]) / a).toBeLessThan(1e-6);
    }
    expect(compare(p, design, { sum: { "0": back }, units: {} })!.fit.rms).toBeLessThan(0.01);
  });

  it("names the verdict bands", () => {
    expect(matchVerdict(1.2).label).toBe("Matches the model");
    expect(matchVerdict(2.5).label).toBe("Close");
    expect(matchVerdict(3.5).label).toBe("Investigate");
    expect(matchVerdict(NaN).state).toBe("bad");
  });
});
