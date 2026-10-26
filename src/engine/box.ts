// Woofer box model and its fit to the Lab D impedances. TypeScript port of ltspice/task1/box_model.py,
// generalised from System D to any profile.
//
// IMPEDANCE analogy, everything referred to the acoustic domain behind the cone:
//   electrical: e_g -> R_E -> L_E -> Bl u
//   mechanical: M_MD + R_MS + C_MS + S_D^2 (Z_front + Z_rear)
//   rear (box): U_D into node p_B, to ground through C_AB (V_B * fill) in series with R_AB, the
//               leak R_AL and the vent branch M_AP + R_AP. U_P = p_B / (jw M_AP + R_AP) leaves the vent.
//   far field:  p = jw rho (U_D - U_P) / (2 pi r)   (half space, r = 1 m)
//   near field: p = jw rho U / (pi a) at the centre of a baffled piston of radius a (ka << 1)
// Fit, on the complex Z (log|Z| and phase together): free air + closed box jointly for the driver
// and R_AB (8-150 Hz), then the vented curves for a shared leak Q_L and vent loss Q_P and one
// effective M_AP per measured configuration (5-150 Hz). Nelder-Mead with one restart, as the Python.

import type { BoxDesign, BoxFit, CArray, DriverParams, Profile, Series, VentedMeasurement } from "../types";
import { carray, type Cx } from "./complex";

const TWO_PI = 2 * Math.PI;

// ---------------------------------------------------------------- air and geometry
export interface Air { T: number; c: number; rho: number }

/** Speed of sound and air density at T (deg C), as box_model.py. */
export function air(T_C: number): Air {
  return { T: T_C, c: 331.3 * Math.sqrt(1 + T_C / 273.15), rho: 1.2041 * 293.15 / (273.15 + T_C) };
}

/** Everything the box physics needs (a subset of BoxFit, so a BoxFit can be passed directly). */
export interface BoxGeometry {
  c: number; rho: number;
  RE: number; SD: number; AD: number; VB: number;
  /** Radius of the primary vent. */
  AP: number;
}

/** Radiation impedance of one face of a piston of radius a (Lecture 7 low-frequency network):
 *  M_A1 in parallel with R_A2 + (R_A1 || C_A1). Unbaffled: the mass is scaled 0.6133/0.8488. */
export function zPiston(w: number, a: number, baffled: boolean, rho: number, c: number): Cx {
  const S = Math.PI * a * a;
  const MA1 = 8 * rho / (3 * Math.PI ** 2 * a) * (baffled ? 1 : 0.6133 / 0.8488);
  const RA1 = 0.441 * rho * c / S, RA2 = rho * c / S, CA1 = 5.94 * a ** 3 / (rho * c * c);
  // Y = 1/(jw MA1) + 1/(RA2 + 1/(1/RA1 + jw CA1))
  const y1i = -1 / (w * MA1);
  const gr = 1 / RA1, gi = w * CA1, gd = gr * gr + gi * gi;
  const zr = RA2 + gr / gd, zi = -gi / gd, zd = zr * zr + zi * zi;
  const yr = zr / zd, yi = -zi / zd + y1i, yd = yr * yr + yi * yi;
  return [yr / yd, -yi / yd];
}

/** Mass of n equal tubes in parallel, M_AP = rho (L + k_end a) / (n pi a^2) (kg/m^4). */
export function tubeMass(L: number, a: number, rho: number, kEnd = 1.46, n = 1): number {
  return rho * (L + kEnd * a) / (n * Math.PI * a * a);
}

// ---------------------------------------------------------------- box elements
export interface BoxElements {
  CAB: number; RAB: number; RAL: number;
  /** null = closed box. */
  MAP: number | null;
  RAP: number;
  /** Vent radius (for the vent near field). */
  ap: number;
}

/** Box elements. The leak R_AL is set by Q_L at 20 Hz (Lecture 8 convention, as box_model.py). */
export function boxElements(g: BoxGeometry, o: { fill?: number; RAB?: number; QL?: number; MAP?: number | null; RAP?: number; ap?: number } = {}): BoxElements {
  const fill = o.fill ?? 1, CAB = g.VB * fill / (g.rho * g.c * g.c);
  return { CAB, RAB: o.RAB ?? 0, RAL: (o.QL ?? 1e9) / (TWO_PI * 20 * CAB), MAP: o.MAP ?? null, RAP: o.RAP ?? 0, ap: o.ap ?? g.AP };
}

