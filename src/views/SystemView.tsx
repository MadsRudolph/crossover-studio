// System view (the default): the loudspeaker in 3D, the probe card that explains what happens at the
// probe frequency, the design checks, and a compact response plot underneath.

import { useEffect, useMemo, useRef, useState, type Ref, type RefObject } from "react";
import { ArrowDown, ArrowUpRight, ChevronDown } from "lucide-react";
import { Plot, PhaseDial, type PlotSeries } from "../charts";
import { probeSample } from "../engine";
import { Slider, StatusDot, fmtFreq, parseNumber } from "../ui";
import { focusControl } from "../ui/shell/commands";
import { CHECK_FOCUS } from "../ui/inspector/focus";
import { Viewport3D } from "../viewport3d";
import { useStore } from "../state/store";
import { UNIT_IDS } from "../types";
import { Card, crossoverLines, fmtSigned, judgeBand, snapshotSeries, useProbe, useSize } from "./common";
import { ScoreBadge } from "./ScoreBadge";
import { TRACE_META, TRACES, checkCounts, db, levelAt, nearest, readProbe, responseRange, type TraceId } from "./data";

export function SystemView() {
  const side = useRef<HTMLElement>(null);
  const checksRef = useRef<HTMLElement>(null);
  const { more, checksHidden } = useSideScroll(side, checksRef);
  const checks = useStore(s => s.results!.checks);
  const c = checkCounts(checks);
  return (
    <div className="vw-system">
      <div className="vw-sys-stage"><Viewport3D /></div>
      <CompactResponse />
      <aside className={"vw-sys-side" + (more ? " has-more" : "")} aria-label="Probe and checks" ref={side}>
        <ProbeCard />
        <ChecksCard ref={checksRef} />
        {checksHidden && (
          // the checks sit below the fold on short windows: say so, and how they stand
          <button type="button" className={"vw-sys-jump is-" + (c.bad ? "bad" : c.warn ? "warn" : "good")}
                  onClick={() => checksRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}>
            <StatusDot state={c.bad ? "bad" : c.warn ? "warn" : "good"} />
            Checks <span className="mono">{c.good}/{checks.length} OK</span>
            <ArrowDown size={13} aria-hidden />
          </button>
        )}
      </aside>
    </div>
  );
}

/** Whether the side column has more below (for its fade) and whether the Checks card is out of view. */
function useSideScroll(side: RefObject<HTMLElement | null>, checks: RefObject<HTMLElement | null>) {
  const [state, setState] = useState({ more: false, checksHidden: false });
  useEffect(() => {
    const el = side.current;
    if (!el) return;
    const read = () => {
      const more = el.scrollHeight - el.scrollTop - el.clientHeight > 4;
      const card = checks.current;
      // hidden = its header is below the visible part of the column
      const checksHidden = !!card && card.getBoundingClientRect().top + 44 > el.getBoundingClientRect().bottom;
      setState(s => (s.more === more && s.checksHidden === checksHidden ? s : { more, checksHidden }));
    };
    read();
    el.addEventListener("scroll", read, { passive: true });
    const ro = new ResizeObserver(read);
    ro.observe(el);
    for (const child of Array.from(el.children)) ro.observe(child);
    return () => { el.removeEventListener("scroll", read); ro.disconnect(); };
  }, [side, checks]);
  return state;
}

/** "0" or "30": the probe card and the compact plot follow the workspace angle, "both" reads on axis. */
function useMainAngle(): string {
  const angle = useStore(s => s.ui.angle);
  const results = useStore(s => s.results);
  return angle !== "both" && results?.angles[angle] ? angle : "0";
}

// ---------------------------------------------------------------- probe
const BAR_MIN = -40, BAR_MAX = 6;

