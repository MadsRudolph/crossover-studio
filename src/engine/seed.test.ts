// A topology switch that adds parts tunes them (seedParts) instead of copying a sibling's value.
import { describe, expect, it } from "vitest";
import { fitBox, prepare, score, seedParts } from ".";
import { BUNDLED_PROFILES, defaultDesign } from "../state/store";
import type { Design } from "../types";

const base = BUNDLED_PROFILES[0];
const p = prepare(base, fitBox(base));

describe("seedParts", () => {
  it("tunes the new 3rd-order midrange part far better than L2 = L1", () => {
    const des: Design = structuredClone(defaultDesign(base));
    const old = des.mid.vals;
    des.mid = { ...des.mid, topo: "LP3", vals: { ...old, L2: old.L1 } };
    const copied = score(p, des);
    const vals = seedParts(p, des, "mid", ["L2"]);
    expect(base.components.L).toContain(vals.L2);
    expect(vals.L1).toBe(old.L1);
    expect(vals.C1).toBe(old.C1);
    const seeded = score(p, { ...des, mid: { ...des.mid, vals } });
    // System D: 3.26 with L2 = L1, 1.80 after seeding (LP2 is 1.49)
    expect(seeded).toBeLessThan(copied - 1);
  });
  it("never worsens the score and only touches the named parts", () => {
    const des: Design = structuredClone(defaultDesign(base));
    const old = des.tw.vals;
    des.tw = { ...des.tw, topo: "HP3", vals: { ...old, C2: old.C1 } };
    const before = score(p, des);
    const vals = seedParts(p, des, "tw", ["C2"]);
    expect(vals.C1).toBe(old.C1);
    expect(vals.L1).toBe(old.L1);
    expect(score(p, { ...des, tw: { ...des.tw, vals } })).toBeLessThanOrEqual(before);
  });
});
