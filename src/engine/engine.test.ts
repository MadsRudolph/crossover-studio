// The engine must reproduce design/xover.py (the Python model the report and LTspice were verified against).
// fixtures/reference.json = xover.py's result for fixtures/design.json; data.json stores the measurements to
// 6 significant digits, so agreement is ~5e-6 relative (same tolerance as the artifact's test_engine.mjs).
import { describe, expect, it } from "vitest";
import ref from "../../fixtures/reference.json";
import { compute, fitBox, minidspText, ltspiceText, prepare } from ".";
import { BUNDLED_PROFILES, defaultDesign } from "../state/store";
import type { CArray } from "../types";

const TOL = 2e-5;
const worst = (a: CArray, r: number[][]) => {
  let w = 0;
  for (let i = 0; i < a.re.length; i++) w = Math.max(w, Math.hypot(a.re[i] - r[0][i], a.im[i] - r[1][i]) / Math.hypot(r[0][i], r[1][i]));
  return w;
};

describe("engine vs xover.py (System D, Group 10 design)", () => {
  const profile = BUNDLED_PROFILES[0];
  const p = prepare(profile, fitBox(profile));
  const des = defaultDesign();
  const R = compute(p, des);
  it("uses the Lab E grid", () => expect(p.f.length).toBe((ref as any).on.sum[0].length));
  for (const [ang, key] of [["0", "on"], ["30", "off30"]] as const)
    for (const u of ["woof", "mid", "tw", "sum"] as const)
      it(`${key} ${u}`, () => expect(worst((R.angles[ang] as any)[u], (ref as any)[key][u])).toBeLessThan(TOL));
  it("amplifier load", () => expect(worst(R.angles["0"].Zamp2, (ref as any).Zamp2)).toBeLessThan(TOL));
  it("metrics", () => {
    expect(R.metrics.x_wm).toBe((ref as any).metrics.x_wm);
    expect(R.metrics.x_mt).toBe((ref as any).metrics.x_mt);
    expect(Math.abs(R.metrics.on.spread - (ref as any).metrics.on.spread)).toBeLessThan(1e-3);
  });
  it("MiniDSP and LTspice text identical to DigitalCrossover.m", () => {
    for (const k of ["LPF", "HPF"] as const) {
      expect(minidspText(p, des.digital.fc, k, des.digital.align)).toBe((ref as any).minidsp[k]);
      expect(ltspiceText(p, des.digital.fc, k, des.digital.align)).toEqual((ref as any).ltspice[k]);
    }
  });
});
