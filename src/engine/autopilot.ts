// The autopilot ("Design it for me"): a whole design worked out in five recorded steps, each with a
// plain-language reason and the numbers that decided it, so a student can follow (and defend) it.
//
//   1. Box      every vent setting the profile allows (plugged, one vent, two vents, lengths near the
//               measured ones): the deepest f3 whose bass ripple and vent air speed meet the verdict's
//               targets.
//   2. Digital  every MiniDSP alignment, f_c across the woofer/midrange window and both woofer
//               polarities, with the woofer gain searched for each; the best of each alignment is judged.
//   3. Passive  every midrange and tweeter topology in the library, both polarities, its parts seeded
//               from the basket by the optimiser score (seedParts).
//   4. Polish   the coordinate-descent optimiser (runOptimise, a worker in the app) over every choice.
//   5. Finish   the verdict's tested suggestions (suggest), applied one at a time while they raise the score.
//
// Every step is judged by the verdict (assess) and is kept only if it does not lower the score, so the
// design after any step, and the result, are never worse than the starting design. Candidates within a
// stage are ranked by the verdict first and the optimiser score (lower = better) second.
//
// The runner is async and yields to the event loop every few tens of milliseconds, so the UI can show a
// live stepper and an AbortSignal can stop it between candidates.

import type { Align, Design } from "../types";
import { assess, suggest, TEST_POWER_W, type Assessment } from "./assess";
import { ALIGNMENTS } from "./digital";
import { TOPOLOGY_LIBRARY } from "./passive";
import { score as optScore, seedParts } from "./optimise";
import { boxModelCurves, compute, type Prepared } from "./system";
import { runOptimise } from "./index";

export type AutopilotStage = "box" | "digital" | "passive" | "polish" | "finish";

/** The stages in the order they run, with their stepper titles. */
export const AUTOPILOT_STAGES: { id: AutopilotStage; title: string }[] = [
  { id: "box", title: "Tune the box" },
  { id: "digital", title: "Set the MiniDSP crossover" },
  { id: "passive", title: "Choose the passive filters" },
  { id: "polish", title: "Polish with the optimiser" },
  { id: "finish", title: "Apply the tested suggestions" },
];

export interface AutopilotStep {
  stage: AutopilotStage;
  title: string;
  /** Whether this step changed the design. */
  changed: boolean;
  /** One or two plain sentences: what was chosen and why (or why the design was kept). */
  reason: string;
  /** The numbers that decided it, formatted with their units. */
  numbers: { label: string; value: string }[];
  /** The whole design after this step (every earlier step included). */
  design: Design;
  /** Verdict score after this step (0-100, rounded) and unrounded, for comparisons. */
  score: number;
  exact: number;
}

export interface AutopilotProgress {
  stage: AutopilotStage;
  /** 0-based index into AUTOPILOT_STAGES. */
  index: number;
  /** 0..1 within the stage. */
  fraction: number;
  /** Live line for the stepper: "Tuning the box… f3 38 Hz with a 160 mm vent". */
  message: string;
}

export interface AutopilotResult {
  before: { score: number; exact: number; rating: Assessment["rating"] };
  after: { score: number; exact: number; rating: Assessment["rating"] };
  steps: AutopilotStep[];
  /** The best design (the last step's); equal to the input when nothing improved. */
  design: Design;
  /** True when the result scores higher than the starting design. */
  improved: boolean;
  /** Wall time of the run. */
  ms: number;
}

export interface AutopilotOptions {
  signal?: AbortSignal;
  onProgress?(p: AutopilotProgress): void;
  /** Called as each stage finishes, with its recorded step. */
  onStep?(step: AutopilotStep): void;
  /** Optimiser rounds in the polish stage (default 3; 0 skips the stage). */
  polishRounds?: number;
}

