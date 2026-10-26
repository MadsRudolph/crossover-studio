// Showcase of the chart kit with synthetic three-way data shaped like the course measurements:
// LR4 crossovers at 300 Hz and 3 kHz, a vented-box woofer, a tweeter with a resonance and a small delay.
// Used for visual review (src/charts/demo) and as living documentation of the props.

import { useMemo, useRef, useState } from "react";
import { Plot } from "./Plot";
import { StackedPlots } from "./StackedPlots";
import { Sparkline } from "./Sparkline";
import { PhaseDial } from "./PhaseDial";
import { formatHz, nearestIndex } from "./scale";
import type { PlotHandle, PlotSeries } from "./types";

// ---------------------------------------------------------------- tiny complex helpers
type C = [number, number];
const mul = (a: C, b: C): C => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];
const div = (a: C, b: C): C => {
  const d = b[0] * b[0] + b[1] * b[1];
  return [(a[0] * b[0] + a[1] * b[1]) / d, (a[1] * b[0] - a[0] * b[1]) / d];
};
const add = (a: C, b: C): C => [a[0] + b[0], a[1] + b[1]];
const db = (a: C) => 20 * Math.log10(Math.hypot(a[0], a[1]) || 1e-12);
const deg = (a: C) => (Math.atan2(a[1], a[0]) * 180) / Math.PI;

/** Second-order section at frequency f: low-pass or high-pass, quality Q. */
function so(f: number, fc: number, Q: number, hp: boolean): C {
  const s: C = [0, f / fc];
  const den: C = [1 - (f / fc) ** 2, f / fc / Q];
  return div(hp ? mul(s, s) : [1, 0], den);
}
const lr4 = (f: number, fc: number, hp: boolean) => mul(so(f, fc, Math.SQRT1_2, hp), so(f, fc, Math.SQRT1_2, hp));

function useDemoData() {
  return useMemo(() => {
    const n = 480;
    const f = Float64Array.from({ length: n }, (_, i) => 10 * 10 ** ((i / (n - 1)) * Math.log10(4000)));
    const W: C[] = [], M: C[] = [], T: C[] = [], S: C[] = [];
    for (const fx of f) {
      // Woofer: vented-box 4th-order high-pass at 38 Hz, LR4 low-pass at 300 Hz, cone break-up bump.
      let w = mul(mul(so(fx, 38, 0.9, true), so(fx, 42, 0.6, true)), lr4(fx, 300, false));
      w = mul(w, [1 + 0.25 * Math.exp(-(((Math.log10(fx) - Math.log10(1800)) / 0.08) ** 2)), 0]);
      // Midrange: LR4 band-pass 300 Hz - 3 kHz with 1 dB more sensitivity and a gentle ripple.
      let m = mul(mul(lr4(fx, 300, true), lr4(fx, 3000, false)), [1.12 * (1 + 0.06 * Math.sin(Math.log(fx) * 6)), 0]);
      // Tweeter: LR4 high-pass at 3 kHz, resonance hump near 1.45 kHz, 0.04 ms acoustic offset.
      const delay: C = [Math.cos(2 * Math.PI * fx * 4e-5), -Math.sin(2 * Math.PI * fx * 4e-5)];
      let t = mul(mul(lr4(fx, 3000, true), delay), [0.95, 0]);
      t = mul(t, add([1, 0], mul([0.4, 0], so(fx, 1450, 3, true))));
      W.push(w); M.push(m); T.push(t); S.push(add(add(w, m), t));
    }
    const arr = (z: C[], fn: (c: C) => number) => Float64Array.from(z, fn);
    // Impedance of a vented woofer: two peaks around the box tuning, rising with Le at the top.
    const Z = Float64Array.from(f, (fx) => {
      const pk = (f0: number, h: number, q: number) => h / Math.sqrt(1 + q * q * (fx / f0 - f0 / fx) ** 2);
      return 5.6 + pk(22, 28, 3) + pk(62, 34, 2.6) + Math.hypot(0, 2 * Math.PI * fx * 0.9e-3) * 0.9;
    });
    const sumDb = arr(S, db);
    return {
      f,
      woofDb: arr(W, db), midDb: arr(M, db), twDb: arr(T, db), sumDb,
      woofPh: arr(W, deg), midPh: arr(M, deg), twPh: arr(T, deg), sumPh: arr(S, deg),
      lower: Float64Array.from(sumDb, (v) => v - 2),
      upper: Float64Array.from(sumDb, (v) => v + 2),
      Z,
      complex: { W, M, T },
    };
  }, []);
}

