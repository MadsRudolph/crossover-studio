// Display formatting at the UI edge. The engine works in SI units (Hz, ohm, H, F, m); these helpers turn
// those into the units the course uses (Hz/kHz, dB, Ω, mH, µF, mm). Negative numbers use a true minus sign.

const MINUS = "−";
/** Thin no-break space between a number and its unit, so "4.7 Ω" never wraps. */
export const UNIT_SPACE = " ";

function minus(s: string): string {
  return s.startsWith("-") ? MINUS + s.slice(1) : s;
}

const isNum = (x: number | null | undefined): x is number => typeof x === "number" && Number.isFinite(x);

/** A number with `sig` significant digits, trailing zeros trimmed but at least `minDecimals` kept. */
export function fmtSig(x: number, sig = 3, minDecimals = 0): string {
  if (!isNum(x)) return "—";
  if (x === 0) return minDecimals ? (0).toFixed(minDecimals) : "0";
  const mag = Math.floor(Math.log10(Math.abs(x)));
  const decimals = Math.max(0, sig - 1 - mag);
  let s = x.toFixed(decimals);
  if (s.includes(".")) s = s.replace(/0+$/, "").replace(/\.$/, "");
  const have = s.includes(".") ? s.length - s.indexOf(".") - 1 : 0;
  if (have < minDecimals) s = (s.includes(".") ? s : s + ".") + "0".repeat(minDecimals - have);
  return minus(s);
}

/** Fixed decimals with a true minus sign; `sign` adds "+" to positive values. */
export function fmtFixed(x: number, digits = 1, sign = false): string {
  if (!isNum(x)) return "—";
  const s = x.toFixed(digits);
  // "-0.0" reads as noise: show it as zero
  if (Number(s) === 0) return (sign ? "±" : "") + (0).toFixed(digits);
  return (sign && x > 0 ? "+" : "") + minus(s);
}

export interface FreqOptions {
  /** Omit the unit (e.g. for axis ticks where the axis carries it). */
  bare?: boolean;
}

/** 23.4 Hz · 325 Hz · 1.45 kHz · 12.5 kHz */
export function fmtFreq(hz: number | null | undefined, opts: FreqOptions = {}): string {
  if (!isNum(hz)) return "—";
  const a = Math.abs(hz);
  let num: string, unit: string;
  if (a >= 1000) {
    const k = hz / 1000;
    num = Math.abs(k) >= 10 ? fmtFixed(k, 1) : fmtFixed(k, 2);
    unit = "kHz";
  } else {
    num = a >= 100 ? fmtFixed(hz, 0) : a >= 10 ? fmtFixed(hz, 1) : fmtFixed(hz, 2);
    unit = "Hz";
  }
  return opts.bare ? num : num + UNIT_SPACE + unit;
}

export interface DbOptions {
  digits?: number;
  /** Show "+" for positive values (gains, deviations). */
  sign?: boolean;
  bare?: boolean;
}

/** −4.5 dB · +2.0 dB */
export function fmtDb(db: number | null | undefined, opts: DbOptions = {}): string {
  if (!isNum(db)) return "—";
  const s = fmtFixed(db, opts.digits ?? 1, opts.sign);
  return opts.bare ? s : s + UNIT_SPACE + "dB";
}

/** 3.3 Ω · 15 Ω · 0.18 Ω (three significant digits) */
export function fmtOhm(ohm: number | null | undefined, opts: { bare?: boolean; sig?: number } = {}): string {
  if (!isNum(ohm)) return "—";
  const s = fmtSig(ohm, opts.sig ?? 3);
  return opts.bare ? s : s + UNIT_SPACE + "Ω";
}

export type PartKind = "L" | "C" | "R";

/** Display unit and scale for a part kind: inductors in mH, capacitors in µF, resistors in Ω. */
export const PART_UNITS: Record<PartKind, { unit: string; scale: number }> = {
  L: { unit: "mH", scale: 1e3 },
  C: { unit: "µF", scale: 1e6 },
  R: { unit: "Ω", scale: 1 },
};

/** A part value given in SI (H, F, Ω): 0.82 mH · 6.8 µF · 4.7 Ω. Null or zero means "not fitted". */
export function fmtValue(v: number | null | undefined, kind: PartKind, opts: { bare?: boolean; empty?: string } = {}): string {
  if (!isNum(v) || v === 0) return opts.empty ?? "—";
  const { unit, scale } = PART_UNITS[kind];
  const x = v * scale;
  // keep one decimal below ten (1.0 mH, 2.2 µF) so a column of parts reads evenly
  const s = fmtSig(x, 3, Math.abs(x) < 10 && Number.isInteger(x) ? 1 : 0);
  return opts.bare ? s : s + UNIT_SPACE + unit;
}

/** A length given in metres: 160 mm · 6.5 mm · 1.15 m */
export function fmtLength(m: number | null | undefined, opts: { bare?: boolean; digits?: number } = {}): string {
  if (!isNum(m)) return "—";
  const a = Math.abs(m);
  if (a >= 1) {
    const s = fmtFixed(m, opts.digits ?? 2);
    return opts.bare ? s : s + UNIT_SPACE + "m";
  }
  const mm = m * 1e3;
  const s = opts.digits !== undefined ? fmtFixed(mm, opts.digits) : Math.abs(mm) >= 10 ? fmtFixed(mm, 0) : fmtFixed(mm, 1);
  return opts.bare ? s : s + UNIT_SPACE + "mm";
}

/** Milliseconds for timing readouts: 0.84 ms · 12 ms */
export function fmtMs(ms: number | null | undefined): string {
  if (!isNum(ms)) return "—";
  return (ms < 10 ? fmtFixed(ms, 1) : fmtFixed(ms, 0)) + UNIT_SPACE + "ms";
}

const PREFIX: Record<string, number> = { p: 1e-12, n: 1e-9, u: 1e-6, "µ": 1e-6, "μ": 1e-6, m: 1e-3, k: 1e3, K: 1e3, M: 1e6 };

/**
 * Parse what a person types into a number field: "4.7", "4,7", "−3", "1.2k", "820u".
 * An SI prefix multiplies the number; a trailing unit ("Hz", "Ω", "dB") is ignored.
 * Pass the field's own display unit ("mH") so "4.7 mH" in a millihenry field reads as 4.7, not 4.7 milli.
 * Returns null when nothing numeric is found.
 */
export function parseNumber(text: string, unit?: string): number | null {
  let t = text.trim().replace(/−/g, "-").replace(/,/g, ".").replace(/\s+/g, "");
  if (unit) {
    const u = unit.replace(/\s+/g, "");
    if (u && t.toLowerCase().endsWith(u.toLowerCase())) t = t.slice(0, -u.length);
  }
  const m = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)([pnuµμmkKM]?)/i.exec(t);
  if (!m) return null;
  const base = Number(m[1]);
  if (!Number.isFinite(base)) return null;
  // "m" only counts as milli when it is not the start of a unit like "mm"/"ms" typed after a plain number
  const p = m[2];
  const rest = t.slice(m[0].length);
  if (p && /^[a-zA-ZΩ]/.test(rest) && p === "m" && /^m/.test(rest)) return base;
  return p ? base * (PREFIX[p] ?? 1) : base;
}
