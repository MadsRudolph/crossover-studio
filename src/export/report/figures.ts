// Report pack, part 2: the figure data. A figure is one frequency axis, stacked panels and the series on
// them; the same object becomes a pgfplots groupplot over a CSV file (latex.ts) and an inline SVG (svg.ts).
//
// The grading rules of the course's Lab A apply to every figure: axis labels "Name (unit)" without
// [unit] brackets, a phase panel for every complex quantity, and dB always with its reference.

import { boxModelCurves, boxValidation, displayPhase, driverValidation, offAxisAngle, type Prepared } from "../../engine";
import type { CArray } from "../../types";
import type { ReportInput } from "./tables";

/** Print palette, theme independent (a report is printed). Driver colours follow the app's meaning. */
export const PALETTE = {
  woof: "#1f5fb4", mid: "#e07b17", tw: "#2e8b3d", sum: "#111111", ref: "#8a8a8a",
  c1: "#1f5fb4", c2: "#e07b17", c3: "#2e8b3d", c4: "#8e44ad", c5: "#b03a2e", c6: "#555555",
} as const;
export type PaletteKey = keyof typeof PALETTE;

export interface FigSeries {
  /** CSV column name (pgfplots-safe: letters, digits, underscore). */
  col: string;
  legend: string;
  color: PaletteKey;
  dash?: boolean;
  /** "mag": magnitude of a complex quantity (needs a phase partner); "phase": its phase, `partner` = the
   *  magnitude's col; "real": a real quantity with no phase (peak excursion, air speed). */
  kind: "mag" | "phase" | "real";
  partner?: string;
  y: ArrayLike<number>;
}

export interface FigPanel {
  /** "Name (unit)", never square brackets. */
  ylabel: string;
  series: FigSeries[];
  /** Fixed y range (phase: -180..180). */
  y?: [number, number];
  /** Shaded tolerance band. */
  band?: { x: [number, number]; y: [number, number] };
}

export interface Figure {
  id: string;
  /** CSV file the LaTeX reads, e.g. "fig_response.csv". */
  file: string;
  caption: string;
  x: ArrayLike<number>;
  xlabel: string;
  xrange: [number, number];
  panels: FigPanel[];
}

export const X_LABEL = "Frequency (Hz)";
const PHASE_LABEL = "Phase (deg)";
/** Response figure: a unit's phase is drawn only where its level is within this many dB of the system level. */
export const PHASE_FLOOR_DB = 40;

// ---------------------------------------------------------------- helpers
const db = (z: CArray): Float64Array => Float64Array.from(z.re, (r, i) => 20 * Math.log10(Math.hypot(r, z.im[i])));
const absOf = (z: CArray): Float64Array => Float64Array.from(z.re, (r, i) => Math.hypot(r, z.im[i]));

/** Phase in degrees with NaN at each wrap (a jump over 180 deg), so a plot breaks the line instead of
 *  drawing a vertical stroke from +180 to -180. pgfplots skips NaN with `unbounded coords=jump`. */
export function wrapBreaks(deg: ArrayLike<number>): Float64Array {
  const out = Float64Array.from(deg);
  for (let i = 1; i < out.length; i++) {
    const a = deg[i - 1], b = deg[i];
    if (Number.isFinite(a) && Number.isFinite(b) && Math.abs(b - a) > 180) out[i] = NaN;
  }
  return out;
}
const phaseDeg = (z: CArray): Float64Array => wrapBreaks(Float64Array.from(z.re, (r, i) => Math.atan2(z.im[i], r) * 180 / Math.PI));
/** Acoustic phase with the reference distance removed (the app's display convention). */
const acousticPhase = (p: Prepared, z: CArray): Float64Array =>
  wrapBreaks(Float64Array.from(z.re, (_, i) => displayPhase(p, z, i) * 180 / Math.PI));

function mul(a: CArray, b: CArray, k = 1): CArray {
  const n = a.re.length, re = new Float64Array(n), im = new Float64Array(n);
  for (let i = 0; i < n; i++) { re[i] = k * (a.re[i] * b.re[i] - a.im[i] * b.im[i]); im[i] = k * (a.re[i] * b.im[i] + a.im[i] * b.re[i]); }
  return { re, im };
}
const scale = (a: CArray, k: number): CArray => ({ re: a.re.map(v => v * k), im: a.im.map(v => v * k) });

