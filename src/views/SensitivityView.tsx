// Sensitivity view: which part moves the on-axis sum most. A tornado chart of every passive part, the
// MiniDSP crossover, the woofer gain and the vent, each one basket step (or its tolerance) down and up,
// coloured by the unit it acts on. Clicking a bar shows that control in the inspector, moves the probe
// to where the part acts and draws the sum with that part changed as a band underneath. The verdict
// change of every variant (about 40 ms in all) is worked out a moment after the design settles.

import { useEffect, useMemo, useState } from "react";
import { Plot, type PlotBand, type PlotSeries } from "../charts";
import { cachedSensitivity, sensitivity, type SensEntry, type SensVariant, type Sensitivity } from "../engine";
import { Badge, Segmented, Switch, fmtDb, fmtFreq, fmtLength, fmtValue } from "../ui";
import { ViewInsights } from "../insights/ViewInsights";
import { focusControl } from "../ui/shell/commands";
import { useStore } from "../state/store";
import type { Results } from "../types";
import { Card, PartChip, Readout, ViewHeader, crossoverLines, fmtSigned, judgeBand, useProbe, useSize } from "./common";
import { TRACE_META, levelAt, responseRange } from "./data";
import "./sensitivity.css";

type SortBy = "step" | "tol";
// kept while the app runs, so switching views does not reset them
let lastSort: SortBy = "step";
let lastOverlay = true;

/** A control's value in its own unit. */
function fmtKnob(e: SensEntry, v: number): string {
  switch (e.kind) {
    case "L": case "C": case "R": return fmtValue(v, e.kind);
    case "fc": return fmtFreq(v);
    case "gain": return fmtDb(v, { sign: true });
    case "vent": return fmtLength(v);
  }
}

/** The full analysis (with verdict changes), a moment after the design settles; the cheap on-axis one
 *  (cached per Results, shared with the insights) meanwhile. */
function useSensitivity(): { s: Sensitivity | null; busy: boolean } {
  const prep = useStore(s => s.prep);
  const design = useStore(s => s.design);
  const results = useStore(s => s.results);
  const [full, setFull] = useState<{ results: Results; s: Sensitivity } | null>(null);
  useEffect(() => {
    if (!prep || !results || full?.results === results) return;
    const t = window.setTimeout(() => {
      try { setFull({ results, s: sensitivity(prep, design, results, { score: true }) }); } catch { /* keep the cheap one */ }
    }, 300);
    return () => window.clearTimeout(t);
  }, [prep, results]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!prep || !results) return { s: null, busy: false };
  if (full?.results === results) return { s: full.s, busy: false };
  let cheap: Sensitivity | null = null;
  try { cheap = cachedSensitivity(prep, design, results); } catch { cheap = null; }
  return { s: cheap, busy: true };
}

