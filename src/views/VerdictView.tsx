// Verdict view: is this a good crossover, and why. A score with a one-line verdict, the five groups at
// a glance, tested suggestions that raise the score, and every criterion with what it measures, why it
// matters for the sound, what this design does and what to change, next to a plot that shows it.

import { useMemo, useState } from "react";
import { ArrowUpRight, Check, CircleHelp, Lightbulb, Wand2 } from "lucide-react";
import { Plot, type PlotBand, type PlotHBand, type PlotSeries, type PlotVLine } from "../charts";
import { boxModelCurves, GROUPS, resistorPower, RESISTOR_RATING_W, TEST_POWER_W, type Assessment, type Criterion, type CriterionGroup } from "../engine";
import { Badge, Button, StatusDot, fmtFreq, toast } from "../ui";
import { focusControl } from "../ui/shell/commands";
import { useStore } from "../state/store";
import type { Design, Results } from "../types";
import type { Prepared } from "../engine";
import { ViewHeader, crossoverLines, judgeBand, useProbe, useSize } from "./common";
import { TRACE_META, db, mag, responseRange } from "./data";
import { RATING_TONE, useAssessment, useSuggestions } from "./assessment";
import "./verdict.css";

export function VerdictView() {
  const a = useAssessment();
  const [picked, setPicked] = useState<string | null>(null);
  if (!a) return <div className="vw-view" />;
  const selected = a.criteria.find(c => c.id === (picked ?? a.issues[0] ?? a.criteria[0].id)) ?? a.criteria[0];
  return (
    <div className="vw-view vd-view">
      <ViewHeader title="Verdict">
        Is this a good crossover, and why. Every criterion says what it measures, why it matters for the sound, what this
        design does and what to change. The score is an engineering judgement from your measurements; the listening test decides.
      </ViewHeader>
      <div className="vd-top">
        <Hero a={a} onPick={setPicked} />
        <Suggestions a={a} />
      </div>
      <div className="vd-main">
        <CriteriaList a={a} selected={selected.id} onPick={setPicked} />
        <Detail c={selected} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- score + groups
function groupScore(a: Assessment, g: CriterionGroup) {
  const cs = a.criteria.filter(c => c.group === g && c.weight > 0);
  const w = cs.reduce((s, c) => s + c.weight, 0);
  const worst = cs.some(c => c.state === "bad") ? "bad" : cs.some(c => c.state === "warn") ? "warn" : "good";
  return { score: w ? Math.round(100 * cs.reduce((s, c) => s + c.weight * c.score, 0) / w) : 100, state: worst as "good" | "warn" | "bad", n: cs.length };
}

function Hero({ a, onPick }: { a: Assessment; onPick: (id: string) => void }) {
  const tone = RATING_TONE[a.rating];
  const R = 34, C = 2 * Math.PI * R;
  return (
    <section className="vw-card vd-hero" aria-label="Overall verdict">
      <div className="vd-score">
        <svg viewBox="0 0 84 84" className={`vd-ring is-${tone}`} aria-hidden>
          <circle cx="42" cy="42" r={R} className="vd-ring-track" />
          <circle cx="42" cy="42" r={R} className="vd-ring-arc" strokeDasharray={`${C * a.score / 100} ${C}`} transform="rotate(-90 42 42)" />
        </svg>
        <div className="vd-score-num"><span className="mono">{a.score}</span><small>/100</small></div>
      </div>
      <div className="vd-hero-text">
        <div className="vd-rating">
          <Badge tone={tone} solid>{a.rating}</Badge>
          <span className="vd-counts mono">
            {a.criteria.filter(c => c.state === "good").length} met · {a.criteria.filter(c => c.state === "warn").length} close · {a.criteria.filter(c => c.state === "bad").length} failed
          </span>
        </div>
        <p className="vd-headline">{a.headline}</p>
        <ul className="vd-groups">
          {GROUPS.map(g => {
            const s = groupScore(a, g.id);
            if (!s.n) return null;
            const first = a.criteria.find(c => c.group === g.id && c.state !== "good") ?? a.criteria.find(c => c.group === g.id)!;
            return (
              <li key={g.id}>
                <button type="button" className={`vd-group is-${s.state}`} onClick={() => onPick(first.id)} title={g.blurb}>
                  <span className="vd-group-name">{g.title}</span>
                  <span className="vd-group-bar"><span style={{ width: `${s.score}%` }} /></span>
                  <span className="vd-group-num mono">{s.score}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- tested suggestions
function Suggestions({ a }: { a: Assessment }) {
  const { list, busy } = useSuggestions(a);
  const setDesign = useStore(s => s.setDesign);
  const undo = useStore(s => s.undo);
  const apply = (d: Design, label: string, gain: number) => {
    setDesign(structuredClone(d));
    toast({ id: "verdict-apply", tone: "good", title: label, description: `Score +${gain}.`, action: { label: "Undo", onClick: undo } });
  };
  return (
    <section className="vw-card vd-sugg" aria-label="Suggestions">
      <header className="vw-card-head">
        <h2 className="vw-card-title"><Lightbulb size={13} aria-hidden /> Try this</h2>
        <div className="vw-card-actions">{busy ? <span className="vw-muted">testing…</span> : <span className="vw-muted">each change tested on your data</span>}</div>
      </header>
      {list.length === 0 && !busy && (
        <p className="vd-empty"><Check size={14} aria-hidden /> No single small change improves this design. Try the optimiser for bigger moves, or listen to it.</p>
      )}
      <ol className="vd-sugg-list">
        {list.map(s => (
          <li key={s.label} className="vd-sugg-item">
            <span className="vd-sugg-gain mono">+{s.gain}</span>
            <div className="vd-sugg-text">
              <button type="button" className="vd-sugg-label" onClick={() => s.focus && focusControl(s.focus)} title="Show this control in the inspector">{s.label}</button>
              <span className="vd-sugg-effects">
                {s.effects.slice(0, 3).map(e => (
                  <span key={e.id} className={e.delta > 0 ? "is-up" : "is-down"}>{e.title} {e.delta > 0 ? "↑" : "↓"}</span>
                ))}
              </span>
            </div>
            <Button size="sm" variant="subtle" icon={Wand2} onClick={() => apply(s.design, s.label, s.gain)}>Apply</Button>
          </li>
        ))}
      </ol>
    </section>
  );
}

// ---------------------------------------------------------------- criteria
function CriteriaList({ a, selected, onPick }: { a: Assessment; selected: string; onPick: (id: string) => void }) {
  return (
    <div className="vd-list" role="listbox" aria-label="Criteria">
      {GROUPS.map(g => {
        const cs = a.criteria.filter(c => c.group === g.id);
        if (!cs.length) return null;
        return (
          <section key={g.id} className="vd-list-group">
            <h3 className="vd-list-title">{g.title}<span>{g.blurb}</span></h3>
            {cs.map(c => (
              <button key={c.id} type="button" role="option" aria-selected={c.id === selected}
                      className={`vd-crit is-${c.state}${c.id === selected ? " is-selected" : ""}`} onClick={() => onPick(c.id)}>
                <StatusDot state={c.state} />
                <span className="vd-crit-text">
                  <span className="vd-crit-title">{c.title}{c.weight === 0 && <em> info</em>}</span>
                  <span className="vd-crit-summary">{c.summary}</span>
                </span>
                <span className="vd-crit-value mono" title={c.value}>{c.weight ? Math.round(c.score * 100) : "–"}</span>
              </button>
            ))}
          </section>
        );
      })}
    </div>
  );
}

function Detail({ c }: { c: Criterion }) {
  const [, setProbe] = useProbe();
  return (
    <section className="vw-card vd-detail" aria-label={c.title}>
      <header className="vd-detail-head">
        <StatusDot state={c.state} />
        <h2>{c.title}</h2>
        <span className="vd-detail-score mono">{Math.round(c.score * 100)}<small>/100</small></span>
      </header>
      <div className="vd-detail-nums">
        <div><span>This design</span><b className={`mono is-${c.state}`}>{c.value}</b></div>
        <div><span>Target</span><b className="mono">{c.target}</b></div>
        <div><span>Weight</span><b className="mono">{c.weight ? `×${c.weight}` : "info"}</b></div>
      </div>
      <div className="vd-explain">
        <div><h3><CircleHelp size={13} aria-hidden /> Why it matters</h3><p>{c.why}</p></div>
        <div><h3>In this design</h3><p>{c.finding}</p></div>
        <div className={c.fix ? "is-fix" : "is-ok"}>
          <h3>{c.fix ? "What to change" : "Nothing to change"}</h3>
          <p>{c.fix || "This criterion is met. Keep an eye on it when you change something else."}</p>
          <div className="vd-explain-actions">
            {c.focus && <Button size="sm" variant="subtle" icon={ArrowUpRight} onClick={() => focusControl(c.focus!)}>Show the control</Button>}
            {c.at && <Button size="sm" variant="ghost" onClick={() => setProbe(c.at!)}>Probe {fmtFreq(c.at)}</Button>}
          </div>
        </div>
      </div>
      <CriterionPlot c={c} />
    </section>
  );
}

// ---------------------------------------------------------------- the plot for each criterion
interface PlotSpec {
  title: string; series: PlotSeries[]; yUnit: string; yLabel: string; yRange?: [number, number];
  xRange: [number, number]; bands?: PlotBand[]; hBands?: PlotHBand[]; vLines?: PlotVLine[];
}

function phaseDiffDeg(a: { re: Float64Array; im: Float64Array }, b: { re: Float64Array; im: Float64Array }): Float64Array {
  const n = a.re.length, y = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const re = a.re[i] * b.re[i] + a.im[i] * b.im[i], im = a.im[i] * b.re[i] - a.re[i] * b.im[i];
    y[i] = Math.atan2(im, re) * 180 / Math.PI;
  }
  return y;
}

function specFor(c: Criterion, r: Results, p: Prepared, design: Design): PlotSpec | null {
  const on = r.angles["0"], m = r.metrics, level = m.on.level, f = r.f;
  const resp = (units: ("woof" | "mid" | "tw" | "sum")[]): PlotSeries[] => units.map(u => ({
    id: u, label: TRACE_META[u].name, x: f, y: db(on[u]), color: TRACE_META[u].color, width: u === "sum" ? 2.25 : 1.5,
  }));
  const hl = c.band ? [{ id: "hl", x: c.band, lower: [-200, -200], upper: [200, 200], color: c.state === "good" ? "good" : c.state === "warn" ? "warn" : "bad", opacity: 0.07 }] : [];
  switch (c.id) {
    case "flat": case "canc": case "xover":
      return { title: "On-axis response", series: resp(["woof", "mid", "tw", "sum"]), yUnit: "dB", yLabel: "Level", yRange: responseRange(level),
               xRange: [20, 20000], bands: [judgeBand(level), ...(c.id === "canc" ? hl : [])], vLines: crossoverLines(m) };
    case "balance": {
      // the mean level of each band as a flat segment over that band
      const segs: PlotSeries[] = [];
      const x1 = m.x_wm ?? 400, x2 = m.x_mt ?? 3000;
      const bands: [string, number, number][] = [["woof", 150, x1 / Math.SQRT2], ["mid", x1 * Math.SQRT2, x2 / Math.SQRT2], ["tw", x2 * Math.SQRT2, 15000]];
      const sum = db(on.sum);
      for (const [u, lo, hi] of bands) {
        let s = 0, n = 0;
        for (let i = 0; i < f.length; i++) if (f[i] >= lo && f[i] <= hi && Number.isFinite(sum[i])) { s += sum[i]; n++; }
        if (n) segs.push({ id: `band:${u}`, label: `${TRACE_META[u as "woof"].name} band`, x: [lo, hi], y: [s / n, s / n], color: TRACE_META[u as "woof"].color, width: 4 });
      }
      return { title: "Band levels against the system level", series: [...resp(["sum"]), ...segs], yUnit: "dB", yLabel: "Level",
               yRange: [level - 12, level + 6], xRange: [100, 20000], bands: [judgeBand(level, 1)], vLines: crossoverLines(m) };
    }
    case "blend_wm": case "blend_mt": {
      const [a, b] = c.id === "blend_wm" ? (["woof", "mid"] as const) : (["mid", "tw"] as const);
      const x = (c.id === "blend_wm" ? m.x_wm : m.x_mt) ?? c.at ?? 1000;
      return { title: `Phase difference ${TRACE_META[a].name.toLowerCase()} − ${TRACE_META[b].name.toLowerCase()}`,
               series: [{ id: "dphi", label: "Δφ", x: f, y: phaseDiffDeg(on[a], on[b]), color: "accent", width: 2, wrapPhase: true }],
               yUnit: "°", yLabel: "Δφ", yRange: [-180, 180], xRange: [x / 8, Math.min(20000, x * 8)],
               hBands: [{ from: -30, to: 30, color: "good", opacity: 0.12, label: "±30° blend" }, { from: 150, to: 180, color: "bad", opacity: 0.1 }, { from: -180, to: -150, color: "bad", opacity: 0.1 }],
               vLines: [{ x, label: fmtFreq(x), style: "dashed", color: "text-3" }],
               bands: [{ id: "overlap", x: [x / Math.SQRT2, x * Math.SQRT2], lower: [-180, -180], upper: [180, 180], color: "accent", opacity: 0.06 }] };
    }
    case "off": {
      const a = m.offAngle ?? "30", o = r.angles[a];
      return { title: `On axis and at ${a}°`, series: [
                 { id: "on", label: "0°", x: f, y: db(on.sum), color: "sum", width: 2 },
                 { id: "off", label: `${a}°`, x: f, y: db(o.sum), color: "accent", width: 1.75, dash: [6, 4] }],
               yUnit: "dB", yLabel: "Level", yRange: responseRange(level), xRange: [100, 20000], bands: hl, vLines: crossoverLines(m) };
    }
    case "twfs": {
      const fs = p.profile.limits.tw_fs_hz;
      return { title: "Tweeter output around its resonance", series: resp(["tw", "sum"]), yUnit: "dB", yLabel: "Level",
               yRange: responseRange(level), xRange: [300, 20000], vLines: [{ x: fs, label: `fs ${fmtFreq(fs)}`, color: "bad", style: "dashed" }],
               hBands: [{ from: level - 60, to: level - 12, color: "good", opacity: 0.06, label: "≥ 12 dB down" }] };
    }
    case "load":
      return { title: "Load on amplifier channel 2", series: [{ id: "z", label: "|Z| ch. 2", x: f, y: mag(on.Zamp2), color: "accent", width: 2 }],
               yUnit: "Ω", yLabel: "|Z|", yRange: [0, 16], xRange: [100, 20000],
               hBands: [{ from: 0, to: 3, color: "bad", opacity: 0.14 }, { from: 3, to: 4, color: "warn", opacity: 0.12, label: "< 4 Ω" }] };
    case "bass": {
      const bc = boxModelCurves(p, design);
      return { title: "Woofer box model, 2.83 V at 1 m", series: [
                 { id: "box", label: bc.label, x: bc.f, y: bc.spl_dB, color: "woof", width: 2 },
                 { id: "plug", label: "vents plugged", x: bc.f, y: bc.plugged.spl_dB, color: "ref", dash: [5, 4] }],
               yUnit: "dB", yLabel: "SPL", xRange: [10, 400] };
    }
    case "vent": {
      const bc = boxModelCurves(p, design), k = Math.sqrt(TEST_POWER_W * 8) / 2.83 * 10 ** (design.digital.g_woof_dB / 20);
      return { title: `Vent air speed at ${TEST_POWER_W} W`, series: [{ id: "v", label: "peak air speed", x: bc.f, y: bc.ventSpeed_ms.map(v => v * k), color: "woof", width: 2 }],
               yUnit: "m/s", yLabel: "Speed", yRange: [0, 30], xRange: [10, 400],
               hBands: [{ from: 10, to: 20, color: "warn", opacity: 0.1 }, { from: 20, to: 30, color: "bad", opacity: 0.12, label: "chuffing" }] };
    }
    default: return null;
  }
}

function CriterionPlot({ c }: { c: Criterion }) {
  const results = useStore(s => s.results)!;
  const prep = useStore(s => s.prep)!;
  const design = useStore(s => s.design);
  const [probe, setProbe] = useProbe();
  const [ref, size] = useSize<HTMLDivElement>();
  const spec = useMemo(() => { try { return specFor(c, results, prep, design); } catch { return null; } }, [c, results, prep, design]);

  if (!spec) return <PartsTable c={c} />;
  return (
    <div className="vd-plot" ref={ref}>
      {size.height > 0 && (
        <Plot height={size.height} xRange={spec.xRange} yRange={spec.yRange} yLabel={spec.yLabel} yUnit={spec.yUnit}
              title={<span className="vw-plot-title">{spec.title}</span>} series={spec.series} bands={spec.bands} hBands={spec.hBands}
              vLines={spec.vLines} probeHz={probe} onProbe={setProbe} syncId={`verdict-${c.id}`} ariaLabel={spec.title} />
      )}
    </div>
  );
}

/** For the build and resistor criteria: the parts on the board, their stock status and their heat. */
function PartsTable({ c }: { c: Criterion }) {
  const prep = useStore(s => s.prep)!;
  const design = useStore(s => s.design);
  const rows = useMemo(() => {
    const heat = new Map(resistorPower(prep, design).map(x => [x.id, x]));
    const C = prep.profile.components, out: { id: string; kind: string; value: string; stock: boolean; heat?: string }[] = [];
    for (const unit of ["mid", "tw"] as const) {
      const b = design[unit];
      const add = (id: string, kind: "L" | "C" | "R", v: number) => out.push({
        id, kind, value: kind === "L" ? `${+(v * 1e3).toPrecision(3)} mH` : kind === "C" ? `${+(v * 1e6).toPrecision(3)} µF` : `${+v.toPrecision(3)} Ω`,
        stock: C[kind].some(x => Math.abs(x / v - 1) < 0.005),
        heat: heat.has(id) ? `${(heat.get(id)!.pinkPerW * TEST_POWER_W).toFixed(2)} W` : undefined,
      });
      for (const [n, v] of Object.entries(b.vals)) add(`${unit}.${n}`, n[0] as "L" | "C", v);
      if (b.pad?.Rs) add(`${unit}.pad.Rs`, "R", b.pad.Rs);
      if (b.pad?.Rp) add(`${unit}.pad.Rp`, "R", b.pad.Rp);
      if (b.zobel) { add(`${unit}.zobel`, "R", b.zobel.R); add(`${unit}.zobel`, "C", b.zobel.C); }
    }
    return out;
  }, [prep, design]);
  return (
    <div className="vd-table-wrap">
      <table className="vd-table">
        <thead><tr><th>Part</th><th>Value</th><th>In the basket</th><th>Heat at {TEST_POWER_W} W of music</th></tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.id + i} onClick={() => focusControl(r.id)} title="Show this part in the inspector">
              <td className="mono">{r.id.replace(".pad.", " ")}</td>
              <td className="mono">{r.value}</td>
              <td className={r.stock ? "is-good" : "is-bad"}>{r.stock ? "yes" : "no"}</td>
              <td className="mono">{r.heat ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {c.id === "resistors" && <p className="vd-note">Heat assumes {RESISTOR_RATING_W} W resistors should stay at half their rating; check the rating printed on the basket's resistors.</p>}
    </div>
  );
}
