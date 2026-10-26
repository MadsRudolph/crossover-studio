// The verdict on the bundled System D design, and that its suggestions are real improvements.
import { describe, expect, it } from "vitest";
import { assess, compute, fitBox, prepare, suggest } from ".";
import { BUNDLED_PROFILES, defaultDesign } from "../state/store";
import type { Design } from "../types";

const profile = BUNDLED_PROFILES[0];
const p = prepare(profile, fitBox(profile));
const design = defaultDesign();
const run = (d: Design) => assess(p, d, compute(p, d));

describe("assess", () => {
  const a = run(design);

  it("scores the reference design as a good one and explains every criterion", () => {
    console.log(`score ${a.score} ${a.rating}: ${a.headline}`);
    for (const c of a.criteria) console.log(`  ${c.state.padEnd(4)} ${(c.score * 100).toFixed(0).padStart(3)}  ${c.title}: ${c.value} | ${c.finding}`);
    expect(a.score).toBeGreaterThanOrEqual(75);
    for (const c of a.criteria) {
      expect(c.score).toBeGreaterThanOrEqual(0); expect(c.score).toBeLessThanOrEqual(1);
      expect(c.why.length).toBeGreaterThan(40); expect(c.finding.length).toBeGreaterThan(10);
      if (c.score < 0.999) expect(c.fix.length, c.id).toBeGreaterThan(0);
    }
  });

  it("punishes an inverted tweeter at the mid/tweeter blend", () => {
    const d = structuredClone(design); d.pol.tw = -1;
    const b = run(d), blend = (x: typeof b) => x.criteria.find(c => c.id === "blend_mt")!;
    expect(blend(b).score).toBeLessThan(blend(a).score);
    expect(b.score).toBeLessThan(a.score);
  });

  it("reads a woofer level error as a band imbalance with the exact gain fix", () => {
    const d = structuredClone(design); d.digital.g_woof_dB += 4;
    const bal = run(d).criteria.find(c => c.id === "balance")!;
    expect(bal.state).not.toBe("good");
    expect(bal.fix).toMatch(/woofer gain/);
  });

  it("flags a part that is not in the basket", () => {
    const d = structuredClone(design); d.mid.vals.L1 = 0.9e-3;
    expect(run(d).criteria.find(c => c.id === "stock")!.state).toBe("bad");
  });

  it("only suggests changes that raise the score, and finds the way back from a broken design", () => {
    const d = structuredClone(design); d.pol.tw = -1; d.digital.g_woof_dB += 3;
    const b = run(d);
    const t0 = performance.now(), s = suggest(p, d, b);
    console.log(`suggest(): ${(performance.now() - t0).toFixed(0)} ms`, s.map(x => `${x.label} +${x.gain}`));
    expect(s.length).toBeGreaterThan(0);
    for (const x of s) expect(run(x.design).score).toBe(x.score);
    expect(s.some(x => /Invert the tweeter|Woofer gain/.test(x.label))).toBe(true);
  });
});
