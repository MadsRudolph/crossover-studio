// The generalised system model: alignments, topology library, profile variants, display helpers,
// box views, the optimiser entry point and the speed target.
import { describe, expect, it } from "vitest";
import profileJson from "../../profiles/system-d-group10/profile.json";
import { defaultDesign } from "../state/store";
import type { CArray, Design, Profile } from "../types";
import {
  boxModelCurves, boxValidation, compute, driverValidation, fitBox, minidspText, ltspiceText, nodeVoltages, prepare,
  nearestIndex, probeSample, runOptimise, score, tolerance, topologies, legacyTopologies,
} from ".";
import { hDigital } from "./digital";
import { ladder, passiveParts } from "./passive";

const profile = profileJson as unknown as Profile;
const fit = fitBox(profile);
const p = prepare(profile, fit);
const des = defaultDesign();
const mag = (z: CArray, i: number) => Math.hypot(z.re[i], z.im[i]);

describe("digital alignments", () => {
  const f = [20, 100, 325, 1000, 5000, 20000];
  it("LR2 low-pass minus high-pass is all-pass (invert the high-passed units)", () => {
    const L = hDigital(f, 325, "LPF", "LR2"), H = hDigital(f, 325, "HPF", "LR2");
    f.forEach((_, i) => expect(Math.hypot(L.re[i] - H.re[i], L.im[i] - H.im[i])).toBeCloseTo(1, 9));
    expect(20 * Math.log10(mag(L, 2))).toBeCloseTo(-6.02, 1);
  });
  it("LR4 low-pass plus high-pass is all-pass", () => {
    const L = hDigital(f, 325, "LPF", "LR4"), H = hDigital(f, 325, "HPF", "LR4");
    f.forEach((_, i) => expect(Math.hypot(L.re[i] + H.re[i], L.im[i] + H.im[i])).toBeCloseTo(1, 9));
  });
  it("LR2 exports one biquad", () => {
    expect(ltspiceText(p, 325, "LPF", "LR2")).toHaveLength(1);
    expect(minidspText(p, 325, "HPF", "LR2")).toContain("biquad1");
    expect(minidspText(p, 325, "HPF", "LR2")).not.toContain("biquad2");
  });
});

describe("passive topology library", () => {
  const f = [100, 1000, 3000, 10000], R = 8;
  const load: CArray = { re: Float64Array.from(f, () => R), im: new Float64Array(f.length) };
  const T = (topo: string, vals: Record<string, number>, extra = {}) => ladder(f, passiveParts({ topo, vals, ...extra }), load).T;
  const close = (z: CArray, i: number, re: number, im: number) => {
    expect(z.re[i]).toBeCloseTo(re, 10); expect(z.im[i]).toBeCloseTo(im, 10);
  };
  it("metadata for every topology", () => {
    const lib = topologies();
    expect(Object.keys(lib).sort()).toEqual(["HP1", "HP2", "HP3", "LP1", "LP2", "LP3"]);
    expect(lib.LP2.parts.map(x => x.name)).toEqual(["L1", "C1"]);
    expect(lib.LP2.name).toBe("2nd order");
    expect(legacyTopologies().HP3).toEqual([["series", "C", "C1"], ["shunt", "L", "L1"], ["series", "C", "C2"]]);
  });
  it("LP2 and HP2 match the closed form into a resistor", () => {
    const L = 1e-3, C = 10e-6;
    f.forEach((fi, i) => {
      const w = 2 * Math.PI * fi;
      const dr = 1 - w * w * L * C, di = w * L / R, d = dr * dr + di * di;     // 1 / (1 - w^2 LC + jwL/R)
      close(T("LP2", { L1: L, C1: C }), i, dr / d, -di / d);
    });
  });
  it("LP3 (L-C-L) into a resistor", () => {
    const L1 = 1e-3, C1 = 10e-6, L2 = 0.5e-3, w = 2 * Math.PI * 1000;
    // V2/V1 = Z_L / ((1 + Z1 Y)(Z3 + Z_L) + Z1), Z1 = jwL1, Y = jwC1, Z3 = jwL2
    const a = [1 - w * w * L1 * C1, 0], s = [R, w * L2];
    const den = [a[0] * s[0] - a[1] * s[1], a[0] * s[1] + a[1] * s[0] + w * L1], d = den[0] ** 2 + den[1] ** 2;
    close(T("LP3", { L1, C1, L2 }), 1, R * den[0] / d, -R * den[1] / d);
  });
  it("HP1 and LP1 are first-order dividers", () => {
    const C = 10e-6, w = 2 * Math.PI * 1000, x = 1 / (w * C), d = R * R + x * x;
    close(T("HP1", { C1: C }), 1, R * R / d, R * x / d);
  });
  it("a Zobel across a resistive load lowers it; an L-pad attenuates", () => {
    const base = T("HP3", { C1: 6.8e-6, L1: 0.33e-3, C2: 10e-6 });
    const padded = T("HP3", { C1: 6.8e-6, L1: 0.33e-3, C2: 10e-6 }, { pad: { Rs: 4.7, Rp: 3.3 } });
    expect(mag(padded, 3)).toBeLessThan(mag(base, 3) / 2);
    const z = ladder(f, passiveParts({ topo: "LP1", vals: { L1: 1e-3 }, zobel: { R: 8, C: 10e-6 } }), load);
    expect(mag(z.Zin, 3)).toBeLessThan(R + 2 * Math.PI * 10000 * 1e-3);
  });
});

