// Limits: how loud the design can play, and what gives up first. For every mechanism that can fail
// (woofer stroke, vent noise, midrange and tweeter stroke and heat, the crossover resistors, the two
// amplifier channels) this finds the input voltage at which it reaches its limit, as a curve against
// frequency (a sine at that frequency) and as one number for a music-like programme.
//
// Signal chain (see system.ts): the drive V is the voltage the amplifier would deliver with the MiniDSP
// filters bypassed (unity gain from the DSP input to the amplifier output, the convention of every
// "per volt" result in the engine). Channel 1 = V x H_L x woofer gain drives the woofer directly;
// channel 2 = V x H_H feeds the two passive branches, whose ladders set the midrange and tweeter
// terminal voltages and the resistor currents.
//
// Programme: pink noise, 20 Hz-20 kHz (equal power per octave, the same signal the verdict's safety
// checks use), with a crest factor (peak / rms) of 12 dB by default, typical of mastered music; IEC
// 60268-5's test noise is clipped to 6 dB. Heat (power) limits use the rms, stroke, vent speed and
// amplifier clipping use the peak = crest factor x rms of that quantity's own (filtered) signal.
// Everything is linear in V: a limit at V_lim means the part is at x % of its limit at V = x % of
// V_lim (peak quantities) or at V = sqrt(x %) of V_lim (power quantities).
//
// Assumptions, stated once:
// - Woofer excursion and vent speed come from the fitted box model (Lab D), so they are valid below
//   the measured grid (the anechoic room's cut-off is 125 Hz) as well.
// - Midrange and tweeter excursion come from their measured p/V at the microphone, through the
//   low-frequency piston relation p(r) = rho omega^2 S_D x / (Omega r): Omega = 4 pi (full space) well
//   below the top box's baffle step f_bs = 115 / width, 2 pi well above, blended smoothly. Below a
//   floor frequency (150 Hz for the midrange, the tweeter's resonance for the tweeter) the measurement
//   is noise or room, so the excursion per terminal volt is held at its value there (a cone below
//   its resonance is stiffness controlled: flat excursion per volt).
// - Heat: the data-sheet rating is U^2 / Z_nom of long-term noise at the terminals (IEC 60268-5). A
//   tweeter rated through a test high-pass only received the pink-noise share above it, so the rating
//   counts for that share (ln(20 kHz / f_hp) / ln(1000)).
// - SPL: the on-axis sum, measured at mic_distance_m, scaled to 1 m by 1/r (far field). Below the
//   measured grid the box model's woofer, matched in level at the first grid point. Listening
//   distance: free field, 1/r again (a room adds its reverberant field: a few dB more).
// - Limits are reached in a linear model: compression, power compression and the room are ignored.

import type { BoxFit, CArray, Design, Profile, Results, UnitId, UnitInfo } from "../types";
import { cabsAt, logspace } from "./complex";
import { hDigital } from "./digital";
import { ladderNodes, passiveParts } from "./passive";
import { boxConfig, boxSystem, configElements } from "./box";
import type { Prepared } from "./system";
import { RESISTOR_RATING_W } from "./assess";

// ---------------------------------------------------------------- settings
export type LimitSource = "profile" | "user" | "estimate";

/** Data-sheet values of one unit after merging profile, user entries and estimates. */
export interface UnitLimitSpec {
  xmax_mm: number;
  p_rated_w: number;
  p_rated_hp_hz?: number;
  z_nom_ohm: number;
  src: { xmax: LimitSource; p: LimitSource; z: LimitSource };
}

/** What the user typed in the Limits view (kept per profile outside the profile file). */
export interface LimitOverrides {
  units?: Partial<Record<UnitId, Partial<Pick<UnitInfo, "xmax_mm" | "p_rated_w" | "p_rated_hp_hz" | "z_nom_ohm">>>>;
  /** Amplifier: largest clean sine per channel, V rms. */
  amp_vrms?: number;
  /** Listening distance for the second SPL readout, m. */
  listen_m?: number;
}

