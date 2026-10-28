// Statistics of the listening test: Student's t against table values, the 95 % CI of a small sample
// against a hand calculation, the listener as the unit of analysis, and the plain-language conclusions.
import { describe, expect, it } from "vitest";
import { analyse, conclusions, meanCi, t95, tCdf, tQuantile } from "./stats";
import { defaultProtocol, type Protocol, type Rating } from "./model";

describe("Student's t", () => {
  it("matches the textbook critical values t(0.975, df)", () => {
    const table: [number, number][] = [[1, 12.7062], [2, 4.3027], [3, 3.1824], [4, 2.7764], [5, 2.5706], [9, 2.2622],
      [10, 2.2281], [19, 2.0930], [29, 2.0452], [60, 2.0003], [120, 1.9799]];
    for (const [df, t] of table) expect(t95(df)).toBeCloseTo(t, 3);
  });

  it("has a symmetric CDF and inverts it", () => {
    expect(tCdf(0, 5)).toBeCloseTo(0.5, 12);
    expect(tCdf(-2, 7) + tCdf(2, 7)).toBeCloseTo(1, 12);
    expect(tCdf(tQuantile(0.9, 6), 6)).toBeCloseTo(0.9, 10);
    expect(tQuantile(0.95, 10)).toBeCloseTo(1.8125, 3);
  });
});

describe("mean and 95 % CI", () => {
  it("matches a hand calculation", () => {
    // 4 5 6 5 7 3: mean 5, s = sqrt(10/5) = 1.41421, t(0.975, 5) = 2.57058, half = 2.57058 * 1.41421 / sqrt(6) = 1.48413
    const c = meanCi([4, 5, 6, 5, 7, 3]);
    expect(c.n).toBe(6);
    expect(c.mean).toBe(5);
    expect(c.sd).toBeCloseTo(Math.SQRT2, 10);
    expect(c.half).toBeCloseTo(1.48413, 4);
    expect(c.lo).toBeCloseTo(3.51587, 4);
  });

  it("has no CI for one sample and nothing for none", () => {
    expect(Number.isNaN(meanCi([4]).half)).toBe(true);
    expect(meanCi([4]).mean).toBe(4);
    expect(meanCi([]).n).toBe(0);
  });
});

function setup(): Protocol {
  const p = defaultProtocol(1);
  p.variants = [{ id: "a", name: "Design A", kind: "design", ours: true }, { id: "b", name: "Design B", kind: "design" }];
  p.items = p.items.slice(0, 2);
  p.attributes = p.attributes.filter(a => a.id === "clarity" || a.id === "harsh");
  p.listeners = 6; p.reps = 2;
  return p;
}

describe("analysis", () => {
  it("averages each listener's repetitions before the CI", () => {
    const p = setup();
    const rs: Rating[] = [];
    // listener l rates A l+1 and l+2 (mean l+1.5) on both items; B always 4
    for (let l = 0; l < 4; l++) for (const it of p.items) for (let r = 0; r < 2; r++) {
      rs.push({ listener: l, rep: r, item: it.id, variant: "a", attr: "clarity", value: l + 1 + r });
      rs.push({ listener: l, rep: r, item: it.id, variant: "b", attr: "clarity", value: 4 });
    }
    const a = analyse(p, rs);
    expect(a.unit).toBe("listener");
    expect(a.listeners).toBe(4);
    const all = a.byAttribute.get("clarity")![0];
    expect(all.item).toBe("all");
    const ca = all.cells.find(c => c.variant === "a")!.ci;
    expect(ca.n).toBe(4);
    expect(ca.mean).toBeCloseTo(3, 12);
    expect(ca.half).toBeCloseTo(meanCi([1.5, 2.5, 3.5, 4.5]).half, 12);
  });

  it("uses the repetitions as samples when only one listener has rated", () => {
    const p = setup();
    const rs: Rating[] = [5, 6, 5, 6].map((v, k) => ({ listener: 0, rep: k % 2, item: p.items[k >> 1].id, variant: "a", attr: "clarity", value: v }));
    const a = analyse(p, rs);
    expect(a.unit).toBe("repetition");
    expect(a.byAttribute.get("clarity")![0].cells[0].ci.n).toBe(4);
  });

  it("concludes in plain language with the numbers, and points at the control when ours does badly", () => {
    const p = setup();
    const rs: Rating[] = [];
    const A = [4, 4, 5, 4, 3, 4], B = [5, 6, 5, 6, 5, 5];             // clarity: B clearly better
    const HA = [5, 6, 5, 5, 6, 5], HB = [3, 3, 4, 3, 2, 3];          // harshness: A harsher
    for (let l = 0; l < 6; l++) for (const it of p.items) for (let r = 0; r < 2; r++) {
      rs.push({ listener: l, rep: r, item: it.id, variant: "a", attr: "clarity", value: A[l] });
      rs.push({ listener: l, rep: r, item: it.id, variant: "b", attr: "clarity", value: B[l] });
      rs.push({ listener: l, rep: r, item: it.id, variant: "a", attr: "harsh", value: HA[l] });
      rs.push({ listener: l, rep: r, item: it.id, variant: "b", attr: "harsh", value: HB[l] });
    }
    const out = conclusions(p, analyse(p, rs));
    const clarity = out.find(c => c.attr === "clarity")!, harsh = out.find(c => c.attr === "harsh")!;
    expect(clarity.text).toMatch(/^Design B was preferred for voice clarity, 5\.3 vs 4\.0: the CIs do not overlap \(n = 6 listeners\)\.$/);
    expect(clarity.tone).toBe("warn");                     // ours (A) lost
    expect(harsh.text).toMatch(/^Design B had less harshness \/ sibilance, 3\.0 vs 5\.3: the CIs do not overlap/);
    expect(harsh.action).toMatch(/tweeter level.*Rs/);
    expect(harsh.action).toMatch(/2 kHz–6 kHz/);
  });

  it("calls an overlapping difference a tendency", () => {
    const p = setup();
    const rs: Rating[] = [];
    const A = [4, 6, 3, 5, 4, 5], B = [5, 5, 4, 5, 5, 4];
    for (let l = 0; l < 6; l++) {
      rs.push({ listener: l, rep: 0, item: p.items[0].id, variant: "a", attr: "clarity", value: A[l] });
      rs.push({ listener: l, rep: 0, item: p.items[0].id, variant: "b", attr: "clarity", value: B[l] });
    }
    const c = conclusions(p, analyse(p, rs)).find(x => x.attr === "clarity")!;
    expect(c.text).toMatch(/only as a tendency.*includes zero/);
    expect(c.tone).toBe("info");
  });
});