// ---------------------------------------------------------------- small helpers
const fmtHz = (x: number) => (x >= 1000 ? `${(x / 1000).toFixed(2)} kHz` : `${x.toFixed(0)} Hz`);
const sdb = (x: number) => `${x > 0 ? "+" : x < 0 ? "−" : ""}${Math.abs(x).toFixed(1)} dB`;
const mm = (L: number) => `${(L * 1000).toFixed(0)} mm`;
const fmtPart = (kind: string, v: number) => kind === "L" ? `${+(v * 1e3).toPrecision(3)} mH` : kind === "C" ? `${+(v * 1e6).toPrecision(3)} µF` : `${+v.toPrecision(3)} Ω`;
const clone = (d: Design): Design => structuredClone(d);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** The verdict's weighted mean before rounding, 0-100: lets two designs with the same shown score be ranked. */
export function exactScore(a: Assessment): number {
  const cs = a.criteria.filter(c => c.weight > 0), w = cs.reduce((s, c) => s + c.weight, 0);
  return w ? 100 * cs.reduce((s, c) => s + c.weight * c.score, 0) / w : 0;
}

interface Judged { design: Design; a: Assessment; exact: number; opt: number }

function judge(p: Prepared, design: Design): Judged | null {
  try {
    const a = assess(p, design, compute(p, design));
    return { design, a, exact: exactScore(a), opt: optScore(p, design) };
  } catch { return null; }
}

/** Verdict first, then the optimiser score (lower is better). */
const better = (x: Judged, y: Judged) => x.exact > y.exact + 1e-6 || (Math.abs(x.exact - y.exact) <= 1e-6 && x.opt < y.opt - 1e-9);

const abortError = () => new DOMException("Autopilot cancelled", "AbortError");

/** Yield to the event loop every ~30 ms (and check the signal), so a long stage never freezes the UI. */
function makeTicker(signal?: AbortSignal) {
  let last = Date.now();
  return async (force = false) => {
    if (signal?.aborted) throw abortError();
    if (force || Date.now() - last > 30) {
      await new Promise(res => setTimeout(res, 0));
      last = Date.now();
      if (signal?.aborted) throw abortError();
    }
  };
}

// ---------------------------------------------------------------- stage 1: the box
interface BoxCand { design: Design; f3: number; ripple: number; vent: number; label: string; extrapolated: boolean }

/** Peak vent air speed at the test power (m/s), with the woofer gain, as the verdict's "Quiet vent". */
function ventSpeed(p: Prepared, d: Design): number {
  if (d.box.mode === "plugged") return 0;
  const bc = boxModelCurves(p, d);
  let v = 0;
  for (let i = 0; i < bc.f.length; i++) if (bc.f[i] >= 20) v = Math.max(v, bc.ventSpeed_ms[i]);
  return v * Math.sqrt(TEST_POWER_W * 8) / 2.83 * 10 ** (d.digital.g_woof_dB / 20);
}

function boxCandidates(p: Prepared, d0: Design): Design[] {
  const vents = p.profile.woofer_box.vents, out: Design[] = [];
  const put = (box: Partial<Design["box"]>) => { const d = clone(d0); d.box = { ...d.box, ...box }; out.push(d); };
  put({ mode: "plugged" });
  if (!vents.length) return out;
  const measured = (p.profile.measurements.woofer.vented ?? []).filter(m => m.vents.length === 1 && m.vents[0].id === vents[0].id).map(m => m.vents[0].length_m);
  // lengths near the measured ones (the fitted vent mass is interpolated there, extrapolated beyond)
  const span = (r: [number, number] | undefined): [number, number] => {
    const lo0 = r?.[0] ?? 0.05, hi0 = r?.[1] ?? 0.3;
    if (!measured.length) return [lo0, hi0];
    return [Math.max(lo0, Math.min(...measured) - 0.04), Math.min(hi0, Math.max(...measured) + 0.04)];
  };
  const steps = ([lo, hi]: [number, number], dL: number) => {
    const xs: number[] = [];
    for (let L = Math.ceil(lo / dL - 1e-9) * dL; L <= hi + 1e-9; L += dL) xs.push(Math.round(L * 1000) / 1000);
    return xs;
  };
  const A = span(vents[0].length_range_m);
  for (const L of new Set([...steps(A, 0.01), ...measured])) put({ mode: "one", L });
  if (vents.length > 1) {
    const B: [number, number] = [vents[1].length_range_m?.[0] ?? A[0], vents[1].length_range_m?.[1] ?? A[1]];
    for (const L of steps(A, 0.02)) for (const L2 of steps(B, 0.02)) put({ mode: "two", L, L2, a2: vents[1].diameter_m / 2 });
  }
  return out;
}