export interface LimitSettings {
  units: Record<UnitId, UnitLimitSpec>;
  amp: { max_vrms: number; src: LimitSource };
  /** Rating assumed for every crossover resistor (W, long term). */
  resistorW: number;
  /** Peak vent air speed where chuffing becomes audible (m/s). */
  ventMs: number;
  /** Programme crest factor (dB). */
  crestDb: number;
  /** Listening distance (m). */
  listenM: number;
}

/** Peak vent air speed where vent noise becomes audible: about 5 % of c, the Box view's rule of thumb. */
export const VENT_LIMIT_MS = 17;
/** Default programme crest factor (dB): mastered music. IEC 60268-5 test noise: 6 dB. */
export const CREST_MUSIC_DB = 12;
export const CREST_IEC_DB = 6;
/** Assumed amplifier when the profile has none: 50 W into 8 ohm per channel = 20 V rms sine. */
export const DEFAULT_AMP_VRMS = 20;
export const DEFAULT_LISTEN_M = 3;

/** Typical values for a unit without data-sheet figures (clearly estimates: the UI labels them).
 *  Woofer: a 20-26 cm long-throw driver; midrange: a 13 cm mid/woofer; tweeter: a 25 mm dome rated
 *  through a 2 kHz high-pass, as tweeter data sheets usually are. */
const ESTIMATE: Record<UnitId, { xmax_mm: number; p_rated_w: number; p_rated_hp_hz?: number }> = {
  woof: { xmax_mm: 5, p_rated_w: 80 },
  mid: { xmax_mm: 3, p_rated_w: 40 },
  tw: { xmax_mm: 0.5, p_rated_w: 60, p_rated_hp_hz: 2000 },
};

const ok = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x) && x > 0;

/** Merge the profile's data-sheet values, the user's entries (which win) and estimates. */
export function limitSettings(profile: Profile, o: LimitOverrides = {}, crestDb = CREST_MUSIC_DB): LimitSettings {
  const units = {} as Record<UnitId, UnitLimitSpec>;
  for (const u of ["woof", "mid", "tw"] as const) {
    const info = profile.units[u], user = o.units?.[u] ?? {}, est = ESTIMATE[u];
    const pick = (k: "xmax_mm" | "p_rated_w" | "z_nom_ohm", fallback: number): [number, LimitSource] =>
      ok(user[k]) ? [user[k]!, "user"] : ok(info[k]) ? [info[k]!, "profile"] : [fallback, "estimate"];
    // nominal impedance: about R_E / 0.8 (IEC: the minimum of |Z| above resonance is at least 0.8 Z_nom)
    const zEst = ok(info.Re_ohm) ? Math.round(info.Re_ohm / 0.8) : 8;
    const [xmax, sx] = pick("xmax_mm", est.xmax_mm), [pw, sp] = pick("p_rated_w", est.p_rated_w), [z, sz] = pick("z_nom_ohm", zEst);
    // the test high-pass belongs to the rating it came with
    const hp = sp === "user" ? user.p_rated_hp_hz : sp === "profile" ? info.p_rated_hp_hz : est.p_rated_hp_hz;
    units[u] = { xmax_mm: xmax, p_rated_w: pw, p_rated_hp_hz: ok(hp) ? hp : undefined, z_nom_ohm: z, src: { xmax: sx, p: sp, z: sz } };
  }
  const amp: LimitSettings["amp"] = ok(o.amp_vrms) ? { max_vrms: o.amp_vrms, src: "user" }
    : ok(profile.amp?.max_vrms) ? { max_vrms: profile.amp!.max_vrms, src: "profile" } : { max_vrms: DEFAULT_AMP_VRMS, src: "estimate" };
  return { units, amp, resistorW: RESISTOR_RATING_W, ventMs: VENT_LIMIT_MS, crestDb, listenM: ok(o.listen_m) ? o.listen_m : DEFAULT_LISTEN_M };
}

/** Share of a 20 Hz-20 kHz pink noise's power above f (Hz), 0..1. */
export function pinkShareAbove(f: number): number {
  return Math.min(1, Math.max(0, Math.log(20000 / Math.max(20, f)) / Math.log(1000)));
}