/** Vented box with the fitted losses: R_AP from Q_P at the box tuning w_B. */
export function ventedElements(fit: BoxGeometry & { RAB: number; QL: number; QP: number }, MAP: number, fill = 1, ap = fit.AP): BoxElements {
  const wb = 1 / Math.sqrt(MAP * fit.VB * fill / (fit.rho * fit.c ** 2));
  return boxElements(fit, { fill, RAB: fit.RAB, QL: fit.QL, MAP, RAP: wb * MAP / fit.QP, ap });
}

export interface BoxSystemResult {
  /** Electrical input impedance (ohm). */
  ZE: CArray;
  /** Cone and vent volume velocity (m^3/s) for 1 V. */
  UD: CArray; UP: CArray;
  /** Far-field pressure at 1 m, half space, 1 V (Pa). */
  p1m: CArray;
  /** Near-field pressure at the cone / vent centre, 1 V (Pa), the Lab D near-field measurement. */
  nfCone: CArray; nfVent: CArray;
}

/** The full electro-mechano-acoustic system at the frequencies freqs (Hz), driven with 1 V.
 *  bx = null is the driver in free air (both faces loaded by an unbaffled piston). */
export function boxSystem(g: BoxGeometry, drv: DriverParams, bx: BoxElements | null, freqs: ArrayLike<number>): BoxSystemResult {
  const n = freqs.length;
  const out: BoxSystemResult = { ZE: carray(n), UD: carray(n), UP: carray(n), p1m: carray(n), nfCone: carray(n), nfVent: carray(n) };
  const SD2 = g.SD * g.SD;
  for (let i = 0; i < n; i++) {
    const w = TWO_PI * freqs[i];
    let Zf: Cx, Zb: Cx;
    if (!bx) { Zf = zPiston(w, g.AD, false, g.rho, g.c); Zb = Zf; }
    else {
      Zf = zPiston(w, g.AD, true, g.rho, g.c);
      Zb = boxZ(bx, w);
    }
    // Z_M = R_MS + j(w M_MD - 1/(w C_MS)) + S_D^2 (Z_front + Z_box)
    const zmr = drv.Rms + SD2 * (Zf[0] + Zb[0]), zmi = w * drv.Mmd - 1 / (w * drv.Cms) + SD2 * (Zf[1] + Zb[1]);
    const zmd = zmr * zmr + zmi * zmi, B2 = drv.Bl * drv.Bl;
    const zer = g.RE + B2 * zmr / zmd, zei = w * drv.Le - B2 * zmi / zmd;
    const zed = zer * zer + zei * zei, ir = zer / zed, ii = -zei / zed;           // i = 1/Z_E (1 V)
    const k = g.SD * drv.Bl;                                                      // U_D = S_D Bl i / Z_M
    const udr = k * (ir * zmr + ii * zmi) / zmd, udi = k * (ii * zmr - ir * zmi) / zmd;
    let upr = 0, upi = 0;
    if (bx && bx.MAP) {
      // U_P = Z_box U_D / (R_AP + jw M_AP)
      const pr = Zb[0] * udr - Zb[1] * udi, pi = Zb[0] * udi + Zb[1] * udr;
      const vr = bx.RAP, vi = w * bx.MAP, vd = vr * vr + vi * vi;
      upr = (pr * vr + pi * vi) / vd; upi = (pi * vr - pr * vi) / vd;
    }
    const kf = w * g.rho / TWO_PI;                    // jw rho / (2 pi)
    out.ZE.re[i] = zer; out.ZE.im[i] = zei;
    out.UD.re[i] = udr; out.UD.im[i] = udi;
    out.UP.re[i] = upr; out.UP.im[i] = upi;
    out.p1m.re[i] = -kf * (udi - upi); out.p1m.im[i] = kf * (udr - upr);
    const kc = w * g.rho / (Math.PI * g.AD);
    out.nfCone.re[i] = -kc * udi; out.nfCone.im[i] = kc * udr;
    const kv = bx ? w * g.rho / (Math.PI * bx.ap) : 0;
    out.nfVent.re[i] = -kv * upi; out.nfVent.im[i] = kv * upr;
  }
  return out;
}

