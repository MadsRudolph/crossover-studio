// Regression tests from the engine audit: edge cases that used to give wrong numbers or NaN, and the
// rule that the Check panel and the verdict never disagree on a state.
import { describe, expect, it } from "vitest";
import { assess, boxModelCurves, boxResponse, compute, fitBox, prepare, V_REF } from ".";
import { stockNeighbours } from "./assess";
import { boxConfig, tubeMass } from "./box";
import { interpLogF } from "./complex";
import { sections } from "./digital";
import { passiveParts } from "./passive";
import { BUNDLED_PROFILES, defaultDesign } from "../state/store";
import type { Design, Profile } from "../types";

const base = BUNDLED_PROFILES[0];
const variant = (mut: (p: any) => void): Profile => { const p = structuredClone(base) as any; mut(p); return p; };
const fit = fitBox(base);
const p = prepare(base, fit);
const design = defaultDesign(base);

describe("suggest() stock neighbours", () => {
  const list = [1.5, 2.2, 3.3, 4.7];
  it("one step either side of a stock value", () => expect(stockNeighbours(list, 3.3)).toEqual([2.2, 4.7]));
  it("the two stock values around an off-list value", () => expect(stockNeighbours(list, 3)).toEqual([2.2, 3.3]));
  it("only the largest value above the list (not the smallest)", () => expect(stockNeighbours(list, 10)).toEqual([4.7]));
  it("only the smallest value below the list", () => expect(stockNeighbours(list, 1)).toEqual([1.5]));
});

describe("passive branch values", () => {
  const b = (pad: object) => ({ topo: "HP1", vals: { C1: 10e-6 }, pad });
  it("0, null and undefined mean no pad resistor", () => {
    expect(passiveParts(b({ Rs: 0, Rp: null }))).toHaveLength(1);
    expect(passiveParts(b({ Rs: undefined }))).toHaveLength(1);
  });
  it("a negative, NaN or infinite pad resistor is an error, not a non-physical branch", () => {
    for (const Rs of [-2, NaN, Infinity]) expect(() => passiveParts(b({ Rs }), "tw")).toThrow(/tw\.pad\.Rs/);
    expect(() => passiveParts(b({ Rp: -1 }))).toThrow(/pad\.Rp/);
  });
  it("an infinite part value is an error", () => {
    expect(() => passiveParts({ topo: "LP1", vals: { L1: Infinity } })).toThrow(/L1/);
  });
});

describe("interpolation", () => {
  it("a repeated source frequency does not give NaN", () => {
    const s = { f: [100, 100, 1000, 1000], re: [1, 2, 3, 4], im: [0, 0, 0, 0] };
    const z = interpLogF(s as any, [50, 100, 300, 1000, 2000]);
    expect(Array.from(z.re).every(Number.isFinite)).toBe(true);
  });
});

describe("digital crossover frequency range", () => {
  it("rejects 0 Hz and anything at or above half the 96 kHz sample rate", () => {
    for (const fc of [0, -100, NaN, 48000, 60000]) expect(() => sections(fc, "LPF", "LR4")).toThrow(/crossover frequency/);
    expect(sections(47000, "HPF", "LR4")).toHaveLength(2);
  });
});

describe("box fit with only the closed-box curve", () => {
  const prof = variant(q => { delete q.measurements.woofer.free; q.measurements.woofer.vented = []; });
  const f = fitBox(prof);
  it("holds V_AS at the box volume instead of letting f_s run to 0 Hz", () => {
    expect(f.ts.Vas_L).toBeCloseTo(f.VB * 1e3, 0);
    expect(f.ts.fs).toBeGreaterThan(15);
    expect(f.ts.fs).toBeLessThan(40);
    expect(f.notes.join(" ")).toMatch(/closed box alone with V_AS held/);
  });
  it("still reproduces the closed-box resonance", () => {
    const fc = f.ts.fs * Math.sqrt(1 + f.ts.Vas_L / (f.VB * 1e3));
    expect(fc).toBeGreaterThan(35); expect(fc).toBeLessThan(50);   // System D closed box: f_C 42 Hz
  });
});