// ---------------------------------------------------------------- results
export type MechanismKind = "xmax" | "thermal" | "vent" | "resistor" | "amp";

export interface Mechanism {
  /** "woof.xmax", "mid.thermal", "vent", "res:tw.pad.Rs", "amp.ch1", ... */
  id: string;
  kind: MechanismKind;
  unit?: UnitId;
  /** "Woofer stroke", "Tweeter Rs heat", "Amplifier ch. 2 clips". */
  label: string;
  /** Chart colour token. */
  color: string;
  /** Inspector control that changes it most directly. */
  focus: string;
  /** true when the limit is an estimate, not a data-sheet value. */
  estimated: boolean;
  /** The limit and its unit: 6 "mm", 80 "W", 17 "m/s", 28.3 "V". */
  limit: number;
  quantityUnit: "mm" | "W" | "m/s" | "V";
  /** Programme: the quantity (peak or rms power) per V^exp of programme rms drive. */
  perV: number;
  /** 1 for peak quantities (stroke, speed, voltage), 2 for powers. */
  exp: 1 | 2;
  /** Programme rms drive (V) at which the limit is reached, and the SPL at 1 m then (dB). */
  progV: number;
  progSpl: number;
  /** Sine at each frequency of `f`: the drive (V rms) at the limit, and the SPL at 1 m then (dB). */
  sineV: Float64Array;
  sineSpl: Float64Array;
  /** Frequency where this mechanism is closest to its limit (lowest sine SPL), Hz. */
  worstF: number;
}

export interface LimitsResult {
  /** Grid of the curves, 20 Hz-20 kHz log spaced. */
  f: Float64Array;
  settings: LimitSettings;
  mechanisms: Mechanism[];
  /** Lower envelope of every mechanism's sine SPL (dB at 1 m) and which mechanism sets it. */
  envelope: Float64Array;
  envelopeBy: (string | null)[];
  /** On-axis SPL at 1 m for a 1 V rms sine at each frequency (dB). */
  splPerV: Float64Array;
  /** Programme SPL at 1 m for 1 V rms programme drive (dB). */
  progSplPerV: number;
  /** The programme limit: the mechanism that gives up first, its drive and SPL at 1 m and at listenM. */
  limiting: Mechanism;
  maxV: number;
  maxSpl1m: number;
  maxSplListen: number;
  /** Units whose stroke or heat limit is an estimate. */
  estimatedUnits: UnitId[];
  /** Measurement chain gain the SPL and the top-box excursion were corrected by (dB), see chainGainDb. */
  chainGainDb: number;
}

const NAME: Record<UnitId, string> = { woof: "Woofer", mid: "Midrange", tw: "Tweeter" };
const COLOR: Record<UnitId, string> = { woof: "woof", mid: "mid", tw: "tw" };
const P0 = 20e-6;
const GRID_N = 360;

/** Linear interpolation on log f of y given on the ascending grid xs; NaN outside it. */
function interpLog(xs: Float64Array, ys: Float64Array, f: number): number {
  const n = xs.length;
  if (f < xs[0] * (1 - 1e-9) || f > xs[n - 1] * (1 + 1e-9)) return NaN;
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (xs[m] <= f) lo = m; else hi = m; }
  if (hi === lo) return ys[lo];
  const t = (Math.log(f) - Math.log(xs[lo])) / (Math.log(xs[hi]) - Math.log(xs[lo]));
  return ys[lo] + Math.min(1, Math.max(0, t)) * (ys[hi] - ys[lo]);
}

/** Pink-noise weights on the grid: each point's share of ln f over ln(20 kHz / 20 Hz), so that a
 *  quantity Q(f) per volt gives the programme mean square sum(w Q^2) per volt^2. */
export function pinkWeights(f: ArrayLike<number>): Float64Array {
  const n = f.length, w = new Float64Array(n), span = Math.log(1000);
  for (let i = 0; i < n; i++) {
    if (f[i] < 20 || f[i] > 20000) continue;
    const lo = i ? Math.max(20, Math.sqrt(f[i - 1] * f[i])) : Math.max(20, f[i]);
    const hi = i < n - 1 ? Math.min(20000, Math.sqrt(f[i] * f[i + 1])) : Math.min(20000, f[i]);
    w[i] = Math.max(0, Math.log(hi / lo)) / span;
  }
  return w;
}