function ProbeCard() {
  const prep = useStore(s => s.prep)!;
  const results = useStore(s => s.results)!;
  const [probe, setProbe] = useProbe();
  const angle = useMainAngle();
  const m = results.metrics;

  const sample = useMemo(() => probeSample(prep, results, probe, angle), [prep, results, probe, angle]);
  const out = results.angles[sample.angle];
  const level = levelAt(m, sample.angle);

  const reading = useMemo(() => {
    const i = sample.i;
    const p2 = (k: TraceId) => out[k].re[i] ** 2 + out[k].im[i] ** 2;
    const summing = 10 * Math.log10(p2("sum")) - 10 * Math.log10(p2("woof") + p2("mid") + p2("tw"));
    const fs = prep.profile.limits.tw_fs_hz, iFs = nearest(results.f, fs);
    const twRelAtFs = 20 * Math.log10(Math.hypot(out.tw.re[iFs], out.tw.im[iFs])) - level;
    return readProbe(UNIT_IDS.map(u => ({ id: u, relDb: sample.units[u].relDb, phaseRad: sample.units[u].phaseRad })),
                     summing, { fHz: sample.f, twFsHz: fs, twRelAtFs });
  }, [sample, out, prep, results.f, level]);

  const snapped = Math.abs(Math.log(sample.f / probe)) > 0.01;
  const quick: { f: number; label: string }[] = [
    ...(m.x_wm ? [{ f: m.x_wm, label: "W/M" }] : []),
    ...(m.x_mt ? [{ f: m.x_mt, label: "M/T" }] : []),
    { f: 60, label: "60 Hz" }, { f: 1000, label: "1 kHz" }, { f: 10000, label: "10 kHz" },
  ];

  return (
    <Card title="Probe" actions={<span className="vw-muted mono">{sample.angle}°</span>}>
      <div className="vw-probe-freq">
        <output className="vw-probe-big mono" aria-live="polite">{fmtFreq(probe)}</output>
        {snapped && <span className="vw-muted">measured point {fmtFreq(sample.f)}</span>}
      </div>
      <Slider label="Probe frequency" value={probe} min={20} max={20000} log hideReadout
              marks={[100, 1000, 10000]} onInput={setProbe} onCommit={setProbe}
              format={fmtFreq} parse={t => parseNumber(t, "Hz")} />
      <div className="vw-chips" role="group" aria-label="Jump the probe to">
        {quick.map(q => {
          const on = Math.abs(Math.log(probe / q.f)) < 0.01;
          return (
            <button key={q.label} type="button" className={"vw-qchip" + (on ? " is-on" : "")} aria-pressed={on}
                    onClick={() => setProbe(q.f)} title={`Probe at ${fmtFreq(q.f)}`}>
              {q.label.includes("/") ? <><span className="vw-qchip-k">{q.label}</span> <span className="mono">{fmtFreq(q.f)}</span></> : q.label}
            </button>
          );
        })}
      </div>

      <p className={`vw-reading is-${reading.tone}`}>
        <strong>{reading.headline}</strong>
        {reading.detail && <span> {reading.detail}</span>}
      </p>

      <ul className="vw-units" aria-label="Level and phase per unit, relative to the system level">
        {TRACES.map(u => {
          const s = sample.units[u];
          const rel = Number.isFinite(s.relDb) ? s.relDb : -Infinity;
          const t = Math.max(0, Math.min(1, (rel - BAR_MIN) / (BAR_MAX - BAR_MIN)));
          const zero = (0 - BAR_MIN) / (BAR_MAX - BAR_MIN);
          return (
            <li key={u} className={"vw-unit" + (u === "sum" ? " is-sum" : "")} style={{ ["--unit" as string]: `var(--${TRACE_META[u].color})` }}>
              <button type="button" className="vw-unit-name" onClick={() => u !== "sum" && focusControl(u === "woof" ? "digital.gain" : u)}
                      disabled={u === "sum"} title={u === "sum" ? undefined : `Show the ${TRACE_META[u].name.toLowerCase()} controls`}>
                <span className="vw-swatch" />{TRACE_META[u].name}
              </button>
              <div className="vw-bar" aria-hidden>
                <div className="vw-bar-zero" style={{ left: `${zero * 100}%` }} />
                <div className="vw-bar-fill" style={{ width: `${t * 100}%` }} />
              </div>
              <span className="vw-unit-db mono">{rel < BAR_MIN - 20 ? "< −60" : fmtSigned(rel)}<small> dB</small></span>
              <PhaseDial radians={Number.isFinite(s.phaseRad) ? s.phaseRad : null} size={34} showValue={false}
                         color={TRACE_META[u].color} />
              <span className="vw-unit-ph mono">{Number.isFinite(s.phaseRad) ? `${fmtSigned(s.phaseRad * 180 / Math.PI, 0)}°` : "—"}</span>
            </li>
          );
        })}
      </ul>
      <p className="vw-foot">Levels relative to the system level ({level.toFixed(1)} dB); phase with the {Math.abs(prep.profile.conditions.phase_ref_distance_m).toFixed(2)} m distance compensation. Where two bars meet, a good crossover has their dials pointing the same way.</p>
    </Card>
  );
}

