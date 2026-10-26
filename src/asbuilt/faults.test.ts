// The fault finder on synthetic builds of the bundled System D design: each planted fault must come out first.
import { describe, expect, it } from "vitest";
import { fitBox, prepare } from "../engine";
import { BUNDLED_PROFILES, defaultDesign } from "../state/store";
import type { Design } from "../types";
import { compare, type AsBuiltData } from "./analyse";
import { demoData, syntheticData } from "./demo";
import { basketStep, explains, findFaults, hypotheses, runFaults, swappedOutputs } from "./faults";

const profile = BUNDLED_PROFILES[0];
const p = prepare(profile, fitBox(profile));
const design = defaultDesign(profile);

function faultsFor(data: AsBuiltData) {
  const c = compare(p, design, data)!;
  return { c, faults: findFaults(p, c.design, c.ms, c.fit.rms) };
}

describe("fault finder", () => {
  it("offers a sensible set of hypotheses for the design", () => {
    const hs = hypotheses(p, design);
    expect(hs.length).toBeGreaterThan(30);
    expect(hs.length).toBeLessThan(100);
    expect(new Set(hs.map(h => h.id)).size).toBe(hs.length);
    for (const h of hs) {
      expect(h.title.length, h.id).toBeGreaterThan(10);
      expect(h.focus, h.id).toMatch(/^(digital|mid|tw)\./);
      if (h.apply) {
        // never mutates the design it is given
        const before = JSON.stringify(design);
        h.apply(design);
        expect(JSON.stringify(design)).toBe(before);
      }
    }
  });

  it("(2) a tweeter wired inverted, 4 dB louder, is the top fault and explains it all", () => {
    const { c, faults } = faultsFor(syntheticData(p, design, d => ({ ...d, pol: { ...d.pol, tw: -1 } }), 4));
    expect(c.fit.offset).toBeCloseTo(4, 1);
    expect(faults.length).toBeGreaterThan(0);
    expect(faults[0].h.id).toBe("pol.tw");
    expect(faults[0].h.title).toMatch(/^Tweeter connected inverted/);
    expect(faults[0].rms).toBeLessThan(0.05);
    expect(faults[0].offset).toBeCloseTo(4, 3);
    expect(faults.length).toBeLessThanOrEqual(5);
  });

  it("(3) the midrange L1 one basket step up ranks first", () => {
    const up = basketStep(profile.components.L, design.mid.vals.L1, 1)!;
    expect(up).toBeCloseTo(0.001, 9);
    const { faults } = faultsFor(syntheticData(p, design, d => ({ ...d, mid: { ...d.mid, vals: { ...d.mid.vals, L1: up } } })));
    expect(faults[0].h.id).toBe("mid.L1+1");
    expect(faults[0].h.focus).toBe("mid.L1");
    expect(faults[0].rms).toBeLessThan(0.05);
  });

  it("(4) the woofer gain left at 0 dB instead of −4.5 dB ranks first", () => {
    expect(design.digital.g_woof_dB).toBe(-4.5);
    const { faults } = faultsFor(syntheticData(p, design, d => ({ ...d, digital: { ...d.digital, g_woof_dB: 0 } })));
    expect(faults[0].h.id).toBe("gain.0.0");
    expect(faults[0].h.focus).toBe("digital.gain");
  });

  it("finds swapped MiniDSP outputs through the dedicated evaluation", () => {
    const c0 = compare(p, design, syntheticData(p, design, d => d))!;
    const r = swappedOutputs(p, c0.design), k = 10 ** (2 / 20);
    const sum = Object.fromEntries(p.angles.map(a => [a, {
      f: Array.from(p.f), re: Array.from(r.angles[a].sum.re, v => v * k), im: Array.from(r.angles[a].sum.im, v => v * k),
    }]));
    const { faults } = faultsFor({ sum, units: {} });
    expect(faults[0].h.id).toBe("outputs.swapped");
    expect(faults[0].rms).toBeLessThan(0.05);
  });

  it("the demo case lists the inverted tweeter first", () => {
    expect(faultsFor(demoData(p, design)).faults[0].h.id).toBe("pol.tw");
  });

  it("drops a hypothesis whose design does not compute", () => {
    const bad: Design = structuredClone(design);
    bad.mid.topo = "nonsense";
    // the base design computes, a broken hypothesis is skipped rather than failing the scan
    const c = compare(p, design, syntheticData(p, design, d => ({ ...d, pol: { ...d.pol, tw: -1 } })))!;
    const hs = hypotheses(p, c.design);
    hs.unshift({ id: "broken", title: "A hypothesis that throws", fix: "", focus: "mid.topo", apply: () => bad });
    expect(() => findFaults(p, c.design, c.ms, c.fit.rms)).not.toThrow();
  });

  it("runs in chunks, reports progress and can be cancelled", async () => {
    const c = compare(p, design, demoData(p, design))!;
    const seen: number[] = [];
    const out = await runFaults(p, c.design, c.ms, c.fit.rms, { onProgress: d => seen.push(d), chunk: 10 });
    expect(out[0].h.id).toBe("pol.tw");
    expect(seen.length).toBeGreaterThan(2);
    const ac = new AbortController();
    const pending = runFaults(p, c.design, c.ms, c.fit.rms, { signal: ac.signal });
    ac.abort();
    await expect(pending).rejects.toThrow(/cancelled/);
  });

  it("lists only hypotheses that explain a real part of the difference", () => {
    expect(explains(3, 2)).toBe(true);        // 1 dB and a third better
    expect(explains(3, 2.4)).toBe(false);     // 0.6 dB: not enough
    expect(explains(5, 4.1)).toBe(false);     // 0.9 dB but only 18 %
    expect(explains(0.32, 0)).toBe(true);     // a small difference explained completely
    expect(explains(0.1, 0)).toBe(false);     // below anything worth naming
  });

  it("steps through the basket", () => {
    const L = profile.components.L;
    expect(basketStep(L, 0.00082, -1)).toBeCloseTo(0.00068, 9);
    expect(basketStep(L, 0.00082, 2)).toBeCloseTo(0.0012, 9);
    expect(basketStep(L, 0.0022, 1)).toBeNull();
    expect(basketStep(L, 0.0009, 0)).toBeCloseTo(0.00082, 9);   // off-list values snap to the nearest
  });
});