/** Solid angle the top-box drivers radiate into: 4 pi well below the baffle step, 2 pi well above. */
export function radiationAngle(f: number, baffleWidth: number): number {
  const fbs = 115 / Math.max(0.05, baffleWidth);
  return 2 * Math.PI * (1 + 1 / (1 + (f / fbs) ** 2));
}

/** Peak cone excursion (m) per volt rms at the terminals from a far-field p/V at distance r:
 *  |x| = |p| Omega r / (rho S omega^2), times sqrt 2 for the peak. */
export function excursionFromPressure(pPerV: number, f: number, r: number, rho: number, SD: number, omega: number): number {
  const w = 2 * Math.PI * f;
  return Math.SQRT2 * pPerV * omega * r / (rho * SD * w * w);
}

const cache = new WeakMap<Results, Map<string, LimitsResult>>();

/** Every limit of the design (cached per Results and settings). */
export function limits(p: Prepared, design: Design, results: Results, settings: LimitSettings): LimitsResult {
  const key = JSON.stringify(settings);
  let m = cache.get(results);
  if (!m) { m = new Map(); cache.set(results, m); }
  let r = m.get(key);
  if (!r) { r = computeLimits(p, design, results, settings); if (m.size > 8) m.clear(); m.set(key, r); }
  return r;
}