// ---------------------------------------------------------------- checks
const SEVERITY = { bad: 0, warn: 1, good: 2 } as const;

function ChecksCard({ ref }: { ref?: Ref<HTMLElement> }) {
  const checks = useStore(s => s.results!.checks);
  const [showPassing, setShowPassing] = useState(false);
  // what needs attention first; the passing ones fold into one line unless nothing else is listed
  const sorted = [...checks].sort((a, b) => SEVERITY[a.state] - SEVERITY[b.state]);
  const open = sorted.filter(k => k.state !== "good");
  const passing = sorted.filter(k => k.state === "good");
  const foldPassing = open.length > 0 && !showPassing;
  const shown = foldPassing ? open : sorted;
  return (
    <section className="vw-card" ref={ref} aria-labelledby="vw-checks-title">
      <header className="vw-card-head">
        <h2 className="vw-card-title" id="vw-checks-title">Checks</h2>
        <div className="vw-card-actions"><ScoreBadge /></div>
      </header>
      <ul className="vw-checks">
        {shown.map(k => (
          <li key={k.id}>
            <button type="button" className={`vw-check is-${k.state}`} onClick={() => focusControl(CHECK_FOCUS[k.id] ?? `check.${k.id}`)}
                    title="Show the control that changes this">
              <StatusDot state={k.state} />
              <span className="vw-check-text">
                <span className="vw-check-title">{k.title}</span>
                <span className="vw-check-detail">{k.detail}</span>
              </span>
              <ArrowUpRight className="vw-check-go" size={14} strokeWidth={1.75} aria-hidden />
            </button>
          </li>
        ))}
      </ul>
      {open.length > 0 && passing.length > 0 && (
        <button type="button" className="vw-checks-more" aria-expanded={showPassing} onClick={() => setShowPassing(v => !v)}>
          {showPassing ? "Hide the passing checks" : `${passing.length} more passing`}
          <ChevronDown size={13} className={showPassing ? "is-flipped" : undefined} aria-hidden />
        </button>
      )}
    </section>
  );
}

// ---------------------------------------------------------------- compact response
/** Top + bottom padding of .vw-sys-plot (px): the plot gets the rest, so its tick labels clear the border. */
const SYS_PLOT_PAD_Y = 12;
function CompactResponse() {
  const results = useStore(s => s.results)!;
  const snapshots = useStore(s => s.snapshots);
  const visible = useStore(s => s.ui.visible);
  const [probe, setProbe] = useProbe();
  const angle = useMainAngle();
  const [ref, size] = useSize<HTMLDivElement>();
  const level = levelAt(results.metrics, angle);

  const series = useMemo<PlotSeries[]>(() => {
    const out = results.angles[angle];
    const s: PlotSeries[] = TRACES.filter(u => visible[u]).map(u => ({
      id: u, label: TRACE_META[u].name, x: results.f, y: db(out[u]), color: TRACE_META[u].color, width: u === "sum" ? 2 : 1.5,
    }));
    return [...s, ...snapshotSeries(snapshots, angle)];
  }, [results, angle, visible, snapshots]);

  return (
    <div className="vw-sys-plot" ref={ref}>
      {size.height > 0 && (
        <Plot height={size.height - SYS_PLOT_PAD_Y} xRange={[20, 20000]} yRange={responseRange(level)} yLabel="Level" yUnit="dB"
              title={<span className="vw-plot-title">Response · {angle}°</span>}
              series={series} bands={[judgeBand(level)]} vLines={crossoverLines(results.metrics, false)}
              probeHz={probe} onProbe={setProbe} syncId="system" ariaLabel="System response" />
      )}
    </div>
  );
}
