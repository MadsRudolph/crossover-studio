import { beforeEach, describe, expect, it } from "vitest";
import { BUNDLED_PROFILES, defaultDesign, useStore } from "./store";
import { useOptimiser } from "../ui/shell/optimiser";
import type { Profile } from "../types";

const A = BUNDLED_PROFILES[0];

describe("undo across a live gesture", () => {
  beforeEach(() => useStore.getState().loadProfile(A));

  it("returns to the value from before a slider drag in one step", () => {
    const fc0 = useStore.getState().design.digital.fc;
    for (const v of [360, 370, 380]) useStore.getState().edit(d => { d.digital.fc = v; }, false);
    useStore.getState().edit(d => { d.digital.fc = 380; }, true);
    expect(useStore.getState().history).toHaveLength(1);
    useStore.getState().undo();
    expect(useStore.getState().design.digital.fc).toBe(fc0);
    useStore.getState().redo();
    expect(useStore.getState().design.digital.fc).toBe(380);
  });

  it("leaves no undo step for a release without movement", () => {
    const fc0 = useStore.getState().design.digital.fc;
    useStore.getState().edit(d => { d.digital.fc = fc0; }, true);
    expect(useStore.getState().history).toHaveLength(0);
  });
});

describe("optimiser and profile switching", () => {
  it("drops a running optimiser's work when another profile loads", async () => {
    const B = { ...structuredClone(A), id: "other-group", name: "Other group" } as Profile;
    useStore.getState().loadProfile(A);
    useStore.getState().edit(d => { d.digital.fc = 450; d.tw.vals.C1 = 4.7e-6; });
    useOptimiser.getState().start();
    await new Promise(r => setTimeout(r, 200));
    useStore.getState().loadProfile(B);
    const atLoad = JSON.stringify(useStore.getState().design);
    expect(useOptimiser.getState().running).toBe(false);
    await new Promise(r => setTimeout(r, 300));
    const s = useStore.getState();
    expect(s.profile!.id).toBe("other-group");
    expect(JSON.stringify(s.design)).toBe(atLoad);
    expect(s.history).toHaveLength(0);
  }, 30000);
});

describe("default design per profile", () => {
  it("starts on the first measured vent length and vent B's own diameter", () => {
    const d = defaultDesign(A);
    expect(d.box.mode).toBe("one");
    expect(d.box.L).toBeCloseTo(0.16, 6);
    expect(d.box.a2).toBeCloseTo(A.woofer_box.vents[1].diameter_m / 2, 6);
  });
  it("is a closed box when the profile has no vents", () => {
    const p = structuredClone(A) as Profile;
    p.woofer_box.vents = [];
    expect(defaultDesign(p).box.mode).toBe("plugged");
  });
});
