// The AI chat's tools: everything the model may ask the app to compute, run locally on the app's own
// engine. The model never sees raw curves, only these answers, and it can only *propose* a design:
// applying one is the user's click (one undo step). Definitions are OpenAI-style function schemas,
// which OpenRouter passes on to every model that supports tools.
//
// A design change is a small JSON patch (DesignChange) in the units the inspector shows: L in mH,
// C in µF, R in Ω, lengths in mm. Part values are snapped to the nearest value in the profile's parts
// basket, and every snap or clamp is reported back so the model can say what it actually tried.

import type { Align, CheckState, Design, PassiveBranch, Profile, Results, UnitId } from "../types";
import { UNIT_IDS } from "../types";
import { assess, compute, displayPhase, nearestIndex, probeSample, seedParts, suggest, TOPOLOGY_LIBRARY, type Assessment } from "../engine";
import type { ViewId } from "../state/store";
import { partDisplay, sig, type ChatEnv } from "./context";
import { VIEW_INFO } from "./views";

// ---------------------------------------------------------------- the patch schema
export interface BranchChange {
  topology?: string;
  /** Part name → value, L in mH, C in µF. */
  parts?: Record<string, number>;
  /** L-pad resistors in Ω; null or 0 removes one. */
  Rs?: number | null;
  Rp?: number | null;
  /** Zobel across the driver; null removes it. */
  zobel?: { R: number; C_uF: number } | null;
}

export interface DesignChange {
  mid?: BranchChange;
  tw?: BranchChange;
  polarity?: Partial<Record<UnitId, 1 | -1>>;
  fc_hz?: number;
  alignment?: Align;
  woofer_gain_db?: number;
  box_mode?: "plugged" | "one" | "two";
  vent_mm?: number;
  vent2_mm?: number;
  fill?: number;
}

export interface PatchResult {
  design: Design;
  /** What was adjusted on the way (snapped to stock, clamped to a range), in words. */
  notes: string[];
  /** What could not be applied (unknown part, wrong topology); the rest of the change still is. */
  errors: string[];
}

const ALIGNS: Align[] = ["BW2", "LR2", "LR4", "BW4"];
const UNIT_FACTOR = { L: 1e-3, C: 1e-6, R: 1 } as const;
const UNIT_TEXT = { L: "mH", C: "µF", R: "Ω" } as const;
const finite = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/** The basket value nearest to v (log distance, so 1.1 mH is nearer 1.0 than 1.5). */
export function snapToStock(list: number[], v: number): number {
  let best = list[0], bd = Infinity;
  for (const x of list) { const d = Math.abs(Math.log(x / v)); if (d < bd) { bd = d; best = x; } }
  return best;
}