/** A magnitude series and its phase partner, from one complex quantity. */
function pair(col: string, legend: string, color: PaletteKey, mag: Float64Array, ph: Float64Array, dash?: boolean): [FigSeries, FigSeries] {
  return [
    { col: `${col}_db`, legend, color, dash, kind: "mag", y: mag },
    { col: `${col}_deg`, legend, color, dash, kind: "phase", partner: `${col}_db`, y: ph },
  ];
}

/** Linear interpolation of a measured complex series on log f, NaN outside its own range (no extrapolation). */
export function onGrid(s: { f: ArrayLike<number>; re: ArrayLike<number>; im: ArrayLike<number> }, x: ArrayLike<number>): CArray {
  const n = s.f.length, re = new Float64Array(x.length).fill(NaN), im = new Float64Array(x.length).fill(NaN);
  let k = 0;
  for (let i = 0; i < x.length; i++) {
    const xi = x[i];
    if (!(n >= 2 && xi >= s.f[0] && xi <= s.f[n - 1])) continue;
    while (k < n - 2 && s.f[k + 1] < xi) k++;
    const a = Math.log(s.f[k]), b = Math.log(s.f[k + 1]), t = b > a ? (Math.log(xi) - a) / (b - a) : 0;
    re[i] = s.re[k] + t * (s.re[k + 1] - s.re[k]);
    im[i] = s.im[k] + t * (s.im[k + 1] - s.im[k]);
  }
  return { re, im };
}

const angleLabel = (a: string) => `${a} deg`;
const angleTag = (a: string) => (a.startsWith("-") ? `m${a.slice(1)}` : a);

// ---------------------------------------------------------------- 1. woofer box
export function boxFigures(x: ReportInput): Figure[] {
  const { prep: p, design } = x;
  const c = boxModelCurves(p, design), f = c.f;
  const vented = c.MAP !== null;
  const splPanel: FigPanel = { ylabel: "SPL (dB re 20 µPa)", series: [] };
  const phPanel: FigPanel = { ylabel: PHASE_LABEL, series: [], y: [-180, 180] };
  const [a, b] = pair("spl", `Designed: ${c.label}`, "woof", c.spl_dB, phaseDeg(c.spl));
  splPanel.series.push(a); phPanel.series.push(b);
  if (vented) {
    const [pa, pb] = pair("spl_plugged", "Vents plugged", "ref", c.plugged.spl_dB, phaseDeg(c.plugged.spl), true);
    splPanel.series.push(pa); phPanel.series.push(pb);
  }
  const panels: FigPanel[] = [splPanel, phPanel, {
    ylabel: "Excursion (mm)",
    series: [
      { col: "x_mm", legend: "Designed", color: "woof", kind: "real", y: c.excursion_mm },
      ...(vented ? [{ col: "x_plugged_mm", legend: "Vents plugged", color: "ref" as const, dash: true, kind: "real" as const, y: c.plugged.excursion_mm }] : []),
    ],
  }];
  if (vented) panels.push({ ylabel: "Vent speed (m/s)", series: [{ col: "vent_ms", legend: "Designed", color: "woof", kind: "real", y: c.ventSpeed_ms }] });
  const out: Figure[] = [{
    id: "box", file: "fig_box.csv", xlabel: X_LABEL, x: f, xrange: [f[0], f[f.length - 1]], panels,
    caption: `Woofer box model at 2.83 V: far-field SPL at 1 m in half space, peak cone excursion${vented ? " and peak air speed in the vent" : ""}; ${vented ? "the designed box against the plugged one (the condition of the measured woofer response)" : "the closed box"}.`,
  }];

  // measured against modelled impedance on the box grid (the measurements have their own grids)
  const mag: FigSeries[] = [], ph: FigSeries[] = [];
  const add = (col: string, legend: string, color: PaletteKey, meas: CArray, fMeas: ArrayLike<number>, model: CArray) => {
    const zm = onGrid({ f: fMeas, re: meas.re, im: meas.im }, f), zp = onGrid({ f: fMeas, re: model.re, im: model.im }, f);
    const m1 = { col: `${col}_meas_ohm`, legend: `${legend}, measured`, color, kind: "mag" as const, y: absOf(zm) };
    const m2 = { col: `${col}_model_ohm`, legend: `${legend}, model`, color, dash: true, kind: "mag" as const, y: absOf(zp) };
    mag.push(m1, m2);
    ph.push({ col: `${col}_meas_deg`, legend: m1.legend, color, kind: "phase", partner: m1.col, y: phaseDeg(zm) },
            { col: `${col}_model_deg`, legend: m2.legend, color, dash: true, kind: "phase", partner: m2.col, y: phaseDeg(zp) });
  };
  const dv = driverValidation(p), colors: PaletteKey[] = ["c6", "c5", "c1", "c2", "c3", "c4"];
  let ci = 0;
  if (dv.free) add("free", "Free air", colors[ci++], dv.free.meas, dv.free.f, dv.free.model);
  if (dv.closed) add("closed", "Closed box", colors[ci++], dv.closed.meas, dv.closed.f, dv.closed.model);
  boxValidation(p).forEach((v, j) => add(`vent${j + 1}`, `Vent ${v.label}`, colors[ci++ % colors.length], v.Z.meas, v.Z.f, v.Z.model));
  if (mag.length) out.push({
    id: "box_impedance", file: "fig_box_impedance.csv", xlabel: X_LABEL, x: f, xrange: [f[0], f[f.length - 1]],
    panels: [{ ylabel: "Impedance magnitude (Ω)", series: mag }, { ylabel: PHASE_LABEL, series: ph, y: [-180, 180] }],
    caption: "Woofer input impedance, Lab D measurement (solid) against the fitted model (dashed).",
  });
  return out;
}

