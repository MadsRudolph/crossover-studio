// Insight provider: time. How the units line up in time at the two crossovers (and what that does off
// axis), and whether the group delay of the sum is anywhere near audible (Blauert & Laws). Uses only
// the cheap group-delay analysis (well under 1 ms, cached per Results); the impulse and step
// responses (about 60 ms) stay in the Time view. A polarity flip is offered as a fix only when it is
// tested to raise the verdict score.
import { assess, cachedGroupDelay, compute, gdThreshold, offAxisAngle, type XoverTiming } from "../../engine";
import { fmtFreq } from "../../ui/format";
import type { AngleResult, Design, UnitId } from "../../types";
import type { Insight, InsightContext, InsightProvider } from "../types";

const NAME: Record<UnitId, string> = { woof: "woofer", mid: "midrange", tw: "tweeter" };
const ms = (x: number) => { const a = Math.abs(x); return `${a < 0.995 ? a.toFixed(2) : a < 9.95 ? a.toFixed(1) : a.toFixed(0)} ms`; };
/** Below this the two units count as arriving together (ms): 0.05 ms is under 1/5 period at 3.8 kHz. */
const TOGETHER_MS = 0.05;

/** Complex sum minus power sum of the pair at the grid point nearest f (dB): +3 in phase, < 0 cancels. */
function pairGain(f: Float64Array, out: AngleResult, a: UnitId, b: UnitId, x: number): number {
  let i = 0;
  for (let k = 1; k < f.length; k++) if (Math.abs(Math.log(f[k] / x)) < Math.abs(Math.log(f[i] / x))) i = k;
  const A = out[a], B = out[b];
  const s = (A.re[i] + B.re[i]) ** 2 + (A.im[i] + B.im[i]) ** 2, pw = A.re[i] ** 2 + A.im[i] ** 2 + B.re[i] ** 2 + B.im[i] ** 2;
  return 10 * Math.log10(s / pw);
}

/** The flip of the upper unit's polarity, when it raises the verdict score by at least one point. */
function testedFlip(ctx: InsightContext, u: UnitId): Insight["fix"] {
  try {
    const base = assess(ctx.prep, ctx.design, ctx.results).score;
    const d: Design = structuredClone(ctx.design);
    d.pol[u] = d.pol[u] === 1 ? -1 : 1;
    const s = assess(ctx.prep, d, compute(ctx.prep, d)).score;
    return s >= base + 1 ? { label: `Invert the ${NAME[u]} (score +${Math.round(s - base)})`, design: d } : undefined;
  } catch { return undefined; }
}

function xoverInsight(ctx: InsightContext, key: "wm" | "mt", on: XoverTiming, off: XoverTiming | null, offAngle?: string): Insight {
  const lo = NAME[on.lo], hi = NAME[on.hi], ph = Math.abs(on.phaseDeg), where = fmtFreq(on.f);
  const together = Math.abs(on.leadMs) < TOGETHER_MS;
  const leader = on.leadMs > 0 ? hi : lo, follower = on.leadMs > 0 ? lo : hi;
  const gain0 = pairGain(ctx.results.f, ctx.results.angles["0"], on.lo, on.hi, on.f);
  const severity = ph > 90 ? "warn" : "info";

  const title = together
    ? `The ${lo} and ${hi} arrive together at the ${where} crossover`
    : `The ${leader} leads the ${follower} by ${ms(on.leadMs)} at the ${where} crossover`;
  let detail = ph > 90
    ? `They are ${ph.toFixed(0)}° apart in phase there, so they partly cancel (the pair sums ${gain0.toFixed(1)} dB against the power sum). `
    : `In phase they are ${ph.toFixed(0)}° apart, so they still add (the pair sums ${gain0 >= 0 ? "+" : ""}${gain0.toFixed(1)} dB against the power sum, +3 dB is perfect). `;
  if (!together && ph <= 90) detail += `A group-delay difference with the phases lined up only means one unit's sound builds up a little later; you do not hear it at a crossover this smooth. `;
  // off axis: only claim the dip when the phase really drifts apart there and the sum really dips
  if (off && offAngle) {
    const gOff = pairGain(ctx.results.f, ctx.results.angles[offAngle], on.lo, on.hi, on.f), phOff = Math.abs(off.phaseDeg);
    if (gOff < -1 && phOff > Math.max(90, ph + 20))
      detail += `At ${offAngle}° the path to each unit changes, they drift ${phOff.toFixed(0)}° apart and the pair dips ${gOff.toFixed(1)} dB below the power sum: that is why the ${offAngle}° response dips there.`;
  }
  return {
    id: `time.x${key}`,
    severity,
    title,
    detail: detail.trim(),
    view: "time",
    alsoIn: ["phase", ...(severity === "warn" ? ["response" as const] : [])],
    at: on.f,
    band: [on.f / 2 ** (1 / 3), on.f * 2 ** (1 / 3)],
    focus: severity === "warn" ? `${on.hi}.pol` : undefined,
    fix: severity === "warn" ? testedFlip(ctx, on.hi) : undefined,
    weight: severity === "warn" ? 0.7 : 0.25,
  };
}

export const timeInsights: InsightProvider = (ctx) => {
  const { prep, design, results } = ctx;
  const a = cachedGroupDelay(prep, design, results, "0");
  const offAngle = offAxisAngle(Object.keys(results.angles));
  const b = offAngle ? cachedGroupDelay(prep, design, results, offAngle) : null;
  const out: Insight[] = [];
  for (const k of ["wm", "mt"] as const) {
    const on = a.xover[k];
    if (on) out.push(xoverInsight(ctx, k, on, b?.xover[k] ?? null, offAngle));
  }

  // group-delay distortion of the sum against the published threshold
  const g = a.audibility;
  if (Number.isFinite(g.atHz)) {
    const pct = Math.round(100 * g.ratio), f0 = a.f[0], low = a.gd.sum[0] - a.midbandMs;
    const bassNote = g.atHz < 100 || !Number.isFinite(low) ? ""
      : ` The vented box adds ${ms(low)} at ${fmtFreq(f0)}, where the limit is about ${ms(gdThreshold(f0) * 1e3)}.`;
    out.push({
      id: "time.gd-audible",
      severity: g.ratio >= 1 ? "warn" : g.ratio >= 0.7 ? "info" : "good",
      title: g.ratio >= 1
        ? `The group delay is likely audible: ${ms(g.excessMs)} extra at ${fmtFreq(g.atHz)}`
        : `The group delay stays under the audible limit (worst ${pct} % of it, at ${fmtFreq(g.atHz)})`,
      detail: `At ${fmtFreq(g.atHz)} the sum is ${ms(g.excessMs)} ${g.excessMs >= 0 ? "later" : "earlier"} than in the midband; listeners start to notice about ${ms(g.thresholdMs)} there (Blauert & Laws, 1978).`
        + (g.ratio < 1 ? bassNote : " Look for a steep filter or a high-Q peak near that frequency."),
      view: "time",
      alsoIn: g.ratio >= 1 ? ["phase"] : undefined,
      at: g.atHz,
      weight: g.ratio >= 1 ? 0.6 : 0.2,
    });
  }
  return out;
};
