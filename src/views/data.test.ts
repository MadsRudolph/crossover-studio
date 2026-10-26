import { describe, expect, it } from "vitest";
import { compute, fitBox, prepare } from "../engine";
import { BUNDLED_PROFILES, defaultDesign } from "../state/store";
import type { CArray } from "../types";
import { METRIC_ROWS, db, diff, minIn, nearest, powerSumDb, readProbe, responseRange, rmsDbError, shownAngles, summingGainDb, terminalDrive } from "./data";

const c = (re: number[], im: number[] = re.map(() => 0)): CArray => ({ re: Float64Array.from(re), im: Float64Array.from(im) });

describe("curve helpers", () => {
  it("db breaks the line at zero instead of -inf", () => {
    const y = db(c([1, 0, 10]));
    expect(y[0]).toBeCloseTo(0);
    expect(Number.isNaN(y[1])).toBe(true);
    expect(y[2]).toBeCloseTo(20);
  });

  it("two equal units in phase sum +3 dB over their power sum, in antiphase they cancel", () => {
    const one = c([1]), zero = c([0]);
    expect(summingGainDb({ woof: one, mid: one, tw: zero, sum: c([2]) })[0]).toBeCloseTo(10 * Math.log10(2), 6);
    expect(powerSumDb({ woof: one, mid: one, tw: zero })[0]).toBeCloseTo(10 * Math.log10(2), 6);
    expect(summingGainDb({ woof: one, mid: c([-1]), tw: zero, sum: c([1e-6]) })[0]).toBeLessThan(-100);
  });

  it("nearest snaps on a log axis and clamps at the ends", () => {
    const f = [100, 200, 400, 800];
    expect(nearest(f, 10)).toBe(0);
    expect(nearest(f, 1e5)).toBe(3);
    expect(nearest(f, 280)).toBe(1);   // geometric middle of 200 and 400 is 283
    expect(nearest(f, 290)).toBe(2);
  });

  it("minIn, diff and rmsDbError", () => {
    expect(minIn([1, 2, 3, 4], [5, 1, 0, 9], 1.5, 4)).toEqual({ x: 3, y: 0 });
    expect(Array.from(diff([1, NaN, 3], [1, 1, 1]))).toEqual([0, NaN, 2]);
    expect(rmsDbError([1, 2], c([10, 10]), c([10, 10]))).toBe(0);
    expect(rmsDbError([1, 2], c([10, 10]), c([1, 1]))).toBeCloseTo(20);
  });

  it("responseRange puts the level near the top on a 3 dB raster", () => {
    const [lo, hi] = responseRange(-12.4);
    expect(Math.abs(hi % 3)).toBe(0);
    expect(hi - lo).toBe(51);
    expect(hi).toBeGreaterThan(-12.4 + 6);
  });
});

describe("probe reading", () => {
  it("names the unit that carries the sound and how far the next is down", () => {
    const r = readProbe([{ id: "woof", relDb: -30, phaseRad: 0 }, { id: "mid", relDb: 0, phaseRad: 0 }, { id: "tw", relDb: -18, phaseRad: 0 }], 0.2, { fHz: 1000 });
    expect(r.headline).toBe("Midrange carries the sound; tweeter 18 dB down");
    expect(r.detail).toBe("Woofer 30 dB down.");
  });

  it("explains a crossover and flags cancellation", () => {
    const inPhase = readProbe([{ id: "woof", relDb: -6, phaseRad: 0.1 }, { id: "mid", relDb: -6.5, phaseRad: 0 }, { id: "tw", relDb: -60, phaseRad: 0 }], 2.9, { fHz: 330 });
    expect(inPhase.headline).toMatch(/^Crossover region: woofer and midrange/);
    expect(inPhase.tone).toBe("good");
    const against = readProbe([{ id: "woof", relDb: -6, phaseRad: 0 }, { id: "mid", relDb: -6, phaseRad: Math.PI }, { id: "tw", relDb: -60, phaseRad: 0 }], -12, { fHz: 330 });
    expect(against.tone).toBe("bad");
    expect(against.detail).toMatch(/against each other/);
  });

  it("speaks about tweeter protection near its resonance", () => {
    const r = readProbe([{ id: "woof", relDb: -40, phaseRad: 0 }, { id: "mid", relDb: 0, phaseRad: 0 }, { id: "tw", relDb: -8, phaseRad: 0 }], 0, { fHz: 1450, twFsHz: 1450, twRelAtFs: -8 });
    expect(r.detail).toMatch(/Tweeter resonance/);
    expect(r.tone).toBe("warn");
  });
});

describe("with the bundled profile", () => {
  const profile = BUNDLED_PROFILES[0];
  const prep = prepare(profile, fitBox(profile));
  const design = defaultDesign();
  const res = compute(prep, design);

  it("shows the angles that exist", () => {
    expect(shownAngles(res, "both")).toEqual(["0", "30"]);
    expect(shownAngles(res, "45")).toEqual(["0"]);
    expect(shownAngles({ angles: { "0": res.angles["0"] } }, "both")).toEqual(["0"]);
  });

  it("the terminal drive of the woofer is gain x low-pass", () => {
    const d = terminalDrive(res.angles["0"], design), i = 3;
    const g = 10 ** (design.digital.g_woof_dB / 20);
    expect(Math.hypot(d.woof.re[i], d.woof.im[i])).toBeCloseTo(g * Math.hypot(res.angles["0"].HL.re[i], res.angles["0"].HL.im[i]), 12);
  });

  it("every metric row reads a number", () => {
    for (const r of METRIC_ROWS) {
      const v = r.get(res);
      expect(v === null || Number.isFinite(v)).toBe(true);
    }
  });
});
