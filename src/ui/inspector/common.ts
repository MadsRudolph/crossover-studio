import type { CheckState, UnitId } from "../../types";
import type { PartKind } from "../format";

/** Props every workflow section gets from the inspector. */
export interface SectionCommon {
  open: boolean;
  onOpenChange(open: boolean): void;
  status: CheckState | null;
}

export const UNIT_COLOR: Record<UnitId, string> = { woof: "var(--woof)", mid: "var(--mid)", tw: "var(--tw)" };

export const POLARITY_OPTIONS = [
  { value: 1 as const, label: "+ Normal", hint: "Connected as marked." },
  { value: -1 as const, label: "− Inverted", hint: "Leads swapped: the unit's output is turned upside down (180°)." },
];

/** Values for topology `parts`: the current value of the same name, else the one it had before the
 *  last switch, else the first current part of the same kind, else the middle of the parts list. */
export function carryValues(parts: { kind: PartKind; name: string }[], old: Record<string, number>,
                            memory: Record<string, number>, listFor: (kind: PartKind) => number[]): Record<string, number> {
  const vals: Record<string, number> = {};
  for (const { kind, name } of parts) {
    const sameKind = Object.entries(old).find(([n]) => n.startsWith(kind));
    const list = listFor(kind);
    const kept = memory[name] !== undefined && list.includes(memory[name]) ? memory[name] : undefined;
    vals[name] = old[name] ?? kept ?? (sameKind ? sameKind[1] : list[Math.floor(list.length / 2)]);
  }
  return vals;
}
