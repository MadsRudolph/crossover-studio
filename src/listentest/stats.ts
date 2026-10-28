// Listening-test kit, part 3: the statistics. Small samples (a group tests with 4-10 listeners), so the
// 95 % confidence intervals use Student's t, not the normal 1.96.
//
// The listener is the unit of analysis (Bech & Zacharov ch. 9): a listener's repetitions are averaged
// first, then the mean and CI are taken across listeners, so ten answers from one person never pass
// for ten people. With a single listener the repetitions are the samples instead, and the text says so.
// Comparisons between two variants use the paired difference per listener, which removes each
// listener's own use of the scale.

import { ATTRIBUTE_LINKS, oursVariant, type Attribute, type Protocol, type Rating } from "./model";

// ---------------------------------------------------------------- Student's t
/** ln Gamma(x), Lanczos (g = 7, n = 9), ~15 digits for x > 0. */
function lnGamma(x: number): number {
  const c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
    12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lnGamma(1 - x);
  x -= 1;
  let a = c[0];
  const t = x + 7.5;
  for (let i = 1; i < 9; i++) a += c[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

/** Continued fraction of the incomplete beta function (modified Lentz). */
function betacf(a: number, b: number, x: number): number {
  const TINY = 1e-300;
  let c = 1, d = 1 - (a + b) * x / (a + 1);
  if (Math.abs(d) < TINY) d = TINY;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 300; m++) {
    const m2 = 2 * m;
    let aa = m * (b - m) * x / ((a + m2 - 1) * (a + m2));
    d = 1 + aa * d; if (Math.abs(d) < TINY) d = TINY;
    c = 1 + aa / c; if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d; h *= d * c;
    aa = -(a + m) * (a + b + m) * x / ((a + m2) * (a + m2 + 1));
    d = 1 + aa * d; if (Math.abs(d) < TINY) d = TINY;
    c = 1 + aa / c; if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-14) break;
  }
  return h;
}

/** Regularised incomplete beta I_x(a, b). */
export function betaInc(a: number, b: number, x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(lnGamma(a + b) - lnGamma(a) - lnGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2) ? bt * betacf(a, b, x) / a : 1 - bt * betacf(b, a, 1 - x) / b;
}

/** CDF of Student's t with `df` degrees of freedom. */
export function tCdf(t: number, df: number): number {
  const x = df / (df + t * t);
  const tail = 0.5 * betaInc(df / 2, 0.5, x);
  return t >= 0 ? 1 - tail : tail;
}

