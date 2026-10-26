// Measurement roles and their automatic assignment. Pure (no React, no Tauri) so the end-to-end test
// can run the same code the wizard does.
//
// A role is one slot of Profile.measurements, keyed as a string:
//   "tf:<angle>:<unit>"      anechoic p/V of one unit at one angle ("tf:0:woof")
//   "zi:mid" | "zi:tw"       input impedance of the passively filtered units
//   "woofer:free" | "woofer:closed"
//   "vent:<cfg>:z" | "vent:<cfg>:nf_cone" | "vent:<cfg>:nf_vent"   one vented configuration, cfg = "A160" or "A160+B120"
//
// A data item is one readable complex series inside a file: the whole file for .txt/.csv, or one
// variable (and column of a matrix) of a .mat file.

import type { FileInfo, MatVariable, UnitId } from "../types";
import type { Table } from "./parsers";

export type RoleKey = string;
export type Quantity = "tf" | "z" | "nf";

export interface WizardFile {
  /** Stable id within the wizard (the path on the desktop, name + size in the browser). */
  id: string;
  name: string;
  /** Desktop only: absolute path, read again by the Rust backend. */
  path?: string;
  format: FileInfo["format"];
  status: "reading" | "ready" | "error";
  info?: FileInfo;
  /** Browser only: the parsed text table (the desktop app reads text files in Rust). */
  table?: Table;
  error?: string;
}

/** Which series to read: a file, and for .mat the variables and the matrix column. */
export interface Choice {
  fileId: string;
  freqVar?: string;
  dataVar?: string;
  column?: number;
}

export interface DataItem extends Choice {
  /** Number of points. */
  points: number;
  complex: boolean;
  /** Human label: "H(:,2)", "Z", or the file name for text files. */
  label: string;
  /** Number of columns of the matrix this item comes from (1 for vectors and text files). */
  columns: number;
}

export interface Assignment {
  role: RoleKey;
  choice: Choice;
  /** 0..1: how sure the automatic assignment is (1 for a choice the user made). */
  confidence: number;
  /** Why this item was chosen, in plain words. */
  reason: string;
  /** false once the user picked it by hand: re-running the auto-assignment leaves it alone. */
  auto: boolean;
}

export interface VentConfig {
  key: string;
  vents: { id: string; length_m: number }[];
}

export const UNIT_NAME: Record<UnitId, string> = { woof: "woofer", mid: "midrange", tw: "tweeter" };
const UNITS: UnitId[] = ["woof", "mid", "tw"];

export const choiceKey = (c: Choice): string => `${c.fileId}|${c.freqVar ?? ""}|${c.dataVar ?? ""}|${c.column ?? ""}`;
export const sameChoice = (a: Choice | undefined, b: Choice | undefined) => !!a && !!b && choiceKey(a) === choiceKey(b);

export const ventKey = (vents: VentConfig["vents"]): string =>
  vents.map(v => `${v.id}${Math.round(v.length_m * 1000)}`).join("+");

export function ventLabel(vents: VentConfig["vents"]): string {
  if (!vents.length) return "Vented box";
  return vents.map(v => `vent ${v.id} ${Math.round(v.length_m * 1000)} mm`).join(" + ");
}

// ---------------------------------------------------------------- role catalogue
export interface RoleDef {
  key: RoleKey;
  title: string;
  hint: string;
  quantity: Quantity;
  required: boolean;
  unit?: UnitId;
  angle?: string;
  group: "tf0" | "zi" | "woofer" | "angles" | "vented";
}

export const REQUIRED_ROLES: RoleDef[] = [
  ...UNITS.map((u): RoleDef => ({
    key: `tf:0:${u}`, title: `${cap(UNIT_NAME[u])} response, 0°`, quantity: "tf", required: true, unit: u, angle: "0", group: "tf0",
    hint: "Anechoic p/V on axis (Lab E system measurement). All three units must come from the same run so their relative phase is valid.",
  })),
  { key: "zi:mid", title: "Midrange impedance", quantity: "z", required: true, unit: "mid", group: "zi",
    hint: "Input impedance of the midrange (Lab D). The passive crossover sees it as its load." },
  { key: "zi:tw", title: "Tweeter impedance", quantity: "z", required: true, unit: "tw", group: "zi",
    hint: "Input impedance of the tweeter (Lab D). Its peak gives the tweeter resonance." },
  { key: "woofer:free", title: "Woofer impedance, free air", quantity: "z", required: true, unit: "woof", group: "woofer",
    hint: "The woofer hanging in free air (Lab D). Together with the closed box it pins Bl, M_MS, C_MS and V_AS." },
  { key: "woofer:closed", title: "Woofer impedance, closed box", quantity: "z", required: true, unit: "woof", group: "woofer",
    hint: "The woofer in its box with the vents plugged (Lab D). Gives V_AS and the box losses." },
];

