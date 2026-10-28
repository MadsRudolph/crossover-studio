// Insight provider: limits. How loud the design can play and what gives up first, with a tested
// change when a passive part or the box sets the limit, and a note when data-sheet values are missing.
// Also home of the Limits view's data-sheet entries: kept per profile id in localStorage (the bundled
// profile is read-only, and an imported one need not be rewritten), merged over the profile's own
// values by limitSettings().

import type { Design, UnitId } from "../../types";
import type { Insight, InsightContext, InsightProvider } from "../types";
import type { ViewId } from "../../state/store";
import {
  assess, compute, limits, limitSettings, stockNeighbours,
  type LimitOverrides, type LimitsResult, type Mechanism, type Prepared,
} from "../../engine";

// ---------------------------------------------------------------- the user's data-sheet entries
const KEY = (id: string) => `crossover-studio.limits.${id}`;
const listeners = new Set<() => void>();

/** The values typed into the Limits view for a profile ({} when none, or storage is unavailable). */
export function loadLimitOverrides(profileId: string): LimitOverrides {
  try { return JSON.parse(localStorage.getItem(KEY(profileId)) || "{}") as LimitOverrides; } catch { return {}; }
}

export function saveLimitOverrides(profileId: string, o: LimitOverrides): void {
  try { localStorage.setItem(KEY(profileId), JSON.stringify(o)); } catch { /* not remembered */ }
  for (const l of listeners) l();
}

