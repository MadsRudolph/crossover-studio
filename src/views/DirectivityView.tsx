// Directivity view: on axis against every off-axis angle the group measured, per unit and for the
// sum; the difference curves (how much each unit drops off axis); and the drop per unit at the probe.

import { useMemo } from "react";
import { Radar } from "lucide-react";
import { StackedPlots, type PlotSeries } from "../charts";
import { Button, EmptyState, fmtFreq } from "../ui";
import { useStore } from "../state/store";
import type { Results } from "../types";
import { Card, ViewHeader, crossoverLines, fmtSigned, splitHeights, useProbe, useSize } from "./common";
import { TRACE_META, TRACES, db, diff, levelAt, nearest, responseRange, type TraceId } from "./data";

const OFF_DASH: number[][] = [[6, 4], [2, 3], [9, 3, 2, 3], [3, 6]];

/** Off-axis drop is only meaningful where the unit contributes: blank it more than 30 dB below the system level. */
const DROP_FLOOR_DB = 30;
function audible(d: Float64Array, onDb: Float64Array, level: number): Float64Array {
  return d.map((v, i) => (onDb[i] < level - DROP_FLOOR_DB ? NaN : v));
}

export function DirectivityView() {
  const results = useStore(s => s.results)!;
  const visible = useStore(s => s.ui.visible);
  const setUi = useStore(s => s.setUi);
  const [probe, setProbe] = useProbe();
  const [ref, size] = useSize<HTMLDivElement>();
  const off = Object.keys(results.angles).filter(a => a !== "0").sort((a, b) => +a - +b);

  const dbs = useMemo(() => {
    const out: Record<string, Record<TraceId, Float64Array>> = {};
    for (const a of Object.keys(results.angles)) {
      const r = results.angles[a];
      out[a] = { woof: db(r.woof), mid: db(r.mid), tw: db(r.tw), sum: db(r.sum) };
    }
    return out;
  }, [results]);

  if (!off.length) {
    return (
      <div className="vw-view">
        <ViewHeader title="Directivity">How evenly the speaker spreads its sound off axis.</ViewHeader>
        <div className="cs-fill-center">
          <EmptyState icon={Radar} title="Only the on-axis response is measured"
            description="Add a Lab E system measurement at 30° (all three units from the same run) to compare on and off axis."
            action={<Button onClick={() => setUi({ wizard: true })}>Import measurements</Button>} />
        </div>
      </div>
    );
  }

  const shown = TRACES.filter(u => visible[u]);
  const level = levelAt(results.metrics, "0");
  const top: PlotSeries[] = [];
  const bottom: PlotSeries[] = [];
  for (const u of shown) {
    top.push({ id: `${u}@0`, label: `${TRACE_META[u].name} · 0°`, x: results.f, y: dbs["0"][u], color: TRACE_META[u].color, width: u === "sum" ? 2.25 : 1.5 });
    off.forEach((a, k) => {
      top.push({ id: `${u}@${a}`, label: `${TRACE_META[u].name} · ${a}°`, x: results.f, y: dbs[a][u], color: TRACE_META[u].color,
                 dash: OFF_DASH[k % OFF_DASH.length], width: u === "sum" ? 1.75 : 1.25, opacity: 0.85 });
      bottom.push({ id: `${u}Δ${a}`, label: `${TRACE_META[u].name} ${a}° − 0°`, x: results.f, y: audible(diff(dbs[a][u], dbs["0"][u]), dbs["0"][u], level),
                    color: TRACE_META[u].color, dash: k ? OFF_DASH[(k - 1) % OFF_DASH.length] : undefined, width: u === "sum" ? 2 : 1.5 });
    });
  }
  bottom.push({ id: "z", x: [20, 20000], y: [0, 0], color: "text-3", width: 1, quiet: true });
  const [hTop, hBottom] = splitHeights(size.height, [1.6, 1]);

  return (
    <div className="vw-view">
      <ViewHeader title="Directivity">
        On axis (solid) against {off.map(a => `${a}°`).join(", ")} (dashed), all units from the same Lab E runs. Below: how far each
        one drops off axis (where it plays within 30 dB of the system level). A small, smooth difference means an even spread; a step at a crossover means the units beam differently there.
      </ViewHeader>
      <div className="vw-dir">
        <div className="vw-plots" ref={ref}>
          {size.height > 0 && (
            <StackedPlots xRange={[20, 20000]} probeHz={probe} onProbe={setProbe} syncId="directivity"
              plots={[
                { key: "lvl", height: hTop, series: top, yRange: responseRange(level), yLabel: "Level", yUnit: "dB",
                  vLines: crossoverLines(results.metrics), title: <span className="vw-plot-title">On and off axis</span>, ariaLabel: "On and off-axis response" },
                { key: "d", height: hBottom, series: bottom, yRange: [-18, 6], yLabel: "Off − on", yUnit: "dB",
                  hBands: [{ from: -3, to: 3, color: "good", opacity: 0.05, label: "±3 dB" }],
                  title: <span className="vw-plot-title">Off-axis drop</span>, ariaLabel: "Off-axis difference" },
              ]} />
          )}
        </div>
        <aside className="vw-dir-side"><DropCard results={results} dbs={dbs} off={off} probe={probe} units={shown} /></aside>
      </div>
    </div>
  );
}

