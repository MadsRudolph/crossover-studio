// Insight provider: sensitivity. Which part decides a crossover (one basket step moves the sum most
// there) and which parts to measure with the LCR meter (their tolerance alone moves the sum most), or
// that the design is robust. Uses the on-axis-only sensitivity (a few ms, cached per Results); the
// verdict changes per part are left to the Sensitivity view, which works them out after the design
// settles.
import { cachedSensitivity, type SensEntry, type SensVariant } from "../../engine";
import { fmtFreq } from "../../ui/format";
import type { UnitId } from "../../types";
import type { Insight, InsightProvider } from "../types";

const NAME: Record<UnitId, string> = { woof: "woofer", mid: "midrange", tw: "tweeter" };
const db = (x: number) => `${Math.abs(x).toFixed(1)} dB`;
/** A tolerance change below this (dB) is not worth measuring the part for. */
const ROBUST_DB = 0.5;

/** "C1 in the tweeter filter", "Rs of the tweeter L-pad", "the tweeter Zobel's C". */
export function partPhrase(e: SensEntry): string {
  const u = NAME[e.unit];
  if (e.label === "Rs" || e.label === "Rp") return `${e.label} of the ${u} L-pad`;
  if (e.label.startsWith("Zobel")) return `the ${u} Zobel's ${e.label.slice(6)}`;
  return `${e.label} in the ${u} filter`;
}

/** The larger (by |dB| of `key`) of two variants. */
const bigger = (a: SensVariant | null, b: SensVariant | null, key: "maxDb" | "xoverDb" = "maxDb") =>
  (!a ? b : !b ? a : Math.abs(a[key]) >= Math.abs(b[key]) ? a : b);

export const sensitivityInsights: InsightProvider = (ctx) => {
  const s = cachedSensitivity(ctx.prep, ctx.design, ctx.results), m = ctx.results.metrics, out: Insight[] = [];

  // the part that decides a crossover
  const x = s.topXover;
  if (x && x.xoverDb >= 0.5) {
    const v = bigger(x.step.lo, x.step.hi, "xoverDb")!;
    const which = Math.abs(Math.log2(v.xoverHz / (m.x_mt ?? 1e9))) < Math.abs(Math.log2(v.xoverHz / (m.x_wm ?? 1e9))) ? m.x_mt : m.x_wm;
    const phrase = partPhrase(x), measure = x.tolDb >= ROBUST_DB;
    out.push({
      id: "sens.xover",
      severity: x.tolDb >= 1 ? "warn" : "info",
      title: `${phrase[0].toUpperCase()}${phrase.slice(1)} decides the ${which ? fmtFreq(which) + " " : ""}crossover: one basket step moves the sum ${db(x.xoverDb)}`,
      detail: `Of all the parts, ${phrase} changes the sum most around a crossover (${db(v.xoverDb)} at ${fmtFreq(v.xoverHz)}`
        + (Math.abs(v.maxDb) > Math.abs(v.xoverDb) + 0.2 ? `; ${db(v.maxDb)} at most, at ${fmtFreq(v.atHz)}). ` : "). ")
        + (measure ? `Its ${Math.round(100 * (x.tol?.rel ?? 0))} % tolerance alone moves it ${db(x.tolDb)}, so measure it before you solder.`
                   : `Its tolerance moves the sum only ${db(x.tolDb)}, but pick its value with care.`),
      view: "sensitivity",
      alsoIn: ["response", "filters"],
      at: v.xoverHz,
      band: which ? [which / 2 ** (1 / 3), which * 2 ** (1 / 3)] : undefined,
      focus: x.focus,
      weight: Math.min(1, x.xoverDb / 3),
    });
  }

  // the parts to measure, or the design is robust
  const [a, b] = s.measure;
  if (a && a.tolDb >= ROBUST_DB) {
    const va = bigger(a.tol!.lo, a.tol!.hi)!;
    const two = b && b.tolDb >= ROBUST_DB;
    out.push({
      id: "sens.measure",
      severity: a.tolDb >= 1.5 ? "warn" : "info",
      title: `Measure the ${NAME[a.unit]} ${a.label}${two ? ` and the ${NAME[b.unit]} ${b.label}` : ""} with the LCR meter`,
      detail: `Within its ${Math.round(100 * (a.tol!.rel ?? 0))} % tolerance ${partPhrase(a)} moves the on-axis sum up to ${db(a.tolDb)} (at ${fmtFreq(va.atHz)})`
        + (two ? `, ${partPhrase(b)} up to ${db(b.tolDb)}` : "")
        + `. Pick the basket part that measures closest to the design value.`,
      view: "sensitivity",
      alsoIn: ["response"],
      at: va.atHz,
      focus: a.focus,
      weight: Math.min(1, a.tolDb / 2),
    });
  } else if (a) {
    out.push({
      id: "sens.robust",
      severity: "good",
      title: `The design is robust: no part within its tolerance moves the sum more than ${db(a.tolDb)}`,
      detail: `Every passive part was moved by its tolerance (L ±5 %, C ±10 %, R ±5 %) on its own; the largest change of the on-axis sum is ${db(a.tolDb)}, from ${partPhrase(a)}.`,
      view: "sensitivity",
      focus: a.focus,
      weight: 0.2,
    });
  }
  return out;
};
