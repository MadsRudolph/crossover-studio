// Turning the wizard's draft into a Profile, plus the estimates and sanity checks the wizard shows.
// Pure functions: the end-to-end test builds a profile from fixture files through exactly this code.

import type { Profile, Series, UnitId, VentedMeasurement } from "../types";
import { UNIT_NAME, type Assignment, type RoleKey, type VentConfig } from "./roles";

/** Everything of a profile except its measurements (and the fixed version/id). */
export type DraftSystem = Omit<Profile, "version" | "id" | "measurements">;

const UNITS: UnitId[] = ["woof", "mid", "tw"];
/** Speed of sound the phase display uses (Matlab2LTspice / phaseunwrap.m convention). */
export const C_PHASE = 345;

/** A draft pre-filled from an existing profile (the bundled example): the wizard marks every value
 *  as an example until the user edits it. */
export function draftFromProfile(p: Profile): DraftSystem {
  const { version: _v, id: _id, measurements: _m, ...rest } = structuredClone(p);
  return { ...rest, name: "", group: "", system: "", notes: "" };
}

/** Folder-safe id, the rule the Rust side enforces: [A-Za-z0-9._-], at most 64 chars, not starting with '.'. */
export function slugify(name: string): string {
  const s = name.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^[-.]+|-+$/g, "").slice(0, 64).replace(/-+$/, "");
  return s || "my-system";
}
export const isValidId = (id: string) => /^[A-Za-z0-9._-]{1,64}$/.test(id) && !id.startsWith(".");

export interface BuildInput {
  system: DraftSystem;
  id: string;
  assignments: Record<RoleKey, Assignment>;
  /** Series read for each assigned role. */
  series: Record<RoleKey, Series | undefined>;
  vents: VentConfig[];
}

/** Assemble the profile. Throws a plain-language error naming the first missing required piece. */
export function buildProfile({ system, id, assignments, series, vents }: BuildInput): Profile {
  const get = (role: RoleKey) => (assignments[role] ? series[role] : undefined);
  const tf: Profile["measurements"]["tf"] = {};
  for (const role of Object.keys(assignments)) {
    const m = /^tf:([^:]+):(woof|mid|tw)$/.exec(role);
    const s = m && get(role);
    if (!m || !s) continue;
    (tf[m[1]] ??= {})[m[2] as UnitId] = s;
  }
  const missing = [
    ...UNITS.filter(u => !tf["0"]?.[u]).map(u => `the ${UNIT_NAME[u]} response at 0°`),
    ...(!get("zi:mid") ? ["the midrange impedance"] : []),
    ...(!get("zi:tw") ? ["the tweeter impedance"] : []),
    ...(!get("woofer:free") && !get("woofer:closed") ? ["a woofer impedance (free air or closed box)"] : []),
  ];
  if (missing.length) throw new Error(`Still missing: ${missing.join(", ")}.`);

  const vented: VentedMeasurement[] = [];
  for (const cfg of vents) {
    const z = get(`vent:${cfg.key}:z`);
    if (!z) continue;
    const nfCone = get(`vent:${cfg.key}:nf_cone`), nfVent = get(`vent:${cfg.key}:nf_vent`);
    vented.push({ vents: cfg.vents.map(v => ({ ...v })), z, ...(nfCone ? { nf_cone: nfCone } : {}), ...(nfVent ? { nf_vent: nfVent } : {}) });
  }
  const free = get("woofer:free"), closed = get("woofer:closed");
  const s = structuredClone(system);
  return {
    version: 1, id,
    name: s.name.trim() || "My system",
    ...(s.group?.trim() ? { group: s.group.trim() } : {}),
    ...(s.system?.trim() ? { system: s.system.trim() } : {}),
    ...(s.notes?.trim() ? { notes: s.notes.trim() } : {}),
    conditions: s.conditions, units: s.units, woofer_box: s.woofer_box, top_box: s.top_box,
    measurements: {
      tf,
      zi: { mid: get("zi:mid"), tw: get("zi:tw") },
      woofer: { ...(free ? { free } : {}), ...(closed ? { closed } : {}), vented },
    },
    components: s.components, limits: s.limits,
  };
}

// ---------------------------------------------------------------- estimates
const mag = (s: Series, i: number) => Math.hypot(s.re[i], s.im[i]);

/** Resonance from an impedance peak: the |Z| maximum in [lo, hi] Hz, refined by a parabola through the
 *  three points around it on a log-frequency axis. Null when the band holds no clear peak. */
export function estimateResonance(z: Series, lo = 300, hi = 8000): number | null {
  let k = -1;
  for (let i = 1; i < z.f.length - 1; i++)
    if (z.f[i] >= lo && z.f[i] <= hi && (k < 0 || mag(z, i) > mag(z, k))) k = i;
  if (k < 1 || k >= z.f.length - 1) return null;
  if (!(mag(z, k) >= mag(z, k - 1) && mag(z, k) >= mag(z, k + 1))) return null;
  const [x0, x1, x2] = [z.f[k - 1], z.f[k], z.f[k + 1]].map(Math.log);
  const [y0, y1, y2] = [mag(z, k - 1), mag(z, k), mag(z, k + 1)];
  const den = (x0 - x1) * (x0 - x2) * (x1 - x2);
  const a = (x2 * (y1 - y0) + x1 * (y0 - y2) + x0 * (y2 - y1)) / den;
  const b = (x2 * x2 * (y0 - y1) + x1 * x1 * (y2 - y0) + x0 * x0 * (y1 - y2)) / den;
  const x = a < 0 ? -b / (2 * a) : x1;
  return Math.exp(Math.min(Math.max(x, x0), x2));
}