function computeLimits(p: Prepared, design: Design, results: Results, S: LimitSettings): LimitsResult {
  const fit: BoxFit = p.fit, prof = p.profile, on = results.angles["0"];
  const F = Float64Array.from(logspace(20, 20000, GRID_N)), N = F.length, W = pinkWeights(F);
  const crest = 10 ** (S.crestDb / 20), dMic = prof.conditions.mic_distance_m ?? 1;
  const g = 10 ** (design.digital.g_woof_dB / 20), dg = design.digital;

  // ---- channel gains on F (per volt of drive)
  const HL = hDigital(F, dg.fc, "LPF", dg.align), HHF = hDigital(F, dg.fc, "HPF", dg.align);
  const ch1 = new Float64Array(N), ch2 = new Float64Array(N);
  for (let i = 0; i < N; i++) { ch1[i] = cabsAt(HL, i) * g; ch2[i] = cabsAt(HHF, i); }

  // ---- woofer from the box model (per volt at its terminals), times channel 1
  const cfg = boxConfig(fit, design.box, prof.woofer_box.vents.length);
  const bx = boxSystem(fit, fit.drv, configElements(fit, cfg), F);
  const xW = new Float64Array(N), vV = new Float64Array(N), pW1m = new Float64Array(N);
  const ventArea = Math.PI * cfg.ap ** 2, vk = cfg.ventSpeedFactor ?? 1;
  for (let i = 0; i < N; i++) {
    const w = 2 * Math.PI * F[i];
    xW[i] = Math.SQRT2 * cabsAt(bx.UD, i) / (w * fit.SD) * ch1[i];            // m peak per V rms
    vV[i] = cfg.MAP ? Math.SQRT2 * cabsAt(bx.UP, i) / ventArea * vk * ch1[i] : 0; // m/s peak per V rms
    pW1m[i] = cabsAt(bx.p1m, i) * ch1[i];
  }

  // ---- on the measured grid: SPL per volt, top-box excursion and terminal voltage, resistor powers.
  // The measured p/V are per volt at the amplifier input (Lab E feeds the sound card to it), so they
  // are divided by the chain gain to be per volt at the amplifier output, the drive used here.
  const pf = p.f, M = pf.length, width = prof.top_box.outer_m[0], G = 10 ** (chainGainDb(p) / 20);
  const sum1m = new Float64Array(M);
  for (let i = 0; i < M; i++) sum1m[i] = cabsAt(on.sum, i) * dMic / G;
  const top = (u: "mid" | "tw") => {
    const T = u === "mid" ? on.Tm : on.Tt, tf = p._e.tf["0"][u], SD = Math.PI * prof.units[u].diameter_m ** 2 / 4;
    const floor = u === "mid" ? 150 : Math.max(150, prof.limits.tw_fs_hz);
    const vt = new Float64Array(M), x = new Float64Array(M);
    let iFloor = 0;
    while (iFloor < M - 1 && pf[iFloor] < floor) iFloor++;
    const xAt = (k: number) => excursionFromPressure(cabsAt(tf, k) / G, pf[k], dMic, fit.rho, SD, radiationAngle(pf[k], width));
    const xFloor = xAt(iFloor);
    for (let i = 0; i < M; i++) {
      vt[i] = cabsAt(on.HH, i) * cabsAt(T as CArray, i);
      x[i] = (i < iFloor ? xFloor : xAt(i)) * vt[i];
    }
    return { vt, x };
  };
  const mid = top("mid"), tw = top("tw");
  const res = resistorLoads(p, design, on.HH);

  // ---- everything onto F
  // log-domain interpolation of positive quantities (precompute the logs once per array)
  const onFpos = (ys: Float64Array) => {
    const ln = ys.map(v => Math.log(Math.max(v, 1e-30))), out = new Float64Array(N);
    for (let i = 0; i < N; i++) out[i] = Math.exp(interpLog(pf, ln, F[i]));
    return out;
  };
  const spl1 = onFpos(sum1m);
  // below the measured grid the box model's woofer, matched in level at the first grid point
  const iStart = F.findIndex(x => x >= pf[0]);
  if (iStart > 0) {
    const k = spl1[iStart] / (pW1m[iStart] || 1e-30);
    for (let i = 0; i < iStart; i++) spl1[i] = pW1m[i] * k;
  }
  const splPerV = Float64Array.from(spl1, v => 20 * Math.log10(v / P0));
  const xM = onFpos(mid.x), xT = onFpos(tw.x), vtM = onFpos(mid.vt), vtT = onFpos(tw.vt);
  const progSplPerV = 10 * Math.log10(sumW(W, spl1, 2) / P0 ** 2);

  // ---- the mechanisms
  const mechs: Mechanism[] = [];
  const add = (m: Omit<Mechanism, "progV" | "progSpl" | "sineSpl" | "worstF">) => {
    const progV = (m.limit / m.perV) ** (1 / m.exp);
    const sineSpl = new Float64Array(N);
    let worst = Infinity, worstF = F[0];
    for (let i = 0; i < N; i++) {
      const v = m.sineV[i], s = Number.isFinite(v) && v > 0 ? splPerV[i] + 20 * Math.log10(v) : NaN;
      sineSpl[i] = s;
      if (s < worst) { worst = s; worstF = F[i]; }
    }
    mechs.push({ ...m, progV, progSpl: progSplPerV + 20 * Math.log10(progV), sineSpl, worstF });
  };
  const sineFrom = (q: Float64Array, limit: number, exp: 1 | 2) =>
    Float64Array.from(q, v => (v > 0 && Number.isFinite(v) ? (limit / v) ** (1 / exp) : NaN));
  const rms = (q: Float64Array) => Math.sqrt(sumW(W, q, 2));

  // stroke: the arrays hold the peak per volt rms of a sine; the programme peak is crest x rms
  // (a sine's rms is peak / sqrt 2)
  const stroke = (u: UnitId, x: Float64Array) => {
    const s = S.units[u], lim = s.xmax_mm * 1e-3;
    add({ id: `${u}.xmax`, kind: "xmax", unit: u, label: `${NAME[u]} stroke`, color: COLOR[u],
          focus: u === "woof" ? "box.L" : `${u}.topo`, estimated: s.src.xmax === "estimate",
          limit: s.xmax_mm, quantityUnit: "mm", perV: crest * rms(x) / Math.SQRT2 * 1e3, exp: 1,
          sineV: sineFrom(x, lim, 1) });
  };
  // heat: U^2 / Z_nom at the terminals against the rating (its share above a test high-pass)
  const heat = (u: UnitId, vt: Float64Array) => {
    const s = S.units[u], lim = s.p_rated_w * (s.p_rated_hp_hz ? pinkShareAbove(s.p_rated_hp_hz) : 1);
    const pw = Float64Array.from(vt, v => v * v / s.z_nom_ohm);
    add({ id: `${u}.thermal`, kind: "thermal", unit: u, label: `${NAME[u]} heat`, color: COLOR[u],
          focus: u === "woof" ? "digital.gain" : u === "tw" ? "tw.pad.Rs" : "mid.topo", estimated: s.src.p === "estimate",
          limit: lim, quantityUnit: "W", perV: sumW(W, pw, 1), exp: 2, sineV: sineFrom(pw, lim, 2) });
  };
  stroke("woof", xW);
  heat("woof", Float64Array.from(ch1));
  if (cfg.MAP) add({ id: "vent", kind: "vent", unit: "woof", label: "Vent noise", color: "woof", focus: "box.L", estimated: false,
                     limit: S.ventMs, quantityUnit: "m/s", perV: crest * rms(vV) / Math.SQRT2, exp: 1, sineV: sineFrom(vV, S.ventMs, 1) });
  stroke("mid", xM); heat("mid", vtM);
  stroke("tw", xT); heat("tw", vtT);
  for (const r of res) {
    const q = onFpos(r.pPerV2);
    add({ id: `res:${r.id}`, kind: "resistor", label: `${partName(r.id)} heat`, color: "warn", focus: r.id, estimated: false,
          limit: S.resistorW, quantityUnit: "W", perV: sumW(W, q, 1), exp: 2, sineV: sineFrom(q, S.resistorW, 2) });
  }
  const vpk = S.amp.max_vrms * Math.SQRT2;
  for (const [id, h, label, focus] of [["amp.ch1", ch1, "Amplifier ch. 1 clips", "digital.gain"], ["amp.ch2", ch2, "Amplifier ch. 2 clips", "digital.fc"]] as const) {
    // a sine of V rms at the drive peaks at sqrt 2 V |H|
    const peak = Float64Array.from(h, v => Math.SQRT2 * v);
    add({ id, kind: "amp", label, color: "bad", focus, estimated: S.amp.src === "estimate",
          limit: vpk, quantityUnit: "V", perV: crest * rms(h), exp: 1, sineV: sineFrom(peak, vpk, 1) });
  }

  // ---- envelope and the programme limit
  const envelope = new Float64Array(N).fill(NaN), envelopeBy: (string | null)[] = new Array(N).fill(null);
  for (const m of mechs) for (let i = 0; i < N; i++) {
    const s = m.sineSpl[i];
    if (Number.isFinite(s) && !(s >= envelope[i])) { envelope[i] = s; envelopeBy[i] = m.id; }
  }
  const limiting = mechs.reduce((a, b) => (b.progV < a.progV ? b : a));
  const maxSpl1m = limiting.progSpl;
  const estimatedUnits = (["woof", "mid", "tw"] as const).filter(u => S.units[u].src.xmax === "estimate" || S.units[u].src.p === "estimate");
  return {
    f: F, settings: S, mechanisms: mechs, envelope, envelopeBy, splPerV, progSplPerV, limiting,
    maxV: limiting.progV, maxSpl1m, maxSplListen: maxSpl1m - 20 * Math.log10(S.listenM), estimatedUnits, chainGainDb: 20 * Math.log10(G),
  };
}

