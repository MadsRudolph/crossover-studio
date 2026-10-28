// Part sensitivity on the bundled design: every part is varied, the signs make physical sense, the
// ranking is consistent and the whole analysis stays inside its time budget.
import { describe, expect, it } from "vitest";
import profileJson from "../../profiles/system-d-group10/profile.json";
import { defaultDesign } from "../state/store";
import type { Profile } from "../types";
import { compute, fitBox, prepare } from ".";
import { sensitivity } from "./sensitivity";

const profile = profileJson as unknown as Profile;
const p = prepare(profile, fitBox(profile));
const design = defaultDesign(profile);
const results = compute(p, design);
const s = sensitivity(p, design, results, { score: true });
const byId = (id: string) => s.entries.find(e => e.id === id)!;

describe("part sensitivity", () => {
  it("varies every passive part, the pad, the MiniDSP and the vent", () => {
    const ids = s.entries.map(e => e.id).sort();
    expect(ids).toEqual(["box.L", "digital.fc", "digital.gain", "mid.C1", "mid.L1", "tw.C1", "tw.L1", "tw.pad.Rp", "tw.pad.Rs"].sort());
    for (const e of s.entries) expect(e.step.lo || e.step.hi).toBeTruthy();
    expect(byId("digital.fc").tol).toBeNull();
    expect(byId("tw.C1").tol?.rel).toBe(0.10);
  });

  it("is ranked by the basket-step change and the changes have the physical sign", () => {
    for (let i = 1; i < s.entries.length; i++) expect(s.entries[i - 1].stepDb).toBeGreaterThanOrEqual(s.entries[i].stepDb);
    // a bigger series resistor in front of the tweeter makes the top end quieter
    const rs = byId("tw.pad.Rs").step.hi!;
    expect(rs.maxDb).toBeLessThan(0);
    expect(rs.atHz).toBeGreaterThan(3000);
    // more woofer gain makes the bass louder, by at most the step itself
    const g = byId("digital.gain").step.hi!;
    expect(g.maxDb).toBeGreaterThan(0);
    expect(g.maxDb).toBeLessThanOrEqual(0.5 + 1e-9);
    expect(g.atHz).toBeLessThan(400);
  });

  it("a ±10 % capacitor tolerance moves the sum less than a basket step does", () => {
    for (const id of ["tw.C1", "mid.C1"]) expect(byId(id).tolDb).toBeLessThan(byId(id).stepDb);
    expect(s.measure).toHaveLength(2);
    expect(s.measure.every(e => e.passive)).toBe(true);
    expect(s.topXover?.passive).toBe(true);
  });

  it("works out the verdict change and runs in well under 150 ms", () => {
    expect(s.base.score).toBeGreaterThan(80);
    expect(s.entries.every(e => e.step.lo?.dScore !== null || e.step.hi?.dScore !== null)).toBe(true);
    // best of three, so a busy test machine (the suite runs files in parallel) does not fail it
    const best = (run: () => void) => Math.min(...[0, 1, 2].map(() => { const t = performance.now(); run(); return performance.now() - t; }));
    expect(best(() => sensitivity(p, design, results, { score: true }))).toBeLessThan(150);
    expect(best(() => sensitivity(p, design, results))).toBeLessThan(30);
  });
});