async function stageBox(p: Prepared, cur: Judged, tick: (f?: boolean) => Promise<void>, report: (fr: number, msg: string) => void): Promise<{ next: Judged; step: Omit<AutopilotStep, "design" | "score" | "exact"> }> {
  const vents = p.profile.woofer_box.vents;
  const measured = (p.profile.measurements.woofer.vented ?? []).map(m => m.vents[0]?.length_m).filter((x): x is number => x !== undefined);
  const near = (L: number) => !measured.length || measured.some(x => Math.abs(x - L) <= 0.0205);
  const cands: BoxCand[] = [];
  const all = boxCandidates(p, cur.design);
  for (let k = 0; k < all.length; k++) {
    const d = all[k];
    let r;
    try { r = compute(p, d); } catch { continue; }
    const c: BoxCand = { design: d, f3: r.box.f3, ripple: r.box.ripple, vent: ventSpeed(p, d), label: r.box.label,
                         extrapolated: d.box.mode !== "plugged" && !near(d.box.L) };
    cands.push(c);
    await tick();
    report(k / all.length, `Tuning the box… f3 ${c.f3.toFixed(0)} Hz with ${d.box.mode === "plugged" ? "the vents plugged" : d.box.mode === "one" ? `a ${mm(d.box.L)} vent` : `two vents (${mm(d.box.L)} + ${mm(d.box.L2)})`}`);
  }
  // the verdict's targets: ripple <= +1.5 dB ("Smooth bass") and air <= 10 m/s ("Quiet vent"); a design
  // that meets both is ranked by f3 (with 1 Hz in favour of a measured length and of one vent over
  // two, since the second vent's data is less certain), otherwise by how far it misses them
  const miss = (c: BoxCand) => Math.max(0, c.ripple - 1.5) + Math.max(0, c.vent - 10) / 4;
  const rank = (c: BoxCand) => (miss(c) > 0 ? 1000 + miss(c) * 100 + c.f3 / 100 : c.f3 + (c.extrapolated ? 1 : 0) + (c.design.box.mode === "two" ? 1 : 0));
  cands.sort((a, b) => rank(a) - rank(b));
  const pick = cands[0];
  const curR = compute(p, cur.design).box, curVent = ventSpeed(p, cur.design);
  const numbersFor = (f3: number, ripple: number, vent: number, label: string) => [
    { label: "Setting", value: label.replace(/^one vent, L = /, "one vent, ") },
    { label: "f3", value: `${f3.toFixed(1)} Hz` },
    { label: "Bass ripple", value: sdb(ripple) },
    { label: "Vent air", value: `${vent.toFixed(1)} m/s at ${TEST_POWER_W} W` },
  ];
  const title = AUTOPILOT_STAGES[0].title;
  if (!pick || !vents.length) {
    return { next: cur, step: { stage: "box", title, changed: false, numbers: numbersFor(curR.f3, curR.ripple, curVent, curR.label),
      reason: vents.length ? "No vent setting could be computed, so the box is kept as it is." : "This box has no vents: it is a closed box, so there is nothing to tune." } };
  }
  const j = judge(p, pick.design);
  const tried = `${cands.length} settings tried`;
  if (!j || same(pick.design.box, cur.design.box) || j.exact < cur.exact - 1e-6) {
    return { next: cur, step: { stage: "box", title, changed: false, numbers: [...numbersFor(curR.f3, curR.ripple, curVent, curR.label), { label: "Searched", value: tried }],
      reason: same(pick.design.box, cur.design.box)
        ? `The current box is already the best setting: the deepest bass (f3 ${curR.f3.toFixed(0)} Hz) that stays smooth.`
        : `The best box on its own (${pick.label}, f3 ${pick.f3.toFixed(0)} Hz) would lower the overall score, so the box is kept.` } };
  }
  const ok = miss(pick) === 0;
  const reason = ok
    ? `${cap(pick.label)} gives the deepest bass that stays smooth: f3 ${pick.f3.toFixed(0)} Hz with ${pick.ripple > 0.2 ? `a ${sdb(pick.ripple)} hump` : "no hump"} and ${pick.vent.toFixed(0)} m/s in the vent.`
      + (pick.f3 < curR.f3 - 0.5 ? ` That is ${(curR.f3 - pick.f3).toFixed(0)} Hz deeper than before.` : curR.ripple > 1.5 ? ` Before, the bass had a ${sdb(curR.ripple)} hump.` : "")
    : `No setting meets every bass target; ${pick.label} comes closest (ripple ${sdb(pick.ripple)}, vent ${pick.vent.toFixed(0)} m/s).`;
  return { next: j, step: { stage: "box", title, changed: true, reason, numbers: [...numbersFor(pick.f3, pick.ripple, pick.vent, pick.label), { label: "Searched", value: tried }] } };
}

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

