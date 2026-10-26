import { describe, expect, it } from "vitest";
import { fuzzy } from "./fuzzy";

describe("fuzzy", () => {
  it("prefers a literal substring and highlights it contiguously", () => {
    const r = fuzzy("probe", "Type a probe frequency")!;
    expect(r.hits).toEqual([7, 8, 9, 10, 11]);
    expect(r.score).toBeGreaterThan(fuzzy("pre", "Type a probe frequency")!.score);
  });
  it("matches initials in order", () => {
    expect(fuzzy("mtc", "Probe the midrange/tweeter crossover")).not.toBeNull();
    expect(fuzzy("xyz", "Show Response")).toBeNull();
  });
  it("word starts outrank mid-word hits", () => {
    expect(fuzzy("sr", "Show Response")!.score).toBeGreaterThan(fuzzy("sr", "Sensor")!.score);
  });
});