/** Acoustic impedance seen behind the cone: (R_AB + C_AB) || R_AL || (R_AP + M_AP). */
function boxZ(bx: BoxElements, w: number): Cx {
  // 1/(R_AB + 1/(jw C_AB))
  const ar = bx.RAB, ai = -1 / (w * bx.CAB), ad = ar * ar + ai * ai;
  let yr = ar / ad + 1 / bx.RAL, yi = -ai / ad;
  if (bx.MAP) {
    const vr = bx.RAP, vi = w * bx.MAP, vd = vr * vr + vi * vi;
    yr += vr / vd; yi -= vi / vd;
  }
  const yd = yr * yr + yi * yi;
  return [yr / yd, -yi / yd];
}

// ---------------------------------------------------------------- Nelder-Mead (box_model.py nelder_mead)
/** Downhill simplex, a line-for-line port (same initial simplex, coefficients and stopping rule). */
export function nelderMead(fun: (x: number[]) => number, x0: number[], step = 0.1, iters = 4000, tol = 1e-10): number[] {
  const n = x0.length;
  let pts: number[][] = [x0.slice()];
  for (let k = 0; k < n; k++) { const x = x0.slice(); x[k] += step; pts.push(x); }
  let vals = pts.map(fun);
  const lin = (a: number[], b: number[], t: number) => a.map((v, i) => v + t * (b[i] - v));   // a + t (b - a)
  for (let it = 0; it < iters; it++) {
    const o = vals.map((v, i) => [v, i]).sort((p, q) => p[0] - q[0]).map(p => p[1]);
    pts = o.map(i => pts[i]); vals = o.map(i => vals[i]);
    if (Math.abs(vals[n] - vals[0]) < tol * (Math.abs(vals[0]) + 1e-12)) break;
    const c = new Array(n).fill(0);
    for (let j = 0; j < n; j++) for (let k = 0; k < n; k++) c[k] += pts[j][k];
    for (let k = 0; k < n; k++) c[k] /= n;
    const worst = pts[n];
    const xr = lin(worst, c, 2), fr = fun(xr);                     // c + (c - worst)
    if (fr < vals[0]) {
      const xe = lin(worst, c, 3), fe = fun(xe);                   // c + 2 (c - worst)
      if (fe < fr) { pts[n] = xe; vals[n] = fe; } else { pts[n] = xr; vals[n] = fr; }
    } else if (fr < vals[n - 1]) {
      pts[n] = xr; vals[n] = fr;
    } else {
      const xc = lin(c, worst, 0.5), fcv = fun(xc);
      if (fcv < vals[n]) { pts[n] = xc; vals[n] = fcv; }
      else { pts = pts.map(p => lin(pts[0], p, 0.5)); vals = pts.map(fun); }
    }
  }
  let best = 0;
  for (let i = 1; i < vals.length; i++) if (vals[i] < vals[best]) best = i;
  return pts[best];
}

// ---------------------------------------------------------------- fast impedance model for the fit
/** One measured impedance curve restricted to a band, with the frequency-only terms precomputed. */
interface FitCurve {
  w: Float64Array;
  zr: Float64Array; zi: Float64Array;
  /** S_D^2 Z_front (and for free air also the rear face, so S_D^2 (Z_f + Z_r)). */
  radR: Float64Array; radI: Float64Array;
  free: boolean;
}

function fitCurve(s: Series, lo: number, hi: number, g: BoxGeometry, free: boolean): FitCurve {
  const idx: number[] = [];
  for (let i = 0; i < s.f.length; i++) if (s.f[i] >= lo && s.f[i] <= hi) idx.push(i);
  const n = idx.length, c: FitCurve = {
    w: new Float64Array(n), zr: new Float64Array(n), zi: new Float64Array(n),
    radR: new Float64Array(n), radI: new Float64Array(n), free,
  };
  const SD2 = g.SD * g.SD;
  idx.forEach((k, j) => {
    const w = TWO_PI * s.f[k], zp = zPiston(w, g.AD, !free, g.rho, g.c);
    c.w[j] = w; c.zr[j] = s.re[k]; c.zi[j] = s.im[k];
    c.radR[j] = SD2 * zp[0] * (free ? 2 : 1); c.radI[j] = SD2 * zp[1] * (free ? 2 : 1);
  });
  return c;
}

