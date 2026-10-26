// Profiles that are legal but unusual must still give finite, honest results.
import { describe, expect, it } from "vitest";
import { compute, fitBox, prepare } from "./index";
import { mapAt } from "./box";
import { BUNDLED_PROFILES, defaultDesign } from "../state/store";
import type { Profile } from "../types";

const base = BUNDLED_PROFILES[0];
const variant = (mut: (p: any) => void): Profile => { const p = structuredClone(base) as any; mut(p); return p; };
const run = (p: Profile) => { const fit = fitBox(p); const prep = prepare(p, fit); return { fit, prep, r: compute(prep, defaultDesign(p)) }; };

describe("engine robustness", () => {
  it("ignores a 0 Hz (DC) point instead of spreading NaN through the metrics", () => {
    const p = variant(p => {
      for (const set of Object.values(p.measurements.tf) as any[]) for (const s of Object.values(set) as any[]) {
        s.f.unshift(0); s.re.unshift(s.re[0]); s.im.unshift(0);
      }
    });
    const { r } = run(p);
    expect(Number.isFinite(r.metrics.on.spread)).toBe(true);
    expect(Number.isFinite(r.metrics.off30!.spread)).toBe(true);
    expect(r.checks.every(c => !c.detail.includes("NaN"))).toBe(true);
  });

  it("merges repeated measurements at one vent length", () => {
    const { fit, r } = run(variant(p => { p.measurements.woofer.vented.push(structuredClone(p.measurements.woofer.vented[0])); }));
    expect(new Set(fit.MAP.map(([L]) => L)).size).toBe(fit.MAP.length);
    expect(r.box.fB).toBeCloseTo(24.6, 0);
    expect(Number.isFinite(mapAt({ ...fit, MAP: [[0.16, 60], [0.16, 70]] }, 0.16))).toBe(true);
  });

  it("holds V_AS at the box volume when free air is the only woofer curve", () => {
    const { fit } = run(variant(p => { delete p.measurements.woofer.closed; p.measurements.woofer.vented = []; }));
    expect(fit.ts.Vas_L).toBeCloseTo(fit.VB * 1e3, 0);
    expect(fit.notes.join(" ")).toContain("V_AS is assumed equal to the box volume");
  });

  it("treats a vent setting as a closed box when the profile has no vents", () => {
    const p = variant(p => { p.woofer_box.vents = []; p.woofer_box.vent_pos_m = []; p.measurements.woofer.vented = []; });
    const fit = fitBox(p), prep = prepare(p, fit);
    const r = compute(prep, { ...defaultDesign(p), box: { ...defaultDesign(p).box, mode: "one" } });
    expect(r.box.fB).toBeFalsy();
  });

  it("judges the first off-axis angle when 30° was not measured", () => {
    const { r } = run(variant(p => { p.measurements.tf["15"] = p.measurements.tf["30"]; delete p.measurements.tf["30"]; }));
    expect(r.metrics.offAngle).toBe("15");
    expect(r.checks.find(c => c.id === "off")?.detail).toMatch(/^15°/);
  });
});
