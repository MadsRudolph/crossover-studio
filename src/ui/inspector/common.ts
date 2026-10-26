import type { CheckState, UnitId } from "../../types";

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