/** Applies a change to a copy of `design`. Pure and deterministic: the same inputs give the same design. */
export function applyChange(prep: ChatEnv["prep"], design: Design, change: DesignChange): PatchResult {
  const P: Profile = prep.profile, stock = P.components;
  const d: Design = structuredClone(design);
  const notes: string[] = [], errors: string[] = [];
  if (!change || typeof change !== "object") return { design: d, notes, errors: ["The change must be a JSON object."] };

  const snap = (kind: "L" | "C" | "R", v: unknown, what: string): number | null => {
    if (!finite(v) || v <= 0) { errors.push(`${what}: needs a positive number in ${UNIT_TEXT[kind]}.`); return null; }
    const si = v * UNIT_FACTOR[kind], s = snapToStock(stock[kind], si);
    if (Math.abs(s / si - 1) > 0.005) notes.push(`${what} ${sig(v)} ${UNIT_TEXT[kind]} is not in the basket: used ${partDisplay(kind, s)} ${UNIT_TEXT[kind]}.`);
    return s;
  };

  // ---- passive branches
  for (const unit of ["mid", "tw"] as const) {
    const c = change[unit];
    if (!c) continue;
    const name = unit === "mid" ? "Midrange" : "Tweeter", type = unit === "mid" ? "LP" : "HP";
    const b: PassiveBranch = d[unit];
    if (c.topology !== undefined && c.topology !== b.topo) {
      const t = TOPOLOGY_LIBRARY[c.topology];
      if (!t || t.type !== type) errors.push(`${name} topology "${c.topology}" does not exist (use ${Object.keys(TOPOLOGY_LIBRARY).filter(k => TOPOLOGY_LIBRARY[k].type === type).join(", ")}).`);
      else {
        // carry values by name; parts the new topology adds are tuned on the spot (as the inspector does)
        const vals: Record<string, number> = {}, fresh: string[] = [];
        for (const p of t.parts) {
          if (b.vals[p.name] !== undefined) vals[p.name] = b.vals[p.name];
          else {
            const same = Object.entries(b.vals).find(([k]) => k[0] === p.kind);
            vals[p.name] = same ? same[1] : stock[p.kind][Math.floor(stock[p.kind].length / 2)];
            if (!c.parts || c.parts[p.name] === undefined) fresh.push(p.name);
          }
        }
        b.topo = c.topology; b.vals = vals;
        if (fresh.length) {
          try { b.vals = seedParts(prep, d, unit, fresh); notes.push(`${name} ${fresh.join(", ")} chosen by the app for the new ${t.name} filter.`); }
          catch { /* keep the carried values */ }
        }
      }
    }
    if (c.parts) for (const [part, v] of Object.entries(c.parts)) {
      const tp = TOPOLOGY_LIBRARY[b.topo].parts.find(p => p.name === part);
      if (!tp) { errors.push(`${name} ${b.topo} has no part "${part}" (it has ${TOPOLOGY_LIBRARY[b.topo].parts.map(p => p.name).join(", ")}).`); continue; }
      const s = snap(tp.kind, v, `${name} ${part}`);
      if (s !== null) b.vals[part] = s;
    }
    for (const k of ["Rs", "Rp"] as const) {
      if (!(k in c)) continue;
      const v = c[k];
      const pad = { ...(b.pad ?? {}) };
      if (v === null || v === 0) { if (k === "Rp") pad.Rp = null; else delete pad.Rs; }
      else { const s = snap("R", v, `${name} ${k}`); if (s !== null) pad[k] = s; }
      b.pad = pad;
    }
    if ("zobel" in c) {
      if (!c.zobel) b.zobel = null;
      else {
        const R = snap("R", c.zobel.R, `${name} Zobel R`), C = snap("C", c.zobel.C_uF, `${name} Zobel C`);
        if (R !== null && C !== null) b.zobel = { R, C };
      }
    }
  }

  // ---- polarity, digital
  if (change.polarity) for (const [u, v] of Object.entries(change.polarity)) {
    if (!UNIT_IDS.includes(u as UnitId)) errors.push(`polarity: unknown unit "${u}" (use woof, mid, tw).`);
    else if (v !== 1 && v !== -1) errors.push(`polarity.${u}: use 1 (normal) or -1 (inverted).`);
    else d.pol[u as UnitId] = v;
  }
  if (change.fc_hz !== undefined) {
    if (!finite(change.fc_hz)) errors.push("fc_hz: needs a number.");
    else { const v = clamp(Math.round(change.fc_hz), 100, 1000); if (v !== change.fc_hz) notes.push(`fc ${change.fc_hz} Hz: used ${v} Hz (100 Hz–1 kHz, whole Hz).`); d.digital.fc = v; }
  }
  if (change.alignment !== undefined) {
    if (!ALIGNS.includes(change.alignment)) errors.push(`alignment "${change.alignment}": use ${ALIGNS.join(", ")}.`);
    else d.digital.align = change.alignment;
  }
  if (change.woofer_gain_db !== undefined) {
    if (!finite(change.woofer_gain_db)) errors.push("woofer_gain_db: needs a number.");
    else { const v = clamp(Math.round(change.woofer_gain_db * 10) / 10, -12, 6); if (v !== change.woofer_gain_db) notes.push(`woofer gain ${change.woofer_gain_db} dB: used ${v} dB (−12…+6 dB, 0.1 dB steps).`); d.digital.g_woof_dB = v; }
  }

  // ---- box
  const vents = P.woofer_box.vents;
  if (change.box_mode !== undefined) {
    const ok = change.box_mode === "plugged" || (change.box_mode === "one" && vents.length >= 1) || (change.box_mode === "two" && vents.length >= 2);
    if (!ok) errors.push(`box_mode "${change.box_mode}": this box has ${vents.length} vent(s).`);
    else d.box.mode = change.box_mode;
  }
  const length = (v: unknown, i: 0 | 1, what: string): number | null => {
    if (!finite(v)) { errors.push(`${what}: needs a length in mm.`); return null; }
    const r = vents[i]?.length_range_m ?? vents[0]?.length_range_m ?? [0.05, 0.35];
    const m = clamp(Math.round(v) / 1000, r[0], r[1]);
    if (Math.abs(m * 1000 - v) > 0.5) notes.push(`${what} ${v} mm: used ${Math.round(m * 1000)} mm (the vent's range is ${Math.round(r[0] * 1000)}–${Math.round(r[1] * 1000)} mm).`);
    return m;
  };
  if (change.vent_mm !== undefined) { const m = length(change.vent_mm, 0, "vent length"); if (m !== null) d.box.L = m; }
  if (change.vent2_mm !== undefined) { const m = length(change.vent2_mm, 1, "second vent length"); if (m !== null) d.box.L2 = m; }
  if (change.fill !== undefined) {
    if (!finite(change.fill)) errors.push("fill: needs a number.");
    else { const v = clamp(Math.round(change.fill * 100) / 100, 1, 1.5); if (v !== change.fill) notes.push(`fill ${change.fill}: used ${v} (1.0 empty … 1.5).`); d.box.fill = v; }
  }
  return { design: d, notes, errors };
}

