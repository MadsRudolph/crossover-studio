// The fault finder: build mistakes that would explain why the measured system differs from the
// prediction. Each hypothesis is a pure change of the (plugged) design, or a dedicated evaluation for
// faults the design cannot express (MiniDSP outputs swapped). Every one is scored by the same aligned
// RMS as the measurement itself, with its own level offset, and the ones that explain a real part of
// the difference are listed. A hypothesis never touches the design: the fault is in the build.

import type { Align, Design, Results, UnitId } from "../types";
import { ALIGNMENTS, compute, type Prepared } from "../engine";
import { fmtValue } from "../ui/format";
import { scoreResults, type MeasOnGrid } from "./analyse";

export interface Hypothesis {
  id: string;
  /** Plain-language title, what to do included: "Tweeter connected inverted: swap its leads on the board". */
  title: string;
  /** One sentence on how to check it on the bench. */
  fix: string;
  /** Inspector control (store.ui.focus id) of the part involved. */
  focus: string;
  /** The design as it would have been built with this fault. */
  apply?: (d: Design) => Design;
  /** A fault the design cannot express: computes the results directly. */
  evaluate?: (p: Prepared, d: Design) => Results;
}

export interface FaultResult {
  h: Hypothesis;
  rms: number;
  offset: number;
  results: Results;
}

/** A hypothesis is listed when it lowers the RMS by at least MIN_GAIN_DB and by MIN_GAIN_FRAC. A small
 *  difference (a single part one step off moves the response by only a few tenths of a dB) still lists
 *  a hypothesis that explains most of it: at least half of the RMS and MIN_SMALL_GAIN_DB. */
export const MIN_GAIN_DB = 0.75;
export const MIN_GAIN_FRAC = 0.25;
export const MIN_SMALL_GAIN_DB = 0.15;
export const MAX_FAULTS = 5;

const NAME: Record<UnitId, string> = { woof: "Woofer", mid: "Midrange", tw: "Tweeter" };
const clone = (d: Design): Design => structuredClone(d) as Design;
const fmtGain = (g: number) => `${g > 0 ? "+" : g < 0 ? "−" : ""}${Math.abs(g).toFixed(1)} dB`;
const fmtHz = (f: number) => f >= 1000 ? `${(f / 1000).toFixed(2)} kHz` : `${Math.round(f)} Hz`;

/** The basket value `steps` positions from v in a sorted component list (v snapped to the nearest stock
 *  value first); null past either end. */
export function basketStep(list: number[], v: number, steps: number): number | null {
  const s = [...list].sort((a, b) => a - b);
  if (!s.length || !(v > 0)) return null;
  let i = 0;
  for (let k = 1; k < s.length; k++) if (Math.abs(Math.log(s[k] / v)) < Math.abs(Math.log(s[i] / v))) i = k;
  const j = i + steps;
  return j >= 0 && j < s.length ? s[j] : null;
}

/** MiniDSP outputs swapped: the woofer channel gets the high-pass and the board the low-pass. The
 *  results of the design are re-weighted per unit by H_H / H_L (and the inverse), which is exact
 *  because each unit's output is a product with its digital filter. */
export function swappedOutputs(p: Prepared, d: Design): Results {
  const r = compute(p, d), angles: Results["angles"] = {};
  for (const [a, out] of Object.entries(r.angles)) {
    const N = out.sum.re.length, woof = { re: new Float64Array(N), im: new Float64Array(N) };
    const mid = { re: new Float64Array(N), im: new Float64Array(N) }, tw = { re: new Float64Array(N), im: new Float64Array(N) };
    const sum = { re: new Float64Array(N), im: new Float64Array(N) };
    for (let i = 0; i < N; i++) {
      // q = H_H / H_L: the woofer is multiplied by q, the passive branches by 1/q
      const lr = out.HL.re[i], li = out.HL.im[i], hr = out.HH.re[i], hi = out.HH.im[i];
      const dl = lr * lr + li * li, dh = hr * hr + hi * hi;
      const qr = dl ? (hr * lr + hi * li) / dl : 0, qi = dl ? (hi * lr - hr * li) / dl : 0;
      const ir = dh ? (lr * hr + li * hi) / dh : 0, ii = dh ? (li * hr - lr * hi) / dh : 0;
      woof.re[i] = out.woof.re[i] * qr - out.woof.im[i] * qi; woof.im[i] = out.woof.re[i] * qi + out.woof.im[i] * qr;
      mid.re[i] = out.mid.re[i] * ir - out.mid.im[i] * ii; mid.im[i] = out.mid.re[i] * ii + out.mid.im[i] * ir;
      tw.re[i] = out.tw.re[i] * ir - out.tw.im[i] * ii; tw.im[i] = out.tw.re[i] * ii + out.tw.im[i] * ir;
      sum.re[i] = woof.re[i] + mid.re[i] + tw.re[i]; sum.im[i] = woof.im[i] + mid.im[i] + tw.im[i];
    }
    angles[a] = { ...out, woof, mid, tw, sum, HL: out.HH, HH: out.HL };
  }
  return { ...r, angles };
}

