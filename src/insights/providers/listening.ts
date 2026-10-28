// Insight provider: listening (project Task 4). Reads the profile's listening-test document (protocol and
// ratings, src/listentest) and turns the group's own ratings into design advice: an attribute rated on
// the bad side ("harshness 5.1/7") points at its frequency region and control, and where the change is
// mechanical (tweeter pad one basket step, woofer gain 1 dB) a tested fix whose verdict score barely
// moves. Before any ratings exist it is a low-weight reminder to plan the test. Cheap: one analysis of a
// few hundred ratings, and at most two design evaluations for the fix.

import type { Design } from "../../types";
import type { Insight, InsightContext, InsightProvider } from "../types";
import { assess, stockNeighbours } from "../../engine/assess";
import { compute } from "../../engine";
import { peekDoc } from "../../listentest/store";
import { ATTRIBUTE_LINKS, oursVariant, type Attribute } from "../../listentest/model";
import { analyse, badSide, conclusions, regionText } from "../../listentest/stats";

/** A tested fix may cost at most this many verdict points (the ears outrank the score, within reason). */
const MAX_SCORE_DROP = 4;

const ohm = (r: number) => `${Number(r.toPrecision(3))} Ω`;

/** Mean level (dB) of the on-axis sum over a band. */
function bandDb(f: Float64Array, re: Float64Array, im: Float64Array, band: [number, number]): number {
  let s = 0, n = 0;
  for (let i = 0; i < f.length; i++) if (f[i] >= band[0] && f[i] <= band[1]) { s += 20 * Math.log10(Math.hypot(re[i], im[i])); n++; }
  return n ? s / n : NaN;
}

/** The mechanical change for an attribute on the bad side, tested with assess; null when none fits. */
function tryFix(ctx: InsightContext, attr: Attribute): { label: string; design: Design; note: string } | null {
  const { prep, design, results, profile } = ctx;
  const cands: { label: string; mut: (d: Design) => void }[] = [];
  if (attr.id === "harsh") {
    const rs = design.tw.pad?.Rs;
    const up = rs ? stockNeighbours(profile.components.R, rs).filter(x => x > rs)[0] : [...profile.components.R].sort((a, b) => a - b)[0];
    if (up) cands.push({ label: rs ? `Tweeter Rs ${ohm(rs)} → ${ohm(up)}` : `Add a ${ohm(up)} tweeter Rs`, mut: d => { d.tw.pad = { ...d.tw.pad, Rs: up }; } });
  } else if (attr.id === "bass-ext") {
    const g = Math.round((design.digital.g_woof_dB + 1) * 10) / 10;
    cands.push({ label: `Woofer gain +1 dB`, mut: d => { d.digital.g_woof_dB = g; } });
  } else return null;
  const link = ATTRIBUTE_LINKS[attr.id];
  const base = assess(prep, design, results).score;
  const before = bandDb(results.f, results.angles["0"].sum.re, results.angles["0"].sum.im, link.band);
  for (const c of cands) {
    const d = structuredClone(design) as Design;
    c.mut(d);
    try {
      const r = compute(prep, d), score = assess(prep, d, r).score;
      if (score < base - MAX_SCORE_DROP) continue;
      const delta = bandDb(r.f, r.angles["0"].sum.re, r.angles["0"].sum.im, link.band) - before;
      const dd = `${delta > 0 ? "+" : "−"}${Math.abs(delta).toFixed(1)} dB over ${regionText(link.band)}`;
      const ds = score - base;
      return { label: c.label, design: d, note: `${dd}; the verdict score ${Math.abs(ds) < 0.5 ? "stays the same" : `changes by ${ds > 0 ? "+" : "−"}${Math.abs(ds).toFixed(0)}`}.` };
    } catch { /* this change does not compute: try the next */ }
  }
  return null;
}

export const listeningInsights: InsightProvider = ctx => {
  const doc = peekDoc(ctx.profile.id);
  const p = doc?.protocol;
  if (!doc || !p || p.variants.length === 0) return [{
    id: "listening.plan", severity: "info", view: "listentest", weight: 0.1,
    title: "Plan the Task 4 listening test",
    detail: "The guide asks for a methodical test, not casual listening. Set up the variants, programme and attributes, print the blind session sheets, then enter the ratings to see what to change.",
  }];
  if (!doc.ratings.length) return [{
    id: "listening.run", severity: "info", view: "listentest", weight: 0.15,
    title: `Listening test planned: ${p.variants.length} variants, ${p.listeners} listeners`,
    detail: "Run the blind sessions (in the app for design variants, or with the printed sheets in the IEC room) and enter the ratings. The results then point at the control to change.",
  }];

  const a = analyse(p, doc.ratings), ours = oursVariant(p), out: Insight[] = [];
  const text = new Map(conclusions(p, a).map(c => [c.attr, c]));
  for (const attr of p.attributes) {
    const link = ATTRIBUTE_LINKS[attr.id];
    const cell = ours ? a.byAttribute.get(attr.id)?.[0].cells.find(c => c.variant === ours.id) : undefined;
    if (!link || !cell || cell.ci.n === 0 || !badSide(attr, cell.ci.mean)) continue;
    const m = cell.ci.mean.toFixed(1);
    const fix = tryFix(ctx, attr);
    const far = attr.better === "high" ? 4 - cell.ci.mean : cell.ci.mean - 4;       // how far past the middle
    out.push({
      id: `listening.${attr.id}`, severity: far >= 1.5 ? "bad" : "warn", view: "listentest", alsoIn: [link.view],
      title: fix ? `Listeners rated ${attr.name.toLowerCase()} ${m}/7: try ${fix.label[0].toLowerCase() + fix.label.slice(1)} (${regionText(link.band)})`
                 : `Listeners rated ${attr.name.toLowerCase()} ${m}/7 (${regionText(link.band)})`,
      detail: `${ours!.name}: ${attr.name.toLowerCase()} ${m} on the 1–7 scale (n = ${cell.ci.n}), on the ${attr.better === "high" ? "low" : "high"} side. ` +
        `The region is ${regionText(link.band)}, set mostly by the ${link.control}: ${link.advice}.` + (fix ? ` Tested: ${fix.note}` : "") +
        (text.get(attr.id)?.text ? ` ${text.get(attr.id)!.text}` : ""),
      focus: link.focus, band: link.band, at: Math.sqrt(link.band[0] * link.band[1]),
      ...(fix ? { fix: { label: fix.label, design: fix.design } } : {}),
      weight: Math.min(1, 0.45 + far / 6),
    });
  }
  if (!out.length) {
    const pref = text.get("pref") ?? [...text.values()][0];
    out.push({
      id: "listening.ok", severity: "good", view: "listentest", weight: 0.3,
      title: `Listening test: no attribute on the bad side (${a.listeners} listener${a.listeners === 1 ? "" : "s"})`,
      detail: (pref?.text ?? "Every rated attribute is on the good side of the scale.") + " Put the method and the table in the report (Export → Report).",
    });
  }
  return out;
};