// ---------------------------------------------------------------- 3. passive crossover
export function filterFigures(x: ReportInput): Figure[] {
  const { prep: p, design: d, results } = x, on = results.angles["0"], f = p.f;
  const gw = d.pol.woof * 10 ** (d.digital.g_woof_dB / 20);
  const woof = scale(on.HL, gw), mid = mul(on.HH, on.Tm, d.pol.mid), tw = mul(on.HH, on.Tt, d.pol.tw);
  const s = [
    pair("woof", "Woofer (DSP low-pass and gain)", "woof", db(woof), phaseDeg(woof)),
    pair("mid", "Midrange (DSP high-pass and passive low-pass)", "mid", db(mid), phaseDeg(mid)),
    pair("tw", "Tweeter (DSP high-pass and passive high-pass)", "tw", db(tw), phaseDeg(tw)),
    pair("dsp_hp", "DSP high-pass alone", "ref", db(on.HH), phaseDeg(on.HH), true),
  ];
  return [{
    id: "filters", file: "fig_filters.csv", xlabel: X_LABEL, x: f, xrange: [f[0], f[f.length - 1]],
    panels: [{ ylabel: "Voltage transfer (dB re 1 V/V)", series: s.map(q => q[0]) }, { ylabel: PHASE_LABEL, series: s.map(q => q[1]), y: [-180, 180] }],
    caption: "Electrical transfer from the MiniDSP input to each driver's terminals, polarity included; the passive boards are loaded with the measured driver impedances.",
  }];
}

// ---------------------------------------------------------------- 4. system response and load
export function responseFigures(x: ReportInput): Figure[] {
  const { prep: p, results } = x, on = results.angles["0"], f = p.f, lvl = results.metrics.on.level;
  // a unit's phase far down in its stop band is measurement noise: hide it where the level is 40 dB under the system's
  const s = (["woof", "mid", "tw", "sum"] as const).map(k => {
    const m = db(on[k]), ph = acousticPhase(p, on[k]).map((v, i) => (m[i] < lvl - PHASE_FLOOR_DB ? NaN : v));
    return pair(k, { woof: "Woofer", mid: "Midrange", tw: "Tweeter", sum: "Sum" }[k], k, m, ph);
  });
  const z = on.Zamp2;
  return [
    {
      id: "response", file: "fig_response.csv", xlabel: X_LABEL, x: f, xrange: [f[0], f[f.length - 1]],
      panels: [
        { ylabel: "Level (dB re 1 Pa/V)", series: s.map(q => q[0]), band: { x: [150, 15000], y: [lvl - 2, lvl + 2] } },
        { ylabel: PHASE_LABEL, series: s.map(q => q[1]), y: [-180, 180] },
      ],
      caption: `On-axis response per unit and summed (measured drivers, simulated crossover). Grey band: +/-2 dB around the median level, 150 Hz to 15 kHz. Phase referred to the profile's phase distance of ${p.profile.conditions.phase_ref_distance_m} m (the Matlab2LTspice convention), the same for every unit; a unit's phase is left out where it plays more than ${PHASE_FLOOR_DB} dB below the system level.`,
    },
    {
      id: "load", file: "fig_load.csv", xlabel: X_LABEL, x: f, xrange: [f[0], f[f.length - 1]],
      panels: [
        { ylabel: "Impedance magnitude (Ω)", series: [{ col: "z_ohm", legend: "Amplifier channel 2 load", color: "sum", kind: "mag", y: absOf(z) }] },
        { ylabel: PHASE_LABEL, series: [{ col: "z_deg", legend: "Amplifier channel 2 load", color: "sum", kind: "phase", partner: "z_ohm", y: phaseDeg(z) }], y: [-90, 90] },
      ],
      caption: "Load on amplifier channel 2: both passive boards in parallel, each loaded with its driver's measured impedance.",
    },
  ];
}