/** 200 000-point noisy "raw sweep", to show decimation keeps panning fluid. */
function useDenseSeries() {
  return useMemo(() => {
    const n = 200_000;
    const x = new Float64Array(n);
    const y = new Float64Array(n);
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) - 0.5;
    for (let i = 0; i < n; i++) {
      x[i] = 20 * 10 ** ((i / (n - 1)) * 3);
      const lf = Math.log10(x[i]);
      y[i] = -4 * Math.exp(-(((lf - 2.2) / 0.3) ** 2)) + 3 * Math.exp(-(((lf - 3.6) / 0.2) ** 2)) + rnd() * 2.2 * (1 + (lf - 1.3));
    }
    return { x, y };
  }, []);
}

export function ChartsDemo() {
  const d = useDemoData();
  const dense = useDenseSeries();
  const [probe, setProbe] = useState(1000);
  const [theme, setTheme] = useState<"dark" | "light">(
    () => (document.documentElement.dataset.theme as "dark" | "light") ?? "dark",
  );
  const [showBand, setShowBand] = useState(true);
  const [narrow, setNarrow] = useState(false);
  const responseRef = useRef<PlotHandle>(null);
  const [exported, setExported] = useState<string>("");
  const [preview, setPreview] = useState<string | null>(null);

  const flipTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    setTheme(next);
  };

  const responseSeries: PlotSeries[] = [
    { id: "woof", label: "Woofer", x: d.f, y: d.woofDb, color: "woof" },
    { id: "mid", label: "Midrange", x: d.f, y: d.midDb, color: "mid" },
    { id: "tw", label: "Tweeter", x: d.f, y: d.twDb, color: "tw" },
    { id: "sum", label: "Sum", x: d.f, y: d.sumDb, color: "sum", width: 2.25 },
    { id: "target", label: "Target", x: [20, 20000], y: [0, 0], color: "ref", dash: [5, 4], width: 1.25 },
  ];

  const i = useMemo(() => {
    let best = 0;
    for (let k = 0; k < d.f.length; k++) if (Math.abs(Math.log(d.f[k] / probe)) < Math.abs(Math.log(d.f[best] / probe))) best = k;
    return best;
  }, [d.f, probe]);
  const rad = (v: number) => (v * Math.PI) / 180;
  const zAt = (fHz: number) => d.Z[nearestIndex(d.f, fHz, true)];

  return (
    <div className="charts-demo">
      <header className="charts-demo__bar">
        <div>
          <h1>Chart kit</h1>
          <p>Hover for readouts · click to set the probe · drag to pan · wheel to zoom (Ctrl: y) · Shift-drag to box-zoom · double-click to reset · ← → move the probe</p>
        </div>
        <div className="charts-demo__actions">
          <label><input type="checkbox" checked={showBand} onChange={(e) => setShowBand(e.target.checked)} /> ±2 dB band</label>
          <label><input type="checkbox" checked={narrow} onChange={(e) => setNarrow(e.target.checked)} /> Zoom 200 Hz–5 kHz</label>
          <button
            type="button"
            onClick={async () => {
              const png = await responseRef.current!.exportPNG(2);
              setExported(`PNG ${png.length.toLocaleString()} bytes`);
              setPreview((old) => {
                if (old) URL.revokeObjectURL(old);
                return URL.createObjectURL(new Blob([png as BlobPart], { type: "image/png" }));
              });
            }}
          >
            Export PNG
          </button>
          <button type="button" onClick={flipTheme}>{theme === "dark" ? "Light" : "Dark"} theme</button>
        </div>
      </header>

      <section className="charts-demo__chips">
        <div className="chip"><span>Spread</span><b>±1.8 dB</b><Sparkline x={d.f} y={d.sumDb} yRange={[-12, 6]} band={[-2, 2]} fill markerX={probe} /></div>
        <div className="chip"><span>Woofer</span><b>f3 41 Hz</b><Sparkline x={d.f} y={d.woofDb} color="woof" yRange={[-40, 6]} /></div>
        <div className="chip"><span>Min load</span><b>5.6 Ω</b><Sparkline x={d.f} y={d.Z} color="warn" /></div>
        <div className="chip chip--dials">
          <PhaseDial radians={rad(d.woofPh[i])} color="woof" label="Woofer" />
          <PhaseDial radians={rad(d.midPh[i])} color="mid" label="Mid" />
          <PhaseDial radians={rad(d.twPh[i])} color="tw" label="Tweeter" reference={rad(d.midPh[i])} referenceColor="mid" tolerance={rad(30)} target={rad(d.midPh[i])} />
          <PhaseDial radians={null} label="Idle" />
        </div>
        <div className="chip"><span>Probe</span><b>{formatHz(probe)}</b>{exported && <em>{exported}</em>}</div>
      </section>

      {preview && (
        <figure className="charts-demo__preview">
          <img src={preview} alt="Exported response plot" />
          <figcaption>
            Exported at 2x · <button type="button" onClick={() => setPreview(null)}>Close</button>
          </figcaption>
        </figure>
      )}

      <section className="charts-demo__panel">
        <Plot
          ref={responseRef}
          title="On-axis response"
          height={360}
          xRange={narrow ? [200, 5000] : [20, 20000]}
          yRange={[-30, 9]}
          yLabel="Level"
          yUnit="dB"
          series={responseSeries}
          bands={showBand ? [{ x: d.f, lower: d.lower, upper: d.upper, color: "sum", opacity: 0.08 }] : []}
          hBands={[{ from: -3, to: 3, label: "±3 dB" }]}
          vLines={[
            { x: 300, label: "fc 300 Hz", color: "text-3" },
            { x: 3000, label: "fc 3 kHz", color: "text-3" },
          ]}
          markers={[
            { x: 300, y: -6, color: "woof", shape: "diamond", label: "−6 dB" },
            { x: 3000, y: -6, color: "tw", shape: "diamond", label: "−6 dB" },
          ]}
          probeHz={probe}
          onProbe={setProbe}
          syncId="demo"
        />
      </section>

      <section className="charts-demo__grid">
        <div className="charts-demo__panel">
          <StackedPlots
            xRange={[20, 20000]}
            probeHz={probe}
            onProbe={setProbe}
            syncId="demo"
            plots={[
              {
                key: "mag",
                title: "Magnitude",
                height: 200,
                yRange: [-30, 9],
                yLabel: "Level",
                yUnit: "dB",
                series: responseSeries.slice(0, 4),
              },
              {
                key: "phase",
                title: "Phase",
                height: 180,
                yRange: [-180, 180],
                yLabel: "Phase",
                yUnit: "°",
                legend: false,
                series: [
                  { id: "woof", label: "Woofer", x: d.f, y: d.woofPh, color: "woof", wrapPhase: true },
                  { id: "mid", label: "Midrange", x: d.f, y: d.midPh, color: "mid", wrapPhase: true },
                  { id: "tw", label: "Tweeter", x: d.f, y: d.twPh, color: "tw", wrapPhase: true },
                ],
                tooltipFormat: (v) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(0)}°`,
              },
            ]}
          />
        </div>
        <div className="charts-demo__panel">
          <Plot
            title="Woofer impedance"
            height={200}
            xRange={[10, 2000]}
            yLabel="|Z|"
            yUnit="Ω"
            series={[{ id: "z", label: "Vented, 200 mm", x: d.f, y: d.Z, color: "woof" }]}
            hBands={[{ from: 0, to: 4.8, color: "bad", opacity: 0.08, label: "below 0.8 · R_E" }]}
            markers={[
              { x: 22, y: zAt(22), color: "woof", label: "f_L 22 Hz" },
              { x: 37, y: zAt(37), color: "text-2", shape: "triangle", label: "f_B 37 Hz" },
              { x: 62, y: zAt(62), color: "woof", label: "f_H 62 Hz" },
            ]}
            probeHz={probe}
            onProbe={setProbe}
            tooltipFormat={(v) => `${v.toFixed(2)} Ω`}
          />
          <div style={{ height: 8 }} />
          <Plot
            title="Raw sweep · 200k points"
            height={172}
            xRange={[20, 20000]}
            yLabel="Level"
            yUnit="dB"
            series={[{ id: "raw", label: "Unsmoothed", x: dense.x, y: dense.y, color: "mid", width: 1 }]}
            probeHz={probe}
            onProbe={setProbe}
          />
        </div>
      </section>

      <section className="charts-demo__grid">
        <div className="charts-demo__panel">
          <Plot
            title="Off-axis 30°"
            height={180}
            xRange={[20, 20000]}
            yRange={[-30, 9]}
            yLabel="Level"
            yUnit="dB"
            series={[]}
            emptyState={
              <>
                <strong>No 30° measurement</strong>
                <span>Add TF30 files to the profile to compare off-axis.</span>
              </>
            }
          />
        </div>
        <div className="charts-demo__panel">
          <Plot
            title="Group delay (linear x)"
            height={180}
            xRange={[0, 5000]}
            xLog={false}
            yLabel="Delay"
            yUnit="ms"
            series={[
              {
                id: "gd",
                label: "Sum",
                x: d.f,
                y: Float64Array.from(d.f, (fx) => 1.2 / (1 + (fx / 300) ** 2) + 0.2 / (1 + (fx / 3000) ** 2)),
                color: "sum",
              },
            ]}
          />
        </div>
      </section>
    </div>
  );
}