/** Mean of |log(Z_model / Z_meas)|^2 = (ln|ratio|)^2 + (phase difference)^2, box_model.py zerr(). */
function zerr(c: FitCurve, g: BoxGeometry, drv: DriverParams, bx: BoxElements | null): number {
  const SD2 = g.SD * g.SD, B2 = drv.Bl * drv.Bl;
  let e = 0;
  for (let j = 0; j < c.w.length; j++) {
    const w = c.w[j];
    let zmr = drv.Rms + c.radR[j], zmi = w * drv.Mmd - 1 / (w * drv.Cms) + c.radI[j];
    if (bx) { const zb = boxZ(bx, w); zmr += SD2 * zb[0]; zmi += SD2 * zb[1]; }
    const zmd = zmr * zmr + zmi * zmi;
    const sr = g.RE + B2 * zmr / zmd, si = w * drv.Le - B2 * zmi / zmd;
    // q = Z_model / Z_meas
    const mr = c.zr[j], mi = c.zi[j], md = mr * mr + mi * mi;
    const qr = (sr * mr + si * mi) / md, qi = (si * mr - sr * mi) / md;
    const lnm = 0.5 * Math.log(qr * qr + qi * qi), ph = Math.atan2(qi, qr);
    e += lnm * lnm + ph * ph;
  }
  return e / c.w.length;
}

// ---------------------------------------------------------------- starting point from the curves
interface PeakEstimate { fs: number; Qms: number; Qes: number }

/** f_s, Q_MS, Q_ES from an impedance peak by the classic r0 / sqrt(r0) method (Lab D procedure). */
function estimatePeak(s: Series, RE: number, lo = 8, hi = 150): PeakEstimate | null {
  const f: number[] = [], m: number[] = [];
  for (let i = 0; i < s.f.length; i++) if (s.f[i] >= lo && s.f[i] <= hi) { f.push(s.f[i]); m.push(Math.hypot(s.re[i], s.im[i])); }
  if (f.length < 5) return null;
  // a 3-point running median keeps a single noisy sample from posing as the peak
  const sm = m.map((_, i) => i === 0 || i === m.length - 1 ? m[i] : [m[i - 1], m[i], m[i + 1]].sort((a, b) => a - b)[1]);
  let k = 0;
  for (let i = 1; i < sm.length; i++) if (sm[i] > sm[k]) k = i;
  const zmax = sm[k], r0 = zmax / RE;
  if (!(r0 > 1.2)) return null;
  const target = RE * Math.sqrt(r0);
  const cross = (dir: -1 | 1): number | null => {
    for (let i = k; i + dir >= 0 && i + dir < sm.length; i += dir) {
      if (sm[i + dir] <= target) {
        const t = (sm[i] - target) / (sm[i] - sm[i + dir]);
        return Math.exp(Math.log(f[i]) + t * (Math.log(f[i + dir]) - Math.log(f[i])));
      }
    }
    return null;
  };
  const f1 = cross(-1), f2 = cross(1), fs = f[k];
  if (!f1 || !f2 || f2 <= f1) return null;
  const Qms = fs * Math.sqrt(r0) / (f2 - f1);
  return { fs, Qms, Qes: Qms / (r0 - 1) };
}

// ---------------------------------------------------------------- the fit
/** BoxFit plus what the engine learned while fitting (shown in the box view). */
export interface BoxFitEx extends BoxFit {
  /** Plain-language notes about assumptions (missing curves, defaults used). */
  notes: string[];
  /** The fitted effective vent mass of every vented configuration, in measurement order. */
  ventFits: { label: string; vents: { id: string; length_m: number }[]; MAP: number; fB: number; ap: number }[];
}

const KEYS = ["Bl", "Mmd", "Cms", "Rms", "Le"] as const;
const toDrv = (v: number[]): DriverParams => ({ Bl: v[0], Mmd: v[1], Cms: v[2], Rms: v[3], Le: v[4] });

