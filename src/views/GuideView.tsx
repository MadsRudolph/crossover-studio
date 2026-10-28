// Guide view (the landing view): where the design stands, the one thing to do next, and everything
// else worth knowing, each with a small plot of the curve it is about and a button that fixes it or
// opens the view that explains it. "Design it for me" runs the autopilot (src/engine/autopilot.ts)
// and shows every step it took, with the reason and the numbers, before anything is changed. A
// student can reach a finished, exportable design from here alone; the other views are there to look
// deeper.

import { useMemo, useState } from "react";
import {
  ArrowRight, Camera, Check, ChevronDown, ChevronRight, CircleCheck, Download, Import, Sparkles, SkipForward, Square, Wand2, X,
} from "lucide-react";
import { Plot } from "../charts";
import { AUTOPILOT_STAGES, boxModelCurves, type Assessment, type AutopilotStep, type Prepared } from "../engine";
import type { Design, Results } from "../types";
import { applyInsightFix, insightProbe, showInsight, useSettledInsights, viewTitle } from "../insights/ViewInsights";
import type { Insight, InsightSeverity } from "../insights";
import { BUNDLED_PROFILES, useStore } from "../state/store";
import { STEP_CHECKS } from "../ui/inspector/focus";
import { STEPS, focusControl, openExport, snapshotNow } from "../ui/shell/commands";
import { Badge, Button, ProgressBar, fmtFreq, worstState } from "../ui";
import { ViewHeader, crossoverLines, judgeBand } from "./common";
import { TRACE_META, db, mag, responseRange } from "./data";
import { RATING_TONE, useAssessment } from "./assessment";
import { specFor, type PlotSpec } from "./VerdictView";
import { acceptAutopilot, cancelAutopilot, discardAutopilot, startAutopilot, useAutopilot } from "./autopilotRun";
import "./guide.css";

const SEV_ORDER: InsightSeverity[] = ["bad", "warn", "info"];
const SEV_TITLE: Record<InsightSeverity, string> = { bad: "Fix these", warn: "Worth a look", info: "Good to know", good: "What's already right" };