/** Called after every save (the view re-reads). Returns the unsubscribe function. */
export function onLimitOverrides(l: () => void): () => void {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

// ---------------------------------------------------------------- phrasing
const NAME: Record<UnitId, string> = { woof: "woofer", mid: "midrange", tw: "tweeter" };
const fmtHz = (x: number) => (x >= 1000 ? `${(x / 1000).toFixed(x >= 10000 ? 1 : 2)} kHz` : `${x.toFixed(0)} Hz`);

/** "before the woofer runs out of stroke at 20 Hz", for one mechanism. */
export function limitReason(m: Mechanism): string {
  const u = m.unit ? NAME[m.unit] : "";
  switch (m.kind) {
    case "xmax": return `before the ${u} runs out of stroke at ${fmtHz(m.worstF)}`;
    case "vent": return `before the vent starts to chuff at ${fmtHz(m.worstF)}`;
    case "thermal": return `before the ${u}'s voice coil overheats`;
    case "resistor": return `before the ${m.label.replace(/ heat$/, "")} overheats (${m.limit.toFixed(0)} W)`;
    case "amp": return `before amplifier channel ${m.id === "amp.ch1" ? "1 (woofer)" : "2 (midrange and tweeter)"} clips`;
  }
}

const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

// ---------------------------------------------------------------- tested fix
interface Cand { label: string; mut: (d: Design) => void }

/** Buildable changes aimed at the limiting mechanism. */
function candidates(ctx: InsightContext, m: Mechanism): Cand[] {
  const d = ctx.design, C = ctx.profile.components, out: Cand[] = [];
  const ohm = (v: number) => `${+v.toPrecision(3)} Ω`;
  const branchPads = (u: "mid" | "tw") => {
    const pad = d[u].pad ?? {}, U = u === "tw" ? "Tweeter" : "Midrange";
    if (pad.Rs) for (const v of stockNeighbours(C.R, pad.Rs)) out.push({ label: `${U} Rs ${ohm(pad.Rs)} → ${ohm(v)}`, mut: x => { x[u].pad = { ...x[u].pad, Rs: v }; } });
    if (pad.Rp) {
      for (const v of stockNeighbours(C.R, pad.Rp)) out.push({ label: `${U} Rp ${ohm(pad.Rp)} → ${ohm(v)}`, mut: x => { x[u].pad = { ...x[u].pad, Rp: v }; } });
      out.push({ label: `Remove the ${NAME[u]} Rp`, mut: x => { x[u].pad = { ...x[u].pad, Rp: null }; } });
    }
    // a different split of the same attenuation: Rs and Rp one step each, the same way
    if (pad.Rs && pad.Rp) {
      const up = (v: number) => stockNeighbours(C.R, v).filter(x => x > v)[0], dn = (v: number) => stockNeighbours(C.R, v).filter(x => x < v)[0];
      const a = up(pad.Rs), b = up(pad.Rp), c = dn(pad.Rs), e = dn(pad.Rp);
      if (a && b) out.push({ label: `${U} L-pad ${ohm(pad.Rs)}/${ohm(pad.Rp)} → ${ohm(a)}/${ohm(b)}`, mut: x => { x[u].pad = { ...x[u].pad, Rs: a, Rp: b }; } });
      if (c && e) out.push({ label: `${U} L-pad ${ohm(pad.Rs)}/${ohm(pad.Rp)} → ${ohm(c)}/${ohm(e)}`, mut: x => { x[u].pad = { ...x[u].pad, Rs: c, Rp: e }; } });
    }
  };
  if (m.kind === "resistor") branchPads(m.id.startsWith("res:tw") ? "tw" : "mid");
  if (m.unit === "tw") {
    const c1 = d.tw.vals.C1;
    if (c1) for (const v of stockNeighbours(C.C, c1).filter(v => v < c1)) out.push({ label: `Tweeter C1 ${+(c1 * 1e6).toPrecision(3)} → ${+(v * 1e6).toPrecision(3)} µF`, mut: x => { x.tw.vals.C1 = v; } });
    branchPads("tw");
  }
  if (m.unit === "woof" && d.box.mode !== "plugged") {
    const range = ctx.profile.woofer_box.vents[0]?.length_range_m;
    for (const dl of [-0.02, 0.02]) {
      const L = Math.round((d.box.L + dl) * 1000) / 1000;
      if (!range || (L >= range[0] && L <= range[1])) out.push({ label: `Vent length ${(d.box.L * 1e3).toFixed(0)} → ${(L * 1e3).toFixed(0)} mm`, mut: x => { x.box.L = L; } });
    }
  }
  return out.slice(0, 8);
}

/** The candidate that lets the target mechanism take the most more (≥ 0.5 dB), without lowering the
 *  loudest clean level or the score. */
function testedFix(ctx: InsightContext, base: LimitsResult, target: Mechanism, overrides: LimitOverrides): { label: string; design: Design; gain: number } | null {
  const p: Prepared = ctx.prep;
  let baseScore: number;
  try { baseScore = assess(p, ctx.design, ctx.results).score; } catch { return null; }
  let best: { label: string; design: Design; gain: number } | null = null;
  for (const c of candidates(ctx, target)) {
    const d = structuredClone(ctx.design) as Design;
    c.mut(d);
    try {
      const r = compute(p, d), lim = limits(p, d, r, limitSettings(ctx.profile, overrides, base.settings.crestDb));
      const after = lim.mechanisms.find(x => x.id === target.id);
      const gain = after ? after.progSpl - target.progSpl : 0;
      if (gain < 0.5 || (best && gain <= best.gain) || lim.maxSpl1m < base.maxSpl1m - 0.05) continue;
      if (assess(p, d, r).score < baseScore) continue;
      best = { label: c.label, design: d, gain };
    } catch { /* an invalid candidate is skipped */ }
  }
  return best;
}

// ---------------------------------------------------------------- the provider
const cache = new WeakMap<object, { key: string; list: Insight[] }>();

export const limitsInsights: InsightProvider = (ctx) => {
  const overrides = loadLimitOverrides(ctx.profile.id), key = JSON.stringify(overrides);
  const hit = cache.get(ctx.results);
  if (hit && hit.key === key) return hit.list;
  const L = limits(ctx.prep, ctx.design, ctx.results, limitSettings(ctx.profile, overrides));
  const m = L.limiting, out: Insight[] = [];
  const next = [...L.mechanisms].sort((a, b) => a.progV - b.progV)[1];
  const alsoIn: ViewId[] | undefined = m.unit === "woof" ? ["box"] : m.kind === "resistor" ? ["verdict"] : undefined;
  // the amplifier is not part of the design: aim the fix at the next part when it is close behind
  const target = m.kind !== "amp" ? m : next && next.kind !== "amp" && next.progSpl - m.progSpl < 6 ? next : null;
  const fix = target ? testedFix(ctx, L, target, overrides) : null;
  const quiet = L.maxSpl1m < 90;
  out.push({
    id: "limits.max", severity: quiet ? "warn" : "info",
    title: `Loudest clean level: about ${L.maxSpl1m.toFixed(0)} dB at 1 m, ${limitReason(m)}`,
    detail: `That is about ${L.maxSplListen.toFixed(0)} dB at ${L.settings.listenM} m in free field, for music with a ${L.settings.crestDb} dB crest factor. `
      + (next ? `Next to give up: ${lower(next.label)} at ${next.progSpl.toFixed(0)} dB. ` : "")
      + (m.estimated ? (m.kind === "amp" ? "The amplifier's size is assumed: enter yours in the Limits view." : "This limit uses an estimate, not a data-sheet value.") : "")
      + (fix && target ? ` ${fix.label} lets the ${lower(target.label)} take ${fix.gain.toFixed(1)} dB more without costing score.` : ""),
    view: "limits", alsoIn, at: m.kind === "amp" || m.kind === "thermal" ? undefined : m.worstF, focus: (target ?? m).focus,
    fix: fix ? { label: fix.label, design: fix.design } : undefined,
    weight: quiet ? 0.6 : 0.3,
  });
  if (L.estimatedUnits.length) {
    const names = L.estimatedUnits.map(u => NAME[u]);
    out.push({
      id: "limits.datasheet", severity: "info",
      title: `Data-sheet values missing for the ${names.join(" and ")}`,
      detail: "The loudness limits use typical values for X_max and the power rating there. Enter the data-sheet figures in the Limits view to get real limits.",
      view: "limits", weight: 0.2,
    });
  }
  cache.set(ctx.results, { key, list: out });
  return out;
};