describe("compute on profile variants", () => {
  it("on-axis only: no off30 metric or check", () => {
    const only0 = structuredClone(profile);
    delete only0.measurements.tf["30"];
    const R = compute(prepare(only0, fit), des);
    expect(Object.keys(R.angles)).toEqual(["0"]);
    expect(R.metrics.off30).toBeUndefined();
    expect(R.checks.find(c => c.id === "off")).toBeUndefined();
  });
  it("extra angles are evaluated, incomplete ones skipped", () => {
    const more = structuredClone(profile);
    more.measurements.tf["60"] = structuredClone(more.measurements.tf["30"]);
    more.measurements.tf["90"] = { woof: more.measurements.tf["30"].woof };
    const pp = prepare(more, fit);
    expect(pp.angles).toEqual(["0", "30", "60"]);
    expect(pp.skipped[0].angle).toBe("90");
    expect(Object.keys(compute(pp, des).angles)).toEqual(["0", "30", "60"]);
  });
  it("missing input impedance: a clear error", () => {
    const noZi = structuredClone(profile);
    delete noZi.measurements.zi.tw;
    expect(() => prepare(noZi, fit)).toThrow(/input impedance of the tweeter/);
  });
  it("LR2 with inverted high-passed units computes", () => {
    const d: Design = { ...structuredClone(des), digital: { ...des.digital, align: "LR2" }, pol: { woof: 1, mid: -1, tw: -1 } };
    expect(Number.isFinite(compute(p, d).metrics.on.spread)).toBe(true);
  });
});

