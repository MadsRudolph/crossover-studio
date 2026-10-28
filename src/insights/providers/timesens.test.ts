// The time and sensitivity insight providers on the bundled design: honest claims, valid targets, fast.
import { describe, expect, it } from "vitest";
import profileJson from "../../../profiles/system-d-group10/profile.json";
import { defaultDesign } from "../../state/store";
import { compute, fitBox, prepare } from "../../engine";
import type { Profile } from "../../types";
import type { InsightContext } from "../types";
import { timeInsights } from "./time";
import { sensitivityInsights } from "./sensitivity";

const profile = profileJson as unknown as Profile;
const fit = fitBox(profile);
const prep = prepare(profile, fit);
const design = defaultDesign(profile);
const ctx: InsightContext = { profile, fit, prep, design, results: compute(prep, design) };

describe("time and sensitivity insights", () => {
  it("time: both crossovers and the audibility check, pointing at the Time view", () => {
    const list = timeInsights(ctx);
    expect(list.map(i => i.id).sort()).toEqual(["time.gd-audible", "time.xmt", "time.xwm"]);
    for (const i of list) { expect(i.view).toBe("time"); expect(i.at).toBeGreaterThan(0); }
    // the bundled crossovers are within 60° in phase: no cancellation claimed, no fix offered
    expect(list.every(i => i.severity !== "bad" && !i.fix)).toBe(true);
    expect(list.find(i => i.id === "time.gd-audible")!.severity).toBe("good");
  });

  it("sensitivity: the crossover part and the parts to measure, with focus ids the inspector knows", () => {
    const list = sensitivityInsights({ ...ctx, results: compute(prep, design) });
    expect(list.length).toBeGreaterThanOrEqual(2);
    for (const i of list) { expect(i.view).toBe("sensitivity"); expect(i.focus).toMatch(/^(mid|tw)\./); }
  });
});