export function angleRoles(angle: string): RoleDef[] {
  return UNITS.map(u => ({
    key: `tf:${angle}:${u}`, title: `${cap(UNIT_NAME[u])} response, ${angle}°`, quantity: "tf" as const, required: false, unit: u, angle,
    group: "angles" as const, hint: `Anechoic p/V at ${angle}° off axis, from the same run for all three units.`,
  }));
}

export function ventRoles(cfg: VentConfig): RoleDef[] {
  const l = ventLabel(cfg.vents);
  return [
    { key: `vent:${cfg.key}:z`, title: "Woofer impedance", quantity: "z", required: false, unit: "woof", group: "vented",
      hint: `Woofer impedance with ${l} open. Fits the effective vent mass and the box losses.` },
    { key: `vent:${cfg.key}:nf_cone`, title: "Near field at the cone", quantity: "nf", required: false, unit: "woof", group: "vented",
      hint: `Near-field pressure at the cone with ${l} (optional, for the box validation plot).` },
    { key: `vent:${cfg.key}:nf_vent`, title: "Near field at the vent", quantity: "nf", required: false, unit: "woof", group: "vented",
      hint: `Near-field pressure at the vent mouth with ${l} (optional).` },
  ];
}

export function roleDef(key: RoleKey, vents: VentConfig[]): RoleDef | undefined {
  const req = REQUIRED_ROLES.find(r => r.key === key);
  if (req) return req;
  const tf = /^tf:([^:]+):(woof|mid|tw)$/.exec(key);
  if (tf) return angleRoles(tf[1]).find(r => r.key === key);
  const v = /^vent:([^:]+):/.exec(key);
  const cfg = v && vents.find(c => c.key === v[1]);
  return cfg ? ventRoles(cfg).find(r => r.key === key) : undefined;
}

function cap(s: string) { return s[0].toUpperCase() + s.slice(1); }

// ---------------------------------------------------------------- data items in a file
const NUMERIC = new Set(["double", "single", "int8", "uint8", "int16", "uint16", "int32", "uint32", "int64", "uint64"]);
const FREQ_NAMES = ["fn", "f", "freq", "frequency", "f_hz", "freq_hz", "fr", "fvec", "frequencies", "w"];
const isFreqName = (name: string) => FREQ_NAMES.includes(leaf(name).toLowerCase());
/** Last part of a flattened struct name: "meas(2).fn" -> "fn". */
const leaf = (name: string) => name.slice(name.lastIndexOf(".") + 1);

const isNumeric = (v: MatVariable) => NUMERIC.has(v.class) && v.dims.length === 2 && v.dims.every(d => d >= 1);
const vectorLength = (v: MatVariable) => (v.dims[0] === 1 || v.dims[1] === 1) ? v.dims[0] * v.dims[1] : 0;

/** The frequency vector that belongs to a data variable of n points: a real vector of the same length,
 *  preferring the usual names (fn before f: Lab E files also hold the 48000-point FFT axis `f`). */
export function frequencyVariable(vars: MatVariable[], n: number, dataName?: string): string | undefined {
  const cands = vars.filter(v => isNumeric(v) && !v.complex && vectorLength(v) === n);
  // In a struct array, meas(2).H belongs with meas(2).fn: a candidate in the data's own struct ranks first.
  const prefix = (name: string) => { const i = name.lastIndexOf("."); return i < 0 ? "" : name.slice(0, i); };
  const own = dataName === undefined ? null : prefix(dataName);
  const rank = (v: MatVariable) => {
    const i = FREQ_NAMES.indexOf(leaf(v.name).toLowerCase());
    return (own !== null && prefix(v.name) !== own ? 1000 : 0) + (i < 0 ? 99 : i);
  };
  cands.sort((a, b) => rank(a) - rank(b));
  return cands[0]?.name;
}

