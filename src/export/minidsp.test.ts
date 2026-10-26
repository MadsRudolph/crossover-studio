// MiniDSP and LTspice filter text against DigitalCrossover.m itself, run in MATLAB (fixtures/digitalcrossover.json).
// The script makes Butterworth filters: n = 2 is the app's BW2, n = 4 its BW4.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ltspiceText } from "../engine";
import { minidspFileText } from "./minidsp";

interface Case { f0: number; type: "LPF" | "HPF"; n: 2 | 4; biquad: string; e1: string; e2: string }
const { cases } = JSON.parse(readFileSync(new URL("./fixtures/digitalcrossover.json", import.meta.url), "utf8")) as { cases: Case[] };

describe("DigitalCrossover.m", () => {
  for (const c of cases) {
    const align = c.n === 2 ? "BW2" : "BW4";
    it(`${c.type} n=${c.n} at ${c.f0} Hz: MiniDSP text is byte for byte the script's file`, () => {
      expect(minidspFileText(c.f0, c.type, align)).toBe(c.biquad);
    });
    it(`${c.type} n=${c.n} at ${c.f0} Hz: LTspice Laplace sources`, () => {
      expect(ltspiceText(null, c.f0, c.type, align)).toEqual(c.n === 2 ? [c.e1] : [c.e1, c.e2]);
    });
  }
});
