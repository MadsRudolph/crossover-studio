// Step 4: the phase reference. The measured phases carry the flight time to the microphone plus the
// sound card's random start delay; one distance d for all three units removes both (Lab E, plot_labE.m).
import { useEffect, useMemo, useState } from "react";
import { Wand2 } from "lucide-react";
import { Plot } from "../../charts";
import type { Series, UnitId } from "../../types";
import { Button, NumberField, Segmented, Stat } from "../../ui";
import { useWizard } from "../draft";
import { compensatedPhaseDeg, C_PHASE } from "../build";
import { choiceKey, UNIT_NAME } from "../roles";

const UNITS: UnitId[] = ["woof", "mid", "tw"];
const fmtEnd = (d: number) => `${d < 0 ? "\u2212" : ""}${Math.abs(d).toFixed(0)} m`;
const fmtM = (d: number) => `${d < 0 ? "−" : ""}${Math.abs(d).toFixed(3)} m`;

export function PhaseStep() {
  const phase = useWizard(s => s.phase);
  const tf = useWizard(s => s.assignments);
  const cache = useWizard(s => s.series);
  const series = useMemo(() => {
    const out: Partial<Record<UnitId, Series>> = {};
    for (const u of UNITS) { const a = tf[`tf:0:${u}`]; const x = a && cache[choiceKey(a.choice)]?.series; if (x) out[u] = x; }
    return out;
  }, [tf, cache]);
  const [view, setView] = useState<"comp" | "raw">("comp");

  useEffect(() => { useWizard.getState().runPhaseEstimate(); }, [series]);

  const d = phase.value;
  const plotSeries = useMemo(() => UNITS.filter(u => series[u]).map(u => {
    const s = series[u]!;
    return { id: u, label: UNIT_NAME[u], x: Float64Array.from(s.f), y: compensatedPhaseDeg(s, view === "comp" ? d : 0), color: u, wrapPhase: true };
  }), [series, d, view]);
  const est = phase.estimate;
  const delayMs = (d / C_PHASE) * 1000;

  return (
    <div className="wz-phase">
      <p className="wz-lede">
        Each measured phase includes the flight time to the microphone and the sound card's random start delay. Removing one
        delay, written as a distance d (Matlab2LTspice convention, c = {C_PHASE} m/s), makes the phases readable. The same d
        is used for all three units, so their relative phase, which decides how they sum, is untouched.
      </p>

      <div className="wz-phase-grid">
        <section className="wz-card">
          <header><h4>Compensation distance</h4></header>
          <div className="wz-phase-value">
            <NumberField label="Compensation distance d" value={d} unit="m" digits={3} min={-50} max={50} step={0.01} size={8}
                         onChange={v => useWizard.getState().setPhase(v, true)} />
            {phase.manual && est && (
              <Button variant="ghost" size="sm" icon={Wand2} onClick={() => useWizard.getState().setPhase(est.d, false)}>Use the estimate</Button>
            )}
          </div>
          <div className="wz-stats">
            <Stat label="Estimate (all units)" value={phase.busy ? "…" : est ? fmtM(est.d) : "—"} />
            <Stat label="Delay" value={`${delayMs.toFixed(2)} ms`} />
            {est && UNITS.filter(u => est.perUnit[u] !== undefined).map(u => (
              <Stat key={u} label={`${UNIT_NAME[u]} alone`} value={fmtM(est.perUnit[u]!)}
                    tone={Math.abs(est.perUnit[u]! - est.d) < 0.1 ? "good" : "warn"} />
            ))}
          </div>
          {est && <CostCurve grid={est.grid} d={d} best={est.d} />}
          <p className="wz-muted">
            The estimate is the d that makes the three phase curves smoothest between 200 Hz and 15 kHz. A negative d is normal:
            it means the sound card started recording late. When the units disagree strongly, check that all three come from
            one run.
          </p>
        </section>

        <section className="wz-card wz-phase-plot">
          <header>
            <h4>Phase at 0°</h4>
            <span className="wz-grow" />
            <Segmented size="sm" label="Phase view" value={view} onChange={v => setView(v as "comp" | "raw")}
                       options={[{ value: "comp", label: "Compensated" }, { value: "raw", label: "As measured" }]} />
          </header>
          <Plot height={300} xRange={[50, 20000]} yRange={[-180, 180]} yUnit="°" yLabel="Phase" series={plotSeries}
                ariaLabel="Phase of the three units at 0 degrees" />
        </section>
      </div>
    </div>
  );
}

/** Smoothness cost against d, with the estimate and the chosen value marked. */
function CostCurve({ grid, d, best }: { grid: { d: Float64Array; cost: Float64Array }; d: number; best: number }) {
  const W = 320, H = 72;
  const path = useMemo(() => {
    const n = grid.d.length, lo = grid.d[0], hi = grid.d[n - 1];
    let cmin = Infinity, cmax = -Infinity;
    for (const c of grid.cost) { cmin = Math.min(cmin, c); cmax = Math.max(cmax, c); }
    const X = (x: number) => ((x - lo) / (hi - lo)) * W, Y = (c: number) => 4 + (1 - (c - cmin) / (cmax - cmin || 1)) * (H - 8);
    let p = "";
    for (let i = 0; i < n; i++) p += `${i ? "L" : "M"}${X(grid.d[i]).toFixed(1)},${Y(grid.cost[i]).toFixed(1)}`;
    return { p, X, lo, hi };
  }, [grid]);
  const clampX = (x: number) => Math.min(W, Math.max(0, path.X(x)));
  return (
    <figure className="wz-cost">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Phase roughness against the compensation distance">
        <path d={path.p} className="wz-cost-line" vectorEffect="non-scaling-stroke" />
        <line x1={clampX(best)} x2={clampX(best)} y1={0} y2={H} className="wz-cost-best" vectorEffect="non-scaling-stroke" />
        <line x1={clampX(d)} x2={clampX(d)} y1={0} y2={H} className="wz-cost-d" vectorEffect="non-scaling-stroke" />
      </svg>
      <figcaption>
        <span className="mono">{fmtEnd(path.lo)}</span>
        <span>roughness of the phase against d (lower is smoother)</span>
        <span className="mono">+{fmtEnd(path.hi)}</span>
      </figcaption>
    </figure>
  );
}