// ---------------------------------------------------------------- evaluation
export interface Evaluation {
  score_before: number;
  score_after: number;
  rating_after: string;
  /** Criteria whose state or score moved, before → after; points is the criterion's own 0–100 score change. */
  changed: { id: string; title: string; before: { state: CheckState; value: string }; after: { state: CheckState; value: string }; points: number }[];
  metrics_before: ReturnType<typeof keyMetrics>;
  metrics_after: ReturnType<typeof keyMetrics>;
  notes: string[];
  errors: string[];
  /** The same change as the inspector would read it, for the proposal card. */
  summary: string[];
}

function keyMetrics(r: Results) {
  const m = r.metrics;
  return {
    spread_db: sig(m.on.spread, 2), ...(m.off30 ? { off_axis_spread_db: sig(m.off30.spread, 2) } : {}),
    x_wm_hz: m.x_wm === null ? null : sig(m.x_wm), x_mt_hz: m.x_mt === null ? null : sig(m.x_mt),
    min_load_ohm: sig(m.Zamp2_min), f3_hz: sig(r.box.f3), bass_ripple_db: sig(r.box.ripple, 2),
  };
}

/** What differs between two designs, in the inspector's words ("Tweeter Rs 4.7 → 3.3 Ω"). */
export function describeDiff(a: Design, b: Design): string[] {
  const out: string[] = [];
  const fmt = (kind: string, v: number | null | undefined) => (v ? `${partDisplay(kind, v)} ${UNIT_TEXT[kind as "L"] ?? ""}`.trim() : "none");
  for (const unit of ["mid", "tw"] as const) {
    const name = unit === "mid" ? "Midrange" : "Tweeter", x = a[unit], y = b[unit];
    if (x.topo !== y.topo) out.push(`${name} filter ${x.topo} → ${y.topo}`);
    for (const k of new Set([...Object.keys(x.vals), ...Object.keys(y.vals)]))
      if (x.vals[k] !== y.vals[k]) out.push(`${name} ${k} ${fmt(k[0], x.vals[k])} → ${fmt(k[0], y.vals[k])}`);
    for (const k of ["Rs", "Rp"] as const)
      if ((x.pad?.[k] || null) !== (y.pad?.[k] || null)) out.push(`${name} ${k} ${fmt("R", x.pad?.[k])} → ${fmt("R", y.pad?.[k])}`);
    if (JSON.stringify(x.zobel ?? null) !== JSON.stringify(y.zobel ?? null))
      out.push(y.zobel ? `${name} Zobel ${fmt("R", y.zobel.R)} + ${fmt("C", y.zobel.C)}` : `Remove the ${name.toLowerCase()} Zobel`);
  }
  for (const u of UNIT_IDS) if (a.pol[u] !== b.pol[u]) out.push(`${{ woof: "Woofer", mid: "Midrange", tw: "Tweeter" }[u]} ${b.pol[u] === -1 ? "inverted" : "normal polarity"}`);
  if (a.digital.fc !== b.digital.fc) out.push(`Crossover ${a.digital.fc} → ${b.digital.fc} Hz`);
  if (a.digital.align !== b.digital.align) out.push(`Alignment ${a.digital.align} → ${b.digital.align}`);
  if (a.digital.g_woof_dB !== b.digital.g_woof_dB) out.push(`Woofer gain ${a.digital.g_woof_dB} → ${b.digital.g_woof_dB} dB`);
  if (a.box.mode !== b.box.mode) out.push(`Box ${a.box.mode} → ${b.box.mode}`);
  if (a.box.L !== b.box.L) out.push(`Vent ${Math.round(a.box.L * 1000)} → ${Math.round(b.box.L * 1000)} mm`);
  if (a.box.L2 !== b.box.L2 && b.box.mode === "two") out.push(`Second vent ${Math.round(a.box.L2 * 1000)} → ${Math.round(b.box.L2 * 1000)} mm`);
  if (a.box.fill !== b.box.fill) out.push(`Filling ${a.box.fill} → ${b.box.fill}`);
  return out;
}