/** Box geometry of a profile: S_D from the woofer diameter, V_B from the inner box, the primary
 *  vent (the one the vented measurements used, else the first) for A_P. */
export function profileGeometry(profile: Profile): BoxGeometry & Air & { primaryVent: string | null; notes: string[] } {
  const a = air(profile.conditions.T_C), notes: string[] = [];
  const woof = profile.units.woof, wb = profile.woofer_box;
  const SD = Math.PI * woof.diameter_m ** 2 / 4;
  const VB = wb.inner_m[0] * wb.inner_m[1] * wb.inner_m[2];
  if (!(SD > 0)) throw new Error("woofer diameter (units.woof.diameter_m) is missing");
  if (!(VB > 0)) throw new Error("woofer box inner dimensions (woofer_box.inner_m) are missing");
  const used = profile.measurements.woofer.vented[0]?.vents[0]?.id;
  const vent = wb.vents.find(v => v.id === used) ?? wb.vents[0];
  let RE = woof.Re_ohm ?? NaN;
  if (!(RE > 0)) {
    const z = profile.measurements.woofer.free ?? profile.measurements.woofer.closed;
    if (!z) throw new Error("the woofer box fit needs the woofer's R_E (units.woof.Re_ohm) or an impedance curve");
    // lowest real part above 5 Hz: the impedance minimum just above resonance sits close to R_E
    RE = Infinity;
    for (let i = 0; i < z.f.length; i++) if (z.f[i] > 5 && z.f[i] < 1000) RE = Math.min(RE, z.re[i]);
    RE *= 0.95;
    notes.push(`R_E not given: estimated ${RE.toFixed(2)} Ω from the impedance minimum. Measure it with a multimeter for a better fit.`);
  }
  return { ...a, RE, SD, AD: Math.sqrt(SD / Math.PI), VB, AP: vent ? vent.diameter_m / 2 : 0.025, primaryVent: vent?.id ?? null, notes };
}

/** Thiele-Small view of the fitted driver. M_MS adds the air load of both faces at 20 Hz. */
export function thieleSmall(g: BoxGeometry, drv: DriverParams): BoxFit["ts"] {
  const w20 = TWO_PI * 20;
  const Mms = drv.Mmd + 2 * g.SD ** 2 * zPiston(w20, g.AD, false, g.rho, g.c)[1] / w20;
  const fs = 1 / (TWO_PI * Math.sqrt(Mms * drv.Cms)), ws = TWO_PI * fs;
  const Qms = ws * Mms / drv.Rms, Qes = ws * Mms * g.RE / drv.Bl ** 2;
  return { fs, Qms, Qes, Qts: 1 / (1 / Qms + 1 / Qes), Vas_L: g.rho * g.c ** 2 * g.SD ** 2 * drv.Cms * 1e3, Mms };
}

const ventLabel = (m: VentedMeasurement) => m.vents.map(v => `${v.id} ${(v.length_m * 1e3).toFixed(0)} mm`).join(" + ");

/** Fit the woofer box model to the profile's woofer impedances. Pure; ~100 ms for three vented curves.
 *  - free + closed: joint driver fit (Bl, M_MD, C_MS, R_MS, L_E) and R_AB, 8-150 Hz.
 *  - only one of them: one curve alone cannot separate Bl from the moving mass and compliance (V_AS).
 *    Vented curves then pin it (the driver is fitted jointly with them first); with no box curve at
 *    all V_AS stays at the starting guess (V_B) and the notes say so.
 *  - vented: shared Q_L, Q_P and one effective M_AP per configuration, 5-150 Hz. None measured:
 *    M_AP from the tube formula rho (L + 1.46 a) / (pi a^2) and Q_L = 7, Q_P = 30. */