/** Every complex series a file offers. Real-valued .mat variables count only when no complex one exists. */
export function dataItems(file: WizardFile): DataItem[] {
  if (file.status !== "ready") return [];
  if (file.format === "csv" || file.format === "ltspice") {
    const points = file.table?.f.length ?? file.info?.points ?? 0;
    return [{ fileId: file.id, points, complex: true, label: file.name, columns: 1 }];
  }
  if (file.format !== "mat" || !file.info) return [];
  const vars = file.info.variables;
  const items: DataItem[] = [];
  const consider = (v: MatVariable) => {
    if (!isNumeric(v) || isFreqName(v.name)) return;
    const [r, c] = v.dims;
    // a series runs along the longer dimension; the other one counts the columns (units)
    const n = Math.max(r, c), k = Math.min(r, c);
    if (n < 8 || k > 12) return;
    const freqVar = frequencyVariable(vars, n, v.name);
    if (!freqVar) return;
    if (k === 1) items.push({ fileId: file.id, freqVar, dataVar: v.name, points: n, complex: v.complex, label: v.name, columns: 1 });
    else for (let j = 0; j < k; j++)
      items.push({ fileId: file.id, freqVar, dataVar: v.name, column: j, points: n, complex: v.complex,
                   label: r >= c ? `${v.name}(:,${j + 1})` : `${v.name}(${j + 1},:)`, columns: k });
  };
  vars.filter(v => v.complex).forEach(consider);
  if (!items.length) vars.filter(v => !v.complex).forEach(consider);
  return items;
}