/** Applies a change to a copy and scores it against the current design. Nothing in the app changes. */
export function evaluateChange(env: ChatEnv, change: DesignChange, base?: Assessment): Evaluation & { design: Design } {
  const before = base ?? assess(env.prep, env.design, env.results);
  const patch = applyChange(env.prep, env.design, change);
  let after: Assessment, r: Results;
  try { r = compute(env.prep, patch.design); after = assess(env.prep, patch.design, r); }
  catch (e) { throw new Error(`That design does not compute: ${e instanceof Error ? e.message : String(e)}`); }
  const changed = after.criteria.flatMap(c => {
    const o = before.criteria.find(x => x.id === c.id);
    if (!o) return [];
    const points = Math.round((c.score - o.score) * 100);
    return o.state !== c.state || Math.abs(points) >= 2
      ? [{ id: c.id, title: c.title, before: { state: o.state, value: o.value }, after: { state: c.state, value: c.value }, points }] : [];
  });
  return {
    design: patch.design,
    score_before: Math.round(before.score * 10) / 10, score_after: Math.round(after.score * 10) / 10, rating_after: after.rating,
    changed, metrics_before: keyMetrics(env.results), metrics_after: keyMetrics(r),
    notes: patch.notes, errors: patch.errors, summary: describeDiff(env.design, patch.design),
  };
}

// ---------------------------------------------------------------- read-only tools
const deg = (rad: number) => Math.round(rad * 180 / Math.PI);
const wrapDeg = (x: number) => Math.round(((x + 540) % 360) - 180);

export function probeTool(env: ChatEnv, freq: number, angle = "0") {
  if (!finite(freq) || freq < 10 || freq > 40000) throw new Error("freq_hz must be a frequency in Hz (20–20000).");
  const a = env.results.angles[angle] ? angle : "0";
  const s = probeSample(env.prep, env.results, freq, a), out = env.results.angles[a];
  const unit = (u: UnitId | "sum") => ({ level_db: sig(s.units[u].levelDb), rel_db: sig(s.units[u].relDb, 2), phase_deg: deg(s.units[u].phaseRad) });
  const ph = (u: UnitId) => displayPhase(env.prep, out[u], s.i) * 180 / Math.PI;
  return {
    freq_hz: sig(s.f), angle_deg: Number(a),
    note: "level_db is dB re 1 Pa/V at the measurement distance; rel_db is relative to the system's on-axis level.",
    woof: unit("woof"), mid: unit("mid"), tw: unit("tw"), sum: unit("sum"),
    phase_difference_deg: { mid_minus_woof: wrapDeg(ph("mid") - ph("woof")), tw_minus_mid: wrapDeg(ph("tw") - ph("mid")) },
  };
}