/** Quantile of Student's t: the t with P(T <= t) = p (bisection on the CDF; plenty fast for a few calls). */
export function tQuantile(p: number, df: number): number {
  if (!(df > 0) || !(p > 0 && p < 1)) return NaN;
  if (p === 0.5) return 0;
  let lo = -1e3, hi = 1e3;
  for (let i = 0; i < 200 && hi - lo > 1e-12; i++) {
    const mid = (lo + hi) / 2;
    if (tCdf(mid, df) < p) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

const T_CACHE = new Map<number, number>();
/** Two-sided 95 % critical value t(0.975, df). */
export function t95(df: number): number {
  let v = T_CACHE.get(df);
  if (v === undefined) { v = tQuantile(0.975, df); T_CACHE.set(df, v); }
  return v;
}

// ---------------------------------------------------------------- mean and CI
export interface Ci {
  n: number;
  mean: number;
  sd: number;
  /** Half-width of the 95 % CI (NaN for n < 2). */
  half: number;
  lo: number;
  hi: number;
}

export function meanCi(xs: readonly number[]): Ci {
  const n = xs.length;
  if (!n) return { n: 0, mean: NaN, sd: NaN, half: NaN, lo: NaN, hi: NaN };
  const mean = xs.reduce((a, b) => a + b, 0) / n;
  if (n < 2) return { n, mean, sd: NaN, half: NaN, lo: NaN, hi: NaN };
  const sd = Math.sqrt(xs.reduce((a, x) => a + (x - mean) ** 2, 0) / (n - 1));
  const half = t95(n - 1) * sd / Math.sqrt(n);
  return { n, mean, sd, half, lo: mean - half, hi: mean + half };
}

// ---------------------------------------------------------------- the analysis
/** Which samples a cell's CI is built from. */
export type Unit = "listener" | "repetition";

export interface Cell {
  variant: string;
  ci: Ci;
  /** One value per sampling unit (listener means, or single ratings with one listener), keyed by unit. */
  samples: Map<string, number>;
}

export interface Comparison {
  /** The better and the other variant (better by the attribute's direction). */
  better: string;
  worse: string;
  diff: Ci;
  /** The two means' CIs do not overlap. */
  separate: boolean;
  /** The CI of the paired difference excludes zero. */
  significant: boolean;
}

export interface AttributeResult {
  attr: Attribute;
  /** Item id, or "all" for every item together. */
  item: string;
  cells: Cell[];
  comparison: Comparison | null;
}

export interface Analysis {
  unit: Unit;
  /** Listeners with at least one rating. */
  listeners: number;
  ratings: number;
  /** Per attribute: every item ("all") first, then each item. */
  byAttribute: Map<string, AttributeResult[]>;
}

/** Group ratings of one attribute (and item, or all items) into one sample per unit per variant. */
function cells(p: Protocol, rs: Rating[], unit: Unit): Cell[] {
  return p.variants.map(v => {
    const groups = new Map<string, number[]>();
    for (const r of rs) {
      if (r.variant !== v.id) continue;
      const k = unit === "listener" ? String(r.listener) : `${r.rep}|${r.item}`;
      (groups.get(k) ?? groups.set(k, []).get(k)!).push(r.value);
    }
    const samples = new Map<string, number>();
    for (const [k, xs] of groups) samples.set(k, xs.reduce((a, b) => a + b, 0) / xs.length);
    return { variant: v.id, ci: meanCi([...samples.values()]), samples };
  });
}

/** Best against runner-up, by the attribute's direction, on the paired per-unit differences. */
function compare(attr: Attribute, cs: Cell[]): Comparison | null {
  const rated = cs.filter(c => c.ci.n > 0);
  if (rated.length < 2) return null;
  const sign = attr.better === "low" ? -1 : 1;
  const [a, b] = [...rated].sort((x, y) => sign * (y.ci.mean - x.ci.mean));
  const d: number[] = [];
  for (const [k, va] of a.samples) { const vb = b.samples.get(k); if (vb !== undefined) d.push(sign * (va - vb)); }
  const diff = meanCi(d);
  const separate = Number.isFinite(a.ci.half) && Number.isFinite(b.ci.half) &&
    (sign > 0 ? a.ci.lo > b.ci.hi : a.ci.hi < b.ci.lo);
  return { better: a.variant, worse: b.variant, diff, separate, significant: Number.isFinite(diff.lo) && diff.lo > 0 };
}

export function analyse(p: Protocol, ratings: readonly Rating[]): Analysis {
  const who = new Set(ratings.map(r => r.listener));
  const unit: Unit = who.size >= 2 ? "listener" : "repetition";
  const byAttribute = new Map<string, AttributeResult[]>();
  for (const attr of p.attributes) {
    const ra = ratings.filter(r => r.attr === attr.id);
    const list: AttributeResult[] = [];
    for (const item of ["all", ...p.items.map(i => i.id)]) {
      const rs = item === "all" ? ra : ra.filter(r => r.item === item);
      const cs = cells(p, rs, unit);
      list.push({ attr, item, cells: cs, comparison: compare(attr, cs) });
    }
    byAttribute.set(attr.id, list);
  }
  return { unit, listeners: who.size, ratings: ratings.length, byAttribute };
}

// ---------------------------------------------------------------- plain-language conclusions
const f1 = (x: number) => (Number.isFinite(x) ? x.toFixed(1) : "n/a");
const fSigned = (x: number) => `${x < 0 && x.toFixed(1) !== "-0.0" ? "−" : ""}${Math.abs(x).toFixed(1)}`;

export interface Conclusion {
  attr: string;
  tone: "good" | "warn" | "info";
  text: string;
  /** What to change, from the attribute's link, when the group's variant is on the bad side. */
  action?: string;
}

/** Is a mean on the bad side of the scale for this attribute? (more than half a point past the middle) */
export function badSide(attr: Attribute, mean: number): boolean {
  return attr.better === "high" ? mean <= 3.5 : mean >= 4.5;
}

/** One sentence per attribute (all items together), plus what to change when the group's variant does badly. */
export function conclusions(p: Protocol, a: Analysis): Conclusion[] {
  const name = (id: string) => p.variants.find(v => v.id === id)?.name ?? id;
  const ours = oursVariant(p);
  const per = a.unit === "listener" ? "listeners" : "ratings of one listener";
  const out: Conclusion[] = [];
  for (const attr of p.attributes) {
    const all = a.byAttribute.get(attr.id)?.[0];
    if (!all) continue;
    const rated = all.cells.filter(c => c.ci.n > 0);
    if (!rated.length) continue;
    const link = ATTRIBUTE_LINKS[attr.id];
    const lname = attr.name.toLowerCase();
    const oursCell = ours ? all.cells.find(c => c.variant === ours.id && c.ci.n > 0) : undefined;
    const action = oursCell && link && badSide(attr, oursCell.ci.mean)
      ? `${name(oursCell.variant)} scored ${f1(oursCell.ci.mean)} on ${lname} (${attr.better === "high" ? "low" : "high"}): ${link.advice}. Region ${regionText(link.band)}, see the ${link.view} view.`
      : undefined;
    const c = all.comparison;
    if (!c) {
      const x = rated[0];
      out.push({ attr: attr.id, tone: action ? "warn" : "info", action,
        text: `${name(x.variant)}: ${lname} ${f1(x.ci.mean)}${Number.isFinite(x.ci.half) ? ` ± ${f1(x.ci.half)}` : ""} on the 1–7 scale (95 % CI, n = ${x.ci.n} ${per}).` });
      continue;
    }
    const mb = all.cells.find(x => x.variant === c.better)!.ci, mw = all.cells.find(x => x.variant === c.worse)!.ci;
    const verb = attr.better === "low" ? `had less ${lname}` : `was preferred for ${lname}`;
    const nums = `${f1(mb.mean)} vs ${f1(mw.mean)}`;
    let text: string;
    if (c.significant) {
      text = `${name(c.better)} ${verb}, ${nums}: ${c.separate ? "the CIs do not overlap" : `the 95 % CI of the paired difference, ${fSigned(c.diff.lo)} to ${fSigned(c.diff.hi)}, excludes zero`} (n = ${c.diff.n} ${per}).`;
    } else if (Number.isFinite(c.diff.half)) {
      text = `${name(c.better)} ${verb}, ${nums}, but only as a tendency: the 95 % CI of the difference, ${fSigned(c.diff.lo)} to ${fSigned(c.diff.hi)}, includes zero (n = ${c.diff.n}). More listeners or repetitions would settle it.`;
    } else {
      text = `${name(c.better)} ${verb}, ${nums}, from too few paired ratings for a confidence interval.`;
    }
    // green only when the group's own variant wins; amber when it clearly loses or trails the two best
    const oursMean = ours && ours.id !== c.better && ours.id !== c.worse ? all.cells.find(x => x.variant === ours.id && x.ci.n > 0)?.ci.mean : undefined;
    if (oursMean !== undefined) text += ` ${name(ours!.id)}: ${f1(oursMean)}.`;
    const tone = !c.significant ? "info" : ours && c.better === ours.id ? "good" : ours && (c.worse === ours.id || oursMean !== undefined) ? "warn" : "info";
    out.push({ attr: attr.id, tone, text, action });
  }
  return out;
}

export function regionText(band: [number, number]): string {
  const f = (x: number) => (x >= 1000 ? `${Number((x / 1000).toPrecision(3))} kHz` : `${Math.round(x)} Hz`);
  return band[0] <= 20 && band[1] >= 20000 ? "the whole band" : `${f(band[0])}–${f(band[1])}`;
}