describe("two vents", () => {
  it("equal vents move their air at the mean speed", () => {
    const c = boxConfig(fit, { mode: "two", L: 0.16, L2: 0.16, a2: fit.AP, fill: 1 });
    expect(c.ventSpeedFactor).toBeCloseTo(1, 12);
  });
  it("the shorter vent is the faster one, and the box view reports it", () => {
    const box = { mode: "two" as const, L: 0.16, L2: 0.24, a2: fit.AP, fill: 1 };
    const c = boxConfig(fit, box);
    // equal areas: v_short / v_mean = 2 M_long / (M_short + M_long), the tube formula's ratio
    // (the fitted calibration scales both masses alike, so it cancels)
    const ms = tubeMass(0.16, fit.AP, fit.rho), ml = tubeMass(0.24, fit.AP, fit.rho);
    expect(c.ventSpeedFactor).toBeCloseTo(2 * ml / (ms + ml), 9);
    expect(c.ventSpeedFactor).toBeGreaterThan(1.1);
    // the box view's vent speed is the mean speed (total U_P over total area) times that factor
    const d: Design = { ...structuredClone(design), box };
    const bc = boxModelCurves(p, d), area = Math.PI * c.ap ** 2;
    const k = bc.f.findIndex(x => x > 20), r = boxResponse(p, d, [bc.f[k]]);
    const mean = Math.hypot(r.UP.re[0], r.UP.im[0]) / area * V_REF * Math.SQRT2;
    expect(bc.ventSpeed_ms[k]).toBeCloseTo(mean * c.ventSpeedFactor!, 9);
  });
});

describe("Check panel and verdict agree", () => {
  const shared = ["flat", "off", "twfs", "canc", "load", "bass"];
  const designs: [string, (d: Design) => void][] = [
    ["reference", () => {}],
    ["tweeter inverted", d => { d.pol.tw = -1; }],
    ["woofer +4 dB", d => { d.digital.g_woof_dB += 4; }],
    ["LR2 without inversion", d => { d.digital.align = "LR2"; }],
    ["no tweeter pad", d => { d.tw.pad = {}; }],
    ["low crossover", d => { d.digital.fc = 150; }],
    ["vent plugged", d => { d.box = { ...d.box, mode: "plugged" }; }],
    ["short vent", d => { d.box = { ...d.box, L: 0.10 }; }],
    ["big tweeter cap", d => { d.tw.vals.C1 = 22e-6; }],
  ];
  for (const [name, mut] of designs) it(name, () => {
    const d = structuredClone(design); mut(d);
    const r = compute(p, d), a = assess(p, d, r);
    for (const id of shared) {
      const c = r.checks.find(x => x.id === id), v = a.criteria.find(x => x.id === id);
      if (!c || !v) continue;
      expect(`${id} ${v.state}`).toBe(`${id} ${c.state}`);
    }
  });
});

describe("verdict advice", () => {
  it("an opposite woofer/midrange blend suggests inverting the woofer, which leaves mid/tweeter alone", () => {
    const d = structuredClone(design); d.pol.woof = -1;
    const c = assess(p, d, compute(p, d)).criteria.find(x => x.id === "blend_wm")!;
    expect(c.state).toBe("bad");
    expect(c.fix).toMatch(/inverting the woofer/);
  });
});

describe("box settings that would give NaN", () => {
  it("are errors with a plain message", () => {
    expect(() => boxConfig(fit, { ...design.box, fill: 0 })).toThrow(/filling factor/);
    expect(() => boxConfig(fit, { ...design.box, mode: "two", a2: 0 })).toThrow(/second vent/);
    expect(() => boxConfig(fit, { ...design.box, mode: "custom", MAP: -5 } as any)).toThrow(/M_AP/);
  });
});

describe("frozen (Immer) designs", () => {
  const deepFreeze = <T,>(o: T): T => { if (o && typeof o === "object") { Object.values(o).forEach(deepFreeze); Object.freeze(o); } return o; };
  it("assess, suggest and the tolerance band never write to the design", async () => {
    const { suggest, tolerance } = await import(".");
    const d = deepFreeze(structuredClone(design));
    const a = assess(p, d, compute(p, d));
    const s = suggest(p, d, a);
    for (const x of s) expect(assess(p, x.design, compute(p, x.design)).score).toBe(x.score);
    expect(tolerance(p, d, 10).lo.every(Number.isFinite)).toBe(true);
  });
});
