// Parts list of a design: every passive component of the midrange and tweeter boards, in the order
// they sit from the amplifier to the driver, marked by where it comes from.

import type { Design, Profile } from "../types";
import { TOPOLOGY_LIBRARY } from "../engine";

export type BomKind = "L" | "C" | "R";

export interface BomPart {
  /** Schematic reference, unique over the design: "L1_mid", "Rs_tw", "Rz_mid". */
  ref: string;
  /** Inspector focus id: "mid.L1", "tw.pad.Rs", "mid.zobel.R". */
  focusId: string;
  unit: "mid" | "tw";
  pos: "series" | "shunt";
  kind: BomKind;
  /** SI: H, F, ohm. */
  value: number;
  /** Human role, e.g. "Series L", "L-pad series R". */
  role: string;
  /** Zobel only: the capacitor in series with this resistor (drawn under it). */
  zobelC?: { ref: string; value: number; focusId: string };
}

export interface BomRow {
  ref: string;
  focusId: string;
  board: string;
  role: string;
  kind: BomKind;
  value: number;
  /** "basket" = in the profile's component list (Appendix 1 of the course guide). */
  source: "basket" | "other";
}

export const SOURCE_LABEL: Record<BomRow["source"], string> = {
  basket: "course basket (Appendix 1)",
  other: "not in the basket: buy or combine",
};

const BOARD: Record<"mid" | "tw", string> = { mid: "Midrange (low-pass)", tw: "Tweeter (high-pass)" };

/** Folder- and file-safe version of a name. */
export function safeName(s: string): string {
  return s.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^[._]+/, "") || "design";
}

/** The passive parts of one branch, in ladder order (topology, then L-pad, then Zobel), as the engine builds it. */
export function branchParts(d: Design, unit: "mid" | "tw"): BomPart[] {
  const b = d[unit];
  const topo = TOPOLOGY_LIBRARY[b.topo];
  const out: BomPart[] = [];
  if (topo) for (const p of topo.parts) {
    const v = b.vals[p.name];
    if (v > 0) out.push({ ref: `${p.name}_${unit}`, focusId: `${unit}.${p.name}`, unit, pos: p.pos, kind: p.kind, value: v, role: p.label });
  }
  const pad = b.pad ?? {};
  if (pad.Rs) out.push({ ref: `Rs_${unit}`, focusId: `${unit}.pad.Rs`, unit, pos: "series", kind: "R", value: pad.Rs, role: "L-pad series R" });
  if (pad.Rp) out.push({ ref: `Rp_${unit}`, focusId: `${unit}.pad.Rp`, unit, pos: "shunt", kind: "R", value: pad.Rp, role: "L-pad shunt R" });
  if (b.zobel && b.zobel.R > 0 && b.zobel.C > 0)
    out.push({ ref: `Rz_${unit}`, focusId: `${unit}.zobel.R`, unit, pos: "shunt", kind: "R", value: b.zobel.R, role: "Zobel R",
               zobelC: { ref: `Cz_${unit}`, value: b.zobel.C, focusId: `${unit}.zobel.C` } });
  return out;
}

/** True when v is one of the listed values (relative tolerance, the lists are E-series floats). */
export function inList(v: number, list: number[] | undefined): boolean {
  return !!list?.some(x => Math.abs(x - v) <= 1e-6 * Math.max(Math.abs(x), Math.abs(v)));
}

/** Flat parts list of both boards. */
export function bom(profile: Profile, d: Design): BomRow[] {
  const rows: BomRow[] = [];
  const src = (k: BomKind, v: number): BomRow["source"] => inList(v, profile.components?.[k]) ? "basket" : "other";
  for (const u of ["mid", "tw"] as const)
    for (const p of branchParts(d, u)) {
      rows.push({ ref: p.ref, focusId: p.focusId, board: BOARD[u], role: p.role, kind: p.kind, value: p.value, source: src(p.kind, p.value) });
      if (p.zobelC) rows.push({ ref: p.zobelC.ref, focusId: p.zobelC.focusId, board: BOARD[u], role: "Zobel C", kind: "C",
                                value: p.zobelC.value, source: src("C", p.zobelC.value) });
    }
  return rows;
}

/** Plain value with its unit, for files (no locale, ASCII "u" stays "µ" only in Markdown). */
export function valueText(kind: BomKind, v: number, micro = "µ"): string {
  const n = (x: number) => String(Number(x.toPrecision(4)));
  if (kind === "L") return `${n(v * 1e3)} mH`;
  if (kind === "C") return `${n(v * 1e6)} ${micro}F`;
  return `${n(v)} ohm`;
}

const csvCell = (s: string) => /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;

export function bomCsv(rows: BomRow[], d: Design): string {
  const lines = [["Ref", "Board", "Role", "Type", "Value", "Value (SI)", "Source"].join(",")];
  for (const r of rows)
    lines.push([r.ref, r.board, r.role, { L: "Inductor", C: "Capacitor", R: "Resistor" }[r.kind], valueText(r.kind, r.value, "u"),
                String(r.value), SOURCE_LABEL[r.source]].map(csvCell).join(","));
  if (d.Rdcr > 0) lines.push(["", "", `Coil resistance assumed: ${d.Rdcr} ohm per mH`, "", "", "", ""].map(csvCell).join(","));
  return lines.join("\r\n") + "\r\n";
}

export function bomMarkdown(rows: BomRow[], profile: Profile, d: Design, designName?: string): string {
  const out = [`# Parts list: ${profile.name}${designName ? ` - ${designName}` : ""}`, "",
               `Digital crossover: ${d.digital.align} at ${d.digital.fc} Hz, woofer gain ${d.digital.g_woof_dB.toFixed(1)} dB (MiniDSP).`, "",
               "| Ref | Board | Role | Value | Source |", "|---|---|---|---|---|"];
  for (const r of rows) out.push(`| ${r.ref} | ${r.board} | ${r.role} | ${valueText(r.kind, r.value)} | ${SOURCE_LABEL[r.source]} |`);
  const other = rows.filter(r => r.source === "other").length;
  out.push("", other ? `${other} part${other > 1 ? "s are" : " is"} not in the course basket.` : "Every part is in the course basket (Appendix 1).");
  if (d.Rdcr > 0) out.push(`Inductors modelled with ${d.Rdcr} ohm per mH coil resistance.`);
  return out.join("\n") + "\n";
}
