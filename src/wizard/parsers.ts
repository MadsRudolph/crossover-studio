// Text measurement files, parsed in TypeScript for the browser preview (the desktop app parses them in
// Rust: src-tauri/src/text.rs). The rules are the same on both sides, so a file reads identically:
//
// - Matlab2LTspice .txt: one LTspice behavioural source with a FREQ= table,
//       BvTF_mid Pout_mid 0  V=V(Vspkr_mid,0) DB FREQ=
//       +(5.0000000000E+01,-1.9973815578E+01,5.5267288934E+00)
//   the pair after the frequency is DB (dB, degrees; the default), MAG (magnitude, degrees) or R_I.
//   A current source (B... I=..., or any G source) is an admittance table (the script stores 1/Z so that
//   LTspice draws I = V/Z) and is inverted back to impedance.
// - CSV: delimiter , ; tab or whitespace; ';' files use a decimal comma; header names matched loosely
//   with units in brackets dropped; re/im, or mag/dB with phase in degrees or radians; headerless
//   3 columns = f, re, im and 2 columns = f, real value.

import type { Series } from "../types";

export type TextFormat = "ltspice" | "csv";

/** A parsed complex frequency table in SI units (impedance, never admittance). */
export interface Table {
  f: number[];
  re: number[];
  im: number[];
  /** The LTspice source line, or the CSV header line ("" when the CSV has none). */
  header: string;
  /** What the parser learned or assumed, in plain sentences for the user. */
  notes: string[];
}

export class ParseError extends Error {
  constructor(message: string, readonly line?: number) {
    super(line ? `line ${line}: ${message}` : message);
    this.name = "ParseError";
  }
}

const isComment = (line: string): boolean => {
  const t = line.trimStart();
  return t === "" || t.startsWith("*") || t.startsWith("#") || t.startsWith("%") || t.startsWith("//") || t.startsWith(";");
};

/** Position of "FREQ" in "FREQ=" (spaces allowed before '='), in an upper-cased line; -1 when absent. */
function findFreqTable(upper: string): number {
  let i = upper.indexOf("FREQ");
  while (i >= 0) {
    if (upper.slice(i + 4).trimStart().startsWith("=")) return i;
    i = upper.indexOf("FREQ", i + 1);
  }
  return -1;
}

/** True when the text is an LTspice FREQ= table rather than a CSV. */
export function looksLikeLtspice(text: string): boolean {
  const data = text.split(/\r?\n/).filter(l => !isComment(l));
  return (data[0] !== undefined && findFreqTable(data[0].toUpperCase()) >= 0) || (data[1] ?? "").trimStart().startsWith("+(");
}

/** Decodes a text file's bytes like the Rust reader (text::decode): a byte-order mark decides (UTF-8, or
 *  UTF-16 as Excel's "Unicode text" and PowerShell 5 write it); otherwise UTF-8 when valid, else Windows-1252. */
export function decodeText(bytes: Uint8Array): string {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return new TextDecoder("utf-8").decode(bytes.subarray(3));
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes.subarray(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes.subarray(2));
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { return new TextDecoder("windows-1252").decode(bytes); }
}

/** Parse either format, detected from the content. */
export function parseText(text: string): { format: TextFormat; table: Table } {
  // A BOM left in the text would hide the source name (and so whether the table is an admittance).
  text = text.replace(/^\uFEFF/, "");
  return looksLikeLtspice(text) ? { format: "ltspice", table: parseLtspice(text) } : { format: "csv", table: parseCsv(text) };
}

const polar = (mag: number, deg: number): [number, number] => {
  const r = deg * Math.PI / 180;
  return [mag * Math.cos(r), mag * Math.sin(r)];
};

/** Rust's f64 parser accepts plain decimal and exponent forms only; Number() would also take "0x10" or "". */
const NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$|^[+-]?(inf|infinity|nan)$/i;
function num(token: string): number | null {
  const t = token.trim();
  if (!NUMBER.test(t)) return null;
  const lower = t.toLowerCase().replace(/^[+-]/, "");
  if (lower === "nan") return NaN;
  if (lower.startsWith("inf")) return t.startsWith("-") ? -Infinity : Infinity;
  return Number(t);
}

