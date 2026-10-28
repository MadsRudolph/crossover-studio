// Time view: the design in the time domain. Group delay of each unit and the sum against log frequency
// (with the Blauert & Laws audibility limit), and the step and impulse responses against milliseconds,
// all with the profile's reference delay taken out (the Phase view's convention). Beside the plots:
// when each unit arrives, and a short "why LR4 is not phase-linear". The impulse and step need the
// Listen FIRs (~60 ms), so they are worked out a moment after the design settles.

import { useEffect, useMemo, useState } from "react";
import { StackedPlots, type PlotMarker, type PlotSeries } from "../charts";
import {
  cachedGroupDelay, cachedImpulse, gdThreshold, GD_FLOOR_DB, type GroupDelayAnalysis, type ImpulseAnalysis, type XoverTiming,
} from "../engine";
import { Badge, Segmented, UNIT_SPACE, fmtFreq } from "../ui";
import { ViewInsights } from "../insights/ViewInsights";
import { useStore } from "../state/store";
import { UNIT_IDS, type Results } from "../types";
import { Card, Readout, ViewHeader, crossoverLines, fmtSigned, splitHeights, useProbe, useSize } from "./common";
import { TRACE_META, TRACES, shownAngles } from "./data";
import "./time.css";

const ANGLE_DASH: number[][] = [[], [6, 4]];
type Span = "close" | "long";
const SPAN: Record<Span, [number, number]> = { close: [-1, 6], long: [-2, 40] };
type ImpulseMode = "sum" | "units";
// kept while the app runs, so switching views does not reset them
let lastSpan: Span = "close";
let lastMode: ImpulseMode = "sum";

/** Milliseconds without the unit: two decimals below 1 ms (crossover timings are fractions of a
 *  millisecond), one below 10 ms, none above. */
const msNum = (x: number) => {
  if (!Number.isFinite(x)) return "—";
  const a = Math.abs(x), s = x.toFixed(a < 1 ? 2 : a < 10 ? 1 : 0);
  return Number(s) === 0 ? s.replace("-", "") : s.replace("-", "−");
};
/** "0.84 ms", "15 ms". */
const fmtMsFine = (x: number) => (Number.isFinite(x) ? `${msNum(x)}${UNIT_SPACE}ms` : "—");

/** Impulse and step responses per angle, a moment after the design settles (the previous stay meanwhile). */
function useImpulses(angles: string[]) {
  const prep = useStore(s => s.prep);
  const design = useStore(s => s.design);
  const results = useStore(s => s.results);
  const [state, setState] = useState<{ results: Results | null; key: string; list: ImpulseAnalysis[] }>({ results: null, key: "", list: [] });
  const key = angles.join();
  useEffect(() => {
    if (!prep || !results || (state.results === results && state.key === key)) return;
    const t = window.setTimeout(() => {
      try { setState({ results, key, list: angles.map(a => cachedImpulse(prep, design, results, a)) }); }
      catch { setState({ results, key, list: [] }); }
    }, 200);
    return () => window.clearTimeout(t);
  }, [prep, results, key]); // eslint-disable-line react-hooks/exhaustive-deps
  return { list: state.list, busy: state.results !== results || state.key !== key };
}