/** Voice-coil resistance estimate: the smallest real part of the impedance in [lo, hi] Hz. */
export function estimateRe(z: Series, lo = 5, hi = 1000): number | null {
  let r = Infinity;
  for (let i = 0; i < z.f.length; i++) if (z.f[i] >= lo && z.f[i] <= hi && z.re[i] > 0) r = Math.min(r, z.re[i]);
  return Number.isFinite(r) ? r : null;
}

export interface PhaseRefEstimate {
  /** Best common compensation distance (m). */
  d: number;
  /** Cost against d on a 1 cm grid, for the preview. */
  grid: { d: Float64Array; cost: Float64Array };
  /** Best d of each unit on its own, to show how well they agree. */
  perUnit: Partial<Record<UnitId, number>>;
}

/** The Lab E procedure (plot_labE.m): the one distance d for all units that makes the phase smoothest,
 *  i.e. minimises sum |wrap(diff(angle(H) + 2 pi f d / c))| over 200 Hz - 15 kHz, searched over
 *  -10..10 m in 1 mm steps. The sign follows displayPhase: phase + 2 pi f d / c. */
export function estimatePhaseRef(tf: Partial<Record<UnitId, Series>>,
                                 opts: { fLo?: number; fHi?: number; c?: number; range?: number; step?: number } = {}): PhaseRefEstimate | null {
  const { fLo = 200, fHi = 15000, c = C_PHASE, range = 10, step = 0.001 } = opts;
  type Diffs = { dPhase: Float64Array; dF: Float64Array };
  const units: { u: UnitId; d: Diffs }[] = [];
  for (const u of UNITS) {
    const s = tf[u];
    if (!s) continue;
    const ph: number[] = [], f: number[] = [];
    for (let i = 0; i < s.f.length; i++) if (s.f[i] > fLo && s.f[i] < fHi) { ph.push(Math.atan2(s.im[i], s.re[i])); f.push(s.f[i]); }
    if (f.length < 3) continue;
    const n = f.length - 1, dPhase = new Float64Array(n), dF = new Float64Array(n);
    for (let i = 0; i < n; i++) { dPhase[i] = ph[i + 1] - ph[i]; dF[i] = 2 * Math.PI * (f[i + 1] - f[i]) / c; }
    units.push({ u, d: { dPhase, dF } });
  }
  if (!units.length) return null;
  const TAU = 2 * Math.PI;
  const costOf = (x: Diffs, d: number) => {
    let e = 0;
    for (let i = 0; i < x.dPhase.length; i++) { const v = x.dPhase[i] + x.dF[i] * d; e += Math.abs(v - TAU * Math.round(v / TAU)); }
    return e;
  };
  const steps = Math.round(2 * range / step);
  const scan = (pick: Diffs[]) => {
    let best = Infinity, bestD = 0;
    for (let j = 0; j <= steps; j++) {
      const d = -range + j * step;
      let e = 0;
      for (const x of pick) e += costOf(x, d);
      if (e < best - 1e-12) { best = e; bestD = d; }
    }
    return bestD;
  };
  const all = units.map(x => x.d);
  const d = scan(all);
  const perUnit: PhaseRefEstimate["perUnit"] = {};
  for (const x of units) perUnit[x.u] = scan([x.d]);
  const n = Math.round(2 * range / 0.01) + 1, gd = new Float64Array(n), gc = new Float64Array(n);
  for (let j = 0; j < n; j++) { gd[j] = -range + j * 0.01; gc[j] = all.reduce((e, x) => e + costOf(x, gd[j]), 0); }
  return { d: Math.round(d * 1000) / 1000, grid: { d: gd, cost: gc }, perUnit };
}

/** Phase in degrees (wrapped to ±180) after removing the delay over distance d. */
export function compensatedPhaseDeg(s: Series, d: number, c = C_PHASE): Float64Array {
  const out = new Float64Array(s.f.length);
  for (let i = 0; i < s.f.length; i++) {
    const p = Math.atan2(s.im[i], s.re[i]) + 2 * Math.PI * s.f[i] * d / c;
    out[i] = Math.atan2(Math.sin(p), Math.cos(p)) * 180 / Math.PI;
  }
  return out;
}

export function magnitudeDb(s: Series): Float64Array {
  return Float64Array.from(s.f, (_, i) => 20 * Math.log10(Math.max(mag(s, i), 1e-12)));
}
export function magnitude(s: Series): Float64Array {
  return Float64Array.from(s.f, (_, i) => mag(s, i));
}

