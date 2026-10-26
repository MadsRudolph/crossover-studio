// Design mutations the signal chain offers. Each returns an Immer recipe for store.edit, so every
// change is one undo step and the inspector, plots and 3D view all follow from the same store.
import { TOPOLOGY_LIBRARY } from "../engine";
import type { Design, PassiveBranch, Profile } from "../types";

export type BranchUnit = "mid" | "tw";
export type PartKind = "L" | "C" | "R";
type Recipe = (d: Design) => void;

/** Nearest value of `list` to `v` on a log scale (part lists are E-series, so ratios matter). */
export function nearestPart(list: number[], v: number): number {
  if (!list.length) return v;
  return list.reduce((b, x) => (Math.abs(Math.log(x / v)) < Math.abs(Math.log(b / v)) ? x : b), list[0]);
}

export function partList(profile: Profile, kind: PartKind): number[] {
  return kind === "L" ? profile.components.L : kind === "C" ? profile.components.C : profile.components.R;
}

/** Topology keys for a branch, lowest order first (midrange gets low-passes, tweeter high-passes). */
export function topologyKeys(unit: BranchUnit): string[] {
  const type = unit === "mid" ? "LP" : "HP";
  return Object.values(TOPOLOGY_LIBRARY).filter(t => t.type === type).sort((a, b) => a.order - b.order).map(t => t.key);
}

/** Switch a branch's topology. Values the new topology shares by name are kept; a new part takes a
 *  value of the same kind from the branch, else the middle of the parts list. Stale values are dropped,
 *  because the engine rejects a topology with missing values and ignores none. */
export function setTopology(profile: Profile, unit: BranchUnit, key: string): Recipe {
  return d => {
    const b = d[unit] as PassiveBranch;
    const t = TOPOLOGY_LIBRARY[key];
    if (!t || b.topo === key) return;
    const old = b.vals;
    const vals: Record<string, number> = {};
    for (const { kind, name } of t.parts) {
      const sameKind = Object.entries(old).find(([n]) => n.startsWith(kind));
      const list = partList(profile, kind);
      vals[name] = old[name] ?? (sameKind ? sameKind[1] : list[Math.floor(list.length / 2)]);
    }
    b.topo = key;
    b.vals = vals;
  };
}

export function setPartValue(unit: BranchUnit, name: string, value: number): Recipe {
  return d => { d[unit].vals[name] = value; };
}

/** Voice-coil resistance used for the starting values of an L-pad or Zobel. */
function coilR(profile: Profile, unit: BranchUnit): number {
  return profile.units[unit]?.Re_ohm ?? 6;
}

/** Add an L-pad starting at about −6 dB into Re: Rs = Re/2, Rp = Re (a half-voltage divider that keeps
 *  the filter's load close to Re). */
export function addPad(profile: Profile, unit: BranchUnit): Recipe {
  const re = coilR(profile, unit), R = profile.components.R;
  return d => { d[unit].pad = { Rs: nearestPart(R, re / 2), Rp: nearestPart(R, re) }; };
}

export function setPad(unit: BranchUnit, which: "Rs" | "Rp", value: number): Recipe {
  return d => { d[unit].pad = { ...(d[unit].pad ?? {}), [which]: value }; };
}

/** Remove one resistor of the L-pad: Rs = 0 and Rp = null both mean "not fitted" to the engine. */
export function removePadPart(unit: BranchUnit, which: "Rs" | "Rp"): Recipe {
  return d => {
    const pad = { ...(d[unit].pad ?? {}) };
    if (which === "Rs") delete pad.Rs; else delete pad.Rp;
    d[unit].pad = pad;
  };
}

export function removePad(unit: BranchUnit): Recipe {
  return d => { d[unit].pad = {}; };
}

/** Add a Zobel: R ≈ 1.25 Re, C from 4.7 µF (the inspector uses the same start). */
export function addZobel(profile: Profile, unit: BranchUnit): Recipe {
  const re = coilR(profile, unit);
  return d => { d[unit].zobel = { R: nearestPart(profile.components.R, re * 1.25), C: nearestPart(profile.components.C, 4.7e-6) }; };
}

export function setZobel(unit: BranchUnit, which: "R" | "C", value: number): Recipe {
  return d => { const z = d[unit].zobel; if (z) z[which] = value; };
}

export function removeZobel(unit: BranchUnit): Recipe {
  return d => { d[unit].zobel = null; };
}

export function hasPad(b: PassiveBranch): boolean {
  return !!(b.pad?.Rs || b.pad?.Rp);
}

export function hasZobel(b: PassiveBranch): boolean {
  return !!(b.zobel && b.zobel.R > 0 && b.zobel.C > 0);
}

export function flipPolarity(unit: "woof" | "mid" | "tw"): Recipe {
  return d => { d.pol[unit] = d.pol[unit] === 1 ? -1 : 1; };
}
