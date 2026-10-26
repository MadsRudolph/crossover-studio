import { describe, expect, it } from "vitest";
import { fmtDelta } from "./CompareView";

describe("Compare B − A column", () => {
  it("carries the unit", () => {
    expect(fmtDelta(223, "Hz", 0)).toBe("+223 Hz");
    expect(fmtDelta(-1.3, "Hz", 0)).toBe("−1.3 Hz");
    expect(fmtDelta(0.38, "Ω", 2)).toBe("+0.38 Ω");
    expect(fmtDelta(3, "", 0)).toBe("+3");
  });
  it("shows ± when the rounded difference is zero", () => {
    expect(fmtDelta(-0.004, "dB", 2)).toBe("±0.00 dB");
  });
});
