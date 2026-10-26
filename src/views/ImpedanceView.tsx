// Impedance view: the load amplifier channel 2 sees (the passive board with both drivers), against the
// measured driver impedances that load the ladders, with the 4 ohm comfort limit. The woofer's
// channel-1 load from the box model is available as an extra trace.

import { useMemo, useState } from "react";
import { StackedPlots, type PlotMarker, type PlotSeries } from "../charts";
import { boxResponse, nodeVoltages } from "../engine";
import { fmtFreq, fmtOhm } from "../ui";
import { useStore } from "../state/store";
import { Readout, ViewHeader, fmtSigned, splitHeights, useProbe, useSize } from "./common";
import { mag, minIn, nearest, phaseDeg } from "./data";

const MIN_BAND: [number, number] = [200, 15000];

export function ImpedanceView() {
  const prep = useStore(s => s.prep)!;
  const results = useStore(s => s.results)!;
  const box = useStore(s => s.design.box);
  const design = useStore(s => s.design);
  const [probe, setProbe] = useProbe();
  const [ref, size] = useSize<HTMLDivElement>();
  const f = results.f, Z = results.angles["0"].Zamp2;

  // the woofer load depends on the box only, so recompute it only when the box changes
  const woofZ = useMemo(() => boxResponse(prep, design, Array.from(f)).ZE, [prep, box, f]); // eslint-disable-line react-hooks/exhaustive-deps

  const curves = useMemo(() => {
    const ch2 = mag(Z), zm = mag(prep.zi.mid), zt = mag(prep.zi.tw), zw = mag(woofZ);
    return { ch2, zm, zt, zw, ph2: phaseDeg(Z), phm: phaseDeg(prep.zi.mid), pht: phaseDeg(prep.zi.tw), phw: phaseDeg(woofZ) };
  }, [Z, prep, woofZ]);

  const min = minIn(f, curves.ch2, ...MIN_BAND);
  const tone = !min ? undefined : min.y >= 4 ? "good" : min.y >= 3 ? "warn" : "bad";
  const i = nearest(f, probe);
  const split = useMemo(() => {
    const c = nodeVoltages(prep, design, probe).current, t = c.mid + c.tw || 1;
    return { mid: 100 * c.mid / t, tw: 100 * c.tw / t };
  }, [prep, design, probe]);

  // the woofer trace starts hidden; once shown, the magnitude range makes room for its peaks too
  const [showWoof, setShowWoof] = useState(false);
  const onToggle = (id: string, visible: boolean) => { if (id === "zw") setShowWoof(visible); };
  // (up to 1 kHz only: channel 1 is low-passed far below that, and the voice-coil inductance rise above would flatten the rest)
  const woofBand = useMemo(() => curves.zw.filter((_, k) => f[k] <= 1000), [curves, f]);
  const ranged = [curves.ch2, curves.zm, curves.zt, ...(showWoof ? [woofBand] : [])];
  const top = Math.min(64, Math.max(16, Math.ceil(Math.max(...ranged.flatMap(c => Array.from(c).filter(Number.isFinite))) / 8) * 8));

  const mag3: PlotSeries[] = [
    { id: "ch2", label: "Channel 2 load", x: f, y: curves.ch2, color: "sum", width: 2.25, unit: "Ω" },
    { id: "zm", label: "Midrange Zi", x: f, y: curves.zm, color: "mid", dash: [5, 4], unit: "Ω" },
    { id: "zt", label: "Tweeter Zi", x: f, y: curves.zt, color: "tw", dash: [5, 4], unit: "Ω" },
    { id: "zw", label: "Woofer (ch. 1, model)", x: f, y: curves.zw, color: "woof", width: 1.25, hidden: !showWoof, unit: "Ω" },
  ];
  const ph: PlotSeries[] = [
    { id: "ch2", label: "Channel 2 load", x: f, y: curves.ph2, color: "sum", width: 2 },
    { id: "zm", label: "Midrange Zi", x: f, y: curves.phm, color: "mid", dash: [5, 4] },
    { id: "zt", label: "Tweeter Zi", x: f, y: curves.pht, color: "tw", dash: [5, 4] },
    { id: "zw", label: "Woofer (ch. 1, model)", x: f, y: curves.phw, color: "woof", width: 1.25, hidden: !showWoof },
  ];
  const markers: PlotMarker[] = min ? [{ x: min.x, y: min.y, shape: "diamond", color: tone, label: `min ${fmtOhm(min.y)}`, size: 5 }] : [];
  const [hTop, hBottom] = splitHeights(size.height, [2, 1]);

  return (
    <div className="vw-view">
      <ViewHeader title="Impedance">
        The load amplifier channel 2 sees: the passive board with both drivers, built on their measured Lab D impedances (dashed).
        The shaded strip marks 0–4 Ω; staying above it keeps the amplifier comfortable.
      </ViewHeader>
      <div className="vw-strip">
        <Readout label="Minimum, 200 Hz–15 kHz" value={min ? fmtOhm(min.y, { bare: true }) : "—"} unit="Ω" tone={tone}
                 onClick={min ? () => setProbe(min.x) : undefined} hint={min ? `at ${fmtFreq(min.x)}; click to probe there` : undefined} />
        {min && <Readout label="at" value={fmtFreq(min.x)} />}
        <Readout label={`|Z| at ${fmtFreq(f[i])}`} value={fmtOhm(curves.ch2[i], { bare: true })} unit="Ω" />
        <Readout label="Phase" value={`${fmtSigned(curves.ph2[i], 0)}°`} />
        <Readout label="Current mid / tw" value={`${split.mid.toFixed(0)} / ${split.tw.toFixed(0)}`} unit="%"
                 hint="How the channel-2 current divides between the midrange and tweeter branches at the probe (magnitudes)" />
      </div>
      <div className="vw-plots" ref={ref}>
        {size.height > 0 && (
          <StackedPlots xRange={[20, 20000]} probeHz={probe} onProbe={setProbe} syncId="impedance"
            plots={[
              { key: "mag", height: hTop, series: mag3, yRange: [0, top], yLabel: "|Z|", yUnit: "Ω", markers,
                hBands: [{ from: 0, to: 4, color: "bad", opacity: 0.08, label: "< 4 Ω" }],
                title: <span className="vw-plot-title">Magnitude</span>, ariaLabel: "Impedance magnitude", onSeriesToggle: onToggle },
              { key: "ph", height: hBottom, series: ph, yRange: [-90, 90], yLabel: "Phase", yUnit: "°",
                title: <span className="vw-plot-title">Phase</span>, ariaLabel: "Impedance phase", onSeriesToggle: onToggle },
            ]} />
        )}
      </div>
    </div>
  );
}
