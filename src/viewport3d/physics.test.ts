import { describe, expect, it } from "vitest";
import type { Profile } from "../types";
import { UNIT_IDS } from "../types";
import profileJson from "../../profiles/system-d-group10/profile.json";
import { boxResponse, compute, displayPhase, fitBox, prepare } from "../engine";
import { defaultDesign } from "../state/store";
import { sceneLayout } from "./layout";
import { compressExcursion, excursionCeilingDb, nearestIndex, sampleC, sampleProbe } from "./physics";

const profile = profileJson as unknown as Profile;
const prep = prepare(profile, fitBox(profile));
const design = defaultDesign();
const results = compute(prep, design);
const on = results.angles["0"];
const layout = sceneLayout(profile, design.box);
const areas = Object.fromEntries(UNIT_IDS.map(u => [u, Math.PI * (profile.units[u].diameter_m / 2) ** 2])) as Record<"woof" | "mid" | "tw", number>;
const ceiling = excursionCeilingDb(on, results.f, areas);

function at(hz: number) {
  const i = nearestIndex(results.f, hz);
  const r = boxResponse(prep, design, [results.f[i]]);
  return sampleProbe({
    f: results.f, on, probeHz: hz, areas, ceilingDb: ceiling, vents: layout.vents,
    box: { UD: sampleC(r.UD), UP: sampleC(r.UP) }, phaseAt: (z, k) => displayPhase(prep, z, k),
  })!;
}

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

describe("nearestIndex", () => {
  it("snaps on a log axis", () => {
    const f = [100, 1000, 10000];
    expect(nearestIndex(f, 300)).toBe(0);   // log-closer to 100 than to 1000
    expect(nearestIndex(f, 320)).toBe(1);
    expect(nearestIndex(f, 1)).toBe(0);
    expect(nearestIndex(f, 1e6)).toBe(2);
    expect(nearestIndex([], 5)).toBe(-1);
  });
});

describe("compressExcursion", () => {
  it("maps the 48 dB window onto 0..1 and clamps outside it", () => {
    expect(compressExcursion(0, 0)).toBe(1);
    expect(compressExcursion(-48, 0)).toBe(0);
    expect(compressExcursion(-200, 0)).toBe(0);
    expect(compressExcursion(10, 0)).toBe(1);
    const mid = compressExcursion(-24, 0);
    expect(mid).toBeGreaterThan(0.2);
    expect(mid).toBeLessThan(0.6);
  });
});

describe("sampleProbe on System D (default design)", () => {
  it("shares add up to one and the sampled frequency is on the grid", () => {
    for (const hz of [60, 330, 1000, 3000, 10000]) {
      const p = at(hz);
      expect(UNIT_IDS.reduce((a, u) => a + p.units[u].share, 0)).toBeCloseTo(1, 9);
      expect(results.f).toContain(p.f);
    }
  });

  it("hands the output from woofer to midrange to tweeter across the band", () => {
    expect(at(80).units.woof.share).toBeGreaterThan(0.9);
    expect(at(1000).units.mid.share).toBeGreaterThan(0.8);
    expect(at(10000).units.tw.share).toBeGreaterThan(0.8);
  });

  it("moves the woofer cone far more at 60 Hz than at 300 Hz", () => {
    expect(at(60).units.woof.excursion).toBeGreaterThan(at(300).units.woof.excursion);
    expect(at(60).units.woof.excursion).toBeGreaterThan(0.5);
  });

  it("drives the open vent harder at the bottom of the band, in phase with the cone above tuning", () => {
    const lo = at(results.f[0]), hi = at(400);
    expect(results.f[0]).toBeGreaterThan(results.box.fB!); // the measured grid starts above f_B
    expect(lo.vents).toHaveLength(1);
    expect(lo.vents[0].excursion).toBeGreaterThan(hi.vents[0].excursion);
    expect(Math.abs(wrap(lo.vents[0].phase - lo.units.woof.conePhase))).toBeLessThan(Math.PI / 4);
  });

  it("moves the vent air against the cone when the vent flow is drawn into the box", () => {
    // Below tuning the port behaves like a short: U_P ~ U_D (into the box), so the plug moves inward as the cone moves out.
    const p = sampleProbe({
      f: results.f, on, probeHz: 60, areas, ceilingDb: ceiling, vents: layout.vents,
      box: { UD: { re: 1e-3, im: 0 }, UP: { re: 0.9e-3, im: 0 } },
    })!;
    expect(Math.abs(wrap(p.vents[0].phase - p.units.woof.conePhase))).toBeCloseTo(Math.PI, 9);
  });

  it("has no vent motion with the vents plugged", () => {
    const plugged = sampleProbe({ f: results.f, on, probeHz: 60, areas, ceilingDb: ceiling, box: null, vents: layout.vents });
    expect(plugged!.vents).toHaveLength(0);
    expect(plugged!.units.woof.conePhase).toBe(plugged!.units.woof.phase);
  });
});
