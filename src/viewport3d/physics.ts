// What the 3D model shows at the probe frequency: each unit's level, phase, share of the output and cone excursion,
// and the air plug in each open vent. Pure functions on engine results so they are tested without WebGL.
//
// Excursion of a baffled piston in the far field: |p| = rho w^2 S_D |x| / (2 pi r), so x ~ |p| / (w^2 S_D).
// Real excursions span ~80 dB from 20 Hz to 20 kHz, so the view maps a 48 dB window below the largest
// excursion anywhere on the grid onto 0..1 (log compression). Relative sizes and all phases stay physical.

import type { AngleResult, CArray, UnitId } from "../types";
import { UNIT_IDS } from "../types";
import type { VentLayout } from "./layout";

/** Dynamic range of the excursion display, dB. */
export const EXCURSION_WINDOW_DB = 48;

export interface Complex { re: number; im: number }

export interface UnitProbe {
  /** Level of the unit's output at the probe (dB re 1 Pa/V at the measurement distance). */
  levelDb: number;
  /** Level relative to the summed output, dB. */
  relDb: number;
  /** Phase of the unit's pressure (display convention), rad. */
  phase: number;
  /** Phase of the cone displacement, rad (differs from `phase` for the woofer when the vent radiates). */
  conePhase: number;
  /** Fraction of the radiated power, 0..1. */
  share: number;
  /** Visual cone excursion, 0..1 (log-compressed, see EXCURSION_WINDOW_DB). */
  excursion: number;
}

export interface VentProbe {
  id: string;
  /** Visual air-plug excursion, 0..1 on the same scale as the cones. */
  excursion: number;
  /** Phase of the outward air displacement, rad. */
  phase: number;
}

export interface ProbeState {
  /** Grid frequency actually sampled (nearest to the probe). */
  f: number;
  index: number;
  sumDb: number;
  units: Record<UnitId, UnitProbe>;
  vents: VentProbe[];
}

const TWO_PI = 2 * Math.PI;
const mag2 = (z: CArray, i: number) => z.re[i] * z.re[i] + z.im[i] * z.im[i];
const toDb = (x2: number) => 10 * Math.log10(Math.max(x2, 1e-30));

/** Grid index nearest to `x` on a log axis. `f` must be ascending. */
export function nearestIndex(f: ArrayLike<number>, x: number): number {
  const n = f.length;
  if (n === 0) return -1;
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (f[mid] <= x) lo = mid; else hi = mid;
  }
  return Math.abs(Math.log(x / f[lo])) <= Math.abs(Math.log(f[hi] / x)) ? lo : hi;
}

/** 20 log10 of the relative excursion |p| / (w^2 S_D) at grid point i. */
function excursionDb(z: CArray, f: ArrayLike<number>, i: number, areaM2: number): number {
  const w = TWO_PI * f[i];
  return toDb(mag2(z, i)) - 20 * Math.log10(w * w * areaM2);
}

/** Largest excursion (dB) of any unit anywhere on the grid: the top of the display window. Compute once per result. */
export function excursionCeilingDb(on: AngleResult, f: ArrayLike<number>, areas: Record<UnitId, number>): number {
  let top = -Infinity;
  for (const u of UNIT_IDS) for (let i = 0; i < f.length; i++) top = Math.max(top, excursionDb(on[u], f, i, areas[u]));
  return Number.isFinite(top) ? top : 0;
}

/** Map an excursion in dB onto the 0..1 visual scale. */
export function compressExcursion(xDb: number, ceilingDb: number): number {
  const t = (xDb - (ceilingDb - EXCURSION_WINDOW_DB)) / EXCURSION_WINDOW_DB;
  return Math.min(1, Math.max(0, t)) ** 1.35;
}

export interface ProbeInput {
  f: ArrayLike<number>;
  on: AngleResult;
  probeHz: number;
  /** Radiating area per unit, m^2. */
  areas: Record<UnitId, number>;
  ceilingDb: number;
  /** Display phase of z at grid index i (engine displayPhase); defaults to the raw angle. */
  phaseAt?: (z: CArray, i: number) => number;
  /** Woofer box model at the sampled frequency: cone and vent volume velocities (UP = flow into the box). */
  box?: { UD: Complex; UP: Complex } | null;
  /** Vent layout; only open vents carry air. */
  vents?: VentLayout[];
  /** Reference for relDb (dB): the system level, as the probe card and signal chain use. Default: the sum at the probe. */
  refDb?: number;
}