/** Gain (dB) between the volts the measured p/V refer to and the volts at the drivers. Lab E divides
 *  the microphone pressure by the sound card's line-in, which feeds the amplifier input, so the
 *  amplifier's gain at its volume setting is folded into every measured TF. The fitted box model is
 *  absolute (Pa per volt at the woofer), so the plugged-box model against the woofer measured
 *  plugged fixes it: median over 150-400 Hz of |TF| r Omega / (2 pi |p_1m, half space|), with the
 *  woofer box's own baffle step. 0 dB when the TFs are already per terminal volt. */
export function chainGainDb(p: Prepared): number {
  const cached = gainCache.get(p);
  if (cached !== undefined) return cached;
  const prof = p.profile, tf = p._e.tf["0"].woof, ref = p._e.closedRef, r = prof.conditions.mic_distance_m ?? 1;
  const width = prof.woofer_box.inner_m[0] + 2 * prof.woofer_box.wall_m;
  let k: number[] = [];
  for (let i = 0; i < p.f.length; i++) if (p.f[i] >= 150 && p.f[i] <= 400) k.push(i);
  if (k.length < 3) k = Array.from({ length: Math.min(20, p.f.length) }, (_, i) => i);
  const g = k.map(i => 20 * Math.log10(cabsAt(tf, i) * r * radiationAngle(p.f[i], width) / (2 * Math.PI * cabsAt(ref, i)))).sort((a, b) => a - b);
  const out = g[g.length >> 1];
  gainCache.set(p, out);
  return out;
}
const gainCache = new WeakMap<Prepared, number>();

