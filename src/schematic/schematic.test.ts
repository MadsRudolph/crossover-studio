import { describe, expect, it } from "vitest";
import { produce } from "immer";
import { compute, fitBox, prepare } from "../engine";
import { BUNDLED_PROFILES, defaultDesign } from "../state/store";
import type { Design } from "../types";
import * as E from "./edits";
import { branchElements, layoutChain, METRICS } from "./layout";
import { dbOf, flowPeriod, liveChain, partImpedance, strength, voltsOf } from "./live";

const profile = BUNDLED_PROFILES[0];
const design = defaultDesign();
const apply = (d: Design, r: (d: Design) => void) => produce(d, r);

describe("layout", () => {
  it("lays out every part of the default design with focus ids", () => {
    const l = layoutChain(design, "full");
    expect(l.parts.map(p => p.id)).toEqual(["mid.L1", "mid.C1", "tw.C1", "tw.L1", "tw.pad.Rs", "tw.pad.Rp"]);
    expect(l.speakers.map(s => s.unit)).toEqual(["woof", "mid", "tw"]);
    // drivers line up in one column, right of every part
    const xs = new Set(l.speakers.map(s => s.x));
    expect(xs.size).toBe(1);
    for (const p of l.parts) expect(p.hit.x + p.hit.w).toBeLessThan(l.speakers[0].x);
  });

  it("keeps everything inside the drawing and the board", () => {
    for (const mode of ["full", "compact"] as const) {
      const big = apply(design, d => {
        d.mid.topo = "LP3"; d.mid.vals = { L1: 1e-3, C1: 6.8e-6, L2: 1e-3 };
        d.mid.pad = { Rs: 2.2, Rp: 4.7 }; d.mid.zobel = { R: 5.6, C: 4.7e-6 };
        d.tw.topo = "HP3"; d.tw.vals = { C1: 5.6e-6, L1: 2.2e-4, C2: 10e-6 }; d.tw.zobel = { R: 4.7, C: 2.2e-6 };
      });
      const l = layoutChain(big, mode);
      const pts = l.wires.flatMap(w => w.pts);
      for (const [x, y] of pts) {
        expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThanOrEqual(l.width);
        expect(y).toBeGreaterThanOrEqual(0); expect(y).toBeLessThanOrEqual(l.height);
      }
      for (const [x, y] of l.grounds) {
        expect(y + l.m.groundH).toBeLessThanOrEqual(l.board.y + l.board.h);
        expect(x).toBeLessThan(l.board.x + l.board.w);
      }
      expect(l.parts.filter(p => p.role === "zobel").map(p => p.id)).toEqual(["mid.zobel.R", "mid.zobel.C", "tw.zobel.R", "tw.zobel.C"]);
      // midrange grounds stay clear of the tweeter row's labels
      const midGround = Math.max(...l.grounds.filter(([, y]) => y < l.rows.tw).map(([, y]) => y));
      expect(midGround + l.m.groundH).toBeLessThan(l.rows.tw - 8);
    }
  });

  it("draws each branch row as one unbroken conductor apart from the series symbols", () => {
    const rich = apply(design, d => { d.mid.topo = "LP3"; d.mid.vals = { L1: 1e-3, C1: 6.8e-6, L2: 1e-3 }; d.mid.pad = { Rs: 2.2, Rp: 4.7 }; d.mid.zobel = { R: 5.6, C: 4.7e-6 }; });
    for (const mode of ["full", "compact"] as const) {
      const l = layoutChain(rich, mode);
      for (const b of l.branches) {
        const segs = l.wires.filter(w => w.pts.length === 2 && w.pts[0][1] === b.y && w.pts[1][1] === b.y)
          .map(w => [w.pts[0][0], w.pts[1][0]] as const).sort((a, c) => a[0] - c[0]);
        const holes = l.parts.filter(p => p.unit === b.unit && p.pos === "series").map(p => [p.x - p.len / 2, p.x + p.len / 2]);
        let at = b.gx;
        for (const [x0, x1] of segs) {
          if (x0 > at + 1e-9) expect(holes.some(([h0, h1]) => Math.abs(h0 - at) < 1e-9 && Math.abs(h1 - x0) < 1e-9)).toBe(true);
          at = Math.max(at, x1);
        }
        expect(at).toBe(l.speakers[0].x);
      }
    }
  });

  it("compact mode fits the default 160 px dock", () => {
    const l = layoutChain(design, "compact");
    // the dock body is about 124 px at its default 160 px: this fits at a scale of about 0.95
    expect(l.height).toBeLessThanOrEqual(132);
    expect(METRICS.compact.rowGap).toBeLessThan(METRICS.full.rowGap);
  });

  it("orders branch elements as the engine ladder does", () => {
    const els = branchElements({ topo: "HP2", vals: { C1: 5.6e-6, L1: 2.2e-4 }, pad: { Rs: 4.7, Rp: 3.3 }, zobel: { R: 4.7, C: 2.2e-6 } }, "tw");
    expect(els.map(e => e.id)).toEqual(["tw.C1", "tw.L1", "tw.pad.Rs", "tw.pad.Rp", "tw.zobel"]);
    expect(els.map(e => e.pos)).toEqual(["series", "shunt", "series", "shunt", "shunt"]);
  });

  it("tags a node only where it differs from the driver terminal", () => {
    const l = layoutChain(design, "full");
    const tags = l.tags.map(t => t.signal);
    expect(tags).toContain("mid.term");
    expect(tags).toContain("tw.C1");          // followed by the pad's series Rs
    expect(tags).not.toContain("tw.pad.Rs");  // the last series part: same as the terminal
    expect(tags).not.toContain("mid.L1");
  });
});

