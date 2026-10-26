import { describe, expect, it } from "vitest";
import { carryValues } from "./common";

const lists = { L: [0.1e-3, 0.22e-3, 0.68e-3, 1e-3], C: [2.2e-6, 4.7e-6, 5.6e-6], R: [3.3, 4.7] };
const listFor = (k: "L" | "C" | "R") => lists[k];

describe("topology switch keeps part values", () => {
  it("brings back a tuned value after a round trip through another order", () => {
    const memory: Record<string, number> = {};
    const hp2 = { C1: 5.6e-6, L1: 0.22e-3 };
    const hp1 = carryValues([{ kind: "C", name: "C1" }], hp2, memory, listFor);
    Object.assign(memory, hp2);
    expect(hp1).toEqual({ C1: 5.6e-6 });
    const back = carryValues([{ kind: "C", name: "C1" }, { kind: "L", name: "L1" }], hp1, memory, listFor);
    expect(back).toEqual(hp2);
  });
  it("seeds a new part from a current part of the same kind, else the middle of the list", () => {
    const v = carryValues([{ kind: "C", name: "C2" }, { kind: "R", name: "R1" }], { C1: 4.7e-6 }, {}, listFor);
    expect(v).toEqual({ C2: 4.7e-6, R1: 4.7 });
  });
  it("ignores a remembered value that is not in the parts list", () => {
    const v = carryValues([{ kind: "L", name: "L1" }], {}, { L1: 0.5e-3 }, listFor);
    expect(v.L1).toBe(0.68e-3);
  });
});
