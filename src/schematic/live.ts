// Live electrical values at the probe frequency: node voltages along the chain (from the engine's
// nodeVoltages, with a fallback to the computed transfer functions) and the impedance of each part.
import { nearestIndex, nodeVoltages, probeSample, type Prepared } from "../engine";
import type { CArray, Design, Results, UnitId } from "../types";

/** Signal keys used by the layout's wires and node tags. */
export type SignalKey = "in" | "lp" | "woof" | "hp" | "mid.term" | "tw.term" | string;

export interface LiveChain {
  /** Grid frequency the values belong to (Hz). */
  f: number;
  /** |V| per 1 V at the MiniDSP input, keyed by signal. Unknown keys fall back via level(). */
  volts: Record<SignalKey, number>;
  /** Driver level relative to the system's on-axis level (dB), null when unknown. */
  relDb: Record<UnitId, number | null>;
  /** Driver input impedance at f (ohm, complex), mid and tweeter only. */
  zDriver: Partial<Record<UnitId, [number, number]>>;
  /** True when the per-part node voltages came from the engine (false = only the branch ends are known). */
  exact: boolean;
}

const cabs = (z: CArray, i: number) => Math.hypot(z.re[i], z.im[i]);

/** Compute everything the chain shows at fHz. Never throws: a broken design gives a sparse result. */
export function liveChain(p: Prepared | null, design: Design, results: Results | null, fHz: number): LiveChain | null {
  if (!p || !results) return null;
  const relDb: LiveChain["relDb"] = { woof: null, mid: null, tw: null };
  try {
    const s = probeSample(p, results, fHz, "0");
    for (const u of ["woof", "mid", "tw"] as UnitId[]) relDb[u] = s.units[u].relDb;
  } catch { /* levels stay unknown */ }

  const i = nearestIndex(p.f, fHz);
  const zDriver: LiveChain["zDriver"] = {};
  for (const u of ["mid", "tw"] as const) {
    const z = p.zi[u];
    if (z) zDriver[u] = [z.re[i], z.im[i]];
  }

  try {
    const nv = nodeVoltages(p, design, fHz);
    return {
      f: nv.f, relDb, zDriver, exact: true,
      volts: { in: nv.vin, lp: nv.lpOut, woof: nv.woofDrive, hp: nv.hpOut, "mid.term": nv.midTerminals, "tw.term": nv.twTerminals, ...nv.nodes },
    };
  } catch {
    // fall back to the computed transfer functions: the branch ends are right, inner nodes are not known
    const a = results.angles["0"];
    if (!a) return null;
    const lp = cabs(a.HL, i), hp = cabs(a.HH, i);
    return {
      f: p.f[i], relDb, zDriver, exact: false,
      volts: { in: 1, lp, woof: lp * 10 ** (design.digital.g_woof_dB / 20), hp, "mid.term": hp * cabs(a.Tm, i), "tw.term": hp * cabs(a.Tt, i) },
    };
  }
}

/** Voltage of a signal; an inner node the fallback does not know takes its branch's terminal value. */
export function voltsOf(live: LiveChain | null, key: SignalKey): number | null {
  if (!live) return null;
  if (key in live.volts) return live.volts[key];
  const unit = key.split(".")[0];
  return live.volts[`${unit}.term`] ?? null;
}

export function dbOf(v: number | null): number | null {
  return v === null || !(v > 0) ? null : 20 * Math.log10(v);
}

/** Visual strength of a signal, 0 (−36 dB re input or less) to 1 (0 dB). Drives wire width and opacity. */
export function strength(v: number | null): number {
  const db = dbOf(v);
  if (db === null) return 0;
  return Math.min(1, Math.max(0, (db + 36) / 36));
}

/** Impedance of one part at fHz (ohm, complex). Inductors carry Rdcr ohm per mH, as in the engine. */
export function partImpedance(kind: "L" | "C" | "R", value: number, fHz: number, Rdcr = 0): [number, number] {
  const w = 2 * Math.PI * fHz;
  if (kind === "L") return [Rdcr * value * 1e3, w * value];
  if (kind === "C") return [0, -1 / (w * value)];
  return [value, 0];
}

/** Flow dash period (s) for the probe frequency: slow at 20 Hz, quick at 20 kHz, never frantic. */
export function flowPeriod(fHz: number): number {
  const t = Math.min(1, Math.max(0, Math.log10(Math.max(20, fHz) / 20) / 3));
  return 2.4 - 1.8 * t;
}
