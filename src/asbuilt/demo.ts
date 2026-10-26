// A synthetic as-built measurement for demos and browser checks (?asbuilt=demo in a dev build): the
// prediction with the tweeter wired inverted, 4 dB louder (a closer microphone), as if exported from
// LTspice. The fault finder should name the inverted tweeter first.

import type { Design, Series } from "../types";
import { compute, type Prepared } from "../engine";
import { predictedDesign, type AsBuiltData } from "./analyse";

export const DEMO_OFFSET_DB = 4;

/** The measurement a build with `fault` applied would give, at every measured angle, `offsetDb` louder. */
export function syntheticData(p: Prepared, design: Design, fault: (d: Design) => Design, offsetDb = 0, name = "synthetic"): AsBuiltData {
  const r = compute(p, fault(predictedDesign(design, false))), k = 10 ** (offsetDb / 20), sum: Record<string, Series> = {};
  for (const a of p.angles) {
    const z = r.angles[a].sum;
    sum[a] = { f: Array.from(p.f), re: Array.from(z.re, v => v * k), im: Array.from(z.im, v => v * k),
               source: { file: `${name}_${a}deg.txt`, format: "ltspice", note: "Synthetic measurement for the demo." } };
  }
  return { sum, units: {} };
}

/** The tweeter-inverted demo case. */
export function demoData(p: Prepared, design: Design): AsBuiltData {
  return syntheticData(p, design, d => ({ ...d, pol: { ...d.pol, tw: d.pol.tw === 1 ? -1 : 1 } }), DEMO_OFFSET_DB, "demo_tweeter_inverted");
}

/** True when the dev-only URL flag ?asbuilt=demo is set. */
export function demoRequested(): boolean {
  try { return import.meta.env.DEV && new URLSearchParams(window.location.search).get("asbuilt") === "demo"; }
  catch { return false; }
}