/** Every build fault worth testing for this design. */
export function hypotheses(p: Prepared, design: Design): Hypothesis[] {
  const C = p.profile.components, out: Hypothesis[] = [];

  for (const u of ["woof", "mid", "tw"] as const) {
    const where = u === "woof" ? "at the amplifier's channel 1 terminals (or invert channel 1 in the MiniDSP)" : "on the board";
    out.push({
      id: `pol.${u}`, title: `${NAME[u]} connected inverted: swap its leads ${where}`,
      fix: `Check the red/black wire of the ${NAME[u].toLowerCase()} against the schematic.`,
      focus: u === "woof" ? "digital.pol" : `${u}.pol`,
      apply: d => { const x = clone(d); x.pol[u] = (x.pol[u] === 1 ? -1 : 1); return x; },
    });
  }

  // passive parts one and two basket steps off
  for (const u of ["mid", "tw"] as const) {
    const b = design[u];
    const part = (key: string, kind: "L" | "C" | "R", v: number, set: (x: Design, nv: number) => void, focus: string, label: string) => {
      for (const k of [-2, -1, 1, 2]) {
        const nv = basketStep(C[kind], v, k);
        if (nv === null || Math.abs(nv / v - 1) < 1e-6) continue;
        out.push({
          id: `${u}.${key}${k > 0 ? "+" : ""}${k}`,
          title: `${NAME[u]} ${label} is ${fmtValue(nv, kind)}, not ${fmtValue(v, kind)}: ${Math.abs(k) === 1 ? "the neighbouring" : "a value two steps"} ${k > 0 ? "up" : "down"} in the basket`,
          fix: `Read the marking of the ${NAME[u].toLowerCase()} ${label} on the board, or measure it out of circuit.`,
          focus, apply: d => { const x = clone(d); set(x, nv); return x; },
        });
      }
    };
    for (const [name, v] of Object.entries(b.vals)) part(name, name[0] as "L" | "C", v, (x, nv) => { x[u].vals[name] = nv; }, `${u}.${name}`, name);
    const pad = b.pad ?? {};
    if (pad.Rs) part("Rs", "R", pad.Rs, (x, nv) => { x[u].pad = { ...x[u].pad, Rs: nv }; }, `${u}.pad.Rs`, "Rs");
    if (pad.Rp) part("Rp", "R", pad.Rp, (x, nv) => { x[u].pad = { ...x[u].pad, Rp: nv }; }, `${u}.pad.Rp`, "Rp");
    if (b.zobel) {
      const z = b.zobel;
      part("zR", "R", z.R, (x, nv) => { x[u].zobel = { ...z, R: nv }; }, `${u}.zobel.R`, "Zobel R");
      part("zC", "C", z.C, (x, nv) => { x[u].zobel = { ...z, C: nv }; }, `${u}.zobel.C`, "Zobel C");
    }

    // shorted inductors, open capacitors
    for (const [name] of Object.entries(b.vals)) {
      const isL = name.startsWith("L");
      out.push({
        id: `${u}.${name}.${isL ? "short" : "open"}`,
        title: isL ? `${NAME[u]} ${name} shorted: a solder bridge or a wire across the coil` : `${NAME[u]} ${name} open: a cold joint or a missing capacitor`,
        fix: isL ? `Measure across ${name} with the power off: it should read the coil's DC resistance, not 0 Ω.` : `Check both solder joints of ${name}, and that it is the part the schematic shows.`,
        focus: `${u}.${name}`,
        apply: d => { const x = clone(d); x[u].vals[name] = isL ? 1e-6 : 1e-12; return x; },
      });
    }
    if (pad.Rp) out.push({
      id: `${u}.Rp.missing`, title: `${NAME[u]} Rp missing or not connected`,
      fix: "The L-pad's parallel resistor sits across the driver terminals: check that it is fitted and soldered.",
      focus: `${u}.pad.Rp`, apply: d => { const x = clone(d); x[u].pad = { ...x[u].pad, Rp: null }; return x; },
    });
    if (pad.Rs) out.push({
      id: `${u}.Rs.short`, title: `${NAME[u]} Rs bypassed: the series resistor is shorted`,
      fix: "Check that nothing bridges the series resistor of the L-pad.",
      focus: `${u}.pad.Rs`, apply: d => { const x = clone(d); x[u].pad = { ...x[u].pad, Rs: undefined }; return x; },
    });
    if (pad.Rs && pad.Rp && Math.abs(pad.Rs - pad.Rp) > 1e-9) out.push({
      id: `${u}.pad.swap`, title: `${NAME[u]} L-pad resistors swapped: Rs and Rp in each other's place`,
      fix: `Rs (${fmtValue(pad.Rs, "R")}) goes in series, Rp (${fmtValue(pad.Rp, "R")}) across the driver.`,
      focus: `${u}.pad.Rs`, apply: d => { const x = clone(d); x[u].pad = { ...x[u].pad, Rs: pad.Rp!, Rp: pad.Rs! }; return x; },
    });
    if (b.zobel) out.push({
      id: `${u}.zobel.missing`, title: `${NAME[u]} Zobel network missing or not connected`,
      fix: "Check the R + C across the driver terminals.",
      focus: `${u}.zobel`, apply: d => { const x = clone(d); x[u].zobel = null; return x; },
    });
  }

  // MiniDSP settings
  const g = design.digital.g_woof_dB;
  const gains: [number, string][] = [[0, `Woofer gain left at 0 dB (designed ${fmtGain(g)}): set it in the MiniDSP`]];
  for (const dg of [-3, 3]) gains.push([g + dg, `Woofer gain ${dg > 0 ? "3 dB too high" : "3 dB too low"}: ${fmtGain(g + dg)} instead of ${fmtGain(g)}`]);
  for (const [ng, title] of gains) {
    if (Math.abs(ng - g) < 1e-9) continue;
    out.push({ id: `gain.${ng.toFixed(1)}`, title, fix: "Read the channel 1 gain in the MiniDSP plug-in and on the amplifier's volume knobs.",
               focus: "digital.gain", apply: d => { const x = clone(d); x.digital.g_woof_dB = ng; return x; } });
  }
  const fc = design.digital.fc;
  for (const [k, what] of [[2, "doubled"], [0.5, "halved"]] as const) out.push({
    id: `fc.${k}`, title: `MiniDSP crossover typed as ${fmtHz(fc * k)} instead of ${fmtHz(fc)} (${what})`,
    fix: "Re-paste the biquad coefficients from the export, or read the crossover frequency in the plug-in.",
    focus: "digital.fc", apply: d => { const x = clone(d); x.digital.fc = fc * k; return x; },
  });
  for (const al of ALIGNMENTS.map(a => a.key) as Align[]) {
    if (al === design.digital.align) continue;
    out.push({
      id: `align.${al}`, title: `MiniDSP alignment set to ${al} instead of ${design.digital.align}`,
      fix: "Check the filter type of both outputs in the MiniDSP plug-in.",
      focus: "digital.align", apply: d => { const x = clone(d); x.digital.align = al; return x; },
    });
  }
  out.push({
    id: "outputs.swapped", title: "MiniDSP outputs swapped: the woofer gets the high-pass and the board the low-pass",
    fix: "Swap the two cables at the MiniDSP outputs (or the amplifier inputs).",
    focus: "digital.fc", evaluate: swappedOutputs,
  });
  return out;
}