export function SensitivityView() {
  const results = useStore(s => s.results)!;
  const [probe, setProbe] = useProbe();
  const { s, busy } = useSensitivity();
  const [sortBy, setSortState] = useState<SortBy>(lastSort);
  const setSort = (v: SortBy) => { lastSort = v; setSortState(v); };
  const [overlay, setOverlayState] = useState(lastOverlay);
  const setOverlay = (v: boolean) => { lastOverlay = v; setOverlayState(v); };
  const [selected, setSelected] = useState<string | null>(null);

  const rows = useMemo(() => {
    if (!s) return [];
    const key = (e: SensEntry) => (sortBy === "step" ? e.stepDb : e.tolDb);
    return [...s.entries].filter(e => sortBy === "step" || e.tol).sort((a, b) => key(b) - key(a));
  }, [s, sortBy]);
  const scale = Math.max(0.5, ...rows.map(e => (sortBy === "step" ? e.stepDb : e.tolDb)));
  const sel = rows.find(e => e.id === selected) ?? rows[0] ?? null;

  if (!s) return <div className="vw-view"><ViewHeader title="Part sensitivity">Nothing to analyse yet.</ViewHeader></div>;

  const pick = (e: SensEntry, v: SensVariant | null) => {
    setSelected(e.id);
    focusControl(e.focus);
    const at = v ?? bigger(variants(e, sortBy));
    if (at && Number.isFinite(at.atHz)) setProbe(at.atHz);
  };
  const x = s.topXover, xv = x ? bigger([x.step.lo, x.step.hi], "xoverDb") : null;

  return (
    <div className="vw-view">
      <ViewInsights view="sensitivity" />
      <ViewHeader title="Part sensitivity"
        actions={<>
          {busy && <Badge tone="neutral">Testing the verdict…</Badge>}
          <Segmented label="Change each part by" size="sm" value={sortBy} onChange={setSort} options={[
            { value: "step", label: "Basket step", hint: "One value down and up in the course parts basket" },
            { value: "tol", label: "Tolerance", hint: "L ±5 %, C ±10 %, R ±5 % (vent ±2 mm); the MiniDSP is exact" },
          ]} />
          <Switch checked={overlay} onChange={setOverlay} size="sm">Response overlay</Switch>
        </>}>
        Each part changed on its own, everything else held: the largest change of the 1/6-octave smoothed on-axis sum over
        150 Hz–15 kHz, and of the verdict score. Click a bar to show the part in the inspector and probe where it acts.
      </ViewHeader>
      <div className="vw-strip">
        {x && xv && (
          <Readout label={`Decides a crossover · ${TRACE_META[x.unit].name} ${x.label}`} value={fmtSigned(xv.xoverDb)} unit={`dB at ${fmtFreq(xv.xoverHz)}`}
                   tone={x.tolDb >= 1 ? "warn" : "accent"} onClick={() => pick(x, xv)}
                   hint="The part whose one basket step moves the sum most within 1/3 octave of a crossover" />
        )}
        {s.measure.map((e, k) => (
          <Readout key={e.id} label={`Measure ${k === 0 ? "first" : "next"} · ${TRACE_META[e.unit].name} ${e.label}`} value={`±${e.tolDb.toFixed(1)}`} unit="dB"
                   tone={e.tolDb >= 1.5 ? "warn" : undefined} onClick={() => pick(e, null)}
                   hint={`Within its ${Math.round(100 * (e.tol?.rel ?? 0))} % tolerance this part moves the sum up to ${e.tolDb.toFixed(1)} dB: measure it with the LCR meter and pick the basket part closest to ${fmtKnob(e, e.value)}.`} />
        ))}
        {s.base.score !== null && <Readout label="Verdict now" value={Math.round(s.base.score)} unit="/ 100" />}
      </div>
      <div className="sn-body">
        <div className="sn-main">
          <Card className="sn-tornado-card" title={sortBy === "step" ? "One basket step down / up" : "Tolerance down / up"}>
            <div className="sn-tornado" role="list">
              <div className="sn-axis" aria-hidden>
                <span>{scale.toFixed(1)} dB</span><span>0</span><span>{scale.toFixed(1)} dB</span>
              </div>
              {rows.map(e => (
                <TornadoRow key={e.id} e={e} sortBy={sortBy} scale={scale} on={sel?.id === e.id} busy={busy} onPick={pick} />
              ))}
            </div>
          </Card>
          {overlay && sel && <Overlay results={results} e={sel} sortBy={sortBy} base={s.base.sumDb} probe={probe} setProbe={setProbe} />}
        </div>
        <aside className="sn-side">
          <Card title="At the crossover">
            {x && xv ? (
              <p className="sn-note">
                <PartChip focus={x.focus} color={TRACE_META[x.unit].color}>{TRACE_META[x.unit].name} {x.label} <span className="mono">{fmtKnob(x, x.value)}</span></PartChip>
                {" "}matters most there: one basket step moves the sum <strong className="mono">{Math.abs(xv.xoverDb).toFixed(1)} dB</strong> at {fmtFreq(xv.xoverHz)}.
                Choose its value with care; its tolerance alone moves the sum {x.tolDb.toFixed(1)} dB.
              </p>
            ) : <p className="sn-note vw-muted">No part moves the sum by more than a few tenths of a dB around the crossovers.</p>}
          </Card>
          <Card title="Measure with the LCR meter">
            <ol className="sn-measure">
              {s.measure.map(e => {
                const v = bigger([e.tol?.lo ?? null, e.tol?.hi ?? null]);
                return (
                  <li key={e.id}>
                    <PartChip focus={e.focus} color={TRACE_META[e.unit].color}>{TRACE_META[e.unit].name} {e.label} <span className="mono">{fmtKnob(e, e.value)}</span></PartChip>
                    <span className="sn-measure-why">±{Math.round(100 * (e.tol?.rel ?? 0))} % moves the sum up to <span className="mono">{e.tolDb.toFixed(1)} dB</span>{v && <> at {fmtFreq(v.atHz)}</>}</span>
                  </li>
                );
              })}
            </ol>
            <p className="sn-note">Measure these before you solder and use the basket part closest to the design value. The others are forgiving: their tolerance moves the sum less.</p>
          </Card>
          <p className="sn-foot vw-muted">The vent mostly acts below 150 Hz, outside the judged band: see the Box view for it.</p>
        </aside>
      </div>
    </div>
  );
}

const variants = (e: SensEntry, by: SortBy): (SensVariant | null)[] => (by === "step" ? [e.step.lo, e.step.hi] : [e.tol?.lo ?? null, e.tol?.hi ?? null]);
/** The variant with the larger |change| (by `key`). */
function bigger(v: (SensVariant | null)[], key: "maxDb" | "xoverDb" = "maxDb"): SensVariant | null {
  return v.reduce<SensVariant | null>((b, x) => (x && (!b || Math.abs(x[key]) > Math.abs(b[key])) ? x : b), null);
}