export function fitBox(profile: Profile): BoxFitEx {
  const g = profileGeometry(profile), notes = [...g.notes];
  const W = profile.measurements.woofer;
  if (!W.free && !W.closed) throw new Error("the woofer box fit needs the woofer impedance in free air or in the closed box (Lab D)");
  const closedBox = (RAB: number) => boxElements(g, { RAB });

  // ---- starting point: f_s, Q from the free-air peak, V_AS from the shift to the closed-box peak
  const pk = (W.free && estimatePeak(W.free, g.RE)) || { fs: 25, Qms: 5, Qes: 0.5 };
  const pkC = W.closed ? estimatePeak(W.closed, g.RE) : null;
  let Vas: number;
  if (W.free && pkC && pkC.fs > pk.fs * 1.05) Vas = g.VB * ((pkC.fs / pk.fs) ** 2 - 1);
  else { Vas = g.VB; }
  const Cms0 = Vas / (g.rho * g.c ** 2) / g.SD ** 2, ws = TWO_PI * pk.fs, Mms0 = 1 / (ws * ws * Cms0);
  const x0 = [Math.sqrt(ws * g.RE * Mms0 / pk.Qes), Mms0, Cms0, ws * Mms0 / pk.Qms, estimateLe(W.free ?? W.closed!)].map(Math.log);

  // ---- 1 + 2: driver (and R_AB) from free air and/or closed box
  const cf = W.free ? fitCurve(W.free, 8, 150, g, true) : null;
  const cc = W.closed ? fitCurve(W.closed, 8, 150, g, false) : null;
  const cost12 = (x: number[]) => {
    const d = toDrv(x.slice(0, 5).map(Math.exp));
    let e = 0;
    if (cf) e += zerr(cf, g, d, null);
    if (cc) e += zerr(cc, g, d, closedBox(Math.exp(x[5])));
    return e;
  };
  const configs = W.vented.filter(m => m.vents.length > 0 && m.z && m.z.f.length > 0);
  // Free air alone cannot pin C_MS (V_AS): with no closed or vented curve to do it, hold C_MS at
  // V_AS = V_B and fit only Bl, M_MD, R_MS and L_E, instead of letting it drift anywhere.
  const holdCms = !!cf && !cc && !configs.length;
  const CMS = 2;
  const widen = (z: number[]) => [...z.slice(0, CMS), x0[CMS], ...z.slice(CMS)];
  let x: number[];
  if (holdCms) {
    const costHeld = (z: number[]) => cost12(widen(z));
    let z = nelderMead(costHeld, [...x0.filter((_, i) => i !== CMS), Math.log(50)]);
    z = nelderMead(costHeld, z, 0.02);
    x = widen(z);
  } else {
    x = nelderMead(cost12, [...x0, Math.log(50)]);
    x = nelderMead(cost12, x, 0.02);
  }
  let drv = toDrv(x.slice(0, 5).map(Math.exp));
  const RAB = cc ? Math.exp(x[5]) : 0;
  const identified = !!(cf && cc);
  if (!cf) notes.push("No free-air curve: the driver was fitted to the closed box alone, so V_AS rests on the starting estimate.");
  else if (!cc && configs.length) notes.push("No closed-box curve: free air alone cannot separate Bl from the moving mass and V_AS.");

  // ---- 3: vented configurations
  const ventRadius = (id: string) => (profile.woofer_box.vents.find(v => v.id === id)?.diameter_m ?? 2 * g.AP) / 2;
  const configMassFormula = (m: VentedMeasurement) => {
    // tubes in parallel combine like inductors
    const inv = m.vents.reduce((s, v) => s + 1 / tubeMass(v.length_m, ventRadius(v.id), g.rho), 0);
    return 1 / inv;
  };
  const configRadius = (m: VentedMeasurement) => Math.sqrt(m.vents.reduce((s, v) => s + ventRadius(v.id) ** 2, 0));
  let QL = 7, QP = 30, masses: number[] = [], ventCost = 0;
  if (configs.length) {
    const curves = configs.map(m => fitCurve(m.z, 5, 150, g, false));
    const boxes = (y: number[]) => {
      const ql = Math.exp(y[0]), qp = Math.exp(y[1]);
      return configs.map((_, j) => {
        const m = Math.exp(y[2 + j]), wb = 1 / Math.sqrt(m * g.VB / (g.rho * g.c ** 2));
        return boxElements(g, { RAB, QL: ql, MAP: m, RAP: wb * m / qp });
      });
    };
    const ventErr = (y: number[], d: DriverParams) => boxes(y).reduce((e, bx, j) => e + zerr(curves[j], g, d, bx), 0);
    const y0 = [Math.log(20), Math.log(10), ...configs.map(m => Math.log(configMassFormula(m)))];
    if (!identified) {
      // The box compliance of the vented curves is what separates Bl from M_MD and C_MS here, so
      // fit the driver jointly with them first (from the starting estimate, not the degenerate fit).
      const joint = (z: number[]) => {
        const d = toDrv(z.slice(0, 5).map(Math.exp));
        return (cf ? zerr(cf, g, d, null) : 0) + (cc ? zerr(cc, g, d, closedBox(RAB)) : 0) + ventErr(z.slice(5), d);
      };
      let z = nelderMead(joint, [...x0, ...y0], 0.1, 20000);
      for (const step of [0.05, 0.02, 0.01]) z = nelderMead(joint, z, step, 20000);
      drv = toDrv(z.slice(0, 5).map(Math.exp));
      notes.push("V_AS and Bl were pinned by fitting the driver jointly with the vented-box curves.");
    }
    const cost3 = (y: number[]) => ventErr(y, drv);
    let y = nelderMead(cost3, y0, 0.2);
    y = nelderMead(cost3, y, 0.02);
    QL = Math.exp(y[0]); QP = Math.exp(y[1]);
    masses = configs.map((_, j) => Math.exp(y[2 + j]));
    ventCost = cost3(y);
  } else if (holdCms) {
    notes.push("No closed-box or vented curve: V_AS is assumed equal to the box volume, so the bass prediction is rough. Import a closed-box curve.");
  }

  // ---- M_AP per length for the primary vent (what boxConfig interpolates)
  const MAP: [number, number][] = [];
  configs.forEach((m, j) => {
    if (m.vents.length === 1 && m.vents[0].id === g.primaryVent) MAP.push([m.vents[0].length_m, masses[j]]);
  });
  if (!configs.length) {
    const range = profile.woofer_box.vents.find(v => v.id === g.primaryVent)?.length_range_m ?? [0.1, 0.3];
    for (const L of range) MAP.push([L, tubeMass(L, g.AP, g.rho)]);
    notes.push(`No vented-box curves: vent mass from the tube formula ρ(L + 1.46a)/(πa²), Q_L = ${QL}, Q_P = ${QP} assumed.`);
  }
  MAP.sort((p, q) => p[0] - q[0]);
  // repeated measurements at one length (a re-run) become one point with the mean mass
  for (let i = 1; i < MAP.length; i++) {
    let j = i;
    while (j < MAP.length && Math.abs(MAP[j][0] - MAP[i - 1][0]) < 1e-6) j++;
    if (j > i) {
      const group = MAP.slice(i - 1, j);
      MAP.splice(i - 1, group.length, [group[0][0], group.reduce((a, q) => a + q[1], 0) / group.length]);
    }
  }

  const fbOf = (m: number) => 1 / (TWO_PI * Math.sqrt(m * g.VB / (g.rho * g.c ** 2)));
  return {
    T: g.T, c: g.c, rho: g.rho, RE: g.RE, SD: g.SD, AD: g.AD, VB: g.VB, AP: g.AP,
    drv, RAB, QL, QP, MAP,
    ts: thieleSmall(g, drv),
    quality: { driver: cost12([...KEYS.map(k => Math.log(drv[k])), x[5]]), vents: ventCost },
    notes,
    ventFits: configs.map((m, j) => ({ label: ventLabel(m), vents: m.vents, MAP: masses[j], fB: fbOf(masses[j]), ap: configRadius(m) })),
  };
}