describe("edits", () => {
  it("switches topology, keeps shared values and drops stale ones", () => {
    const d3 = apply(design, E.setTopology(profile, "mid", "LP3"));
    expect(d3.mid.topo).toBe("LP3");
    expect(d3.mid.vals.L1).toBe(design.mid.vals.L1);
    expect(d3.mid.vals.L2).toBe(design.mid.vals.L1);      // new coil starts from the existing one
    const d1 = apply(d3, E.setTopology(profile, "mid", "LP1"));
    expect(Object.keys(d1.mid.vals)).toEqual(["L1"]);
    const tw1 = apply(design, E.setTopology(profile, "tw", "HP1"));
    expect(Object.keys(tw1.tw.vals)).toEqual(["C1"]);
  });

  it("adds and removes the L-pad and the Zobel", () => {
    const withPad = apply(design, E.addPad(profile, "mid"));
    expect(E.hasPad(withPad.mid)).toBe(true);
    expect(profile.components.R).toContain(withPad.mid.pad!.Rs!);
    const noRp = apply(withPad, E.removePadPart("mid", "Rp"));
    expect(noRp.mid.pad).toEqual({ Rs: withPad.mid.pad!.Rs });
    const noPad = apply(noRp, E.removePadPart("mid", "Rs"));
    expect(E.hasPad(noPad.mid)).toBe(false);

    const z = apply(design, E.addZobel(profile, "tw"));
    expect(E.hasZobel(z.tw)).toBe(true);
    expect(E.hasZobel(apply(z, E.removeZobel("tw")).tw)).toBe(false);
  });

  it("flips polarity", () => {
    expect(apply(design, E.flipPolarity("mid")).pol.mid).toBe(-design.pol.mid);
  });

  it("lists topologies per branch, lowest order first", () => {
    expect(E.topologyKeys("mid")).toEqual(["LP1", "LP2", "LP3"]);
    expect(E.topologyKeys("tw")).toEqual(["HP1", "HP2", "HP3"]);
  });

  it("every edit keeps the design computable", () => {
    const p = prepare(profile, fitBox(profile));
    let d = design;
    for (const r of [E.setTopology(profile, "mid", "LP3"), E.addPad(profile, "mid"), E.addZobel(profile, "mid"),
                     E.setTopology(profile, "tw", "HP1"), E.addZobel(profile, "tw"), E.removePad("tw")]) {
      d = apply(d, r);
      expect(() => compute(p, d)).not.toThrow();
    }
  });
});

describe("live values", () => {
  const p = prepare(profile, fitBox(profile));
  const results = compute(p, design);

  it("reads node voltages from the engine at the probe", () => {
    const live = liveChain(p, design, results, 1000)!;
    expect(live.exact).toBe(true);
    expect(live.f).toBeGreaterThan(900);
    expect(live.f).toBeLessThan(1100);
    expect(voltsOf(live, "in")).toBe(1);
    // the tweeter L-pad drops the level after the series resistor
    expect(voltsOf(live, "tw.pad.Rs")!).toBeLessThan(voltsOf(live, "tw.C1")!);
    expect(live.relDb.mid).not.toBeNull();
    expect(live.zDriver.tw).toBeDefined();
  });

  it("falls back to the branch ends when the node walk fails", () => {
    const broken = apply(design, d => { d.mid.vals = {}; });
    const live = liveChain(p, broken, results, 2000)!;
    expect(live.exact).toBe(false);
    expect(voltsOf(live, "mid.L1")).toBe(voltsOf(live, "mid.term"));
  });

  it("maps levels to visual strength and frequency to flow speed", () => {
    expect(strength(1)).toBe(1);
    expect(strength(10 ** (-36 / 20))).toBeCloseTo(0, 9);
    expect(strength(null)).toBe(0);
    expect(dbOf(0.1)).toBeCloseTo(-20, 9);
    expect(flowPeriod(20)).toBeGreaterThan(flowPeriod(20000));
    const zl = partImpedance("L", 1e-3, 1000, 0.5);
    expect(zl[0]).toBeCloseTo(0.5, 9);
    expect(zl[1]).toBeCloseTo(2 * Math.PI, 9);
    expect(partImpedance("C", 1e-6, 1000)[1]).toBeCloseTo(-159.155, 2);
  });
});

describe("tag placement", () => {
  it("keeps the channel-2 level left of the passive board, clear of its edge", () => {
    const design = defaultDesign(BUNDLED_PROFILES[0]);
    for (const mode of ["full", "compact"] as const) {
      const l = layoutChain(design, mode);
      const hp = l.tags.find(t => t.signal === "hp")!;
      // about 7 mono characters ("−0.1 dB") at ~6.6 px must end before the board's left edge
      expect(hp.x + 7 * 6.6).toBeLessThan(l.board.x);
      // the driver-terminal levels end inside the board's right edge
      for (const t of l.tags.filter(t => t.signal.endsWith(".term"))) expect(t.x).toBeLessThan(l.board.x + l.board.w);
    }
  });
});
