// Randomisation of the listening test: the seeded generator and shuffle are reproducible, the Williams
// squares are Latin and carry-over balanced, and the session plan is blind, complete and repeatable.
import { describe, expect, it } from "vitest";
import { balancedListenerCount, makePlan, rng, shuffle, williams } from "./random";
import { defaultProtocol, type Protocol } from "./model";

function protocol(nv: number, ni = 3, listeners = 6, reps = 2, seed = 42): Protocol {
  const p = defaultProtocol(seed);
  p.variants = Array.from({ length: nv }, (_, i) => ({ id: `v${i}`, name: `V${i}`, kind: "room" as const }));
  p.items = p.items.slice(0, ni);
  p.listeners = listeners; p.reps = reps;
  return p;
}

describe("seeded randomness", () => {
  it("gives the same sequence for the same seed and a different one for another seed", () => {
    const a = rng(7), b = rng(7), c = rng(8);
    const xa = Array.from({ length: 20 }, a), xb = Array.from({ length: 20 }, b), xc = Array.from({ length: 20 }, c);
    expect(xa).toEqual(xb);
    expect(xa).not.toEqual(xc);
    for (const x of xa) { expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThan(1); }
  });

  it("is roughly uniform", () => {
    const r = rng(123), bins = new Array(10).fill(0);
    for (let i = 0; i < 20000; i++) bins[Math.floor(r() * 10)]++;
    for (const b of bins) expect(Math.abs(b - 2000)).toBeLessThan(200);
  });

  it("shuffles reproducibly into a permutation", () => {
    const xs = [..."ABCDEFGH"];
    const s1 = shuffle(xs, rng(99)), s2 = shuffle(xs, rng(99));
    expect(s1).toEqual(s2);
    expect([...s1].sort()).toEqual(xs);
    expect(xs.join("")).toBe("ABCDEFGH");          // the input is not touched
  });
});

describe("Williams balanced Latin square", () => {
  for (const n of [2, 3, 4, 5, 6, 7]) it(`n = ${n}: Latin by position and balanced for first-order carry-over`, () => {
    const sq = williams(n);
    expect(sq.length).toBe(n % 2 ? 2 * n : n);
    for (const row of sq) expect([...row].sort((a, b) => a - b)).toEqual([...Array(n).keys()]);
    // every treatment equally often in every position
    for (let pos = 0; pos < n; pos++) {
      const counts = new Array(n).fill(0);
      for (const row of sq) counts[row[pos]]++;
      expect(new Set(counts).size).toBe(1);
    }
    // every ordered pair (a directly followed by b) equally often
    const pairs = new Map<string, number>();
    for (const row of sq) for (let i = 0; i + 1 < n; i++) pairs.set(`${row[i]}>${row[i + 1]}`, (pairs.get(`${row[i]}>${row[i + 1]}`) ?? 0) + 1);
    expect(pairs.size).toBe(n * (n - 1));
    expect(new Set(pairs.values()).size).toBe(1);
  });

  it("is trivial for one treatment and empty for none", () => {
    expect(williams(1)).toEqual([[0]]);
    expect(williams(0)).toEqual([]);
  });
});

describe("session plan", () => {
  it("is reproducible from the seed and changes with it", () => {
    expect(makePlan(protocol(3))).toEqual(makePlan(protocol(3)));
    expect(makePlan(protocol(3, 3, 6, 2, 43))).not.toEqual(makePlan(protocol(3)));
  });

  it("gives every listener every item once per repetition, with every variant in each trial", () => {
    const p = protocol(4, 3, 5, 2);
    const plan = makePlan(p);
    expect(plan.length).toBe(5);
    for (const s of plan) {
      expect(s.trials.length).toBe(6);
      expect(s.trials.map(t => t.n)).toEqual([1, 2, 3, 4, 5, 6]);
      for (let r = 0; r < 2; r++) expect(s.trials.filter(t => t.rep === r).map(t => t.item).sort()).toEqual(p.items.map(i => i.id).sort());
      for (const t of s.trials) expect([...t.order].sort()).toEqual(p.variants.map(v => v.id).sort());
    }
  });

  it("hides the variants behind distinct letters per listener", () => {
    const plan = makePlan(protocol(4, 2, 12, 1));
    for (const s of plan) expect(Object.values(s.labels).sort()).toEqual(["A", "B", "C", "D"]);
    // the letter for a variant is not fixed across listeners
    expect(new Set(plan.map(s => s.labels.v0)).size).toBeGreaterThan(1);
  });

  it("balances the positions over the whole test when the listener count completes the square", () => {
    const p = protocol(3, 2, 0, 1);
    p.listeners = balancedListenerCount(3, 2, 1);
    expect(p.listeners).toBe(3);                    // 3 x 2 trials = 6 rows = one full odd-n Williams design
    const counts = new Map<string, number>();
    for (const s of makePlan(p)) for (const t of s.trials) t.order.forEach((v, i) => counts.set(`${v}@${i}`, (counts.get(`${v}@${i}`) ?? 0) + 1));
    expect(counts.size).toBe(9);
    expect(new Set(counts.values())).toEqual(new Set([2]));
  });
});