// ---------------------------------------------------------------- reading names
/** Lower-case words of a name or note, joined by "_" ("labD_vent_L160.mat" -> "labd_vent_l160"). */
export function normalise(s: string): string {
  return s.replace(/\.[a-z0-9]{1,4}$/i, "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}
const has = (s: string, words: string) => new RegExp(`(?:^|_)(?:${words})(?:_|$)`).test(s);

export function unitFrom(s: string): UnitId | null {
  const found: UnitId[] = [];
  if (has(s, "woof|woofer|bass|lf|wf|subwoofer")) found.push("woof");
  if (has(s, "mid|midrange|mr|mf|midbass")) found.push("mid");
  if (has(s, "tw|tweeter|tweet|hf|treble|dome")) found.push("tw");
  return found.length === 1 ? found[0] : null;
}

/** Measurement angle in degrees ("system_30", "TF_off30", "TF30_mid", "angle 15 deg"); null when not named. */
export function angleFrom(s: string): string | null {
  const m = /(?:^|_)(?:off|tf|system|angle|ang|deg|theta)_?(\d{1,3})(?:_?deg)?(?:_|$)/.exec(s) ?? /(?:^|_)(\d{1,3})_?deg(?:_|$)/.exec(s);
  if (m) { const a = +m[1]; return a <= 180 ? String(a) : null; }
  return has(s, "on|onaxis|on_axis|axial") ? "0" : null;
}

/** Vent length in mm ("vent_L160", "L = 160 mm", "nf_cone_L200"); null when not named. */
export function ventLengthFrom(s: string): number | null {
  const m = /(?:^|_)l_?(\d{2,3})(?:_?mm)?(?:_|$)/.exec(s) ?? /(?:^|_)(\d{2,3})_?mm(?:_|$)/.exec(s);
  if (!m) return null;
  const mm = +m[1];
  return mm >= 10 && mm <= 999 ? mm : null;
}

function quantityFrom(s: string, dataVar: string | undefined, header: string): { q: Quantity; why: string } | null {
  const v = dataVar ? normalise(leaf(dataVar)) : "";
  const h = normalise(header.split(/\s+/)[0] ?? "");
  if (has(s, "nf|nearfield|near_field|near")) return { q: "nf", why: "near field" };
  if (/^(bi|g)/.test(h) && /zin|zi|z_|imp/.test(h)) return { q: "z", why: "admittance source in the LTspice file" };
  if (/^z/.test(v)) return { q: "z", why: `variable ${dataVar}` };
  if (/^(h|tf|p)/.test(v)) return { q: "tf", why: `variable ${dataVar}` };
  if (has(s, "z|zi|zin|bizin|gzin|imp|impedance")) return { q: "z", why: "impedance in the name" };
  if (has(s, "tf\\d*|h|response|system|spl|pout|fr|sens")) return { q: "tf", why: "response in the name" };
  return null;
}

/** Raw recordings and spectra the Lab scripts save next to the processed series: never a role's data. */
const RAW_VARS = /^(spec|specn|ch|raw|rec|recording|signal|sig|y|x|peak|rms)$/;

// ---------------------------------------------------------------- automatic assignment
export interface Candidate { role: RoleKey; item: DataItem; confidence: number; reason: string; vents?: VentConfig["vents"] }

/** Everything the names, variables, tags and notes of one file say about its items. */
export function classifyFile(file: WizardFile): Candidate[] {
  const items = dataItems(file);
  if (!items.length) return [];
  const textVar = (n: string) => file.info?.variables.find(v => v.name === n && v.class === "char")?.text ?? "";
  const nameS = normalise(file.name);
  const meta = normalise([textVar("tag"), textVar("kind"), textVar("note"), textVar("part")].join(" "));
  const header = file.table?.header ?? file.info?.header ?? "";
  const all = `${nameS}_${meta}`;
  // Matlab2LTspice also writes model curves (Box_woof.txt: "BvBox_woof"): not a measurement
  if (/^(box|model|sim)(_|$)/.test(nameS) || /^bvbox/i.test(header)) return [];

  const out: Candidate[] = [];
  for (const item of items) {
    const q = quantityFrom(all, item.dataVar, header);
    if (!q) continue;
    // a .mat file holds the processed series (Z, H) next to raw spectra (specn): the variable name decides
    const v = item.dataVar ? normalise(leaf(item.dataVar)) : null;
    if (v !== null && RAW_VARS.test(v)) continue;
    const varPenalty = v === null || (q.q === "z" ? /^z/.test(v) : /^(h|tf|p)/.test(v)) ? 0 : 0.3;
    const fromName = (test: (s: string) => unknown) => test(nameS) ? "name" : test(meta) ? "tag/note" : null;
    const base = (src: string | null) => src === "name" ? 0.92 : 0.85;

    if (q.q === "tf") {
      const angle = angleFrom(nameS) ?? angleFrom(meta) ?? "0";
      const angleSrc = angleFrom(nameS) ? "the name" : angleFrom(meta) ? "the tag" : "no angle named, read as on axis";
      let unit = unitFrom(nameS) ?? unitFrom(meta);
      let conf = base(fromName(unitFrom)), why = `${q.why}, ${unit ? UNIT_NAME[unit] : ""} from the ${fromName(unitFrom) ?? "name"}`;
      if (!unit && item.columns === 3 && item.column !== undefined) {
        // Lab E system files: H(:,1..3) = woofer, midrange, tweeter
        unit = UNITS[item.column];
        conf = 0.8; why = `column ${item.column + 1} of ${item.dataVar}: woofer, midrange, tweeter is the Lab E order`;
      }
      if (!unit) continue;
      if (angleSrc.startsWith("no")) conf -= 0.1;
      out.push({ role: `tf:${angle}:${unit}`, item, confidence: conf - varPenalty, reason: `${why}; angle ${angle}° (${angleSrc})` });
      continue;
    }

    const mm = ventLengthFrom(nameS) ?? ventLengthFrom(meta);
    const ventB = has(all, "b|vent_b|two|2_open|both");
    if (q.q === "nf") {
      const where = has(all, "vent|port") && !has(all, "cone") ? "nf_vent" : has(all, "cone|driver|woofer") ? "nf_cone" : null;
      if (!where || mm === null) continue;
      const vents = [{ id: "A", length_m: mm / 1000 }];
      out.push({ role: `vent:${ventKey(vents)}:${where}`, item, vents, confidence: 0.9 - varPenalty,
                 reason: `near field at the ${where === "nf_vent" ? "vent" : "cone"}, L = ${mm} mm` });
      continue;
    }
    // impedance
    if (mm !== null || has(all, "vent|vented|port|bassreflex|reflex")) {
      if (mm === null) continue;   // a vented curve without its length cannot be placed
      const vents = [{ id: "A", length_m: mm / 1000 }];
      out.push({ role: `vent:${ventKey(vents)}:z`, item, vents, confidence: (ventB ? 0.6 : 0.9) - varPenalty,
                 reason: `vented woofer impedance, L = ${mm} mm${ventB ? " (two vents? check the configuration)" : ""}` });
      continue;
    }
    const unit = unitFrom(nameS) ?? unitFrom(meta);
    if (unit === "mid" || unit === "tw") {
      out.push({ role: `zi:${unit}`, item, confidence: base(fromName(unitFrom)) - varPenalty, reason: `${q.why}, ${UNIT_NAME[unit]} from the ${fromName(unitFrom)}` });
    } else if (has(all, "free|free_air|freeair|fa")) {
      out.push({ role: "woofer:free", item, confidence: 0.92 - varPenalty, reason: `${q.why}, free air` });
    } else if (has(all, "closed|sealed|plugged|cb")) {
      out.push({ role: "woofer:closed", item, confidence: 0.92 - varPenalty, reason: `${q.why}, closed box` });
    } else if (unit === "woof") {
      out.push({ role: "woofer:free", item, confidence: 0.45 - varPenalty, reason: `${q.why}, woofer: free air or closed box not named, guessed free air` });
    }
  }
  return out;
}

export interface AutoResult {
  assignments: Record<RoleKey, Assignment>;
  vents: VentConfig[];
  /** Off-axis angles found, besides 0. */
  angles: string[];
}

/** Assign every role from the files. Manual assignments in `keep` stay as they are; each data item goes
 *  to one role at most; for each role the most confident candidate wins (ties: the earlier file). */
export function autoAssign(files: WizardFile[], keep: Record<RoleKey, Assignment> = {}, keepVents: VentConfig[] = []): AutoResult {
  const cands = files.flatMap(classifyFile);
  const manual = Object.values(keep).filter(a => !a.auto);
  const used = new Set(manual.map(a => choiceKey(a.choice)));
  const assignments: Record<RoleKey, Assignment> = {};
  for (const a of manual) assignments[a.role] = a;

  const order = cands.map((c, i) => ({ c, i })).sort((a, b) => b.c.confidence - a.c.confidence || a.i - b.i);
  for (const { c } of order) {
    if (assignments[c.role] || used.has(choiceKey(c.item))) continue;
    assignments[c.role] = { role: c.role, choice: pickChoice(c.item), confidence: c.confidence, reason: c.reason, auto: true };
    used.add(choiceKey(c.item));
  }

  const vents = [...keepVents];
  for (const role of Object.keys(assignments)) {
    const m = /^vent:([^:]+):/.exec(role);
    if (!m || vents.some(v => v.key === m[1])) continue;
    const cand = cands.find(c => c.role === role);
    if (cand?.vents) vents.push({ key: m[1], vents: cand.vents });
  }
  vents.sort((a, b) => (a.vents[0]?.length_m ?? 0) - (b.vents[0]?.length_m ?? 0));
  const angles = [...new Set(Object.keys(assignments).map(r => /^tf:([^:]+):/.exec(r)?.[1]).filter((a): a is string => !!a && a !== "0"))]
    .sort((a, b) => +a - +b);
  return { assignments, vents, angles };
}

const pickChoice = (it: DataItem): Choice => ({
  fileId: it.fileId,
  ...(it.freqVar !== undefined ? { freqVar: it.freqVar } : {}),
  ...(it.dataVar !== undefined ? { dataVar: it.dataVar } : {}),
  ...(it.column !== undefined ? { column: it.column } : {}),
});
export { pickChoice as choiceOf };

/** Data items no role uses, for the "not used" list. */
export function unusedItems(files: WizardFile[], assignments: Record<RoleKey, Assignment>): DataItem[] {
  const used = new Set(Object.values(assignments).map(a => choiceKey(a.choice)));
  return files.flatMap(dataItems).filter(it => !used.has(choiceKey(it)));
}