export function bandTool(env: ChatEnv, lo: number, hi: number, angle = "0") {
  if (!finite(lo) || !finite(hi) || lo <= 0 || hi <= lo) throw new Error("Give lo_hz < hi_hz, both in Hz.");
  const a = env.results.angles[angle] ? angle : "0", out = env.results.angles[a], f = env.results.f;
  const ref = env.results.metrics.on.level;
  let i0 = nearestIndex(f, lo), i1 = nearestIndex(f, hi);
  if (i1 < i0) [i0, i1] = [i1, i0];
  const stats = (z: { re: Float64Array; im: Float64Array }) => {
    let min = Infinity, max = -Infinity, sum = 0, fmin = 0, fmax = 0;
    for (let i = i0; i <= i1; i++) {
      const db = 10 * Math.log10(z.re[i] ** 2 + z.im[i] ** 2 + 1e-30) - ref;
      if (db < min) { min = db; fmin = f[i]; }
      if (db > max) { max = db; fmax = f[i]; }
      sum += db;
    }
    return { min_db: sig(min, 2), min_at_hz: sig(fmin), max_db: sig(max, 2), max_at_hz: sig(fmax), mean_db: sig(sum / (i1 - i0 + 1), 2) };
  };
  return {
    band_hz: [sig(f[i0]), sig(f[i1])], angle_deg: Number(a), points: i1 - i0 + 1,
    note: "dB relative to the system's on-axis level, unsmoothed (the verdict judges the 1/6-octave smoothed sum).",
    woof: stats(out.woof), mid: stats(out.mid), tw: stats(out.tw), sum: stats(out.sum),
  };
}

// ---------------------------------------------------------------- definitions for the model
const branchSchema = (type: "LP" | "HP") => ({
  type: "object",
  properties: {
    topology: { type: "string", enum: Object.keys(TOPOLOGY_LIBRARY).filter(k => TOPOLOGY_LIBRARY[k].type === type) },
    parts: { type: "object", description: `Part name → value. Names: ${Object.keys(TOPOLOGY_LIBRARY).filter(k => TOPOLOGY_LIBRARY[k].type === type).map(k => `${k}: ${TOPOLOGY_LIBRARY[k].parts.map(p => p.name).join("+")}`).join("; ")}. L in mH, C in µF.`, additionalProperties: { type: "number" } },
    Rs: { type: ["number", "null"], description: "L-pad series resistor, Ω (null removes it)" },
    Rp: { type: ["number", "null"], description: "L-pad parallel resistor, Ω (null removes it)" },
    zobel: { type: ["object", "null"], properties: { R: { type: "number", description: "Ω" }, C_uF: { type: "number", description: "µF" } } },
  },
  additionalProperties: false,
});

const changeSchema = {
  type: "object",
  description: "Only the fields to change. Part values snap to the nearest value in the course parts basket.",
  properties: {
    mid: branchSchema("LP"),
    tw: branchSchema("HP"),
    polarity: { type: "object", properties: Object.fromEntries(UNIT_IDS.map(u => [u, { type: "integer", enum: [1, -1] }])) },
    fc_hz: { type: "number", description: "MiniDSP crossover frequency, 100–1000 Hz" },
    alignment: { type: "string", enum: ALIGNS },
    woofer_gain_db: { type: "number", description: "MiniDSP woofer gain, −12…+6 dB" },
    box_mode: { type: "string", enum: ["plugged", "one", "two"] },
    vent_mm: { type: "number", description: "vent A length, mm" },
    vent2_mm: { type: "number", description: "vent B length, mm (box_mode two)" },
    fill: { type: "number", description: "box filling factor, 1.0 (empty) … 1.5" },
  },
  additionalProperties: false,
};

const angleProp = { type: "string", description: "measurement angle in degrees, e.g. \"0\" (default) or \"30\"" };

export const TOOL_DEFS = [
  { type: "function", function: { name: "probe", description: "Level (dB) and phase of each unit and of the sum at one frequency, from the app's engine, plus the phase difference between neighbouring units.",
    parameters: { type: "object", properties: { freq_hz: { type: "number" }, angle: angleProp }, required: ["freq_hz"] } } },
  { type: "function", function: { name: "response_band", description: "Min, max (with their frequencies) and mean level of each unit and the sum in a frequency band.",
    parameters: { type: "object", properties: { lo_hz: { type: "number" }, hi_hz: { type: "number" }, angle: angleProp }, required: ["lo_hz", "hi_hz"] } } },
  { type: "function", function: { name: "suggest_changes", description: "The app's own tested one-step improvements (a part one basket value up or down, polarity, gain, fc, vent), best first, with the score each gives.",
    parameters: { type: "object", properties: {} } } },
  { type: "function", function: { name: "try_change", description: "Apply a design change to a copy, recompute, and return the score and the criteria that change. Nothing changes in the app.",
    parameters: { type: "object", properties: { changes: changeSchema }, required: ["changes"] } } },
  { type: "function", function: { name: "propose_change", description: "Show the user a card with this change, its before/after score and an Apply button. Use after try_change confirmed it helps. The user decides.",
    parameters: { type: "object", properties: { changes: changeSchema, why: { type: "string", description: "one sentence: what it fixes" } }, required: ["changes", "why"] } } },
  { type: "function", function: { name: "show", description: "Switch the app to a view (and optionally move the probe) so the user sees what you are talking about.",
    parameters: { type: "object", properties: { view: { type: "string", enum: Object.keys(VIEW_INFO) }, freq_hz: { type: "number" } }, required: ["view"] } } },
] as const;

