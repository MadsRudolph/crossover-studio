// What the AI chat knows about the design before it calls a tool: a compact summary of the profile,
// the design, the metrics, the verdict, the current insights, the probe and the view. Every number here
// comes from the app's own engine; the model is told to check anything finer with the tools (tools.ts).
// Values are given in the units the inspector shows (mH, µF, Ω, mm, Hz, dB), rounded to what matters.

import type { BoxFit, Design, PassiveBranch, Profile, Results, UnitId } from "../types";
import { UNIT_IDS } from "../types";
import { assess, probeSample, type Assessment, type Prepared } from "../engine";
import { collectInsights, type Insight } from "../insights";
import type { ViewId } from "../state/store";
import { VIEW_INFO } from "./views";

/** Everything the summary and the tools read: one consistent state of the app. */
export interface ChatEnv {
  profile: Profile;
  fit: BoxFit;
  prep: Prepared;
  design: Design;
  results: Results;
  probe: number;
  view: ViewId;
}

/** Rounds to `sig` significant digits (and never prints -0). */
export const sig = (x: number, n = 3): number => (x === 0 || !Number.isFinite(x) ? 0 : Number(x.toPrecision(n)) + 0);
const r1 = (x: number) => Math.round(x * 10) / 10 + 0;

/** A part value in display units: L in mH, C in µF, R in Ω. */
export function partDisplay(kind: string, v: number): number {
  return kind === "L" ? sig(v * 1e3) : kind === "C" ? sig(v * 1e6) : sig(v);
}

function branchSummary(b: PassiveBranch) {
  const parts: Record<string, string> = {};
  for (const [name, v] of Object.entries(b.vals)) parts[name] = `${partDisplay(name[0], v)} ${name[0] === "L" ? "mH" : name[0] === "C" ? "µF" : "Ω"}`;
  return {
    topology: b.topo,
    parts,
    pad: b.pad && (b.pad.Rs || b.pad.Rp) ? { Rs_ohm: b.pad.Rs || null, Rp_ohm: b.pad.Rp ?? null } : "none",
    zobel: b.zobel ? { R_ohm: b.zobel.R, C_uF: sig(b.zobel.C * 1e6) } : "none",
  };
}

function verdictSummary(a: Assessment) {
  return {
    score: Math.round(a.score), rating: a.rating, headline: a.headline,
    criteria: a.criteria.map(c => ({
      id: c.id, title: c.title, state: c.state, value: c.value, target: c.target,
      finding: c.finding, ...(c.fix ? { fix: c.fix } : {}),
    })),
  };
}

function insightSummary(list: Insight[], max = 8) {
  return list.slice(0, max).map(i => ({
    severity: i.severity, title: i.title, detail: i.detail, view: i.view,
    ...(i.at ? { at_hz: sig(i.at) } : {}), ...(i.fix ? { tested_fix: i.fix.label } : {}),
  }));
}