// ---------------------------------------------------------------- stage 2: the MiniDSP
async function stageDigital(p: Prepared, cur: Judged, tick: (f?: boolean) => Promise<void>, report: (fr: number, msg: string) => void): Promise<{ next: Judged; step: Omit<AutopilotStep, "design" | "score" | "exact"> }> {
  const [lo, hi] = p.profile.limits.wm;
  // f_c on a 1/8-octave grid over the window (from a little below it: the acoustic crossover usually
  // lands above the electrical one, as the midrange rolls off on its own), on 5 Hz steps
  const fcs: number[] = [];
  for (let f = lo * 0.8; f <= hi * 1.001; f *= 2 ** (1 / 8)) {
    const x = Math.round(f / 5) * 5;
    if (x >= 100 && x <= 1000 && !fcs.includes(x)) fcs.push(x);
  }
  const g0 = cur.design.digital.g_woof_dB;
  const coarse = Array.from({ length: 7 }, (_, k) => -10 + 2 * k);
  const finalists: { align: Align; j: Judged }[] = [];
  const total = ALIGNMENTS.length * fcs.length * 2;
  let done = 0;
  for (const { key } of ALIGNMENTS) {
    let best: { d: Design; s: number } | null = null;
    for (const fc of fcs) for (const pol of [1, -1] as const) {
      const d = clone(cur.design);
      d.digital.align = key; d.digital.fc = fc; d.pol.woof = pol;
      const at = (g: number) => { d.digital.g_woof_dB = Math.round(g * 10) / 10; try { return optScore(p, d); } catch { return Infinity; } };
      // the gain: a coarse 2 dB grid (and the current gain), then ±1 and ±0.5 dB around the best
      let g = g0, s = at(g0);
      for (const x of coarse) { const v = at(x); if (v < s) { s = v; g = x; } }
      for (const dg of [1, 0.5]) for (const x of [g - dg, g + dg]) { const v = at(x); if (v < s) { s = v; g = x; } }
      d.digital.g_woof_dB = Math.round(g * 10) / 10;
      if (!best || s < best.s) best = { d, s };
      done++;
      await tick();
      report(done / total, `Setting the MiniDSP… ${key} at ${fmtHz(fc)}, woofer ${sdb(d.digital.g_woof_dB)}`);
    }
    const j = best && judge(p, best.d);
    if (j) finalists.push({ align: key, j });
  }
  const title = AUTOPILOT_STAGES[1].title;
  const setting = (d: Design) => `${fmtHz(d.digital.fc)}, woofer ${sdb(d.digital.g_woof_dB)}${d.pol.woof === -1 ? " and inverted" : ""}`;
  const desc = (d: Design) => `${d.digital.align} at ${setting(d)}`;
  const numbers = finalists.sort((a, b) => b.j.exact - a.j.exact).map(f => ({ label: f.align, value: `${setting(f.j.design)} · ${f.j.a.score}/100` }));
  const top = finalists[0]?.j;
  const sameDigital = (x: Design, y: Design) => JSON.stringify([x.digital, x.pol.woof]) === JSON.stringify([y.digital, y.pol.woof]);
  if (!top || !better(top, cur) || sameDigital(top.design, cur.design)) {
    return { next: cur, step: { stage: "digital", title, changed: false, numbers,
      reason: `Every alignment was tried across ${fmtHz(fcs[0])}–${fmtHz(fcs[fcs.length - 1])} with its best woofer gain; none beats the current ${desc(cur.design)}, so it is kept.` } };
  }
  const second = finalists[1];
  return { next: top, step: { stage: "digital", title, changed: true, numbers,
    reason: `${desc(top.design)} blends best with your drivers: it scores ${top.a.score}/100`
      + (second ? `, against ${second.j.a.score} for the best ${second.align}.` : ".")
      + ` The woofer gain matches its level to the midrange.` } };
}