export function TimeView() {
  const prep = useStore(s => s.prep)!;
  const design = useStore(s => s.design);
  const results = useStore(s => s.results)!;
  const ui = useStore(s => s.ui);
  const [probe, setProbe] = useProbe();
  const [ref, size] = useSize<HTMLDivElement>();
  const angles = shownAngles(results, ui.angle);
  const [span, setSpanState] = useState<Span>(lastSpan);
  const setSpan = (v: Span) => { lastSpan = v; setSpanState(v); };
  const [mode, setModeState] = useState<ImpulseMode>(lastMode);
  const setMode = (v: ImpulseMode) => { lastMode = v; setModeState(v); };

  const gds = useMemo(() => angles.map(a => cachedGroupDelay(prep, design, results, a)), [prep, results, angles.join()]); // eslint-disable-line react-hooks/exhaustive-deps
  const gd = gds[0];
  const irs = useImpulses(angles);
  const m = results.metrics;

  const gdSeries = useMemo<PlotSeries[]>(() => {
    const s: PlotSeries[] = gds.flatMap((g, k) => TRACES.filter(u => ui.visible[u]).map(u => ({
      id: `${u}@${g.angle}`, label: TRACE_META[u].name + (gds.length > 1 ? ` · ${g.angle}°` : ""), x: g.f, y: g.gd[u],
      color: TRACE_META[u].color, width: u === "sum" ? 2 : 1.5, dash: ANGLE_DASH[k % 2], unit: "ms",
    })));
    // the audibility limit, measured from the midband of the (first) sum
    const fx = Array.from(gd.f).filter(x => x <= 8000);
    s.push({ id: "limit", label: "Audible above", x: fx, y: fx.map(x => gd.midbandMs + gdThreshold(x) * 1e3), color: "warn", dash: [4, 4], width: 1.25, unit: "ms" });
    return s;
  }, [gds, ui.visible]); // eslint-disable-line react-hooks/exhaustive-deps

  const gdRange = useMemo<[number, number]>(() => {
    let lo = 0, hi = 1;
    for (const g of gds) for (const u of TRACES) {
      if (!ui.visible[u]) continue;
      const y = g.gd[u];
      for (let i = 0; i < y.length; i++) if (Number.isFinite(y[i])) { lo = Math.min(lo, y[i]); hi = Math.max(hi, y[i]); }
    }
    return [Math.floor(Math.max(-5, lo) - 0.5), Math.ceil(Math.min(60, hi) * 1.1 + 0.5)];
  }, [gds, ui.visible]);

  const timeShown = (u: (typeof TRACES)[number]) => ui.visible[u] && (mode === "units" ? true : u === "sum");
  const [stepSeries, impSeries, markers] = useMemo(() => {
    const st: PlotSeries[] = [], im: PlotSeries[] = [], mk: PlotMarker[] = [];
    irs.list.forEach((r, k) => {
      const tag = irs.list.length > 1 ? ` · ${r.angle}°` : "";
      for (const u of TRACES) {
        // the step always shows the units (they explain the sum's shape); the impulse follows the switch
        if (ui.visible[u]) st.push({ id: `s:${u}@${r.angle}`, label: TRACE_META[u].name + tag, x: r.t, y: r.step[u], color: TRACE_META[u].color,
                                     width: u === "sum" ? 2 : 1.25, dash: ANGLE_DASH[k % 2], unit: "" });
        if (timeShown(u)) im.push({ id: `i:${u}@${r.angle}`, label: TRACE_META[u].name + tag, x: r.t, y: r.impulse[u], color: TRACE_META[u].color,
                                    width: u === "sum" ? 1.75 : 1.25, dash: ANGLE_DASH[k % 2], unit: "" });
      }
      if (k === 0) for (const u of UNIT_IDS) if (ui.visible[u]) {
        const i = nearestT(r.t, r.arrival[u]);
        mk.push({ x: r.t[i], y: mode === "units" ? r.impulse[u][i] : r.impulse.sum[i], color: TRACE_META[u].color, shape: "diamond", label: `${TRACE_META[u].name} ${fmtMsFine(r.arrival[u])}` });
      }
    });
    return [st, im, mk];
  }, [irs.list, ui.visible, mode]); // eslint-disable-line react-hooks/exhaustive-deps

  // three plots in two stacks: 12 px between the stacks, the stack's own 4 px inside the second
  const [hGd, hStep, hImp] = splitHeights(size.height - 8, [1.15, 1, 1], 4, 130);
  const first = irs.list[0];

  return (
    <div className="vw-view">
      <ViewInsights view="time" />
      <ViewHeader title="Time domain"
        actions={<>
          {irs.busy && <Badge tone="neutral">Working out the impulse…</Badge>}
          <Segmented label="Impulse response shows" size="sm" value={mode} onChange={setMode} options={[
            { value: "sum", label: "Sum", hint: "The impulse response of the whole speaker" },
            { value: "units", label: "Units", hint: "Each unit's impulse response on its own, through its filters" },
          ]} />
          <Segmented label="Time window" size="sm" value={span} onChange={setSpan} options={[
            { value: "close", label: "6 ms", hint: "The first milliseconds: the arrival of each unit" },
            { value: "long", label: "40 ms", hint: "Long enough for the woofer and the box to settle" },
          ]} />
        </>}>
        How long each unit takes to answer. Group delay (units drawn within {GD_FLOOR_DB} dB of the sum), then the step and
        impulse response for 1 V into the MiniDSP. Time zero is the arrival over the profile's reference distance
        (d = {gd.ref.distance.toFixed(2)} m), as in the Phase view; only the differences between units carry meaning.
      </ViewHeader>
      <div className="vw-strip">
        <XoverReadout x={gd.xover.wm} label="Woofer/mid" onProbe={setProbe} />
        <XoverReadout x={gd.xover.mt} label="Mid/tweeter" onProbe={setProbe} />
        <Readout label="Audibility" value={Math.round(100 * gd.audibility.ratio)} unit="%" tone={gd.audibility.ratio >= 1 ? "bad" : gd.audibility.ratio >= 0.7 ? "warn" : "good"}
                 onClick={Number.isFinite(gd.audibility.atHz) ? () => setProbe(gd.audibility.atHz) : undefined}
                 hint={`Worst group-delay distortion of the sum against the Blauert & Laws threshold: ${fmtMsFine(gd.audibility.excessMs)} at ${fmtFreq(gd.audibility.atHz)}, limit ${fmtMsFine(gd.audibility.thresholdMs)}. Below 100 % it is not heard.`} />
        <Readout label={`Bass delay at ${fmtFreq(gd.f[0])}`} value={msNum(gd.gd.sum[0] - gd.midbandMs)} unit="ms"
                 hint={`Extra delay of the bass over the midband, from the box model below 80 Hz. The audibility limit there is about ${fmtMsFine(gdThreshold(gd.f[0]) * 1e3)}.`} />
      </div>
      <div className="tm-body">
        <div className="tm-plots" ref={ref}>
          {size.height > 0 && (<>
            <StackedPlots xRange={[20, 20000]} probeHz={probe} onProbe={setProbe} syncId="time-gd"
              plots={[{ key: "gd", height: hGd, series: gdSeries, yRange: gdRange, yLabel: "Delay", yUnit: "ms",
                        vLines: crossoverLines(m), title: <span className="vw-plot-title">Group delay</span>, ariaLabel: "Group delay per unit" }]} />
            <StackedPlots xRange={SPAN[span]} xLog={false} syncId="time-t" key={span}
              plots={[
                { key: "step", height: hStep, series: stepSeries, yLabel: "Step", yUnit: "re flat",
                  title: <span className="vw-plot-title">Step response · ms</span>, ariaLabel: "Step response against time in milliseconds",
                  emptyState: <span>Working out the step response…</span> },
                { key: "imp", height: hImp, series: impSeries, yLabel: "Impulse", yUnit: "re peak", markers,
                  title: <span className="vw-plot-title">Impulse response · ms</span>, ariaLabel: "Impulse response against time in milliseconds",
                  emptyState: <span>Working out the impulse response…</span> },
              ]} />
          </>)}
        </div>
        <aside className="tm-side">
          <Card title="Arrival">
            {first ? (<>
              <ul className="tm-arrivals">
                {first.coherence.order.map(u => (
                  <li key={u}>
                    <span className="vw-swatch" style={{ background: `var(--${TRACE_META[u].color})` }} />
                    <span className="tm-arr-name">{TRACE_META[u].name}</span>
                    <span className="mono">{fmtSigned(first.arrival[u] - first.arrival[first.coherence.order[0]], 2)} ms</span>
                  </li>
                ))}
              </ul>
              <p className="tm-note">{first.coherence.text} The diamonds in the impulse plot mark each unit's peak{first.angle !== "0" ? ` (at ${first.angle}°)` : ""}.</p>
            </>) : <p className="tm-note vw-muted">Working out the impulse responses…</p>}
          </Card>
          <WhyCard gd={gd} />
        </aside>
      </div>
    </div>
  );
}