// ---------------------------------------------------------------- 5. off axis
export function offAxisFigures(x: ReportInput): Figure[] {
  const { prep: p, results } = x, f = p.f;
  const angles = Object.keys(results.angles).sort((a, b) => Math.abs(+a) - Math.abs(+b) || +a - +b);
  if (angles.length < 2) return [];
  const colors: PaletteKey[] = ["sum", "c1", "c2", "c3", "c4", "c5"];
  const s = angles.map((a, i) => pair(`sum${angleTag(a)}`, `Sum at ${angleLabel(a)}`, colors[i % colors.length], db(results.angles[a].sum), acousticPhase(p, results.angles[a].sum)));
  const off = offAxisAngle(angles) ?? angles[1];
  return [{
    id: "offaxis", file: "fig_offaxis.csv", xlabel: X_LABEL, x: f, xrange: [f[0], f[f.length - 1]],
    panels: [{ ylabel: "Level (dB re 1 Pa/V)", series: s.map(q => q[0]) }, { ylabel: PHASE_LABEL, series: s.map(q => q[1]), y: [-180, 180] }],
    caption: `Summed response on axis and off axis (${angles.map(angleLabel).join(", ")}), each from its own Lab E run; the ${angleLabel(off)} curve is the one the checks judge.`,
  }];
}

/** Every figure of a design (in section order); used by the tests. */
export function allFigures(x: ReportInput): Figure[] {
  return [...boxFigures(x), ...filterFigures(x), ...responseFigures(x), ...offAxisFigures(x)];
}

// ---------------------------------------------------------------- axis ranges (shared by svg.ts and latex.ts)
/** A tick step of 1, 2 or 5 times a power of ten giving about `n` intervals over `span`. */
export function niceStep(span: number, n = 5): number {
  const raw = span / n, p = 10 ** Math.floor(Math.log10(raw)), m = raw / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p;
}

/** The y range of a panel: its fixed range, else the data (and band) rounded out to whole ticks. Level
 *  panels show at most the top 50 dB, so a deep stop band does not flatten the pass band. */
export function yRange(panel: FigPanel): { min: number; max: number; step: number } {
  if (panel.y) {
    const span = panel.y[1] - panel.y[0];
    return { min: panel.y[0], max: panel.y[1], step: span >= 360 ? 90 : span >= 180 ? 45 : niceStep(span) };
  }
  let lo = Infinity, hi = -Infinity;
  for (const s of panel.series) for (let i = 0; i < s.y.length; i++) { const v = s.y[i]; if (Number.isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); } }
  if (panel.band) { lo = Math.min(lo, panel.band.y[0]); hi = Math.max(hi, panel.band.y[1]); }
  if (!(hi >= lo)) { lo = 0; hi = 1; }
  if (/\(dB\b/.test(panel.ylabel)) lo = Math.max(lo, hi - 50);
  if (/\((mm|m\/s)\)$/.test(panel.ylabel) || /magnitude/.test(panel.ylabel)) lo = Math.min(0, lo);
  if (hi - lo < 1e-9) { hi += 1; lo -= 1; }
  const step = niceStep(hi - lo);
  return { min: Math.floor(lo / step) * step, max: Math.ceil(hi / step) * step, step };
}
