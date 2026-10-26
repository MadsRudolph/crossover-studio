// fitBox must reproduce box_model.py fit() (fixtures/boxfit_reference.json) on the bundled profile, and
// degrade gracefully when curves are missing.
import { describe, expect, it } from "vitest";
import ref from "../../fixtures/boxfit_reference.json";
import profileJson from "../../profiles/system-d-group10/profile.json";
import type { Profile } from "../types";
import { boxConfig, fitBox, mapAt, tubeMass } from "./box";

const profile = profileJson as unknown as Profile;
const rel = (a: number, b: number) => Math.abs(a - b) / Math.abs(b);

describe("fitBox vs box_model.py (System D, Group 10)", () => {
  const t0 = performance.now();
  const fit = fitBox(profile);
  const ms = performance.now() - t0;

  it("runs in reasonable time", () => {
    console.log(`fitBox: ${ms.toFixed(0)} ms, driver cost ${fit.quality.driver.toFixed(5)}, vents ${fit.quality.vents.toFixed(5)}`);
    expect(ms).toBeLessThan(5000);
  });
  for (const k of ["fs", "Qms", "Qes", "Vas_L"] as const)
    it(`T-S ${k} within 1 %`, () => expect(rel(fit.ts[k], ref.ts[k])).toBeLessThan(0.01));
  it("every vent mass within 1 %", () => {
    expect(fit.MAP.length).toBe(ref.MAP.length);
    fit.MAP.forEach(([L, m], i) => {
      expect(L).toBeCloseTo(ref.MAP[i][0], 9);
      expect(rel(m, ref.MAP[i][1])).toBeLessThan(0.01);
    });
  });
  it("geometry and air from the profile", () => {
    for (const k of ["c", "rho", "RE", "SD", "AD", "VB", "AP"] as const) expect(rel(fit[k], (ref as any)[k])).toBeLessThan(1e-9);
  });
  it("shared vent losses close to the reference", () => {
    expect(rel(fit.QL, ref.QL)).toBeLessThan(0.05);
    expect(rel(fit.QP, ref.QP)).toBeLessThan(0.05);
  });
  it("vent mass interpolation", () => {
    expect(mapAt(fit, 0.16)).toBeCloseTo(fit.MAP[0][1], 9);
    expect(boxConfig(fit, { mode: "plugged", L: 0.16, L2: 0.16, a2: 0.025, fill: 1 }).MAP).toBeNull();
  });
});

describe("fitBox with missing curves", () => {
  const strip = (mut: (p: Profile) => void): Profile => { const p = structuredClone(profile); mut(p); return p; };

  it("no vented curves: tube formula and default losses", () => {
    const fit = fitBox(strip(p => { p.measurements.woofer.vented = []; }));
    expect(fit.QL).toBe(7);
    expect(fit.QP).toBe(30);
    expect(fit.MAP[0][1]).toBeCloseTo(tubeMass(fit.MAP[0][0], fit.AP, fit.rho), 9);
    expect(rel(fit.ts.fs, ref.ts.fs)).toBeLessThan(0.02);
    expect(fit.notes.some(n => n.includes("tube formula"))).toBe(true);
  });
  it("no closed curve: V_AS pinned by the vented curves", () => {
    const fit = fitBox(strip(p => { delete p.measurements.woofer.closed; }));
    expect(rel(fit.ts.fs, ref.ts.fs)).toBeLessThan(0.03);
    expect(rel(fit.ts.Vas_L, ref.ts.Vas_L)).toBeLessThan(0.15);
    expect(fit.notes.length).toBeGreaterThan(0);
  });
  it("no woofer impedance at all: a clear error", () => {
    expect(() => fitBox(strip(p => { p.measurements.woofer = { vented: [] }; }))).toThrow(/free air|closed box/);
  });
});
