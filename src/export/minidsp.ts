// The MiniDSP biquad text exactly as the course's DigitalCrossover.m writes it (DSPCoef_*.txt). The engine
// formats each section like the script's sprintf, ", " after every coefficient; the script then joins the
// sections with strcat, which drops trailing whitespace, so its file has "a2 = ...,\n biquad2" and ends in ",".
import { minidspText, type FilterKind } from "../engine";
import type { Align } from "../types";

export function minidspFileText(fc: number, kind: FilterKind, align: Align): string {
  // strcat trims each section's trailing ", " to ","; the spaces inside a section stay.
  return minidspText(null, fc, kind, align).replace(/, (?=\n biquad|$)/g, ",");
}