// ---------------------------------------------------------------- stage 3: the passive branches
async function stagePassive(p: Prepared, cur: Judged, tick: (f?: boolean) => Promise<void>, report: (fr: number, msg: string) => void): Promise<{ next: Judged; step: Omit<AutopilotStep, "design" | "score" | "exact"> }> {
  const std = p.profile.components, numbers: AutopilotStep["numbers"] = [], said: string[] = [];
  let best = cur, changed = false, done = 0;
  const NAME = { mid: "midrange", tw: "tweeter" } as const;
  for (const unit of ["mid", "tw"] as const) {
    const type = unit === "mid" ? "LP" : "HP";
    const keys = Object.values(TOPOLOGY_LIBRARY).filter(t => t.type === type).sort((a, b) => a.order - b.order);
    const results: { key: string; j: Judged }[] = [];
    for (const t of keys) for (const pol of [1, -1] as const) {
      const d = clone(best.design), old = d[unit].vals;
      d.pol[unit] = pol;
      d[unit].topo = t.key;
      // carry the values of parts with the same name, start new ones from a part of the same kind
      const vals: Record<string, number> = {};
      for (const part of t.parts) {
        const list = part.kind === "L" ? std.L : part.kind === "C" ? std.C : std.R;
        vals[part.name] = old[part.name] ?? Object.entries(old).find(([n]) => n[0] === part.kind)?.[1] ?? list[Math.floor(list.length / 2)];
      }
      d[unit].vals = vals;
      try { d[unit].vals = seedParts(p, d, unit, t.parts.map(x => x.name)); } catch { /* keep the carried values */ }
      const j = judge(p, d);
      if (j) results.push({ key: t.key, j });
      done++;
      await tick(true);
      report(done / (2 * 6), `Choosing the ${NAME[unit]} filter… ${t.name}${pol === -1 ? ", inverted" : ""}: ${j ? `${j.a.score}/100` : "no result"}`);
    }
    // per topology the better polarity; ties go to the simpler filter (sorted by order)
    const perTopo = keys.map(t => results.filter(r => r.key === t.key).reduce<Judged | null>((x, r) => (!x || better(r.j, x) ? r.j : x), null));
    keys.forEach((t, i) => { const j = perTopo[i]; if (j) numbers.push({ label: `${unit === "mid" ? "Mid" : "Tweeter"} ${t.name}`, value: `${j.a.score}/100` }); });
    // a higher order (more parts) has to earn its place: a quarter of a point is not enough
    let pick: Judged | null = null;
    for (const j of perTopo) if (j && (!pick || j.exact > pick.exact + 0.25)) pick = j;
    if (pick && better(pick, best)) {
      const b = pick.design[unit], t = TOPOLOGY_LIBRARY[b.topo];
      said.push(`${cap(NAME[unit])}: ${t.name} (${t.parts.map(x => `${x.name} ${fmtPart(x.kind, b.vals[x.name])}`).join(", ")})${pick.design.pol[unit] === -1 ? ", wired inverted" : ""}`);
      best = pick; changed = true;
    } else {
      said.push(`${cap(NAME[unit])}: the current ${TOPOLOGY_LIBRARY[best.design[unit].topo].name.toLowerCase()} filter stays`);
    }
  }
  const title = AUTOPILOT_STAGES[2].title;
  return { next: best, step: { stage: "passive", title, changed, numbers,
    reason: `Each filter order was tried with both polarities and its parts picked from the basket. ${said.join("; ")}.` } };
}

