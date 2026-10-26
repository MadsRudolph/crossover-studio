// Passive crossover branches as ABCD (transmission) ladders.
//
// A two-port maps the output (V2, I2) to the input: [V1; I1] = [A B; C D] [V2; I2]. A series
// impedance Z is [1 Z; 0 1], a shunt admittance Y is [1 0; Y 1], and a ladder is the product in
// order from the amplifier to the driver. With the driver's measured impedance Z_L as the load,
// the voltage transfer is T = V2/V1 = Z_L / (A Z_L + B) and the amplifier sees
// Z_in = (A Z_L + B) / (C Z_L + D). Port of design/xover.py ladder() / ladder2().

import type { CArray, PassiveBranch } from "../types";
import { carray } from "./complex";

export type PartKind = "L" | "C" | "R";
export type PartPos = "series" | "shunt";

/** One element of a ladder, value in SI (H, F, ohm). Kind "RC" is a series R + C (a Zobel). */
export type LadderPart =
  | { pos: PartPos; kind: PartKind; value: number; id: string }
  | { pos: "shunt"; kind: "RC"; value: [number, number]; id: string };

export interface TopologyPart {
  pos: PartPos;
  kind: PartKind;
  /** Key in PassiveBranch.vals, e.g. "L1". */
  name: string;
  /** Short human label, e.g. "Series L". */
  label: string;
}

export interface Topology {
  key: string;
  /** "2nd order" etc. */
  name: string;
  /** Low-pass (midrange) or high-pass (tweeter). */
  type: "LP" | "HP";
  order: number;
  /** Elements from the amplifier to the driver. */
  parts: TopologyPart[];
  /** One-line description for the picker. */
  description: string;
}

/** The topology library. Every branch may add an L-pad (series Rs, shunt Rp at the driver) and a
 *  Zobel (series R + C across the driver), see PassiveBranch.pad / zobel. */
export const TOPOLOGY_LIBRARY: Record<string, Topology> = {
  LP1: { key: "LP1", name: "1st order", type: "LP", order: 1, description: "Series inductor, 6 dB/oct",
         parts: [{ pos: "series", kind: "L", name: "L1", label: "Series L" }] },
  LP2: { key: "LP2", name: "2nd order", type: "LP", order: 2, description: "Series L, shunt C, 12 dB/oct",
         parts: [{ pos: "series", kind: "L", name: "L1", label: "Series L" },
                 { pos: "shunt", kind: "C", name: "C1", label: "Shunt C" }] },
  LP3: { key: "LP3", name: "3rd order", type: "LP", order: 3, description: "L-C-L T, 18 dB/oct",
         parts: [{ pos: "series", kind: "L", name: "L1", label: "Series L (amp side)" },
                 { pos: "shunt", kind: "C", name: "C1", label: "Shunt C" },
                 { pos: "series", kind: "L", name: "L2", label: "Series L (driver side)" }] },
  HP1: { key: "HP1", name: "1st order", type: "HP", order: 1, description: "Series capacitor, 6 dB/oct",
         parts: [{ pos: "series", kind: "C", name: "C1", label: "Series C" }] },
  HP2: { key: "HP2", name: "2nd order", type: "HP", order: 2, description: "Series C, shunt L, 12 dB/oct",
         parts: [{ pos: "series", kind: "C", name: "C1", label: "Series C" },
                 { pos: "shunt", kind: "L", name: "L1", label: "Shunt L" }] },
  HP3: { key: "HP3", name: "3rd order", type: "HP", order: 3, description: "C-L-C T, 18 dB/oct",
         parts: [{ pos: "series", kind: "C", name: "C1", label: "Series C (amp side)" },
                 { pos: "shunt", kind: "L", name: "L1", label: "Shunt L" },
                 { pos: "series", kind: "C", name: "C2", label: "Series C (driver side)" }] },
};

/** The old shape (key -> [pos, kind, name][]), as the browser prototype exposed it. */
export function legacyTopologies(): Record<string, [PartPos, PartKind, string][]> {
  const out: Record<string, [PartPos, PartKind, string][]> = {};
  for (const [k, t] of Object.entries(TOPOLOGY_LIBRARY)) out[k] = t.parts.map(p => [p.pos, p.kind, p.name]);
  return out;
}

export function topology(key: string): Topology {
  const t = TOPOLOGY_LIBRARY[key];
  if (!t) throw new Error(`unknown passive topology "${key}" (known: ${Object.keys(TOPOLOGY_LIBRARY).join(", ")})`);
  return t;
}

/** Ladder elements of a branch: the topology, then the L-pad, then the Zobel, as xover.py orders them.
 *  `unit` prefixes the ids ("mid.L1", "tw.pad.Rs", "tw.zobel"), which the UI uses as focus ids. */
export function passiveParts(b: PassiveBranch, unit = ""): LadderPart[] {
  const pre = unit ? `${unit}.` : "";
  const parts: LadderPart[] = topology(b.topo).parts.map(p => {
    const v = b.vals[p.name];
    if (!(v > 0 && Number.isFinite(v))) throw new Error(`${pre}${p.name}: missing, non-positive or infinite value`);
    return { pos: p.pos, kind: p.kind, value: v, id: `${pre}${p.name}` };
  });
  const pad = b.pad ?? {};
  // 0, null or undefined mean "no resistor there" (the optimiser tries Rs = 0); a negative, NaN or
  // infinite value would silently give a non-physical (or open) branch, so it is an error
  for (const k of ["Rs", "Rp"] as const) {
    const v = pad[k];
    if (v !== undefined && v !== null && v !== 0 && !(v > 0 && Number.isFinite(v)))
      throw new Error(`${pre}pad.${k}: the L-pad resistor must be a positive resistance (got ${v} Ω)`);
  }
  if (pad.Rs) parts.push({ pos: "series", kind: "R", value: pad.Rs, id: `${pre}pad.Rs` });
  if (pad.Rp) parts.push({ pos: "shunt", kind: "R", value: pad.Rp, id: `${pre}pad.Rp` });
  if (b.zobel && b.zobel.R > 0 && b.zobel.C > 0) parts.push({ pos: "shunt", kind: "RC", value: [b.zobel.R, b.zobel.C], id: `${pre}zobel` });
  return parts;
}

