import { describe, expect, it } from "vitest";
import { alignTurns, phaseRange, unwrapDeg } from "./data";

describe("phase unwrapping", () => {
  it("removes the ±180° jumps and keeps gaps", () => {
    const y = unwrapDeg(Float64Array.from([170, -170, -150, NaN, 170, -175]));
    // after the gap the curve continues nearest where it left off
    expect(Array.from(y)).toEqual([170, 190, 210, NaN, 170, 185]);
  });
  it("ranges in whole quadrants, at least 360° tall", () => {
    expect(phaseRange([{ y: [10, -20] }])).toEqual([-180, 180]);
    expect(phaseRange([{ y: [-500, 30] }])).toEqual([-540, 90]);
    expect(phaseRange([{ y: [-700, -350] }])).toEqual([-720, -270]);
    expect(phaseRange([{ y: [-400, -350] }])).toEqual([-540, -180]);
    expect(phaseRange([{ y: [NaN] }])).toEqual([-180, 180]);
  });
});

describe("aligning unwrapped curves", () => {
  it("moves a curve by whole turns onto the reference where both exist", () => {
    const ref = [NaN, -500, -520, -540];
    const y = Float64Array.from([-150, -150, -170, NaN]);
    expect(Array.from(alignTurns(y, ref))).toEqual([-510, -510, -530, NaN]);
  });
  it("leaves a curve alone when it already overlaps the reference", () => {
    const y = Float64Array.from([10, 20]);
    expect(alignTurns(y, [0, 30])).toBe(y);
  });
});