// ---------------------------------------------------------------- the runner
export async function runAutopilot(p: Prepared, design: Design, opts: AutopilotOptions = {}): Promise<AutopilotResult> {
  const t0 = Date.now(), { signal } = opts, tick = makeTicker(signal);
  const start = judge(p, clone(design));
  if (!start) throw new Error("The current design could not be computed, so the autopilot cannot start from it.");
  const steps: AutopilotStep[] = [];
  let cur = start;
  const record = (s: Omit<AutopilotStep, "design" | "score" | "exact">, next: Judged) => {
    // the guarantee: a step never lowers the verdict (a stage that would is recorded as kept)
    if (next.exact < cur.exact - 1e-6) { next = cur; s = { ...s, changed: false, reason: s.reason + " It would lower the score, so it was not kept." }; }
    cur = next;
    const step: AutopilotStep = { ...s, design: clone(cur.design), score: cur.a.score, exact: cur.exact };
    steps.push(step);
    opts.onStep?.(step);
  };
  const reporter = (index: number) => (fraction: number, message: string) =>
    opts.onProgress?.({ stage: AUTOPILOT_STAGES[index].id, index, fraction: Math.min(1, fraction), message });

  reporter(0)(0, "Tuning the box…");
  await tick(true);
  { const r = await stageBox(p, cur, tick, reporter(0)); record(r.step, r.next); }
  reporter(1)(0, "Setting the MiniDSP…");
  { const r = await stageDigital(p, cur, tick, reporter(1)); record(r.step, r.next); }
  reporter(2)(0, "Choosing the passive filters…");
  { const r = await stagePassive(p, cur, tick, reporter(2)); record(r.step, r.next); }

  // ---- 4: the optimiser
  const rounds = opts.polishRounds ?? 3, title4 = AUTOPILOT_STAGES[3].title;
  if (rounds > 0) {
    reporter(3)(0, "Polishing with the optimiser…");
    const before = cur.opt;
    const res = await runOptimise(p.profile, p.fit, clone(cur.design), {
      rounds, signal,
      onProgress: st => reporter(3)(st.progress, `Polishing with the optimiser… score ${st.score.toFixed(2)} (lower is better)`),
    });
    const j = judge(p, res.design);
    const nums = [{ label: "Optimiser score", value: `${before.toFixed(2)} → ${res.score.toFixed(2)}` }];
    if (j && better(j, cur) && !same(j.design, cur.design)) {
      record({ stage: "polish", title: title4, changed: true, numbers: [...nums, { label: "Verdict", value: `${cur.a.score} → ${j.a.score}/100` }],
        reason: `A search over every part value, the gain and fc found ${describeChanges(cur.design, j.design) || "small changes"} that score better.` }, j);
    } else {
      record({ stage: "polish", title: title4, changed: false, numbers: nums,
        reason: j && res.score < before - 1e-6 ? "The optimiser found a design it rates better, but the verdict does not, so the design is kept." : "The optimiser found nothing better: every part is already at its best stock value." }, cur);
    }
  } else {
    record({ stage: "polish", title: title4, changed: false, numbers: [], reason: "Skipped." }, cur);
  }
  await tick(true);

  // ---- 5: the verdict's own tested suggestions
  reporter(4)(0, "Testing small changes…");
  const applied: string[] = [];
  let fin = cur;
  for (let k = 0; k < 4; k++) {
    await tick(true);
    let list;
    try { list = suggest(p, fin.design, fin.a, 3); } catch { break; }
    const s = list[0];
    if (!s || s.gain < 1) break;
    const j = judge(p, s.design);
    if (!j || !better(j, fin)) break;
    applied.push(`${s.label} (+${s.gain})`);
    fin = j;
    reporter(4)((k + 1) / 4, `Testing small changes… ${s.label}`);
  }
  record({ stage: "finish", title: AUTOPILOT_STAGES[4].title, changed: applied.length > 0,
    numbers: applied.map((x, i) => ({ label: `Change ${i + 1}`, value: x })),
    reason: applied.length ? `The verdict tested every single small change; ${applied.length === 1 ? "one raised" : `${applied.length} in turn raised`} the score.`
      : "No single small change raises the score any further." }, fin);

  const end = cur;
  const improved = end.exact > start.exact + 1e-6 && !same(end.design, start.design);
  return {
    before: { score: start.a.score, exact: start.exact, rating: start.a.rating },
    after: { score: end.a.score, exact: end.exact, rating: end.a.rating },
    steps, design: improved ? clone(end.design) : clone(design), improved, ms: Date.now() - t0,
  };
}