function TornadoRow({ e, sortBy, scale, on, busy, onPick }: {
  e: SensEntry; sortBy: SortBy; scale: number; on: boolean; busy: boolean; onPick(e: SensEntry, v: SensVariant | null): void;
}) {
  const [lo, hi] = variants(e, sortBy);
  const color = `var(--${TRACE_META[e.unit].color})`;
  const what = (v: SensVariant | null, side: "lo" | "hi") =>
    !v ? "" : sortBy === "tol" ? (e.tol?.rel ? `${side === "lo" ? "−" : "+"}${Math.round(100 * e.tol.rel)} %` : `${side === "lo" ? "−" : "+"}${fmtLength(Math.abs(v.value - e.value))}`) : fmtKnob(e, v.value);
  const bar = (v: SensVariant | null, side: "lo" | "hi") => (
    <button type="button" className={`sn-bar is-${side}`} disabled={!v} onClick={() => v && onPick(e, v)}
            title={v ? `${e.name} → ${what(v, side)}: ${fmtSigned(v.maxDb)} dB at ${fmtFreq(v.atHz)}${v.dScore !== null ? `, verdict ${fmtSigned(v.dScore, 0)}` : ""}` : "No basket value on this side"}>
      {v && <span className="sn-bar-fill" style={{ width: `${Math.min(100, 100 * Math.abs(v.maxDb) / scale)}%`, background: color }} />}
    </button>
  );
  const cell = (v: SensVariant | null, side: "lo" | "hi") => (
    <span className={`sn-to is-${side}`}>
      {v && <><span className="sn-to-db mono">{fmtSigned(v.maxDb)} dB</span><span className="sn-to-val mono">{what(v, side)} · {fmtFreq(v.atHz)}</span></>}
    </span>
  );
  const score = (v: SensVariant | null) => (!v ? "" : v.dScore === null ? (busy ? "…" : "—") : fmtSigned(v.dScore, 0));
  return (
    <div className={`sn-row${on ? " is-on" : ""}`} role="listitem">
      <button type="button" className="sn-name" onClick={() => onPick(e, null)} title="Show this control in the inspector">
        <span className="vw-swatch" style={{ background: color }} />
        <span className="sn-name-text">{e.passive ? `${TRACE_META[e.unit].short} ${e.label}` : e.kind === "fc" ? "MiniDSP fc" : e.name}</span>
        <span className="sn-name-val mono">{fmtKnob(e, e.value)}</span>
      </button>
      {cell(lo, "lo")}
      <div className="sn-bars">{bar(lo, "lo")}<span className="sn-zero" aria-hidden />{bar(hi, "hi")}</div>
      {cell(hi, "hi")}
      <span className="sn-score mono" title="Verdict score change down / up (points)">{score(lo)} / {score(hi)}</span>
    </div>
  );
}

function Overlay({ results, e, sortBy, base, probe, setProbe }: {
  results: Results; e: SensEntry; sortBy: SortBy; base: Float64Array; probe: number; setProbe(f: number): void;
}) {
  const [ref, size] = useSize<HTMLDivElement>();
  const [lo, hi] = variants(e, sortBy);
  const color = TRACE_META[e.unit].color, f = results.f, level = levelAt(results.metrics, "0");
  const { band, series } = useMemo(() => {
    const a = lo?.sumDb ?? base, b = hi?.sumDb ?? base, low = new Float64Array(f.length), up = new Float64Array(f.length);
    for (let i = 0; i < f.length; i++) {
      low[i] = Math.min(a[i], b[i], base[i]); up[i] = Math.max(a[i], b[i], base[i]);
      // no band where the part does nothing (a hairline of fill would tint the sum)
      if (up[i] - low[i] < 0.05) low[i] = up[i] = NaN;
    }
    const bands: PlotBand[] = [judgeBand(level), { id: "sens", x: f, lower: low, upper: up, color, opacity: 0.3 }];
    const s: PlotSeries[] = [];
    const tag = (v: SensVariant) => (sortBy === "step" ? fmtKnob(e, v.value) : `${v.value < e.value ? "−" : "+"}${e.tol?.rel ? Math.round(100 * e.tol.rel) + " %" : fmtLength(Math.abs(v.value - e.value))}`);
    if (lo) s.push({ id: "lo", label: `${e.label} ${tag(lo)}`, x: f, y: lo.sumDb, color, width: 1.25, dash: [5, 4] });
    if (hi) s.push({ id: "hi", label: `${e.label} ${tag(hi)}`, x: f, y: hi.sumDb, color, width: 1.25, dash: [2, 3] });
    // the design's own sum on top of its variants
    s.push({ id: "sum", label: "Sum", x: f, y: base, color: "sum", width: 2 });
    return { band: bands, series: s };
  }, [e, lo, hi, base, sortBy]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="sn-overlay" ref={ref}>
      {size.height > 0 && (
        <Plot height={size.height} xRange={[20, 20000]} probeHz={probe} onProbe={setProbe} series={series} bands={band}
              yRange={responseRange(level, 18, 6)} yLabel="Level" yUnit="dB" vLines={crossoverLines(results.metrics)} syncId="sensitivity"
              title={<span className="vw-plot-title">On-axis sum · {e.name} {sortBy === "step" ? "±1 basket step" : "± tolerance"}</span>}
              ariaLabel="On-axis sum with the selected part changed" />
      )}
    </div>
  );
}
