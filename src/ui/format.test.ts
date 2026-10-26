import { describe, expect, it } from "vitest";
import { fmtDb, fmtFreq, fmtLength, fmtOhm, fmtSig, fmtValue, parseNumber, UNIT_SPACE as S } from "./format";

describe("format", () => {
  it("frequency switches to kHz and keeps sensible precision", () => {
    expect(fmtFreq(23.4)).toBe(`23.4${S}Hz`);
    expect(fmtFreq(325)).toBe(`325${S}Hz`);
    expect(fmtFreq(1450)).toBe(`1.45${S}kHz`);
    expect(fmtFreq(12500)).toBe(`12.5${S}kHz`);
    expect(fmtFreq(null)).toBe("—");
    expect(fmtFreq(2600, { bare: true })).toBe("2.60");
  });
  it("dB uses a real minus sign and optional plus", () => {
    expect(fmtDb(-4.5)).toBe(`−4.5${S}dB`);
    expect(fmtDb(2, { sign: true })).toBe(`+2.0${S}dB`);
    expect(fmtDb(-0.01)).toBe(`0.0${S}dB`);
  });
  it("part values in mH, µF and Ω", () => {
    expect(fmtValue(0.00082, "L")).toBe(`0.82${S}mH`);
    expect(fmtValue(0.001, "L")).toBe(`1.0${S}mH`);
    expect(fmtValue(6.8e-6, "C")).toBe(`6.8${S}µF`);
    expect(fmtValue(1e-4, "C")).toBe(`100${S}µF`);
    expect(fmtValue(4.7, "R")).toBe(`4.7${S}Ω`);
    expect(fmtValue(null, "R", { empty: "off" })).toBe("off");
    expect(fmtOhm(3.30)).toBe(`3.3${S}Ω`);
  });
  it("lengths in mm", () => {
    expect(fmtLength(0.16)).toBe(`160${S}mm`);
    expect(fmtLength(0.0065)).toBe(`6.5${S}mm`);
    expect(fmtLength(-1.15)).toBe(`−1.15${S}m`);
  });
  it("significant digits", () => {
    expect(fmtSig(0.000123456, 3)).toBe("0.000123");
    expect(fmtSig(1234.5, 3)).toBe("1235");
  });
  it("parses what people type", () => {
    expect(parseNumber("4,7")).toBe(4.7);
    expect(parseNumber("−3 dB")).toBe(-3);
    expect(parseNumber("1.2k")).toBe(1200);
    expect(parseNumber("1.2 kHz")).toBe(1200);
    expect(parseNumber("4.7 mH", "mH")).toBe(4.7);
    expect(parseNumber("160 mm")).toBe(160);
    expect(parseNumber("abc")).toBeNull();
  });
});