/** sum_i w_i |q_i|^k, skipping points without a value. */
function sumW(w: Float64Array, q: Float64Array, k: 1 | 2): number {
  let s = 0;
  for (let i = 0; i < w.length; i++) if (w[i] > 0 && Number.isFinite(q[i])) s += w[i] * (k === 2 ? q[i] * q[i] : q[i]);
  return s;
}

/** "tw.pad.Rs" -> "Tweeter Rs", "mid.zobel" -> "Midrange Zobel R". */
export function partName(id: string): string {
  return id.replace(/^tw\./, "Tweeter ").replace(/^mid\./, "Midrange ").replace("pad.", "").replace("zobel", "Zobel R");
}

/** Power in every resistor of the passive branches per volt^2 (rms) of drive, on the measured grid. */
function resistorLoads(p: Prepared, design: Design, HH: CArray): { id: string; pPerV2: Float64Array }[] {
  const out = new Map<string, Float64Array>(), M = p.f.length;
  for (const unit of ["mid", "tw"] as const) {
    const parts = passiveParts(design[unit], unit);
    if (!parts.some(pt => pt.kind === "R" || pt.kind === "RC")) continue;
    for (let i = 0; i < M; i++) {
      const fi = p.f[i], w = 2 * Math.PI * fi, g2 = cabsAt(HH, i) ** 2;
      const nodes = ladderNodes(fi, parts, [p.zi[unit].re[i], p.zi[unit].im[i]], design.Rdcr || 0);
      let k = 0, cur = nodes[0].v;
      const put = (id: string, pw: number) => {
        let a = out.get(id);
        if (!a) { a = new Float64Array(M); out.set(id, a); }
        a[i] = pw;
      };
      for (const pt of parts) {
        if (pt.kind === "RC") {
          const last = nodes[nodes.length - 1].v, [R, C] = pt.value, xc = -1 / (w * C);
          put(pt.id, g2 * (last[0] ** 2 + last[1] ** 2) / (R * R + xc * xc) * R);
        } else if (pt.pos === "series") {
          const next = nodes[++k].v;
          if (pt.kind === "R") put(pt.id, g2 * ((cur[0] - next[0]) ** 2 + (cur[1] - next[1]) ** 2) / pt.value);
          cur = next;
        } else if (pt.kind === "R") {
          put(pt.id, g2 * (cur[0] ** 2 + cur[1] ** 2) / pt.value);
        }
      }
    }
  }
  return [...out.entries()].map(([id, pPerV2]) => ({ id, pPerV2 }));
}

// ---------------------------------------------------------------- at a chosen level
export interface LoadAt {
  id: string;
  /** The quantity at this drive (mm, W, m/s or V) and its share of the limit (1 = at the limit). */
  value: number;
  fraction: number;
}

/** How close every mechanism is to its limit for a programme at `spl1m` dB at 1 m. */
export function loadsAt(r: LimitsResult, spl1m: number): { V: number; loads: LoadAt[] } {
  const V = 10 ** ((spl1m - r.progSplPerV) / 20);
  return { V, loads: r.mechanisms.map(m => { const value = m.perV * V ** m.exp; return { id: m.id, value, fraction: value / m.limit }; }) };
}
