// The listening insight provider: a reminder before the test, then advice from the ratings with a tested
// fix (the tweeter pad one basket step up, verified with the verdict), and it stays cheap.
import { describe, expect, it } from "vitest";
import { compute, fitBox, prepare } from "../engine";
import { BUNDLED_PROFILES, defaultDesign } from "../state/store";
import { listeningInsights } from "../insights/providers/listening";
import { useListenTest } from "./store";
import { demoDoc } from "./demo";
import { emptyDoc } from "./model";

const profile = BUNDLED_PROFILES[0];
const fit = fitBox(profile), prep = prepare(profile, fit), design = defaultDesign(profile);
const ctx = { profile, fit, prep, design, results: compute(prep, design) };

describe("listening insights", () => {
  it("asks for a plan while there is none", () => {
    useListenTest.getState().replace(emptyDoc(profile.id, 1), true);
    const out = listeningInsights(ctx);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: "listening.plan", severity: "info", view: "listentest" });
    expect(out[0].weight).toBeLessThan(0.2);
  });

  it("turns a harsh rating into a tested tweeter-pad fix", () => {
    useListenTest.getState().replace(demoDoc(profile, design), true);
    const t0 = performance.now();
    const out = listeningInsights(ctx);
    const ms = performance.now() - t0;
    const harsh = out.find(i => i.id === "listening.harsh")!;
    expect(harsh).toBeDefined();
    expect(harsh.title).toMatch(/^Listeners rated harshness \/ sibilance \d\.\d\/7: try tweeter Rs 4\.7 Ω → 5\.6 Ω \(2 kHz–6 kHz\)$/);
    expect(harsh).toMatchObject({ view: "listentest", alsoIn: ["response"], focus: "tw.pad.Rs", band: [2000, 6000] });
    expect(harsh.fix!.design.tw.pad?.Rs).toBe(5.6);
    expect(harsh.detail).toMatch(/Tested: −\d\.\d dB over 2 kHz–6 kHz/);
    expect(ms).toBeLessThan(400);
  });
});
