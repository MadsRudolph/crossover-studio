// Per-profile persistence of the as-built measurements: round trip, junk tolerance and throwing storage.
import { describe, expect, it } from "vitest";
import { loadAsBuilt, saveAsBuilt, storageKey } from "./storage";
import type { AsBuiltData } from "./analyse";

function memory() {
  const m = new Map<string, string>();
  return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); } };
}
const throwing = {
  getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("quota"); }, removeItem: () => { throw new Error("denied"); },
};

const data: AsBuiltData = {
  sum: { "0": { f: [100, 200, 400], re: [1, 0.5, 0.25], im: [0, -0.1, 0.2], source: { file: "sys_0.txt", format: "ltspice" } } },
  units: { tw: { f: [1000, 2000], re: [0.1, 0.2], im: [0.3, 0.4] } },
};

describe("as-built storage", () => {
  it("(7) round-trips the data and the vents choice per profile", () => {
    const s = memory();
    expect(saveAsBuilt("group-10", { data, ventsOpen: true }, s)).toBe(true);
    expect(s.m.has(storageKey("group-10"))).toBe(true);
    const back = loadAsBuilt("group-10", s);
    expect(back).toEqual({ data, ventsOpen: true });
    // another profile sees nothing
    expect(loadAsBuilt("group-11", s)).toEqual({ data: { sum: {}, units: {} }, ventsOpen: false });
  });

  it("stores plain arrays, not typed-array objects", () => {
    const s = memory();
    const typed = { sum: { "0": { f: Float64Array.of(1, 2) as unknown as number[], re: [1, 2], im: [0, 0] } }, units: {} };
    saveAsBuilt("p", { data: typed, ventsOpen: false }, s);
    expect(JSON.parse(s.m.get(storageKey("p"))!).sum["0"].f).toEqual([1, 2]);
  });

  it("clearing everything removes the entry", () => {
    const s = memory();
    saveAsBuilt("p", { data, ventsOpen: false }, s);
    saveAsBuilt("p", { data: { sum: {}, units: {} }, ventsOpen: false }, s);
    expect(s.m.size).toBe(0);
  });

  it("(7) survives a throwing or missing storage and junk entries", () => {
    expect(saveAsBuilt("p", { data, ventsOpen: false }, throwing)).toBe(false);
    expect(loadAsBuilt("p", throwing)).toEqual({ data: { sum: {}, units: {} }, ventsOpen: false });
    expect(saveAsBuilt("p", { data, ventsOpen: false }, null)).toBe(false);
    expect(loadAsBuilt("p", null).data.sum).toEqual({});
    const s = memory();
    s.m.set(storageKey("p"), "{not json");
    expect(loadAsBuilt("p", s).data.sum).toEqual({});
    s.m.set(storageKey("p"), JSON.stringify({ sum: { "0": { f: [1], re: [1], im: [1] }, x: { f: [1, 2], re: [1, 2], im: [1, 2] } }, units: { tw: "no" } }));
    expect(loadAsBuilt("p", s)).toEqual({ data: { sum: {}, units: {} }, ventsOpen: false });
  });
});