/** The changes between two designs in words ("tweeter C1 5.6 → 4.7 µF, woofer gain −4.5 → −4.0 dB"). */
export function describeChanges(a: Design, b: Design): string {
  const out: string[] = [];
  if (a.digital.fc !== b.digital.fc) out.push(`fc ${fmtHz(a.digital.fc)} → ${fmtHz(b.digital.fc)}`);
  if (a.digital.align !== b.digital.align) out.push(`${a.digital.align} → ${b.digital.align}`);
  if (a.digital.g_woof_dB !== b.digital.g_woof_dB) out.push(`woofer gain ${sdb(a.digital.g_woof_dB)} → ${sdb(b.digital.g_woof_dB)}`);
  for (const u of ["mid", "tw"] as const) {
    const n = u === "mid" ? "midrange" : "tweeter";
    if (a[u].topo !== b[u].topo) out.push(`${n} ${a[u].topo} → ${b[u].topo}`);
    for (const [k, v] of Object.entries(b[u].vals)) if (a[u].vals[k] !== undefined && a[u].vals[k] !== v) out.push(`${n} ${k} ${fmtPart(k[0], a[u].vals[k])} → ${fmtPart(k[0], v)}`);
    for (const k of ["Rs", "Rp"] as const) {
      const x = a[u].pad?.[k] || null, y = b[u].pad?.[k] || null;
      if (x !== y) out.push(`${n} ${k} ${x ? fmtPart("R", x) : "none"} → ${y ? fmtPart("R", y) : "none"}`);
    }
  }
  for (const u of ["woof", "mid", "tw"] as const) if (a.pol[u] !== b.pol[u]) out.push(`${u === "woof" ? "woofer" : u === "mid" ? "midrange" : "tweeter"} ${b.pol[u] === -1 ? "inverted" : "back to normal polarity"}`);
  if (JSON.stringify(a.box) !== JSON.stringify(b.box)) out.push("the box");
  return out.join(", ");
}