const cdiv = (a: Complex, b: Complex): Complex => {
  const d = b.re * b.re + b.im * b.im || 1e-30;
  return { re: (a.re * b.re + a.im * b.im) / d, im: (a.im * b.re - a.re * b.im) / d };
};
const cabs = (a: Complex) => Math.hypot(a.re, a.im);
const carg = (a: Complex) => Math.atan2(a.im, a.re);

export function sampleProbe(inp: ProbeInput): ProbeState | null {
  const { f, on } = inp;
  const i = nearestIndex(f, inp.probeHz);
  if (i < 0) return null;
  const phaseAt = inp.phaseAt ?? ((z: CArray, k: number) => Math.atan2(z.im[k], z.re[k]));
  const sumDb = toDb(mag2(on.sum, i));
  const power = UNIT_IDS.reduce((a, u) => a + mag2(on[u], i), 0) || 1e-30;
  const w = TWO_PI * f[i];

  // The woofer's measured response already contains the vent: p ~ jw (U_D - U_P). Split it so the cone
  // moves with U_D alone and the plug with -U_P (outward), each with its true phase.
  let ventOverCone: Complex | null = null; // (-U_P) / U_D
  if (inp.box && cabs(inp.box.UD) > 0 && cabs(inp.box.UP) > 0) {
    ventOverCone = cdiv({ re: -inp.box.UP.re, im: -inp.box.UP.im }, inp.box.UD);
  }

  const units = {} as Record<UnitId, UnitProbe>;
  for (const u of UNIT_IDS) {
    const z = on[u];
    const phase = phaseAt(z, i);
    let xDb = excursionDb(z, f, i, inp.areas[u]);
    let conePhase = phase;
    if (u === "woof" && ventOverCone) {
      // p_total / p_cone = 1 + (-U_P / U_D)
      const ratio = { re: 1 + ventOverCone.re, im: ventOverCone.im };
      xDb -= 20 * Math.log10(Math.max(cabs(ratio), 1e-9));
      conePhase = phase - carg(ratio);
    }
    units[u] = {
      levelDb: toDb(mag2(z, i)),
      relDb: toDb(mag2(z, i)) - (inp.refDb ?? sumDb),
      phase, conePhase,
      share: mag2(z, i) / power,
      excursion: compressExcursion(xDb, inp.ceilingDb),
    };
  }

  // Open vents share the box pressure; each carries flow ~ S / L_eff (same air-mass law), so its plug moves
  // with x_k = U_out / (jw) * (1 / L_eff,k) / sum(S_j / L_eff,j).
  const vents: VentProbe[] = [];
  const open = (inp.vents ?? []).filter(v => v.open);
  if (ventOverCone && open.length) {
    const leff = (v: VentLayout) => v.length + 1.7 * v.radius; // end corrections, flanged + free
    const admittance = open.reduce((a, v) => a + (Math.PI * v.radius ** 2) / leff(v), 0);
    const SD = inp.areas.woof;
    const coneDb = toDb(mag2(on.woof, i)) - 20 * Math.log10(w * w * SD)
      - 20 * Math.log10(Math.max(cabs({ re: 1 + ventOverCone.re, im: ventOverCone.im }), 1e-9));
    for (const v of open) {
      // plug velocity / cone velocity = |U_out/U_D| * (S_D / L_eff) / admittance
      const gain = cabs(ventOverCone) * (SD / leff(v)) / admittance;
      vents.push({
        id: v.id,
        excursion: compressExcursion(coneDb + 20 * Math.log10(Math.max(gain, 1e-9)), inp.ceilingDb),
        phase: units.woof.conePhase + carg(ventOverCone),
      });
    }
  }
  return { f: f[i], index: i, sumDb, units, vents };
}

/** Complex sample of a CArray. */
export function sampleC(z: CArray, i = 0): Complex {
  return { re: z.re[i], im: z.im[i] };
}

/** Used by tests and the fallback drawing: a gentle 0..1 intensity from a share (keeps quiet units faintly visible). */
export function glowFromShare(share: number): number {
  return 0.06 + 0.94 * Math.sqrt(Math.min(1, Math.max(0, share)));
}