/** L_E start value: the reactance well above resonance, where the motional part has faded. */
function estimateLe(s: Series): number {
  let best = -1;
  for (let i = 0; i < s.f.length; i++) if (s.f[i] <= 1000 && (best < 0 || s.f[i] > s.f[best])) best = i;
  const le = best >= 0 ? s.im[best] / (TWO_PI * s.f[best]) : 1e-3;
  return Math.min(5e-3, Math.max(5e-5, le));
}

// ---------------------------------------------------------------- box configurations of a design
export interface BoxConfig {
  /** Effective vent mass (kg/m^4), null = closed. */
  MAP: number | null;
  fill: number;
  label: string;
  /** Radius used for the vent near field (the equivalent of all open vents). */
  ap: number;
}

/** Effective vent mass of the primary vent at length L: linear interpolation of the fitted masses
 *  (extrapolated, floor 5 kg/m^4); one fitted point scales with the tube formula; none = formula. */
export function mapAt(fit: BoxFit, L: number): number {
  const pts = fit.MAP;
  if (pts.length === 0) return tubeMass(L, fit.AP, fit.rho);
  if (pts.length === 1) return pts[0][1] * tubeMass(L, fit.AP, fit.rho) / tubeMass(pts[0][0], fit.AP, fit.rho);
  let k = 0;
  while (k < pts.length - 2 && L > pts[k + 1][0]) k++;
  const [L0, m0] = pts[k], [L1, m1] = pts[k + 1];
  // fitBox merges equal lengths; a hand-edited fit with duplicates must still give a number
  if (!(L1 > L0)) return Math.max(5, (m0 + m1) / 2);
  return Math.max(5, m0 + (m1 - m0) * (L - L0) / (L1 - L0));
}

