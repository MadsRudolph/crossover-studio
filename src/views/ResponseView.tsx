// Response view: every unit through its filters and their complex sum, on axis and/or at 30°, with
// the ±2 dB target, the acoustic crossovers, the Monte Carlo tolerance band, the power sum and the
// snapshots; underneath, the voltage that reaches each driver's terminals.

import { useEffect, useMemo, useState } from "react";
import { StackedPlots, type PlotBand, type PlotSeries } from "../charts";
import { tolerance } from "../engine";
import { Badge, Switch, fmtFreq, withUnits } from "../ui";
import { useStore } from "../state/store";
import { UNIT_IDS, type Design } from "../types";
import type { Prepared } from "../engine";
import { Readout, ViewHeader, crossoverLines, judgeBand, snapshotSeries, splitHeights, useProbe, useSize } from "./common";
import { TRACE_META, TRACES, db, levelAt, powerSumDb, responseRange, shownAngles, terminalDrive } from "./data";

const ANGLE_DASH: number[][] = [[], [6, 4], [2, 3], [9, 3, 2, 3]];

/** Monte Carlo band of the on-axis sum, recomputed a moment after the design settles so live drags
 *  stay smooth (the previous band stays on screen meanwhile). */
function useToleranceBand(enabled: boolean, prep: Prepared | null, design: Design) {
  const [band, setBand] = useState<{ design: Design; lo: Float64Array; hi: Float64Array } | null>(null);
  useEffect(() => {
    if (!enabled || !prep || band?.design === design) return;
    const t = window.setTimeout(() => {
      try { setBand({ design, ...tolerance(prep, design) }); } catch { setBand(null); }
    }, 250);
    return () => window.clearTimeout(t);
  }, [enabled, prep, design]); // eslint-disable-line react-hooks/exhaustive-deps
  return { band: enabled ? band : null, busy: enabled && band?.design !== design };
}

export function ResponseView() {
  const prep = useStore(s => s.prep);
  const results = useStore(s => s.results)!;
  const design = useStore(s => s.design);
  const snapshots = useStore(s => s.snapshots);
  const ui = useStore(s => s.ui);
  const setUi = useStore(s => s.setUi);
  const [probe, setProbe] = useProbe();
  const [ref, size] = useSize<HTMLDivElement>();

  const angles = shownAngles(results, ui.angle);
  const main = angles[0];
  const level = levelAt(results.metrics, main);
  const tol = useToleranceBand(ui.showTolerance, prep, design);
  const m = results.metrics;

  const series = useMemo<PlotSeries[]>(() => {
    const s: PlotSeries[] = [];
    angles.forEach((a, k) => {
      const out = results.angles[a], tag = angles.length > 1 ? ` · ${a}°` : "";
      for (const u of TRACES) {
        if (!ui.visible[u]) continue;
        s.push({ id: `${u}@${a}`, label: TRACE_META[u].name + tag, x: results.f, y: db(out[u]), color: TRACE_META[u].color,
                 width: u === "sum" ? 2.25 : 1.5, dash: ANGLE_DASH[k % ANGLE_DASH.length], opacity: k ? 0.85 : 1 });
      }
      if (ui.showPowerSum)
        s.push({ id: `psum@${a}`, label: "Power sum" + tag, x: results.f, y: powerSumDb(out), color: "text-3", width: 1.25, dash: [2, 3] });
    });
    return [...s, ...snapshotSeries(snapshots, main)];
  }, [results, angles.join(), ui.visible, ui.showPowerSum, snapshots, main]); // eslint-disable-line react-hooks/exhaustive-deps

  const bands: PlotBand[] = [judgeBand(level)];
  if (tol.band) bands.push({ id: "tol", x: results.f, lower: tol.band.lo, upper: tol.band.hi, color: "sum", opacity: 0.16 });

  const drive = useMemo<PlotSeries[]>(() => {
    const d = terminalDrive(results.angles["0"], design);
    return UNIT_IDS.filter(u => ui.visible[u]).map(u => ({
      id: `drive:${u}`, label: TRACE_META[u].name, x: results.f, y: db(d[u]), color: TRACE_META[u].color,
    }));
  }, [results, design, ui.visible]);

  const [hTop, hBottom] = splitHeights(size.height, [2.3, 1]);
  const spread = m.on.spread;

  return (
    <div className="vw-view">
      <ViewHeader title="Frequency response"
        actions={<>
          <Switch checked={ui.showTolerance} onChange={v => setUi({ showTolerance: v })} size="sm">
            Tolerance {tol.busy && ui.showTolerance && <Badge tone="neutral">…</Badge>}
          </Switch>
          <Switch checked={ui.showPowerSum} onChange={v => setUi({ showPowerSum: v })} size="sm">Power sum</Switch>
        </>}>
        Each unit's measured anechoic response through its filters, and their complex sum, for 1 V into the MiniDSP.
        The band is ±2 dB around the system level over 150 Hz–15 kHz; dashed lines mark the acoustic crossovers.
      </ViewHeader>
      <div className="vw-strip">
        <Readout label="Spread 0°" value={spread.toFixed(1)} unit="dB" tone={spread <= 4 ? "good" : spread <= 6 ? "warn" : "bad"}
                 hint="Peak-to-peak of the 1/6-octave smoothed sum, 150 Hz–15 kHz (aim ±2 dB = 4 dB)" />
        {m.off30 && <Readout label={`Spread ${m.offAngle ?? "30"}°`} value={m.off30.spread.toFixed(1)} unit="dB"
                             tone={m.off30.spread <= 6 ? "good" : m.off30.spread <= 8 ? "warn" : "bad"} />}
        <Readout label="Level" value={m.on.level.toFixed(1)} unit="dB" hint="Median of the smoothed on-axis sum, re 1 Pa/V" />
        <Readout label="Woofer/mid" value={m.x_wm ? fmtFreq(m.x_wm) : "none"} onClick={m.x_wm ? () => setProbe(m.x_wm!) : undefined}
                 hint="Probe the woofer/midrange crossover" />
        <Readout label="Mid/tweeter" value={m.x_mt ? fmtFreq(m.x_mt) : "none"} onClick={m.x_mt ? () => setProbe(m.x_mt!) : undefined}
                 hint="Probe the midrange/tweeter crossover" />
        {tol.band && <span className="vw-strip-note">Tolerance: 95 % of builds with L ±5 %, C ±10 %, R ±5 % (on axis).</span>}
      </div>
      <div className="vw-plots" ref={ref}>
        {size.height > 0 && (
          <StackedPlots xRange={[20, 20000]} probeHz={probe} onProbe={setProbe} syncId="response"
            plots={[
              { key: "spl", height: hTop, series, bands, yRange: responseRange(level), yLabel: "Level", yUnit: "dB",
                vLines: crossoverLines(m), title: <span className="vw-plot-title">Acoustic output</span>, ariaLabel: "Acoustic response" },
              { key: "drive", height: hBottom, series: drive, yRange: [-36, 6], yLabel: "Drive", yUnit: "dB",
                title: <span className="vw-plot-title">{withUnits("Voltage at the terminals, re 1 V in")}</span>, ariaLabel: "Drive voltage at the terminals" },
            ]} />
        )}
      </div>
    </div>
  );
}