function nearestT(t: Float64Array, x: number): number {
  let best = 0;
  for (let i = 1; i < t.length; i++) if (Math.abs(t[i] - x) < Math.abs(t[best] - x)) best = i;
  return best;
}

function XoverReadout({ x, label, onProbe }: { x: XoverTiming | null; label: string; onProbe(f: number): void }) {
  if (!x) return <Readout label={label} value="none" hint="The two units never cross in their window." />;
  const lead = x.leadMs, upper = TRACE_META[x.hi].name.toLowerCase(), lower = TRACE_META[x.lo].name.toLowerCase();
  const who = Math.abs(lead) < 0.05 ? "together" : lead > 0 ? `${upper} first` : `${lower} first`;
  return (
    <Readout label={`${label} · ${fmtFreq(x.f)}`} value={msNum(x.gdSum)} unit={`ms · ${who}`}
             tone={Math.abs(x.phaseDeg) > 90 ? "warn" : undefined} onClick={() => onProbe(x.f)}
             hint={`Group delay of the sum at the crossover. The ${lower} is delayed ${fmtMsFine(x.gdLo)}, the ${upper} ${fmtMsFine(x.gdHi)}; their phases are ${Math.abs(x.phaseDeg).toFixed(0)}° apart. Click to probe it.`} />
  );
}

