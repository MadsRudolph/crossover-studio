// Level matching and storage of the listening test: a flat IR reads 0 dB, a scaled one its scale, the
// matched gains bring two designs to the same pink-noise level; documents survive storage and files.
import { describe, expect, it } from "vitest";
import { compute, fitBox, prepare } from "../engine";
import { BUNDLED_PROFILES, defaultDesign } from "../state/store";
import { flatIr, irsFromResults, mixIr } from "../listen/ir";
import { matchGains, pinkLevelDb, withGain } from "./level";
import { demoDoc } from "./demo";
import { docFromFile, docToFile, loadDoc, saveDoc } from "./store";
import { readDoc } from "./model";

const profile = BUNDLED_PROFILES[0];
const prep = prepare(profile, fitBox(profile));
const design = defaultDesign(profile);

describe("level matching", () => {
  it("reads 0 dB for the flat reference and follows a gain", () => {
    const flat = flatIr();
    expect(pinkLevelDb(flat)).toBeCloseTo(0, 2);
    expect(pinkLevelDb(withGain(flat, -6))).toBeCloseTo(-6, 2);
  });

  it("brings a design and a quieter-tweeter version to the same level", () => {
    const quieter = structuredClone(design);
    quieter.tw.pad = { ...quieter.tw.pad, Rs: 10 };
    const irs = [design, quieter].map(d => mixIr(irsFromResults(prep, d, compute(prep, d), "0")));
    const g = matchGains(irs);
    expect(g[0]).toBe(0);
    const after = irs.map((x, i) => pinkLevelDb(withGain(x, g[i])));
    expect(Math.abs(after[0] - after[1])).toBeLessThan(0.05);
  });
});

describe("storage and files", () => {
  const doc = demoDoc(profile, design);

  it("round-trips through storage", () => {
    const mem = new Map<string, string>();
    const storage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) };
    expect(saveDoc(doc, storage)).toBe(true);
    const back = loadDoc(profile.id, storage)!;
    expect(back.ratings).toEqual(doc.ratings);
    expect(back.protocol.variants.map(v => v.id)).toEqual(doc.protocol.variants.map(v => v.id));
    expect(loadDoc("nobody", storage)).toBeNull();
  });

  it("survives a throwing storage", () => {
    const bad = { getItem: () => { throw new Error("no"); }, setItem: () => { throw new Error("no"); }, removeItem: () => {} };
    expect(saveDoc(doc, bad)).toBe(false);
    expect(loadDoc(profile.id, bad)).toBeNull();
  });

  it("exports and imports a JSON file, and rejects anything else", () => {
    const back = docFromFile(docToFile(doc), "other-profile");
    expect(back.profileId).toBe("other-profile");
    expect(back.ratings.length).toBe(doc.ratings.length);
    expect(() => docFromFile("{", "x")).toThrow(/not JSON/);
    expect(() => docFromFile('{"protocol":{}}', "x")).toThrow(/not a Crossover Studio listening test/);
  });

  it("drops ratings that point at nothing or lie off the scale", () => {
    const raw = JSON.parse(docToFile(doc));
    raw.ratings.push({ listener: 0, rep: 0, item: "nope", variant: "v-design", attr: "harsh", value: 4 });
    raw.ratings.push({ listener: 0, rep: 0, item: doc.protocol.items[0].id, variant: "v-design", attr: "harsh", value: 9 });
    expect(readDoc(raw, "x")!.ratings.length).toBe(doc.ratings.length);
  });
});
