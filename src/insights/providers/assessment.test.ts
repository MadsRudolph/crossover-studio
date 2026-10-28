// The verdict as insights: one per criterion, pointed at a view, with tested fixes that really help.
import { describe, expect, it } from "vitest";
import { assess, compute, fitBox, prepare } from "../../engine";
import { BUNDLED_PROFILES, defaultDesign } from "../../state/store";
import { assessmentInsights } from "./assessment";

const profile = BUNDLED_PROFILES[0];
const fit = fitBox(profile);
const prep = prepare(profile, fit);

describe("assessment insights", () => {
  const design = defaultDesign(profile);
  const results = compute(prep, design);
  const t0 = performance.now();
  const list = assessmentInsights({ profile, fit, prep, design, results });
  const ms = performance.now() - t0;
  const a = assess(prep, design, results);

  it("turns every criterion into an insight with the criterion's state, place and control", () => {
    console.log(`${list.length} insights in ${ms.toFixed(0)} ms`);
    expect(list.length).toBe(a.criteria.length);
    for (const c of a.criteria) {
      const ins = list.find(i => i.id === `assess.${c.id}`)!;
      expect(ins.severity).toBe(c.state);
      expect(ins.title.length).toBeGreaterThan(5);
      expect(ins.focus).toBe(c.focus);
      expect(ins.at).toBe(c.at);
    }
    expect(list.find(i => i.id === "assess.load")!.view).toBe("impedance");
    expect(list.find(i => i.id === "assess.blend_mt")!.view).toBe("phase");
  });

  it("attaches only fixes that raise the score", () => {
    const fixes = list.filter(i => i.fix);
    expect(fixes.length).toBeGreaterThan(0);
    for (const i of fixes) {
      const d = i.fix!.design;
      expect(assess(prep, d, compute(prep, d)).score, i.id).toBeGreaterThan(a.score);
    }
  });

  it("is cached per Results", () => {
    const t = performance.now();
    assessmentInsights({ profile, fit, prep, design, results });
    expect(performance.now() - t).toBeLessThan(5);
  });
});
