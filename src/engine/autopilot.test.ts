// The autopilot on the bundled System D design: every stage is recorded with a reason, the score never
// drops from step to step, it finishes in a few seconds, it can be cancelled, and it rescues a broken design.
import { describe, expect, it } from "vitest";
import { assess, compute, fitBox, prepare } from ".";
import { AUTOPILOT_STAGES, exactScore, runAutopilot, type AutopilotProgress } from "./autopilot";
import { BUNDLED_PROFILES, defaultDesign } from "../state/store";
import type { Design } from "../types";

const profile = BUNDLED_PROFILES[0];
const p = prepare(profile, fitBox(profile));
const design = defaultDesign(profile);
const scoreOf = (d: Design) => exactScore(assess(p, d, compute(p, d)));

describe("autopilot", () => {
  it("records all five stages, never lowers the score and is quick on the example", async () => {
    const seen: AutopilotProgress[] = [];
    const r = await runAutopilot(p, design, { onProgress: x => seen.push(x) });
    console.log(`autopilot ${r.before.score} → ${r.after.score} (${r.before.exact.toFixed(2)} → ${r.after.exact.toFixed(2)}) in ${r.ms} ms`);
    for (const s of r.steps) console.log(`  ${s.stage.padEnd(8)} ${s.changed ? "changed" : "kept   "} ${s.score}  ${s.reason}`, s.numbers.map(n => `${n.label}: ${n.value}`).join(" | "));
    expect(r.steps.map(s => s.stage)).toEqual(AUTOPILOT_STAGES.map(s => s.id));
    let last = r.before.exact;
    for (const s of r.steps) {
      expect(s.reason.length).toBeGreaterThan(10);
      expect(s.exact).toBeGreaterThanOrEqual(last - 1e-6);
      expect(scoreOf(s.design)).toBeCloseTo(s.exact, 6);
      last = s.exact;
    }
    expect(r.after.exact).toBeGreaterThanOrEqual(r.before.exact);
    expect(scoreOf(r.design)).toBeGreaterThanOrEqual(r.before.exact - 1e-6);
    expect(seen.some(x => x.stage === "box" && /f3 \d+ Hz/.test(x.message))).toBe(true);
    expect(r.ms).toBeLessThan(8000);
  }, 20000);

  it("leaves the design alone when it cannot improve it", async () => {
    const first = await runAutopilot(p, design, { polishRounds: 1 });
    const again = await runAutopilot(p, first.design, { polishRounds: 1 });
    expect(again.after.exact).toBeGreaterThanOrEqual(first.after.exact - 1e-6);
    if (!again.improved) expect(JSON.stringify(again.design)).toBe(JSON.stringify(first.design));
  }, 20000);

  it("rescues a broken design", async () => {
    const d = structuredClone(design);
    d.pol.tw = -1; d.digital.g_woof_dB = 3; d.digital.fc = 900; d.tw.vals.C1 = 2.2e-6; d.box.mode = "plugged";
    const r = await runAutopilot(p, d, { polishRounds: 2 });
    console.log(`broken ${r.before.score} → ${r.after.score} in ${r.ms} ms`);
    expect(r.improved).toBe(true);
    expect(r.after.score).toBeGreaterThan(r.before.score + 10);
  }, 20000);

  it("stops when cancelled", async () => {
    const ac = new AbortController();
    const run = runAutopilot(p, design, { signal: ac.signal, onProgress: x => { if (x.stage === "digital") ac.abort(); } });
    await expect(run).rejects.toThrow(/cancelled/);
  });
});