export function GuideView() {
  const a = useAssessment();
  const insights = useSettledInsights();
  const status = useAutopilot(s => s.status);
  const [skipped, setSkipped] = useState<string[]>([]);
  const open = insights.filter(i => i.severity !== "good");
  const good = insights.filter(i => i.severity === "good");
  const next = open.find(i => !skipped.includes(i.id)) ?? null;
  const rest = open.filter(i => i !== next);

  return (
    <div className="vw-view gd-view">
      <ViewHeader title="Guide">
        Where your design stands and what to do next. Fix things from here, or open the view that explains them.
        “Design it for me” works out a whole design and shows each step before anything changes.
      </ViewHeader>
      <div className="gd-grid">
        <div className="gd-main">
          {a && <Standing a={a} open={open} />}
          <Actions />
          {status !== "idle" ? <AutopilotPanel /> : next ? (
            <NextCard ins={next} onSkip={() => setSkipped(s => [...s, next.id])} canReset={skipped.length > 0} onReset={() => setSkipped([])} />
          ) : (
            <AllDone hasSkipped={skipped.length > 0} onReset={() => setSkipped([])} />
          )}
          {rest.length > 0 && <InsightGroups list={rest} />}
        </div>
        <aside className="gd-side" aria-label="More">
          <ExampleCard />
          {good.length > 0 && <GoodList list={good} />}
        </aside>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- where the design stands
function Standing({ a, open }: { a: Assessment; open: Insight[] }) {
  const checks = useStore(s => s.results?.checks) ?? [];
  const tone = RATING_TONE[a.rating];
  const R = 26, C = 2 * Math.PI * R;
  const n = (sev: InsightSeverity) => open.filter(i => i.severity === sev).length;
  const stepState = (id: string) => id === "check" ? worstState(a.criteria.map(c => c.state))
    : worstState(checks.filter(c => STEP_CHECKS[id]?.includes(c.id)).map(c => c.state));
  const setView = useStore(s => s.setView);
  return (
    <section className="vw-card gd-standing" aria-label="Where the design stands">
      <button type="button" className="gd-score" onClick={() => setView("verdict")} title="Open the verdict: every criterion explained">
        <svg viewBox="0 0 64 64" className={`vd-ring is-${tone}`} aria-hidden>
          <circle cx="32" cy="32" r={R} className="vd-ring-track" />
          <circle cx="32" cy="32" r={R} className="vd-ring-arc" strokeDasharray={`${C * a.score / 100} ${C}`} transform="rotate(-90 32 32)" />
        </svg>
        <span className="gd-score-num mono">{a.score}</span>
      </button>
      <div className="gd-standing-text">
        <div className="gd-standing-top">
          <Badge tone={tone} solid>{a.rating}</Badge>
          <span className="gd-counts">
            <span className="is-bad"><b className="mono">{n("bad")}</b> to fix</span>
            <span className="is-warn"><b className="mono">{n("warn")}</b> worth a look</span>
            <span className="is-good"><b className="mono">{a.criteria.filter(c => c.state === "good").length}</b> met</span>
          </span>
        </div>
        <p className="gd-headline">{a.headline}</p>
        <ol className="gd-steps" aria-label="Workflow steps">
          {STEPS.map((s, i) => {
            const st = stepState(s.id) ?? "good";
            return (
              <li key={s.id}>
                <button type="button" className={`gd-step is-${st}`} onClick={() => focusControl(s.id)} title={`Open step ${i + 1} in the inspector`}>
                  <span className="gd-step-num mono">{st === "good" ? <Check size={11} strokeWidth={2.5} aria-hidden /> : i + 1}</span>
                  <span className="gd-step-name">{SHORT_STEP[s.id] ?? s.title}</span>
                </button>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}
const SHORT_STEP: Record<string, string> = { box: "Box", digital: "Digital", mid: "Midrange", tw: "Tweeter", check: "Check" };

// ---------------------------------------------------------------- the next thing to do
function InsightActions({ ins, onSkip }: { ins: Insight; onSkip?: () => void }) {
  const f = insightProbe(ins);
  return (
    <div className="gd-actions">
      {ins.fix && <Button size="sm" variant="primary" icon={Wand2} onClick={() => applyInsightFix(ins)} title="Apply this tested change (one undo step)">Apply fix: {ins.fix.label}</Button>}
      <Button size="sm" variant="subtle" iconRight={ArrowRight} onClick={() => showInsight(ins)}
              title={`Open ${viewTitle(ins.view)}${f ? `, probe ${fmtFreq(f)}` : ""}${ins.focus ? " and show the control" : ""}`}>
        Show me in {viewTitle(ins.view)}
      </Button>
      {onSkip && <Button size="sm" variant="ghost" icon={SkipForward} onClick={onSkip}>Skip</Button>}
    </div>
  );
}

function NextCard({ ins, onSkip, canReset, onReset }: { ins: Insight; onSkip(): void; canReset: boolean; onReset(): void }) {
  return (
    <section className={`vw-card gd-next is-${ins.severity}`} aria-label="Next thing to do">
      <header className="vw-card-head">
        <h2 className="vw-card-title">Next thing to do</h2>
        <div className="vw-card-actions">
          {canReset && <button type="button" className="gd-link" onClick={onReset}>Show skipped</button>}
          <SevBadge sev={ins.severity} />
        </div>
      </header>
      <h3 className="gd-next-title">{ins.title}</h3>
      <p className="gd-next-detail">{ins.detail}</p>
      <InsightPlot ins={ins} height={190} />
      <InsightActions ins={ins} onSkip={onSkip} />
    </section>
  );
}

function AllDone({ hasSkipped, onReset }: { hasSkipped: boolean; onReset(): void }) {
  return (
    <section className="vw-card gd-next is-good" aria-label="Next thing to do">
      <header className="vw-card-head"><h2 className="vw-card-title">Next thing to do</h2></header>
      <h3 className="gd-next-title"><CircleCheck size={16} aria-hidden /> {hasSkipped ? "Nothing left except what you skipped" : "Nothing needs fixing"}</h3>
      <p className="gd-next-detail">
        {hasSkipped ? "Bring the skipped items back, or move on: export the MiniDSP settings, the parts list and the report."
          : "Every check is met. Export the MiniDSP settings, the parts list and the report, then listen to it."}
      </p>
      <div className="gd-actions">
        <Button size="sm" variant="primary" icon={Download} onClick={openExport}>Export everything</Button>
        {hasSkipped && <Button size="sm" variant="ghost" onClick={onReset}>Show skipped</Button>}
      </div>
    </section>
  );
}

function SevBadge({ sev }: { sev: InsightSeverity }) {
  const t = { bad: ["bad", "Fix"], warn: ["warn", "Worth a look"], info: ["neutral", "Note"], good: ["good", "Met"] } as const;
  return <Badge tone={t[sev][0]}>{t[sev][1]}</Badge>;
}

// ---------------------------------------------------------------- the other insights
function InsightGroups({ list }: { list: Insight[] }) {
  return (
    <section className="vw-card gd-groups" aria-label="Everything else">
      <header className="vw-card-head"><h2 className="vw-card-title">Everything else</h2><span className="vw-muted">{list.length} more</span></header>
      {SEV_ORDER.map(sev => {
        const items = list.filter(i => i.severity === sev);
        if (!items.length) return null;
        return (
          <div key={sev} className="gd-group">
            <h3 className={`gd-group-title is-${sev}`}>{SEV_TITLE[sev]}</h3>
            {items.map(i => <InsightRow key={i.id} ins={i} />)}
          </div>
        );
      })}
    </section>
  );
}

function InsightRow({ ins, quiet }: { ins: Insight; quiet?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`gd-row is-${ins.severity}${open ? " is-open" : ""}`}>
      <button type="button" className="gd-row-head" aria-expanded={open} onClick={() => setOpen(o => !o)}>
        {open ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />}
        <span className="gd-row-dot" aria-hidden />
        <span className="gd-row-title">{ins.title}</span>
        {!quiet && ins.fix && <span className="gd-row-fix"><Wand2 size={12} aria-hidden /> fix</span>}
        <span className="gd-row-view">{viewTitle(ins.view)}</span>
      </button>
      {open && (
        <div className="gd-row-body">
          <p>{ins.detail}</p>
          <InsightPlot ins={ins} height={160} />
          <InsightActions ins={ins} />
        </div>
      )}
    </div>
  );
}

function GoodList({ list }: { list: Insight[] }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="vw-card gd-good" aria-label="What's already right">
      <button type="button" className="gd-good-head" aria-expanded={open} onClick={() => setOpen(o => !o)}>
        {open ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />}
        <span className="vw-card-title">What's already right</span>
        <span className="gd-good-count mono">{list.length}</span>
      </button>
      {open && <div className="gd-good-list">{list.map(i => <InsightRow key={i.id} ins={i} quiet />)}</div>}
    </section>
  );
}

// ---------------------------------------------------------------- actions
function Actions() {
  const status = useAutopilot(s => s.status);
  const hasSnap = useStore(s => s.snapshots.length);
  return (
    <section className="vw-card gd-big" aria-label="Actions">
      <button type="button" className="gd-big-btn is-primary" onClick={startAutopilot} disabled={status === "running"}>
        <Sparkles size={18} aria-hidden />
        <span><b>Design it for me</b><small>Box, MiniDSP, filters and parts, step by step. Nothing changes until you accept.</small></span>
      </button>
      <button type="button" className="gd-big-btn" onClick={openExport}>
        <Download size={18} aria-hidden />
        <span><b>Export everything</b><small>MiniDSP biquads, LTspice, parts list and the report.</small></span>
      </button>
      <button type="button" className="gd-big-btn" onClick={snapshotNow}>
        <Camera size={18} aria-hidden />
        <span><b>Snapshot</b><small>{hasSnap ? `Keep this version to compare (${hasSnap} saved).` : "Keep this version to compare against later."}</small></span>
      </button>
    </section>
  );
}

function ExampleCard() {
  const profile = useStore(s => s.profile);
  const setUi = useStore(s => s.setUi);
  if (!profile || !BUNDLED_PROFILES.some(p => p.id === profile.id)) return null;
  return (
    <section className="vw-card gd-example" aria-label="Your own measurements">
      <p><b>This is the bundled example</b> ({profile.name}). Import your group's Lab D and Lab E measurements to design your own speaker.</p>
      <Button size="sm" variant="subtle" icon={Import} onClick={() => setUi({ wizard: true })}>Import measurements</Button>
    </section>
  );
}

// ---------------------------------------------------------------- the autopilot
function AutopilotPanel() {
  const { status, progress, steps, result, error, from } = useAutopilot();
  const design = useStore(s => s.design);
  const running = status === "running";
  const changedMeanwhile = !!from && design !== from && JSON.stringify(design) !== JSON.stringify(from);

  if (status === "error") {
    return (
      <section className="vw-card gd-auto" aria-label="Autopilot">
        <header className="vw-card-head"><h2 className="vw-card-title"><Sparkles size={13} aria-hidden /> Design it for me</h2></header>
        <p className="gd-auto-note is-bad">The autopilot stopped with an error: {error}</p>
        <div className="gd-actions"><Button size="sm" onClick={discardAutopilot}>Close</Button></div>
      </section>
    );
  }
  return (
    <section className="vw-card gd-auto" aria-label="Autopilot" aria-busy={running}>
      <header className="vw-card-head">
        <h2 className="vw-card-title"><Sparkles size={13} aria-hidden /> Design it for me</h2>
        <div className="vw-card-actions">
          {result && <span className="vw-muted mono">{(result.ms / 1000).toFixed(1)} s</span>}
          {running && <Button size="sm" variant="ghost" icon={Square} onClick={() => cancelAutopilot()}>Stop</Button>}
        </div>
      </header>
      {result && (
        <div className="gd-auto-result">
          <div className="gd-auto-scores">
            <span className="mono">{result.before.score}</span>
            <ArrowRight size={16} aria-hidden />
            <span className={`mono is-${result.improved ? "good" : "same"}`}>{result.after.score}</span>
            <small>/100</small>
            <Badge tone={RATING_TONE[result.after.rating]}>{result.after.rating}</Badge>
          </div>
          <p className="gd-auto-summary">
            {result.improved
              ? `The autopilot raises the score from ${result.before.score} to ${result.after.score}. Accept it as one undo step, or only the first steps.`
              : "The autopilot could not improve this design: every step kept what you have. It is already as good as these searches can make it."}
          </p>
          {changedMeanwhile && <p className="gd-auto-note is-warn">You changed the design while it ran. Accepting replaces those changes.</p>}
        </div>
      )}
      <ol className="gd-stepper">
        {AUTOPILOT_STAGES.map((st, i) => {
          const step = steps[i];
          const active = running && progress?.index === i;
          const state = step ? (step.changed ? "changed" : "kept") : active ? "active" : "waiting";
          return (
            <li key={st.id} className={`gd-stage is-${state}`}>
              <span className="gd-stage-mark mono" aria-hidden>{step ? <Check size={12} strokeWidth={2.5} /> : i + 1}</span>
              <div className="gd-stage-body">
                <div className="gd-stage-head">
                  <span className="gd-stage-title">{st.title}</span>
                  {step && <span className="gd-stage-score mono">{step.score}/100</span>}
                  {step && <span className="gd-stage-tag">{step.changed ? "changed" : "kept"}</span>}
                  {result?.improved && step?.changed && i < AUTOPILOT_STAGES.length - 1 && (
                    <button type="button" className="gd-link" onClick={() => acceptAutopilot(i)} title="Accept the design as it was after this step">Accept up to here</button>
                  )}
                </div>
                {active && (
                  <>
                    <p className="gd-stage-live mono">{progress?.message}</p>
                    <ProgressBar value={progress?.fraction} label={st.title} />
                  </>
                )}
                {step && <StepDetail step={step} />}
              </div>
            </li>
          );
        })}
      </ol>
      {result && (
        <div className="gd-actions">
          {result.improved && <Button variant="primary" icon={Check} onClick={() => acceptAutopilot()}>Accept all</Button>}
          <Button variant={result.improved ? "ghost" : "subtle"} icon={X} onClick={discardAutopilot}>{result.improved ? "Discard" : "Close"}</Button>
        </div>
      )}
    </section>
  );
}

function StepDetail({ step }: { step: AutopilotStep }) {
  return (
    <>
      <p className="gd-stage-reason">{step.reason}</p>
      {step.numbers.length > 0 && (
        <dl className="gd-stage-nums">
          {step.numbers.map(n => <div key={n.label}><dt>{n.label}</dt><dd className="mono">{n.value}</dd></div>)}
        </dl>
      )}
    </>
  );
}

// ---------------------------------------------------------------- the mini plot
/** A small plot of the curve an insight is about: the verdict's own plot for a criterion, otherwise the
 *  curve of the view it points at; its band shaded in the severity colour and its frequency marked. */
function InsightPlot({ ins, height }: { ins: Insight; height: number }) {
  const results = useStore(s => s.results);
  const prep = useStore(s => s.prep);
  const design = useStore(s => s.design);
  const a = useAssessment();
  const spec = useMemo<PlotSpec | null>(() => {
    if (!results || !prep) return null;
    try {
      let s: PlotSpec | null = null;
      if (ins.id.startsWith("assess.") && a) {
        const c = a.criteria.find(x => `assess.${x.id}` === ins.id);
        if (c) s = specFor(c, results, prep, design);
      }
      s = s ?? viewSpec(ins, results, prep, design);
      if (!s) return null;
      const color = ins.severity === "bad" ? "bad" : ins.severity === "warn" ? "warn" : ins.severity === "good" ? "good" : "accent";
      // a fixed y window (the shaded band must not stretch an auto-scaled axis)
      const yRange = s.yRange ?? autoRange(s);
      const bands = [...(s.bands ?? [])];
      if (ins.band) bands.push({ id: "ins-band", x: ins.band, lower: [yRange[0] - 100, yRange[0] - 100], upper: [yRange[1] + 100, yRange[1] + 100], color, opacity: 0.1 });
      // the insight's frequency as the probe line, replacing a dashed marker at the same place
      const at = ins.at;
      const vLines = (s.vLines ?? []).filter(v => !at || Math.abs(Math.log(v.x / at)) > 0.02);
      if (at) vLines.push({ x: at, style: "probe", label: fmtFreq(at) });
      return { ...s, yRange, bands, vLines };
    } catch { return null; }
  }, [ins, results, prep, design, a]);
  if (!spec) return null;
  return (
    <div className="gd-plot">
      <Plot height={height} xRange={spec.xRange} yRange={spec.yRange} yLabel={spec.yLabel} yUnit={spec.yUnit}
            title={<span className="vw-plot-title">{spec.title}</span>} series={spec.series} bands={spec.bands} hBands={spec.hBands}
            vLines={spec.vLines} syncId={`guide-${ins.id}`} ariaLabel={spec.title} />
    </div>
  );
}

/** A y window around the finite values of the series inside the x window, padded and on 5-unit steps. */
function autoRange(s: PlotSpec): [number, number] {
  let lo = Infinity, hi = -Infinity;
  for (const ser of s.series) for (let i = 0; i < ser.x.length; i++) {
    const x = ser.x[i], y = ser.y[i];
    if (x >= s.xRange[0] && x <= s.xRange[1] && Number.isFinite(y)) { lo = Math.min(lo, y); hi = Math.max(hi, y); }
  }
  if (!(hi > lo)) return [lo - 5 || -10, hi + 5 || 10];
  const pad = Math.max(1, (hi - lo) * 0.08);
  return [Math.floor((lo - pad) / 5) * 5, Math.ceil((hi + pad) / 5) * 5];
}

/** The curve of the view an insight points at, for insights that are not verdict criteria. */
function viewSpec(ins: Insight, r: Results, p: Prepared, design: Design): PlotSpec | null {
  const on = r.angles["0"], m = r.metrics, f = r.f;
  if (ins.view === "impedance")
    return { title: "Load on amplifier channel 2", series: [{ id: "z", label: "|Z| ch. 2", x: f, y: mag(on.Zamp2), color: "accent", width: 2 }],
             yUnit: "Ω", yLabel: "|Z|", yRange: [0, 16], xRange: [100, 20000] };
  if (ins.view === "box") {
    const bc = boxModelCurves(p, design);
    return { title: "Woofer box model, 2.83 V at 1 m", series: [{ id: "box", label: bc.label, x: bc.f, y: bc.spl_dB, color: "woof", width: 2 }],
             yUnit: "dB", yLabel: "SPL", xRange: [10, 400] };
  }
  const units = ["woof", "mid", "tw", "sum"] as const;
  return { title: "On-axis response", yUnit: "dB", yLabel: "Level", yRange: responseRange(m.on.level), xRange: [20, 20000],
           series: units.map(u => ({ id: u, label: TRACE_META[u].name, x: f, y: db(on[u]), color: TRACE_META[u].color, width: u === "sum" ? 2.25 : 1.5 })),
           bands: [judgeBand(m.on.level)], vLines: crossoverLines(m, false) };
}

