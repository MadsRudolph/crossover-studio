import { describe, expect, it } from "vitest";
import { phaseRange, unwrapDeg } from "./data";

describe("phase unwrapping", () => {
  it("removes the ±180° jumps and keeps gaps", () => {
    const y = unwrapDeg(Float64Array.from([170, -170, -150, NaN, 170, -175]));
    // after the gap the curve continues nearest where it left off
    expect(Array.from(y)).toEqual([170, 190, 210, NaN, 170, 185]);
  });
  it("ranges in whole quadrants, at least ±180°", () => {
    expect(phaseRange([{ y: [10, -20] }])).toEqual([-180, 180]);
    expect(phaseRange([{ y: [-500, 30] }])).toEqual([-540, 180]);
  });
});