/** Results of a hypothesis, or null when it does not compute (dropped). */
export function evaluateHypothesis(p: Prepared, design: Design, h: Hypothesis): Results | null {
  try { return h.evaluate ? h.evaluate(p, design) : compute(p, h.apply!(design)); }
  catch { return null; }
}

export function scoreHypothesis(p: Prepared, design: Design, ms: MeasOnGrid[], h: Hypothesis): FaultResult | null {
  const r = evaluateHypothesis(p, design, h);
  if (!r) return null;
  const s = scoreResults(p, ms, r);
  return Number.isFinite(s.rms) ? { h, rms: s.rms, offset: s.offset, results: r } : null;
}

/** True when a hypothesis with RMS `after` explains enough of a difference with RMS `base`. */
export function explains(base: number, after: number): boolean {
  const gain = base - after;
  return (gain >= MIN_GAIN_DB && after <= (1 - MIN_GAIN_FRAC) * base) || (gain >= MIN_SMALL_GAIN_DB && after <= 0.5 * base);
}

/** The hypotheses that explain a real part of the difference, best first. */
export function rankFaults(base: number, scored: (FaultResult | null)[], max = MAX_FAULTS): FaultResult[] {
  return scored
    .filter((r): r is FaultResult => !!r && explains(base, r.rms))
    .sort((a, b) => a.rms - b.rms)
    .slice(0, max);
}

/** Synchronous scan of every hypothesis (tests, small designs). `design` is the predicted (plugged) design. */
export function findFaults(p: Prepared, design: Design, ms: MeasOnGrid[], baseRms: number, max = MAX_FAULTS): FaultResult[] {
  return rankFaults(baseRms, hypotheses(p, design).map(h => scoreHypothesis(p, design, ms, h)), max);
}

/** The same scan in small chunks, yielding to the UI between them. Rejects with an AbortError when
 *  the signal aborts (the measurement or the design changed, the view closed). */
export function runFaults(p: Prepared, design: Design, ms: MeasOnGrid[], baseRms: number,
                          opts: { signal?: AbortSignal; onProgress?: (done: number, total: number) => void; chunk?: number } = {}): Promise<FaultResult[]> {
  const list = hypotheses(p, design), scored: (FaultResult | null)[] = [], chunk = opts.chunk ?? 4;
  return new Promise((resolve, reject) => {
    let k = 0;
    const step = () => {
      if (opts.signal?.aborted) { reject(new DOMException("Fault search cancelled", "AbortError")); return; }
      for (const end = Math.min(list.length, k + chunk); k < end; k++) scored.push(scoreHypothesis(p, design, ms, list[k]));
      opts.onProgress?.(k, list.length);
      if (k < list.length) setTimeout(step, 0);
      else resolve(rankFaults(baseRms, scored));
    };
    setTimeout(step, 0);
  });
}