/** Plain-language explanation of why a Linkwitz-Riley (or any IIR) crossover delays the bass. */
function WhyCard({ gd }: { gd: GroupDelayAnalysis }) {
  const dg = useStore(s => s.design.digital);
  // an ideal LR4 sum is a 2nd-order all-pass with Q = 1/sqrt 2: tau(0) = tau(f_c) = 2 sqrt 2 / (2 pi f_c)
  const lr4 = 2 * Math.SQRT2 / (2 * Math.PI * dg.fc) * 1e3;
  const wm = gd.xover.wm;
  return (
    <Card title="Why LR4 is not phase-linear" className="tm-why">
      <p>
        An LR4 low-pass and high-pass add up to a flat level, but not to a straight phase: together they are
        an <em>all-pass</em> whose phase turns a full 360° through the crossover. A turning phase is a delay that
        depends on frequency, so everything below the crossover arrives a little later than everything above it.
      </p>
      <p>
        {dg.align === "LR4"
          ? <>Your MiniDSP LR4 at <span className="mono">{fmtFreq(dg.fc)}</span> alone delays the bass by <span className="mono">{fmtMsFine(lr4)}</span>.</>
          : <>Your {dg.align} crossover does the same, by a different amount.</>}
        {wm && <> With the drivers and the passive filters it is <span className="mono">{fmtMsFine(wm.gdSum - gd.midbandMs)}</span> more at the woofer/mid crossover than in the midband.</>}
        {" "}The step response shows it: a sharp tweeter spike first, the woofer's slow push later.
      </p>
      <p className="vw-muted">
        You hear group delay only above roughly 1–3 ms in the midrange (Blauert &amp; Laws, 1978), so a good LR4 design is
        fine. A phase-linear crossover needs FIR filters, which the course MiniDSP does not run.
      </p>
    </Card>
  );
}