/** The summary as a plain object (tests read it; contextText() serialises it for the model). */
export function buildContext(env: ChatEnv, opts: { assessment?: Assessment; insights?: Insight[] } = {}) {
  const { profile: P, fit, prep, design: d, results: R } = env;
  const a = opts.assessment ?? assess(prep, d, R);
  const insights = opts.insights ?? collectInsights({ profile: P, fit, prep, design: d, results: R });
  const m = R.metrics, wb = P.woofer_box;
  const probe = probeSample(prep, R, env.probe, "0");
  const unit = (u: UnitId) => ({ driver: P.units[u].label, role: P.units[u].role, diameter_mm: Math.round(P.units[u].diameter_m * 1000) });

  return {
    profile: {
      name: P.name,
      units: { woof: unit("woof"), mid: unit("mid"), tw: unit("tw") },
      woofer_box: {
        inner_volume_L: r1(wb.inner_m[0] * wb.inner_m[1] * wb.inner_m[2] * 1000),
        vents: wb.vents.map(v => ({ id: v.id, diameter_mm: Math.round(v.diameter_m * 1000), ...(v.estimated ? { diameter_estimated: true } : {}),
                                    ...(v.length_range_m ? { length_range_mm: v.length_range_m.map(x => Math.round(x * 1000)) } : {}) })),
      },
      woofer_fit: { fs_hz: sig(fit.ts.fs), Qts: sig(fit.ts.Qts), Qes: sig(fit.ts.Qes), Qms: sig(fit.ts.Qms), Vas_L: sig(fit.ts.Vas_L), Re_ohm: sig(fit.RE) },
      measured_angles_deg: prep.angles.map(Number),
      targets: { woofer_mid_crossover_hz: P.limits.wm, mid_tweeter_crossover_hz: P.limits.mt, tweeter_resonance_hz: P.limits.tw_fs_hz },
      parts_basket: { L_mH: P.components.L.map(v => sig(v * 1e3)), C_uF: P.components.C.map(v => sig(v * 1e6)), R_ohm: P.components.R.map(v => sig(v)) },
    },
    design: {
      box: { mode: d.box.mode, vent_A_mm: Math.round(d.box.L * 1000), ...(d.box.mode === "two" ? { vent_B_mm: Math.round(d.box.L2 * 1000), vent_B_diameter_mm: Math.round(d.box.a2 * 2000) } : {}),
             fill: d.box.fill },
      digital: { fc_hz: d.digital.fc, alignment: d.digital.align, woofer_gain_db: d.digital.g_woof_dB },
      mid: branchSummary(d.mid),
      tw: branchSummary(d.tw),
      polarity: d.pol,
      coil_resistance_ohm_per_mH: d.Rdcr,
    },
    metrics: {
      on_axis: { spread_db: r1(m.on.spread), rms_db: r1(m.on.rms), level_db: r1(m.on.level) },
      ...(m.off30 ? { off_axis: { angle_deg: Number(m.offAngle), spread_db: r1(m.off30.spread), level_db: r1(m.off30.level) } } : {}),
      crossover_woofer_mid_hz: m.x_wm === null ? null : sig(m.x_wm),
      crossover_mid_tweeter_hz: m.x_mt === null ? null : sig(m.x_mt),
      min_amp_load_ohm: sig(m.Zamp2_min),
      box: { tuning_hz: R.box.fB === null ? null : sig(R.box.fB), f3_hz: sig(R.box.f3), bass_ripple_db: r1(R.box.ripple), label: R.box.label },
    },
    checks: R.checks.map(c => ({ id: c.id, state: c.state, title: c.title, detail: c.detail })),
    verdict: verdictSummary(a),
    insights: insightSummary(insights),
    probe: {
      freq_hz: sig(probe.f),
      level_rel_db: Object.fromEntries([...UNIT_IDS, "sum" as const].map(u => [u, r1(probe.units[u].relDb)])),
    },
    current_view: env.view,
    views: VIEW_INFO,
  };
}

/** The summary as the model reads it: compact JSON. */
export function contextText(env: ChatEnv, opts?: Parameters<typeof buildContext>[1]): string {
  return JSON.stringify(buildContext(env, opts));
}

/** Starter questions for the empty chat, from the current top insights and verdict issues. */
export function starterQuestions(insights: Insight[], a: Assessment | null, max = 4): string[] {
  const out: string[] = [];
  for (const i of insights) {
    if (i.severity !== "bad" && i.severity !== "warn") continue;
    const title = i.title.replace(/[.!]$/, "");
    out.push(`Explain: ${title}${i.at && !/\d\s?k?Hz/.test(title) ? ` (${fmtHz(i.at)})` : ""}`);
    if (out.length >= 2) break;
  }
  const worst = a?.issues[0] ? a.criteria.find(c => c.id === a.issues[0]) : undefined;
  // the worst criterion, unless the insights already asked about it
  if (worst && out.length < 2) out.push(`How do I fix "${worst.title}"?`);
  const fallback = ["What would raise my score the most?", "Is the tweeter safe at loud levels?", "Explain my crossover in plain words."];
  for (const q of fallback) if (out.length < max && !out.includes(q)) out.push(q);
  return out.slice(0, max);
}

const fmtHz = (x: number) => (x >= 1000 ? `${sig(x / 1000, 2)} kHz` : `${Math.round(x)} Hz`);