export type ToolName = (typeof TOOL_DEFS)[number]["function"]["name"];

/** A proposal card's data (the chat panel renders it). */
export interface Proposal { id: string; why: string; design: Design; base: Design; evaluation: Evaluation }

/** The side effects a tool may have, supplied by the panel (tests pass fakes). */
export interface ToolHooks {
  show(view: ViewId, freq?: number): void;
  propose(p: Omit<Proposal, "id">): void;
}

/** A short label for the activity line under a message ("Checked 2 kHz"). */
export function toolLabel(name: string, args: Record<string, any>): string {
  const hz = (x: unknown) => (finite(x) ? (x >= 1000 ? `${sig(x / 1000, 3)} kHz` : `${Math.round(x)} Hz`) : "?");
  switch (name) {
    case "probe": return `Checked ${hz(args.freq_hz)}${args.angle && args.angle !== "0" ? ` at ${args.angle}°` : ""}`;
    case "response_band": return `Read ${hz(args.lo_hz)}–${hz(args.hi_hz)}`;
    case "suggest_changes": return "Asked the app for tested fixes";
    case "try_change": return "Tried a change";
    case "propose_change": return "Proposed a change";
    case "show": return `Opened ${args.view ?? "a view"}${finite(args.freq_hz) ? ` at ${hz(args.freq_hz)}` : ""}`;
    default: return name;
  }
}

/** Runs one tool call and returns its JSON answer. Errors come back as {error} for the model to read. */
export function executeTool(env: ChatEnv, name: string, argsJson: string, hooks: ToolHooks): string {
  let args: Record<string, any>;
  try { args = argsJson.trim() ? JSON.parse(argsJson) : {}; }
  catch { return JSON.stringify({ error: "The arguments were not valid JSON." }); }
  try {
    switch (name) {
      case "probe": return JSON.stringify(probeTool(env, Number(args.freq_hz), String(args.angle ?? "0")));
      case "response_band": return JSON.stringify(bandTool(env, Number(args.lo_hz), Number(args.hi_hz), String(args.angle ?? "0")));
      case "suggest_changes": {
        const base = assess(env.prep, env.design, env.results);
        const list = suggest(env.prep, env.design, base, 6);
        return JSON.stringify({ score_now: Math.round(base.score * 10) / 10, suggestions: list.map(s => ({ change: s.label, score: Math.round(s.score * 10) / 10, gain: Math.round(s.gain * 10) / 10, effects: s.effects })) });
      }
      case "try_change": {
        const { design: _d, summary: _s, ...ev } = evaluateChange(env, args.changes as DesignChange);
        return JSON.stringify(ev);
      }
      case "propose_change": {
        const ev = evaluateChange(env, args.changes as DesignChange);
        if (!ev.summary.length) return JSON.stringify({ error: "That change leaves the design as it is: nothing to propose.", notes: ev.notes, errors: ev.errors });
        const { design, ...evaluation } = ev;
        hooks.propose({ why: String(args.why ?? ""), design, base: env.design, evaluation });
        return JSON.stringify({ shown: true, note: "The user sees a card with Apply and Dismiss; do not assume it was applied.",
                                score_before: ev.score_before, score_after: ev.score_after, notes: ev.notes, errors: ev.errors });
      }
      case "show": {
        const view = String(args.view) as ViewId;
        if (!(view in VIEW_INFO)) return JSON.stringify({ error: `Unknown view "${args.view}".` });
        const f = finite(args.freq_hz) ? clamp(args.freq_hz, 20, 20000) : undefined;
        hooks.show(view, f);
        return JSON.stringify({ shown: view, ...(f ? { probe_hz: sig(f) } : {}) });
      }
      default: return JSON.stringify({ error: `Unknown tool "${name}".` });
    }
  } catch (e) {
    return JSON.stringify({ error: e instanceof Error ? e.message : String(e) });
  }
}