/** Drop at the probe: each trace's level at every measured off-axis angle re its own on-axis level, as
 *  horizontal bars around 0 dB (the measurements are single angles to one side, so no polar outline is
 *  implied between them). */
const BAR_LO = -18, BAR_HI = 6;
function DropCard({ results, dbs, off, probe, units }: {
  results: Results; dbs: Record<string, Record<TraceId, Float64Array>>; off: string[]; probe: number; units: TraceId[];
}) {
  const i = nearest(results.f, probe);
  const W = 240, LABEL = 64, VALUE = 44, plotW = W - LABEL - VALUE;
  const ROW = off.length > 1 ? 13 : 16, GROUP_GAP = 7, TOP = 16;
  const xOf = (v: number) => LABEL + plotW * (Math.max(BAR_LO, Math.min(BAR_HI, v)) - BAR_LO) / (BAR_HI - BAR_LO);
  const x0 = xOf(0);
  const rows = units.flatMap((u, g) => off.map((a, k) => ({
    u, a, k, v: dbs[a][u][i] - dbs["0"][u][i], y: TOP + g * (off.length * ROW + GROUP_GAP) + k * ROW,
  })));
  const H = TOP + units.length * (off.length * ROW + GROUP_GAP) + 4;

  return (
    <Card title="Off-axis drop at the probe" actions={<span className="vw-muted mono">{fmtFreq(results.f[i])}</span>}>
      <svg className="vw-drop" viewBox={`0 0 ${W} ${H}`} role="img"
           aria-label={`Off-axis level re on axis at ${fmtFreq(results.f[i])}: ` + rows.map(r => `${TRACE_META[r.u].name} ${r.a}° ${Number.isFinite(r.v) ? fmtSigned(r.v) + " dB" : "not measured"}`).join(", ")}>
        <rect className="vw-drop-even" x={xOf(-3)} y={TOP - 4} width={xOf(3) - xOf(-3)} height={H - TOP} />
        {[-18, -12, -6, 0, 6].map(t => (
          <g key={t}>
            <line className={t === 0 ? "vw-drop-zero" : "vw-drop-grid"} x1={xOf(t)} x2={xOf(t)} y1={TOP - 4} y2={H - 4} />
            <text className="vw-drop-tick" x={xOf(t)} y={TOP - 7} textAnchor="middle">{t === 0 ? "0 dB" : fmtSigned(t, 0)}</text>
          </g>
        ))}
        {rows.map(r => {
          const ok = Number.isFinite(r.v), x = ok ? xOf(r.v) : x0;
          return (
            <g key={`${r.u}@${r.a}`} style={{ ["--unit" as string]: `var(--${TRACE_META[r.u].color})` }}>
              {r.k === 0 && <text className="vw-drop-name" x={0} y={r.y + ROW / 2 + 3}>{TRACE_META[r.u].name}</text>}
              {off.length > 1 && <text className="vw-drop-ang" x={LABEL - 6} y={r.y + ROW / 2 + 3} textAnchor="end">{r.a}°</text>}
              <rect className={"vw-drop-bar" + (r.u === "sum" ? " is-sum" : "")} x={Math.min(x, x0)} y={r.y + 2} width={Math.max(1, Math.abs(x - x0))} height={ROW - 4} rx={1.5}
                    style={{ opacity: 1 - r.k * 0.25 }} />
              <text className="vw-drop-val" x={W} y={r.y + ROW / 2 + 3} textAnchor="end">{ok ? `${fmtSigned(r.v)} dB` : "—"}</text>
            </g>
          );
        })}
      </svg>
      <p className="vw-foot">Level at {off.map(a => `${a}°`).join(" and ")} relative to the same unit on axis. Inside the shaded ±3 dB the spread is even; a long bar means that unit beams there.</p>
    </Card>
  );
}