export function parseLtspice(text: string): Table {
  const lines = text.split(/\r?\n/);
  const comments: string[] = [];
  let k = 0, header = "", headerNo = 0;
  for (;; k++) {
    if (k >= lines.length) throw new ParseError("the file is empty: expected an LTspice source line with FREQ=");
    const l = lines[k];
    if (isComment(l)) {
      const c = l.trim().replace(/^[*#%;/]+/, "").trim();
      if (c) comments.push(c);
      continue;
    }
    header = l.trim(); headerNo = k + 1; k++;
    break;
  }
  const upper = header.toUpperCase();
  const freqAt = findFreqTable(upper);
  if (freqAt < 0) throw new ParseError("no FREQ= table on the source line", headerNo);
  // The mode keyword sits between the expression and FREQ=; LTspice's default is dB.
  const before = upper.slice(0, freqAt).split(/\s+/).filter(Boolean);
  const mode = before.includes("R_I") ? "reim" : before.includes("MAG") ? "mag" : "db";
  const name = before[0] ?? "";
  const admittance = name.startsWith("G") || (name.startsWith("B") && before.slice(1).some(t => t.startsWith("I=")));

  const f: number[] = [], a: number[] = [], b: number[] = [];
  const takeTriples = (s: string, line: number) => {
    let rest = s;
    for (let open = rest.indexOf("("); open >= 0; open = rest.indexOf("(")) {
      const close = rest.indexOf(")", open);
      if (close < 0) throw new ParseError("unclosed '(' in the frequency table", line);
      const inner = rest.slice(open + 1, close);
      rest = rest.slice(close + 1);
      const parts = inner.split(/[ ,\t]/).filter(Boolean);
      if (parts.length !== 3) throw new ParseError(`expected (frequency, value, value), found (${inner})`, line);
      const v = parts.map(t => {
        const x = num(t);
        if (x === null) throw new ParseError(`'${t}' is not a number`, line);
        return x;
      });
      f.push(v[0]); a.push(v[1]); b.push(v[2]);
    }
  };
  // The source expression has parentheses of its own (V(Vspkr,0)); only the text after FREQ= is table.
  const tail = header.slice(freqAt);
  takeTriples(tail.includes("=") ? tail.slice(tail.indexOf("=") + 1) : "", headerNo);
  for (; k < lines.length; k++) {
    if (isComment(lines[k])) continue;
    takeTriples(lines[k].trim().replace(/^\++/, ""), k + 1);
  }
  if (!f.length) throw new ParseError("the FREQ= table has no points");

  const re: number[] = [], im: number[] = [];
  for (let i = 0; i < f.length; i++) {
    const [x, y] = mode === "db" ? polar(10 ** (a[i] / 20), b[i]) : mode === "mag" ? polar(a[i], b[i]) : [a[i], b[i]];
    if (admittance) {
      // Z = 1/Y. A zero admittance (open circuit) has no finite impedance; validation reports it.
      const d = x * x + y * y;
      re.push(x / d); im.push(-y / d);
    } else { re.push(x); im.push(y); }
  }
  const notes = [...comments];
  notes.push(`LTspice table in ${mode === "db" ? "dB and degrees" : mode === "mag" ? "magnitude and degrees" : "real and imaginary parts"}.`);
  notes.push(admittance
    ? "Admittance table (Matlab2LTspice stores 1/Z for a current source): inverted back to impedance."
    : "Transfer-function phases include the distance compensation chosen when the file was exported.");
  return dropDcPoints({ f, re, im, header, notes });
}

// ---------------------------------------------------------------- CSV
type Col = "freq" | "re" | "im" | "mag" | "db" | "phaseDeg" | "phaseRad" | "other";

function classify(name: string): Col {
  // Drop units in brackets: "Frequency (Hz)", "Phase [deg]", "SPL(dB)".
  const lower = name.trim().replace(/^"+|"+$/g, "").toLowerCase();
  const parts = lower.split(/[([]/);
  const base = (parts[0] ?? "").trim().replace(/[ -]/g, "_");
  const unit = (parts[1] ?? "").replace(/[)\]]+$/, "").trim();
  switch (base) {
    case "f": case "freq": case "frequency": case "fn": case "hz": case "f_hz": case "freq_hz": case "frequency_hz": return "freq";
    case "re": case "real": case "r": case "re_z": case "real_part": return "re";
    case "im": case "imag": case "imaginary": case "x": case "im_z": case "imag_part": return "im";
    case "mag": case "abs": case "magnitude": case "modulus": case "z": case "abs_z": case "mag_lin": return unit === "db" ? "db" : "mag";
    case "db": case "mag_db": case "level": case "spl": case "spl_db": case "gain_db": case "gain": case "magnitude_db": case "level_db": return "db";
    case "phase": case "deg": case "phase_deg": case "arg": case "angle": case "phi": case "phase_degrees":
      return unit.startsWith("rad") ? "phaseRad" : "phaseDeg";
    case "rad": case "phase_rad": case "arg_rad": return "phaseRad";
    default: return "other";
  }
}

type Delim = ";" | "\t" | "," | null;
const splitFields = (line: string, delim: Delim): string[] =>
  delim ? line.split(delim).map(s => s.trim()) : line.trim().split(/\s+/);

function parseField(s: string, decimalComma: boolean): number | null {
  const t = s.trim().replace(/^"+|"+$/g, "");
  return num(decimalComma ? t.replace(/,/g, ".") : t);
}

/** Column names written as a comment line, as REW does ("* Freq(Hz), SPL(dB), Phase(degrees)"): the last
 *  non-empty comment line above the first data row, if it splits into `count` fields that name a
 *  frequency and a data column. Returns those fields, or null. */
function commentHeader(lines: string[], firstNo: number, delim: Delim, count: number): string[] | null {
  for (let i = firstNo - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line) continue;
    const body = line.replace(/^(\*|#|%|\/\/|;)+\s*/, "");
    for (const d of [delim, ",", ";", "\t", null] as Delim[]) {
      const fields = splitFields(body, d).map(x => x.replace(/[,;]+$/, "")).filter(Boolean);
      if (fields.length !== count) continue;
      const roles = fields.map(classify);
      if (roles.includes("freq") && roles.some(r => r === "re" || r === "mag" || r === "db")) return fields;
    }
    return null;
  }
  return null;
}

export function parseCsv(text: string): Table {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/);
  const rows = lines.map((l, i) => [i, l] as const).filter(([, l]) => !isComment(l));
  if (!rows.length) throw new ParseError("the file has no data rows");
  const [firstNo, first] = rows[0];
  // The delimiter that splits the first line into the most fields; whitespace when none occurs.
  let delim: Delim = null, best = 0;
  for (const d of [";", "\t", ","] as const) {
    const n = first.split(d).length - 1;
    if (n > best) { best = n; delim = d; }
  }
  const decimalComma = delim === ";" || (delim === "\t" && rows.slice(1, 4).some(([, l]) => l.includes(",")));

  const firstFields = splitFields(first, delim);
  const hasHeader = firstFields.some(t => parseField(t, decimalComma) === null);
  const notes: string[] = [];
  const named = hasHeader ? null : commentHeader(lines, firstNo, delim, firstFields.length);
  let roles: Col[];
  if (hasHeader) roles = firstFields.map(classify);
  else if (named) { notes.push(`Column names read from the comment line "${named.join(", ")}".`); roles = named.map(classify); }
  else if (firstFields.length === 2) { notes.push("No header row: columns read as frequency and a real value."); roles = ["freq", "re"]; }
  // three unnamed columns could as well be dB and phase as re and im: guessing would silently corrupt the data
  else if (firstFields.length === 3) throw new ParseError("no header row and 3 columns, which could be re/im or dB/phase: add a header line such as f,re,im or f,db,phase");
  else throw new ParseError(`no header row and ${firstFields.length} columns: add a header such as f,re,im or f,db,phase`);

  const find = (c: Col) => { const i = roles.indexOf(c); return i < 0 ? null : i; };
  const fi = find("freq");
  if (fi === null) throw new ParseError(`no frequency column in the header '${first}' (name it f, freq or frequency)`, firstNo + 1);
  const phaseIdx = find("phaseDeg") ?? find("phaseRad");
  const phase = phaseIdx === null ? null : { i: phaseIdx, rad: roles[phaseIdx] === "phaseRad" };
  type Shape = { kind: "reim"; re: number; im: number | null } | { kind: "polar"; mag: number; db: boolean };
  let shape: Shape;
  const reI = find("re"), magI = find("mag"), dbI = find("db");
  if (reI !== null) shape = { kind: "reim", re: reI, im: find("im") };
  else if (magI !== null) shape = { kind: "polar", mag: magI, db: false };
  else if (dbI !== null) shape = { kind: "polar", mag: dbI, db: true };
  else throw new ParseError(`the header '${first}' names no data columns: use re + im, or mag/db + phase (degrees)`, firstNo + 1);
  if (shape.kind === "reim" && shape.im === null) notes.push("No imaginary column: the data is read as real.");
  if (shape.kind === "polar" && !phase) notes.push("No phase column: the phase is taken as zero.");

  const t: Table = { f: [], re: [], im: [], header: hasHeader ? first.trim() : named ? named.join(",") : "", notes };
  let start = hasHeader ? 1 : 0;
  // A units row under the header ("Hz, Ohm, Ohm", as some exports write) has no number in it: skip it.
  if (hasHeader && rows[1] && splitFields(rows[1][1], delim).every(f => parseField(f, decimalComma) === null)) {
    start = 2;
    notes.push(`The row "${rows[1][1].trim()}" under the header was read as units and skipped.`);
  }
  for (const [no, line] of rows.slice(start)) {
    const fields = splitFields(line, delim);
    const get = (i: number): number => {
      const s = fields[i];
      if (s === undefined) throw new ParseError(`expected at least ${i + 1} columns`, no + 1);
      const v = parseField(s, decimalComma);
      if (v === null) throw new ParseError(`'${s}' is not a number`, no + 1);
      return v;
    };
    t.f.push(get(fi));
    let x: number, y: number;
    if (shape.kind === "reim") { x = get(shape.re); y = shape.im === null ? 0 : get(shape.im); }
    else {
      const m0 = get(shape.mag), m = shape.db ? 10 ** (m0 / 20) : m0;
      const p = phase ? (phase.rad ? get(phase.i) * 180 / Math.PI : get(phase.i)) : 0;
      [x, y] = polar(m, p);
    }
    t.re.push(x); t.im.push(y);
  }
  if (!t.f.length) throw new ParseError("the file has a header but no data rows");
  return dropDcPoints(t);
}

/** Drop leading points at 0 Hz (the DC bin of an FFT axis), noting it, so the rest of the file still loads.
 *  The engine's grid is logarithmic and the models divide by the frequency. */
export function dropDcPoints<T extends { f: number[]; re: number[]; im: number[]; notes: string[] }>(t: T): T {
  let n = 0;
  while (n < t.f.length && t.f[n] === 0) n++;
  if (!n) return t;
  t.f.splice(0, n); t.re.splice(0, n); t.im.splice(0, n);
  t.notes.push(n === 1 ? "The 0 Hz (DC) point was left out." : `${n} points at 0 Hz were left out.`);
  return t;
}

/** Shared checks for any series before it reaches the engine. Returns a plain-language problem, or null. */
export function validateSeries(f: ArrayLike<number>, re: ArrayLike<number>, im: ArrayLike<number>): string | null {
  if (f.length !== re.length || f.length !== im.length) return `frequency has ${f.length} points but the data has ${re.length}`;
  if (f.length < 2) return "a series needs at least two points";
  for (let i = 0; i < f.length; i++)
    if (!Number.isFinite(f[i]) || !Number.isFinite(re[i]) || !Number.isFinite(im[i])) return `point ${i + 1} (f = ${f[i]}) is not a finite number`;
  if (!(f[0] > 0)) return f[0] === 0 ? "the frequency axis starts at 0 Hz: leave the DC point out" : "frequencies must be above 0 Hz, not negative";
  for (let i = 1; i < f.length; i++)
    if (f[i] <= f[i - 1]) return `frequencies must rise strictly: point ${i + 1} (${f[i]} Hz) follows ${f[i - 1]} Hz`;
  return null;
}

/** Parse a text file into a validated Series with its provenance, exactly as the Rust read_series does. */
export function textToSeries(fileName: string, text: string): Series {
  const { format, table } = parseText(text);
  const problem = validateSeries(table.f, table.re, table.im);
  if (problem) throw new ParseError(problem);
  const note = table.notes.length ? table.notes.join(" ") : undefined;
  return { f: table.f, re: table.re, im: table.im, source: { file: fileName, format, ...(note ? { note } : {}) } };
}