/** Impedance of one element at angular frequency w. Inductors carry Rdcr ohm per mH in series. */
function elementZ(p: LadderPart, w: number, Rdcr: number): [number, number] {
  switch (p.kind) {
    case "L": return [Rdcr * p.value * 1e3, w * p.value];
    case "C": return [0, -1 / (w * p.value)];
    case "R": return [p.value, 0];
    case "RC": return [p.value[0], -1 / (w * p.value[1])];
  }
}

export interface LadderResult {
  /** V_driver / V_amp. */
  T: CArray;
  /** Impedance the amplifier sees. */
  Zin: CArray;
}

/** Evaluate a ladder on the grid f (Hz) with the driver impedance Zl on the same grid.
 *  The Zobel sits across the driver, so it folds into the load first (xover.py ladder2). */
export function ladder(f: ArrayLike<number>, parts: LadderPart[], Zl: CArray, Rdcr = 0): LadderResult {
  const n = f.length, T = carray(n), Zin = carray(n);
  const plain = parts.filter(p => p.kind !== "RC");
  const zobel = parts.find(p => p.kind === "RC");
  for (let i = 0; i < n; i++) {
    const w = 2 * Math.PI * f[i];
    let zr = Zl.re[i], zi = Zl.im[i];
    if (zobel) [zr, zi] = parallel(zr, zi, ...elementZ(zobel, w, Rdcr));
    // ABCD accumulated left to right
    let Ar = 1, Ai = 0, Br = 0, Bi = 0, Cr = 0, Ci = 0, Dr = 1, Di = 0;
    for (const p of plain) {
      const [er, ei] = elementZ(p, w, Rdcr);
      if (p.pos === "series") {
        const nBr = Ar * er - Ai * ei + Br, nBi = Ar * ei + Ai * er + Bi;
        const nDr = Cr * er - Ci * ei + Dr, nDi = Cr * ei + Ci * er + Di;
        Br = nBr; Bi = nBi; Dr = nDr; Di = nDi;
      } else {
        const d = er * er + ei * ei, yr = er / d, yi = -ei / d;
        const nAr = Ar + Br * yr - Bi * yi, nAi = Ai + Br * yi + Bi * yr;
        const nCr = Cr + Dr * yr - Di * yi, nCi = Ci + Dr * yi + Di * yr;
        Ar = nAr; Ai = nAi; Cr = nCr; Ci = nCi;
      }
    }
    const numr = Ar * zr - Ai * zi + Br, numi = Ar * zi + Ai * zr + Bi;
    const denr = Cr * zr - Ci * zi + Dr, deni = Cr * zi + Ci * zr + Di;
    let d = numr * numr + numi * numi;
    T.re[i] = (zr * numr + zi * numi) / d; T.im[i] = (zi * numr - zr * numi) / d;
    d = denr * denr + deni * deni;
    Zin.re[i] = (numr * denr + numi * deni) / d; Zin.im[i] = (numi * denr - numr * deni) / d;
  }
  return { T, Zin };
}

function parallel(ar: number, ai: number, br: number, bi: number): [number, number] {
  // (a b) / (a + b)
  const pr = ar * br - ai * bi, pi = ar * bi + ai * br, sr = ar + br, si = ai + bi, d = sr * sr + si * si;
  return [(pr * sr + pi * si) / d, (pi * sr - pr * si) / d];
}

export interface LadderNode {
  /** Id of the element the node sits after ("mid.L1"), or "in" for the amplifier terminal. */
  after: string;
  /** Voltage at the node for 1 V at the input (complex). */
  v: [number, number];
}

/** Voltages along the ladder at one frequency, input driven with 1 V: walk forward with the input
 *  current I = 1 / Z_in, dropping I Z across each series element and shedding V Y into each shunt.
 *  The last node is the driver terminal (after the pad); a Zobel does not add a node. */
export function ladderNodes(fHz: number, parts: LadderPart[], zl: [number, number], Rdcr = 0): LadderNode[] {
  const w = 2 * Math.PI * fHz;
  const one = { re: Float64Array.of(zl[0]), im: Float64Array.of(zl[1]) };
  const { Zin } = ladder([fHz], parts, one, Rdcr);
  const zr = Zin.re[0], zi = Zin.im[0], dz = zr * zr + zi * zi;
  let vr = 1, vi = 0, ir = zr / dz, ii = -zi / dz;
  const nodes: LadderNode[] = [{ after: "in", v: [1, 0] }];
  for (const p of parts) {
    if (p.kind === "RC") continue;
    const [er, ei] = elementZ(p, w, Rdcr);
    if (p.pos === "series") {
      vr -= ir * er - ii * ei; vi -= ir * ei + ii * er;
      nodes.push({ after: p.id, v: [vr, vi] });
    } else {
      const d = er * er + ei * ei, yr = er / d, yi = -ei / d;
      ir -= vr * yr - vi * yi; ii -= vr * yi + vi * yr;
    }
  }
  return nodes;
}
