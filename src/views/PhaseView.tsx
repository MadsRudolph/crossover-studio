// Phase & summing view: each contribution's phase (with the profile's distance compensation, as in
// the LTspice files) and how much the complex sum beats adding powers. A good crossover keeps the two
// units' phases together across the overlap and peaks near +3 dB there, never dropping below 0.

import { useMemo, useState } from "react";
import { PhaseDial, StackedPlots, type PlotSeries } from "../charts";
import { displayPhase, type Prepared } from "../engine";
import { Segmented, fmtFreq } from "../ui";
import { useStore } from "../state/store";
import type { AngleResult, CArray, UnitId } from "../types";
import { Card, ViewHeader, crossoverLines, fmtSigned, splitHeights, useProbe, useSize } from "./common";
import { TRACE_META, TRACES, nearest, phaseRange, shownAngles, summingGainDb, unwrapDeg } from "./data";

const ANGLE_DASH: number[][] = [[], [6, 4]];

/** Below this level re the sum a unit's phase is measurement noise, so it is not drawn. */
const PHASE_FLOOR_DB = 30;

/** Display phase in degrees; blank where the unit is more than PHASE_FLOOR_DB below the sum. */
function displayPhaseDeg(p: Prepared, z: CArray, sum: CArray): Float64Array {
  const y = new Float64Array(p.f.length), floor = 10 ** (-PHASE_FLOOR_DB / 20);
  for (let i = 0; i < y.length; i++) {
    const quiet = Math.hypot(z.re[i], z.im[i]) < floor * Math.hypot(sum.re[i], sum.im[i]);
    y[i] = quiet ? NaN : displayPhase(p, z, i) * 180 / Math.PI;
  }
  return y;
}

/** How the phase plot draws: unwrapped (continuous, the default), wrapped to ±180°, or each unit
 *  relative to the sum (stays near 0° across a good crossover). */
type PhaseMode = "unwrapped" | "wrapped" | "relative";
let lastMode: PhaseMode = "unwrapped"; // kept while the app runs, so switching views does not reset it

/** Unit phase minus sum phase (deg, wrapped to ±180°): where a unit and the sum point the same way. */
function relativeDeg(p: Prepared, z: CArray, sum: CArray): Float64Array {
  const y = displayPhaseDeg(p, z, sum);
  for (let i = 0; i < y.length; i++) {
    if (Number.isNaN(y[i])) continue;
    const d = y[i] - displayPhase(p, sum, i) * 180 / Math.PI;
    y[i] = ((d + 540) % 360) - 180;
  }
  return y;
}

export function PhaseView() {
  const prep = useStore(s => s.prep)!;
  const results = useStore(s => s.results)!;
  const ui = useStore(s => s.ui);
  const [probe, setProbe] = useProbe();
  const [ref, size] = useSize<HTMLDivElement>();
  const angles = shownAngles(results, ui.angle);
  const m = results.metrics;
  const [mode, setModeState] = useState<PhaseMode>(lastMode);
  const setMode = (v: PhaseMode) => { lastMode = v; setModeState(v); };

  const phase = useMemo<PlotSeries[]>(() => angles.flatMap((a, k) => TRACES.filter(u => ui.visible[u] && !(mode === "relative" && u === "sum")).map(u => {
    const out = results.angles[a];
    const deg = mode === "relative" ? relativeDeg(prep, out[u], out.sum) : displayPhaseDeg(prep, out[u], out.sum);
    return {
      id: `${u}@${a}`, label: TRACE_META[u].name + (angles.length > 1 ? ` · ${a}°` : ""), x: results.f,
      y: mode === "unwrapped" ? unwrapDeg(deg) : deg, color: TRACE_META[u].color, wrapPhase: mode !== "unwrapped",
      width: u === "sum" ? 2 : 1.5, dash: ANGLE_DASH[k % 2],
    };
  })), [prep, results, angles.join(), ui.visible, mode]); // eslint-disable-line react-hooks/exhaustive-deps
  const phaseY: [number, number] = mode === "unwrapped" ? phaseRange(phase) : [-180, 180];

  const summing = useMemo<PlotSeries[]>(() => [
    ...angles.map((a, k) => ({ id: `gain@${a}`, label: `Sum − power sum${angles.length > 1 ? ` · ${a}°` : ""}`, x: results.f,
                               y: summingGainDb(results.angles[a]), color: "sum", width: 1.75, dash: ANGLE_DASH[k % 2] })),
    { id: "g3", x: [20, 20000], y: [3, 3], color: "good", dash: [4, 4], width: 1, quiet: true },
    { id: "g0", x: [20, 20000], y: [0, 0], color: "text-3", width: 1, quiet: true },
  ], [results, angles.join()]); // eslint-disable-line react-hooks/exhaustive-deps

  const [hTop, hBottom] = splitHeights(size.height, [1.7, 1]);
  const on = results.angles[angles[0]];

  return (
    <div className="vw-view">
      <ViewHeader title="Phase & summing"
        actions={<Segmented label="Phase display" size="sm" value={mode} onChange={setMode} options={[
          { value: "unwrapped", label: "Unwrapped", hint: "Continuous phase: no jumps at ±180°" },
          { value: "wrapped", label: "Wrapped", hint: "Phase folded into −180° to +180°, as most analysers show it" },
          { value: "relative", label: "Re sum", hint: "Each unit's phase minus the sum's: near 0° across a good crossover" },
        ]} />}>
        Phase of each contribution (drawn where it is within 30 dB of the sum) with the same distance compensation (d = {prep.profile.conditions.phase_ref_distance_m.toFixed(2)} m) as the
        LTspice files. Below: how much the sum beats adding powers — +3 dB means two units in phase, 0 dB uncorrelated, below 0 they cancel.
      </ViewHeader>
      <div className="vw-strip vw-dials">
        <CrossoverDial p={prep} out={on} label="Woofer / midrange" a="woof" b="mid" f={m.x_wm} onProbe={setProbe} />
        <CrossoverDial p={prep} out={on} label="Midrange / tweeter" a="mid" b="tw" f={m.x_mt} onProbe={setProbe} />
        <ProbeDial p={prep} out={on} fHz={probe} />
      </div>
      <div className="vw-plots" ref={ref}>
        {size.height > 0 && (
          <StackedPlots xRange={[20, 20000]} probeHz={probe} onProbe={setProbe} syncId="phase"
            plots={[
              { key: `phase-${mode}`, height: hTop, series: phase, yRange: phaseY, yLabel: mode === "relative" ? "Δφ" : "Phase", yUnit: "°",
                vLines: crossoverLines(m),
                title: <span className="vw-plot-title">{mode === "relative" ? "Phase relative to the sum" : mode === "wrapped" ? "Display phase, wrapped" : "Display phase, unwrapped"}</span>,
                ariaLabel: "Phase per unit" },
              { key: "sum", height: hBottom, series: summing, yRange: [-12, 6], yLabel: "Gain", yUnit: "dB", vLines: crossoverLines(m, false),
                hBands: [{ from: -60, to: 0, color: "bad", opacity: 0.07, label: "cancelling" }],
                title: <span className="vw-plot-title">Sum minus power sum</span>, ariaLabel: "Summing gain" },
            ]} />
        )}
      </div>
    </div>
  );
}