// ---------------------------------------------------------------- sanity checks
export interface Warning { level: "warn" | "bad"; text: string }

const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[s.length >> 1] : NaN; };

/** Plain-language warnings about one series in a role: impedance range and sign, transfer-function units,
 *  frequency coverage. */
export function seriesWarnings(quantity: "tf" | "z" | "nf", s: Series, unit?: UnitId): Warning[] {
  const w: Warning[] = [];
  const n = s.f.length;
  if (n < 2) return [{ level: "bad", text: "fewer than two points" }];
  for (let i = 1; i < n; i++) if (!(s.f[i] > s.f[i - 1])) { w.push({ level: "bad", text: `frequency does not rise at point ${i + 1} (${s.f[i]} Hz)` }); break; }
  const m = Array.from({ length: n }, (_, i) => mag(s, i));
  if (quantity === "z") {
    const med = median(m);
    if (med < 1) w.push({ level: "bad", text: `|Z| is about ${med.toPrecision(2)} Ω: this looks like an admittance (1/Z) or a current, not an impedance` });
    else if (med < 2) w.push({ level: "warn", text: `|Z| is only about ${med.toFixed(1)} Ω: check the series resistor and the amplifier gain` });
    else if (med > 200) w.push({ level: "bad", text: `|Z| is about ${med.toFixed(0)} Ω: far above a loudspeaker; check the units and the series resistor` });
    const neg = s.re.filter((r, i) => r < 0 && s.f[i] > 10).length;
    if (neg > 0.1 * n) w.push({ level: "warn", text: `the real part is negative at ${Math.round(100 * neg / n)} % of the points: a passive driver cannot do that (swapped channels or polarity?)` });
    if (s.f[n - 1] < 5000 && unit !== "woof") w.push({ level: "warn", text: `the data stops at ${Math.round(s.f[n - 1])} Hz: the crossover needs it to about 20 kHz` });
  } else if (quantity === "tf") {
    const med = median(m);
    if (med > 50) w.push({ level: "bad", text: `|H| is about ${med.toFixed(0)}: these look like dB or a level, not p/V in Pa/V` });
    else if (med < 1e-5) w.push({ level: "warn", text: "the response is extremely small: check the microphone sensitivity (Pa/V)" });
    if (s.f[n - 1] < 10000 && unit !== "woof") w.push({ level: "warn", text: `the data stops at ${Math.round(s.f[n - 1])} Hz` });
    if (s.f[0] > 200) w.push({ level: "warn", text: `the data starts at ${Math.round(s.f[0])} Hz` });
  }
  return w;
}

/** Units of one angle should come from one run: different frequency grids suggest they did not. */
export function gridMismatch(series: Partial<Record<UnitId, Series>>): string | null {
  const have = UNITS.filter(u => series[u]);
  if (have.length < 2) return null;
  const ref = series[have[0]]!;
  for (const u of have.slice(1)) {
    const s = series[u]!;
    const same = s.f.length === ref.f.length && s.f.every((x, i) => Math.abs(x - ref.f[i]) <= 1e-6 * Math.max(1, Math.abs(x)));
    if (!same) return `The ${UNIT_NAME[have[0]]} and ${UNIT_NAME[u]} have different frequency grids, so they may come from different runs and their relative phase may not be valid.`;
  }
  return null;
}

/** Plain-language problems in the system description (step 3); empty when the draft can be used. */
export function systemProblems(s: DraftSystem): string[] {
  const p: string[] = [];
  const pos = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v > 0;
  for (const u of UNITS) {
    if (!s.units[u].label.trim()) p.push(`Name the ${UNIT_NAME[u]}.`);
    if (!pos(s.units[u].diameter_m)) p.push(`The ${UNIT_NAME[u]} needs an effective diameter.`);
  }
  if (!s.woofer_box.inner_m.every(pos)) p.push("The woofer box needs its inner width, height and depth.");
  if (!pos(s.woofer_box.wall_m)) p.push("The woofer box needs a wall thickness.");
  if (!s.woofer_box.vents.length) p.push("Describe at least one vent (its diameter), even if it was plugged.");
  s.woofer_box.vents.forEach(v => { if (!pos(v.diameter_m)) p.push(`Vent ${v.id} needs a diameter.`); });
  if (!s.top_box.outer_m.every(pos)) p.push("The top box needs its outer width, height and depth.");
  if (!(s.conditions.T_C > -30 && s.conditions.T_C < 60)) p.push("The temperature should be in °C, between -30 and 60.");
  const [a, b] = s.limits.wm, [c, d] = s.limits.mt;
  if (!(pos(a) && b > a)) p.push("The woofer/midrange crossover window needs a low and a higher high edge.");
  if (!(pos(c) && d > c)) p.push("The midrange/tweeter crossover window needs a low and a higher high edge.");
  if (b >= c) p.push("The woofer/midrange window must end below the midrange/tweeter window.");
  if (!pos(s.limits.tw_fs_hz)) p.push("Give the tweeter resonance frequency.");
  for (const k of ["L", "C", "R"] as const) if (!s.components[k].length) p.push(`The component list has no ${k} values.`);
  return p;
}