/** Vent mass and label of the design's box setting. A second tube uses the tube formula scaled by
 *  the same calibration as the first (the fitted/formula ratio at its length). `ventCount` is how many
 *  vents the box really has: a setting that opens more vents than exist falls back to what does. */
export function boxConfig(fit: BoxFit, box: BoxDesign, ventCount = Infinity): BoxConfig {
  const fill = box.fill ?? 1;
  if (ventCount < 1 && (box.mode === "one" || box.mode === "two")) box = { ...box, mode: "plugged" };
  else if (ventCount < 2 && box.mode === "two") box = { ...box, mode: "one" };
  if (box.mode === "plugged") return { MAP: null, fill, label: "vents plugged (closed box)", ap: fit.AP };
  if (box.mode === "one") return { MAP: mapAt(fit, box.L), fill, label: `one vent, L = ${(box.L * 1e3).toFixed(0)} mm`, ap: fit.AP };
  if (box.mode === "two") {
    const m1 = mapAt(fit, box.L), cal = m1 / tubeMass(box.L, fit.AP, fit.rho), m2 = cal * tubeMass(box.L2, box.a2, fit.rho);
    return { MAP: m1 * m2 / (m1 + m2), fill, ap: Math.hypot(fit.AP, box.a2),
             label: `two vents (L ${(box.L * 1e3).toFixed(0)} + ${(box.L2 * 1e3).toFixed(0)} mm, second ⌀ ${(box.a2 * 2e3).toFixed(0)} mm)` };
  }
  return { MAP: box.MAP ?? null, fill, label: box.label || "custom", ap: fit.AP };
}

/** Box elements of a configuration (closed box when MAP is null). */
export function configElements(fit: BoxFit, cfg: BoxConfig): BoxElements {
  return cfg.MAP ? ventedElements(fit, cfg.MAP, cfg.fill, cfg.ap) : boxElements(fit, { RAB: fit.RAB, fill: cfg.fill });
}

/** Box tuning frequency (Hz) of a vent mass. */
export function tuningHz(fit: BoxFit, MAP: number | null, fill = 1): number | null {
  return MAP ? 1 / (TWO_PI * Math.sqrt(MAP * fit.VB * fill / (fit.rho * fit.c ** 2))) : null;
}

/** f_3 against the mid-band level (mean dB over 150-300 Hz) and the highest point below 150 Hz. */
export function f3Ripple(freqs: ArrayLike<number>, p: CArray, lo = 150, hi = 300): { f3: number; ripple: number; ref: number } {
  const n = freqs.length, L = new Float64Array(n);
  let sum = 0, cnt = 0;
  for (let i = 0; i < n; i++) {
    L[i] = 20 * Math.log10(Math.hypot(p.re[i], p.im[i]));
    if (freqs[i] >= lo && freqs[i] <= hi) { sum += L[i]; cnt++; }
  }
  const ref = sum / cnt;
  let last = -1, rip = -Infinity;
  for (let i = 0; i < n; i++) if (freqs[i] < lo) { if (L[i] - ref < -3) last = i; rip = Math.max(rip, L[i] - ref); }
  return { f3: last >= 0 ? freqs[last + 1] : freqs[0], ripple: rip, ref };
}
