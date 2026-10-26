// Woofer box view: the box model of the design (2.83 V, 1 m, half space) against the vents plugged,
// with cone excursion and vent air speed; a validation page that lays the model over every Lab D
// measurement it was fitted to (impedance) or predicts (near field); and the fitted driver.

import { useMemo, useState } from "react";
import { CircleAlert } from "lucide-react";
import { StackedPlots, type PlotSeries, type PlotVLine } from "../charts";
import { boxModelCurves, boxValidation, driverValidation, type BoxFitEx, type ValidationCurve } from "../engine";
import { Badge, EmptyState, Segmented, fmtFreq, fmtOhm, withUnits } from "../ui";
import { focusControl } from "../ui/shell/commands";
import { useStore } from "../state/store";
import { Card, Readout, ViewHeader, fmtSigned, splitHeights, useProbe, useSize } from "./common";
import { db, mag, rmsDbError } from "./data";

type Page = "model" | "validation";
let lastPage: Page = "model";   // remembered while the app runs, so switching views keeps the page
let lastConfig = "";

/** Above about 17 m/s (5 % of c) vent noise becomes audible: the usual rule of thumb. */
const VENT_NOISE_MS = 17;

export function BoxView() {
  const [page, setPage] = useState<Page>(lastPage);
  const choose = (p: Page) => { lastPage = p; setPage(p); };
  return (
    <div className="vw-view">
      <ViewHeader title="Woofer box"
        actions={<Segmented label="Box view page" size="sm" value={page} onChange={choose}
                            options={[{ value: "model", label: "Design model" }, { value: "validation", label: "Validation" }]} />}>
        {page === "model"
          ? <>The woofer in its box from the circuit fitted to the Lab D impedances: 2.83 V, 1 m, half space, no room. Dashed: the same box with the vents plugged, as the Lab E woofer was measured.</>
          : <>The fitted model laid over the measurements: impedances were fitted, the near-field curves are predictions, so their agreement is the real test.</>}
      </ViewHeader>
      <div className="vw-box">
        <div className="vw-box-main">{page === "model" ? <ModelPlots /> : <ValidationPlots />}</div>
        <aside className="vw-box-side"><FitCard /></aside>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- the design's box
function ModelPlots() {
  const prep = useStore(s => s.prep)!;
  const box = useStore(s => s.design.box);
  const design = useStore(s => s.design);
  const rb = useStore(s => s.results!.box);
  const [probe, setProbe] = useProbe();
  const [ref, size] = useSize<HTMLDivElement>();
  const c = useMemo(() => boxModelCurves(prep, design), [prep, box]); // eslint-disable-line react-hooks/exhaustive-deps
  const vented = !!c.MAP;

  const spl: PlotSeries[] = [
    { id: "cur", label: "This box", x: c.f, y: c.spl_dB, color: "woof", width: 2.25, unit: "dB SPL" },
    { id: "plug", label: "Vents plugged", x: c.f, y: c.plugged.spl_dB, color: "ref", dash: [5, 4], unit: "dB SPL" },
  ];
  const exc: PlotSeries[] = [
    { id: "cur", label: "This box", x: c.f, y: c.excursion_mm, color: "woof", width: 2, unit: "mm" },
    { id: "plug", label: "Vents plugged", x: c.f, y: c.plugged.excursion_mm, color: "ref", dash: [5, 4], unit: "mm" },
  ];
  const vent: PlotSeries[] = vented ? [{ id: "v", label: "Vent air speed", x: c.f, y: c.ventSpeed_ms, color: "woof", width: 2, unit: "m/s" }] : [];
  const lines: PlotVLine[] = [{ x: rb.f3, style: "dashed", color: "text-3", label: `f3 ${fmtFreq(rb.f3)}` }];
  if (rb.fB) lines.push({ x: rb.fB, style: "dotted", color: "woof", label: `fB ${fmtFreq(rb.fB)}` });

  const peakV = vented ? Math.max(...Array.from(c.ventSpeed_ms)) : 0;
  const top = Math.ceil(Math.max(...Array.from(c.spl_dB), ...Array.from(c.plugged.spl_dB)) / 5) * 5 + 5;
  const [h1, h2, h3] = splitHeights(size.height, [1.7, 1, 1], 8, 120);

  return (
    <div className="vw-col">
      <div className="vw-strip">
        <Readout label="Setting" value={rb.label} onClick={() => focusControl("box.mode")} hint="Change the vents in the inspector" />
        <Readout label="fB" value={rb.fB ? rb.fB.toFixed(1) : "—"} unit={rb.fB ? "Hz" : undefined} />
        <Readout label="f3" value={rb.f3.toFixed(1)} unit="Hz" />
        <Readout label="Ripple" value={fmtSigned(rb.ripple)} unit="dB" tone={rb.ripple <= 2 ? "good" : rb.ripple <= 3 ? "warn" : "bad"}
                 hint="Highest point below 150 Hz against the 150–300 Hz level" />
        {vented && <Readout label="Peak vent speed" value={peakV.toFixed(1)} unit="m/s" tone={peakV < VENT_NOISE_MS ? "good" : "warn"}
                            hint={`At 2.83 V; above about ${VENT_NOISE_MS} m/s the vent starts to chuff`} />}
        {rb.fill !== 1 && <Readout label="Filling" value={`× ${rb.fill.toFixed(2)}`} />}
      </div>
      <div className="vw-plots" ref={ref}>
        {size.height > 0 && (
          <StackedPlots xRange={[10, 400]} probeHz={probe} onProbe={setProbe} syncId="box-model"
            plots={[
              { key: "spl", height: h1, series: spl, yRange: [top - 45, top], yLabel: "SPL", yUnit: "dB", vLines: lines,
                title: <span className="vw-plot-title">{withUnits("Far field · 2.83 V · 1 m")}</span>, ariaLabel: "Box model SPL" },
              { key: "x", height: h2, series: exc, yLabel: "Excursion", yUnit: "mm", vLines: lines,
                title: <span className="vw-plot-title">Cone excursion, peak</span>, ariaLabel: "Cone excursion" },
              { key: "v", height: h3, series: vent, yLabel: "Air speed", yUnit: "m/s", vLines: lines,
                hBands: vented ? [{ from: VENT_NOISE_MS, to: Math.max(VENT_NOISE_MS * 3, peakV * 1.2), color: "warn", opacity: 0.08, label: "audible vent noise" }] : [],
                emptyState: <span className="vw-muted">Vents plugged: no vent air flow.</span>,
                title: <span className="vw-plot-title">Vent air speed, peak</span>, ariaLabel: "Vent air speed" },
            ]} />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- validation
interface Config { id: string; label: string; z: ValidationCurve; nfCone?: ValidationCurve; nfVent?: ValidationCurve; fB?: number }

function ValidationPlots() {
  const prep = useStore(s => s.prep)!;
  const [probe, setProbe] = useProbe();
  const [ref, size] = useSize<HTMLDivElement>();
  const configs = useMemo<Config[]>(() => {
    const d = driverValidation(prep), out: Config[] = [];
    if (d.free) out.push({ id: "free", label: "Free air", z: d.free });
    if (d.closed) out.push({ id: "closed", label: "Closed box", z: d.closed });
    boxValidation(prep).forEach((v, k) => out.push({ id: `v${k}`, label: v.label, z: v.Z, nfCone: v.nfCone, nfVent: v.nfVent, fB: v.fB }));
    return out;
  }, [prep]);
  const [sel, setSel] = useState(() => configs.find(c => c.id === lastConfig)?.id ?? configs.find(c => c.fB)?.id ?? configs[0]?.id ?? "");
  const pick = (id: string) => { lastConfig = id; setSel(id); };
  const cfg = configs.find(c => c.id === sel) ?? configs[0];

  if (!cfg) {
    return (
      <div className="cs-fill-center">
        <EmptyState icon={CircleAlert} title="No woofer measurements to validate against"
          description="Add the Lab D woofer impedances (free air, closed box and each vent length) to the profile to see the fit here." />
      </div>
    );
  }

  const zSeries: PlotSeries[] = [
    { id: "meas", label: "Measured", x: cfg.z.f, y: mag(cfg.z.meas), color: "sum", width: 1.75, unit: "Ω" },
    { id: "model", label: "Model", x: cfg.z.f, y: mag(cfg.z.model), color: "accent", dash: [6, 4], width: 2, unit: "Ω" },
  ];
  const nf: PlotSeries[] = [];
  if (cfg.nfCone) nf.push({ id: "cm", label: "Cone, measured", x: cfg.nfCone.f, y: db(cfg.nfCone.meas), color: "woof", width: 1.75 },
                         { id: "cp", label: "Cone, model", x: cfg.nfCone.f, y: db(cfg.nfCone.model), color: "woof", dash: [6, 4] });
  if (cfg.nfVent) nf.push({ id: "vm", label: "Vent, measured", x: cfg.nfVent.f, y: db(cfg.nfVent.meas), color: "mid", width: 1.75 },
                         { id: "vp", label: "Vent, model", x: cfg.nfVent.f, y: db(cfg.nfVent.model), color: "mid", dash: [6, 4] });
  const zErr = rmsDbError(cfg.z.f, cfg.z.meas, cfg.z.model, 8, 150);
  const nfErr = cfg.nfCone ? rmsDbError(cfg.nfCone.f, cfg.nfCone.meas, cfg.nfCone.model, 10, 100) : NaN;
  const zTop = Math.min(160, Math.ceil(Math.max(...Array.from(zSeries[0].y as Float64Array).filter((_v, i) => cfg.z.f[i] >= 10 && cfg.z.f[i] <= 500)) / 10) * 10 + 10);
  const lines: PlotVLine[] = cfg.fB ? [{ x: cfg.fB, style: "dotted", color: "woof", label: `fB ${fmtFreq(cfg.fB)}` }] : [];
  const [h1, h2] = nf.length ? splitHeights(size.height, [1, 1]) : [size.height, 0];

  return (
    <div className="vw-col">
      <div className="vw-strip">
        <Segmented label="Measurement" size="sm" value={cfg.id} onChange={pick} options={configs.map(c => ({ value: c.id, label: c.label }))} />
        <Readout label="|Z| error 8–150 Hz" value={Number.isFinite(zErr) ? zErr.toFixed(2) : "—"} unit="dB RMS"
                 tone={zErr <= 1 ? "good" : zErr <= 2 ? "warn" : "bad"} />
        {Number.isFinite(nfErr) && <Readout label="Near field error" value={nfErr.toFixed(1)} unit="dB RMS" tone={nfErr <= 3 ? "good" : nfErr <= 6 ? "warn" : "bad"}
                                            hint="Cone near field, 10–100 Hz. Not fitted: a prediction of the model" />}
        {cfg.fB && <Readout label="Fitted fB" value={cfg.fB.toFixed(1)} unit="Hz" />}
      </div>
      <div className="vw-plots" ref={ref}>
        {size.height > 0 && (
          <StackedPlots xRange={[10, 500]} probeHz={probe} onProbe={setProbe} syncId="box-val"
            plots={[
              { key: "z", height: h1, series: zSeries, yRange: [0, zTop], yLabel: "|Z|", yUnit: "Ω", vLines: lines,
                title: <span className="vw-plot-title">Input impedance · {cfg.label}</span>, ariaLabel: "Measured and modelled impedance" },
              ...(nf.length ? [{ key: "nf", height: h2, series: nf, yLabel: "Near field", yUnit: "dB", vLines: lines,
                title: <span className="vw-plot-title">Near-field pressure re 1 Pa/V (predicted)</span>, ariaLabel: "Near-field pressure" }] : []),
            ]} />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- the fitted driver
function FitCard() {
  const fit = useStore(s => s.fit) as BoxFitEx | null;
  const profile = useStore(s => s.profile)!;
  if (!fit) return null;
  const ts = fit.ts;
  const q = (x: number) => x < 0.01 ? "good" : x < 0.05 ? "warn" : "bad";
  return (
    <>
      <Card title="Fitted driver" actions={<span className="vw-muted">{profile.units.woof.label}</span>}>
        <dl className="vw-kv">
          <dt>f<sub>S</sub></dt><dd className="mono">{ts.fs.toFixed(1)} Hz</dd>
          <dt>Q<sub>TS</sub></dt><dd className="mono">{ts.Qts.toFixed(3)}</dd>
          <dt>Q<sub>ES</sub></dt><dd className="mono">{ts.Qes.toFixed(3)}</dd>
          <dt>Q<sub>MS</sub></dt><dd className="mono">{ts.Qms.toFixed(2)}</dd>
          <dt>V<sub>AS</sub></dt><dd className="mono">{ts.Vas_L.toFixed(0)} L</dd>
          <dt>M<sub>MS</sub></dt><dd className="mono">{(ts.Mms * 1e3).toFixed(1)} g</dd>
          <dt>Bl</dt><dd className="mono">{fit.drv.Bl.toFixed(2)} T·m</dd>
          <dt>R<sub>E</sub></dt><dd className="mono">{fmtOhm(fit.RE)}</dd>
          <dt>L<sub>E</sub></dt><dd className="mono">{(fit.drv.Le * 1e3).toFixed(2)} mH</dd>
        </dl>
      </Card>
      <Card title="Box">
        <dl className="vw-kv">
          <dt>V<sub>B</sub></dt><dd className="mono">{(fit.VB * 1e3).toFixed(1)} L</dd>
          <dt>Vent ⌀</dt><dd className="mono">{(fit.AP * 2e3).toFixed(0)} mm</dd>
          <dt>Q<sub>L</sub> / Q<sub>P</sub></dt><dd className="mono">{fit.QL.toFixed(1)} / {fit.QP.toFixed(0)}</dd>
          <dt>Air</dt><dd className="mono">{fit.T.toFixed(0)} °C, c {fit.c.toFixed(0)} m/s</dd>
        </dl>
        {fit.MAP.length > 0 && (
          <table className="vw-mini-table">
            <thead><tr><th>Vent length</th><th>M<sub>AP</sub></th><th>f<sub>B</sub></th></tr></thead>
            <tbody>{(fit.ventFits?.length ? fit.ventFits.map(v => [v.vents[0]?.length_m ?? 0, v.MAP, v.fB] as const)
                                          : fit.MAP.map(([L, M]) => [L, M, NaN] as const)).map(([L, M, fB], k) => (
              <tr key={k}><td className="mono">{(L * 1e3).toFixed(0)} mm</td><td className="mono">{M.toFixed(1)} kg/m⁴</td>
                <td className="mono">{Number.isFinite(fB) ? `${fB.toFixed(1)} Hz` : "—"}</td></tr>
            ))}</tbody>
          </table>
        )}
      </Card>
      <Card title="Fit quality">
        <div className="vw-quality">
          <Badge tone={q(fit.quality.driver)}>driver {fit.quality.driver.toFixed(4)}</Badge>
          <Badge tone={q(fit.quality.vents)}>vents {fit.quality.vents.toFixed(4)}</Badge>
        </div>
        <p className="vw-foot">Mean squared log error of |Z| (lower is better). Below 0.01 the curves lie on top of each other.</p>
        {fit.notes?.length ? <ul className="vw-notes">{fit.notes.map((n, k) => <li key={k}>{n}</li>)}</ul> : null}
      </Card>
    </>
  );
}