/** Phase difference b - a at one frequency (rad), plus the summing gain of the pair (dB). */
function pairAt(p: Prepared, out: AngleResult, a: UnitId, b: UnitId, i: number) {
  const za = out[a], zb = out[b];
  const d = displayPhase(p, zb, i) - displayPhase(p, za, i);
  const pa = za.re[i] ** 2 + za.im[i] ** 2, pb = zb.re[i] ** 2 + zb.im[i] ** 2;
  const s = (za.re[i] + zb.re[i]) ** 2 + (za.im[i] + zb.im[i]) ** 2;
  return { dphi: Math.atan2(Math.sin(d), Math.cos(d)), gain: 10 * Math.log10(s / (pa + pb)), ldiff: 10 * Math.log10(pb / pa) };
}

function CrossoverDial({ p, out, label, a, b, f, onProbe }: {
  p: Prepared; out: AngleResult; label: string; a: UnitId; b: UnitId; f: number | null; onProbe(f: number): void;
}) {
  if (!f) {
    return (
      <Card className="vw-dialcard"><div className="vw-dialcard-text"><span className="vw-ro-label">{label}</span>
        <span className="vw-muted">The two never cross in their window.</span></div></Card>
    );
  }
  const r = pairAt(p, out, a, b, nearest(p.f, f));
  const deg = r.dphi * 180 / Math.PI;
  const tone = Math.abs(deg) <= 30 ? "good" : Math.abs(deg) <= 70 ? "warn" : "bad";
  return (
    <button type="button" className="vw-card vw-dialcard is-action" onClick={() => onProbe(f)} title="Probe this crossover">
      <PhaseDial radians={r.dphi} size={48} showValue={false} color={tone} target={0} tolerance={Math.PI / 6} />
      <div className="vw-dialcard-text">
        <span className="vw-ro-label">{label} · <span className="mono">{fmtFreq(f)}</span></span>
        <span className={`vw-dialcard-value mono is-${tone}`}>{fmtSigned(deg, 0)}°</span>
        <span className="vw-muted">pair sums {fmtSigned(r.gain)} dB vs power</span>
      </div>
    </button>
  );
}

function ProbeDial({ p, out, fHz }: { p: Prepared; out: AngleResult; fHz: number }) {
  const i = nearest(p.f, fHz);
  // the two loudest units at the probe are the pair whose phase matters there
  const lv = (u: UnitId) => out[u].re[i] ** 2 + out[u].im[i] ** 2;
  const [a, b] = (["woof", "mid", "tw"] as UnitId[]).sort((x, y) => lv(y) - lv(x));
  const r = pairAt(p, out, a, b, i);
  return (
    <div className="vw-card vw-dialcard">
      <PhaseDial radians={r.dphi} size={48} showValue={false} color="accent" target={0} tolerance={Math.PI / 6} />
      <div className="vw-dialcard-text">
        <span className="vw-ro-label">At the probe · <span className="mono">{fmtFreq(p.f[i])}</span></span>
        <span className="vw-dialcard-value mono">{fmtSigned(r.dphi * 180 / Math.PI, 0)}°</span>
        <span className="vw-muted">{TRACE_META[b].name} vs {TRACE_META[a].name.toLowerCase()}, {Math.abs(r.ldiff).toFixed(1)} dB apart</span>
      </div>
    </div>
  );
}