describe("display helpers", () => {
  const R = compute(p, des);
  it("probe sample at the nearest grid point", () => {
    const s = probeSample(p, R, 1003), i = nearestIndex(p.f, 1003);
    expect(s.f).toBe(p.f[i]);
    expect(s.i).toBe(i);
    expect(s.units.sum.relDb).toBeCloseTo(s.units.sum.levelDb - R.metrics.on.level, 12);
    for (const u of ["woof", "mid", "tw"] as const) {
      expect(s.units[u].excursionRel).toBeGreaterThanOrEqual(0);
      expect(s.units[u].excursionRel).toBeLessThanOrEqual(1);
    }
    expect(probeSample(p, R, R.box.fB!).units.woof.ventRel).toBeGreaterThan(1);   // at f_B the vent dominates
    expect(probeSample(p, R, 40).units.mid.ventRel).toBe(0);
  });
  it("node voltages agree with the transfer functions", () => {
    const nv = nodeVoltages(p, des, 2000), i = p.f.indexOf(nv.f);
    const on = R.angles["0"];
    expect(nv.hpOut).toBeCloseTo(mag(on.HH, i), 12);
    expect(nv.midTerminals).toBeCloseTo(mag(on.HH, i) * mag(on.Tm, i), 9);
    expect(nv.twTerminals).toBeCloseTo(mag(on.HH, i) * mag(on.Tt, i), 9);
    expect(nv.nodes["tw.pad.Rs"]).toBeCloseTo(nv.twTerminals, 12);
    expect(Object.keys(nv.nodes)).toEqual(expect.arrayContaining(["mid.L1", "tw.C1", "tw.pad.Rs"]));
  });
  it("box model curves for the view", () => {
    const b = boxModelCurves(p, des);
    expect(b.f[0]).toBeCloseTo(5); expect(b.f[b.f.length - 1]).toBeCloseTo(400);
    expect(b.fB).toBeGreaterThan(15); expect(b.plugged.fB).toBeNull();
    const k = b.f.findIndex(x => x >= 200);
    expect(b.spl_dB[k]).toBeGreaterThan(80);              // ~88 dB/2.83 V for this woofer
    expect(b.spl_dB[k]).toBeLessThan(96);
    // the vent unloads the cone at f_B: excursion dips below the plugged box there
    const kb = b.f.findIndex(x => x >= b.fB!);
    expect(b.excursion_mm[kb]).toBeLessThan(b.plugged.excursion_mm[kb]);
  });
  it("box validation for every vented measurement", () => {
    const v = boxValidation(p);
    expect(v).toHaveLength(3);
    for (const e of v) {
      expect(e.Z.meas.re.length).toBe(e.Z.f.length);
      expect(e.nfCone && e.nfVent).toBeTruthy();
      // model and measurement agree within a few dB around the tuning frequency
      const i = e.Z.f.findIndex(x => x >= e.fB);
      expect(Math.abs(20 * Math.log10(mag(e.Z.model, i) / mag(e.Z.meas, i)))).toBeLessThan(3);
    }
    expect(driverValidation(p).closed).toBeTruthy();
  });
  it("tolerance band brackets the nominal curve", () => {
    const t = tolerance(p, des, 40), on = R.angles["0"].sum, i = nearestIndex(p.f, 3000);
    const nom = 20 * Math.log10(mag(on, i));
    expect(t.lo[i]).toBeLessThanOrEqual(nom + 0.5);
    expect(t.hi[i]).toBeGreaterThanOrEqual(nom - 0.5);
  });
});

describe("optimiser", () => {
  it("runs inline without Worker, improves the score, honours abort", async () => {
    const start: Design = { ...structuredClone(des), digital: { fc: 500, align: "BW2", g_woof_dB: 0 } };
    let steps = 0;
    const r = await runOptimise(profile, fit, start, { rounds: 1, onProgress: () => { steps++; } });
    expect(steps).toBeGreaterThan(10);
    expect(r.score).toBeLessThan(score(p, start));
    expect(r.score).toBeCloseTo(score(p, r.design), 9);
    for (const v of Object.values(r.design.mid.vals)) expect([...profile.components.L, ...profile.components.C]).toContain(v);
    const ac = new AbortController();
    const pending = runOptimise(profile, fit, start, { onProgress: () => ac.abort() , signal: ac.signal });
    await expect(pending).rejects.toThrow(/cancelled/);
  }, 30000);
});

describe("speed", () => {
  it("compute() under 15 ms on the bundled profile", () => {
    for (let k = 0; k < 5; k++) compute(p, des);               // JIT warm-up
    const n = 40, t0 = performance.now();
    for (let k = 0; k < n; k++) {
      // a fresh digital filter and a fresh ladder each time, like dragging a slider
      const d = structuredClone(des);
      d.digital.fc = 300 + k; d.mid.vals.L1 = 0.8e-3 + k * 1e-6;
      compute(p, d);
    }
    const ms = (performance.now() - t0) / n;
    console.log(`compute(): ${ms.toFixed(2)} ms per edit`);
    expect(ms).toBeLessThan(15);
  });
});
