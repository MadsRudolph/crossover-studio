import { beforeAll, describe, expect, it } from "vitest";
import { BUNDLED_PROFILES, useStore } from "../../state/store";
import { buildCommands, fuzzy, probeQuery } from "./commands";

describe("palette probe query", () => {
  it("reads typed frequencies", () => {
    expect(probeQuery("2k")).toBe(2000);
    expect(probeQuery("2 kHz")).toBe(2000);
    expect(probeQuery("3.5k")).toBe(3500);
    expect(probeQuery("500")).toBe(500);
    expect(probeQuery("1khz")).toBe(1000);
    expect(probeQuery("probe 60 Hz")).toBe(60);
  });
  it("ignores words and out-of-range values", () => {
    expect(probeQuery("zobel")).toBeNull();
    expect(probeQuery("5")).toBeNull();
    expect(probeQuery("50k")).toBeNull();
  });
});

describe("palette part search", () => {
  beforeAll(() => useStore.getState().loadProfile(BUNDLED_PROFILES[0]));
  const find = (q: string) => buildCommands()
    .map(c => ({ c, s: Math.max(fuzzy(q, c.title)?.score ?? -Infinity, (fuzzy(q, `${c.section} ${c.keywords ?? ""}`)?.score ?? -Infinity) - 8) }))
    .filter(r => r.s > -Infinity).sort((a, b) => b.s - a.s).map(r => r.c.id);
  it("finds parts by what students call them", () => {
    expect(find("zobel").slice(0, 2)).toEqual(expect.arrayContaining(["goto.mid.zobel"]));
    expect(find("l-pad").slice(0, 4)).toContain("goto.tw.pad.Rs");
    expect(find("lpad").slice(0, 4)).toContain("goto.tw.pad.Rs");
    expect(find("tweeter C1")[0]).toBe("goto.tw.C1");
  });
});
