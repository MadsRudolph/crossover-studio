// Filters view: the electrical transfer functions. The MiniDSP's digital low- and high-pass, the
// passive ladders alone (dashed, loaded by the real driver impedance, which is why their slopes are
// not textbook-clean) and what finally reaches the midrange and tweeter terminals (solid).

import { useMemo } from "react";
import { StackedPlots, type PlotSeries, type PlotVLine } from "../charts";
import { ALIGNMENTS, TOPOLOGY_LIBRARY } from "../engine";
import { fmtFreq, fmtValue, fmtOhm } from "../ui";
import { useStore } from "../state/store";
import type { PassiveBranch } from "../types";
import { PartChip, ViewHeader, splitHeights, useProbe, useSize } from "./common";
import { cmul, db, phaseDeg, phaseRange, unwrapDeg } from "./data";

export function FiltersView() {
  const prep = useStore(s => s.prep)!;
  const results = useStore(s => s.results)!;
  const design = useStore(s => s.design);
  const [probe, setProbe] = useProbe();
  const [ref, size] = useSize<HTMLDivElement>();
  const f = results.f, out = results.angles["0"];

  const curves = useMemo(() => {
    const termM = cmul(out.HH, out.Tm), termT = cmul(out.HH, out.Tt);
    const list: { id: string; label: string; z: typeof out.HL; color: string; dash?: number[]; width?: number }[] = [
      { id: "lp", label: "Digital low-pass", z: out.HL, color: "woof", width: 1.75 },
      { id: "hp", label: "Digital high-pass", z: out.HH, color: "text-2", width: 1.25 },
      { id: "tm", label: "Mid ladder alone", z: out.Tm, color: "mid", dash: [5, 4], width: 1.25 },
      { id: "tt", label: "Tweeter ladder alone", z: out.Tt, color: "tw", dash: [5, 4], width: 1.25 },
      { id: "vm", label: "Mid terminals", z: termM, color: "mid", width: 2 },
      { id: "vt", label: "Tweeter terminals", z: termT, color: "tw", width: 2 },
    ];
    const magS: PlotSeries[] = list.map(c => ({ id: c.id, label: c.label, x: f, y: db(c.z), color: c.color, dash: c.dash, width: c.width }));
    const phS: PlotSeries[] = list.map(c => ({ id: c.id, label: c.label, x: f, y: unwrapDeg(phaseDeg(c.z)), color: c.color, dash: c.dash, width: c.width }));
    return { magS, phS };
  }, [out, f]);

  const dg = design.digital;
  const align = ALIGNMENTS.find(a => a.key === dg.align);
  const fs = prep.profile.limits.tw_fs_hz;
  const vLines: PlotVLine[] = [
    { x: dg.fc, style: "dotted", color: "woof", label: `fc ${fmtFreq(dg.fc)}` },
    { x: fs, style: "dotted", color: "tw", label: `tweeter fs ${fmtFreq(fs)}` },
  ];
  const [hTop, hBottom] = splitHeights(size.height, [1.8, 1]);

  return (
    <div className="vw-view">
      <ViewHeader title="Filters">
        Electrical transfer functions per 1 V into the MiniDSP. Dashed: the passive filters alone, loaded by the real driver
        impedance (not a resistor). Solid: what reaches the midrange and tweeter after the digital high-pass as well.
      </ViewHeader>
      <div className="vw-strip vw-filter-strip">
        <div className="vw-fgroup">
          <span className="vw-ro-label">MiniDSP</span>
          <PartChip focus="digital.align" color="woof" hint={align?.note}>{align?.name ?? dg.align}</PartChip>
          <PartChip focus="digital.fc" color="woof">fc <span className="mono">{fmtFreq(dg.fc)}</span></PartChip>
          <PartChip focus="digital.gain" color="woof">woofer <span className="mono">{dg.g_woof_dB > 0 ? "+" : ""}{dg.g_woof_dB.toFixed(1)} dB</span></PartChip>
        </div>
        <BranchChips unit="mid" branch={design.mid} />
        <BranchChips unit="tw" branch={design.tw} />
      </div>
      <div className="vw-plots" ref={ref}>
        {size.height > 0 && (
          <StackedPlots xRange={[20, 20000]} probeHz={probe} onProbe={setProbe} syncId="filters"
            plots={[
              { key: "mag", height: hTop, series: curves.magS, yRange: [-48, 6], yLabel: "Gain", yUnit: "dB", vLines,
                hBands: [{ from: -6.02, to: -3.01, color: "text-3", opacity: 0.06, label: "−3…−6 dB" }],
                title: <span className="vw-plot-title">Magnitude</span>, ariaLabel: "Filter magnitude" },
              { key: "ph", height: hBottom, series: curves.phS, yRange: phaseRange(curves.phS as { y: ArrayLike<number> }[]), yLabel: "Phase", yUnit: "°", vLines,
                title: <span className="vw-plot-title">Phase, unwrapped</span>, ariaLabel: "Filter phase" },
            ]} />
        )}
      </div>
    </div>
  );
}

function BranchChips({ unit, branch }: { unit: "mid" | "tw"; branch: PassiveBranch }) {
  const topo = TOPOLOGY_LIBRARY[branch.topo];
  const pad = branch.pad;
  return (
    <div className="vw-fgroup">
      <span className="vw-ro-label">{unit === "mid" ? "Midrange" : "Tweeter"}</span>
      <PartChip focus={`${unit}.topo`} color={unit} hint={topo?.description}>{topo ? `${topo.type} ${topo.name}` : branch.topo}</PartChip>
      {(topo?.parts ?? []).map(p => (
        <PartChip key={p.name} focus={`${unit}.${p.name}`} color={unit} hint={p.label}>
          {p.name} <span className="mono">{fmtValue(branch.vals[p.name], p.kind)}</span>
        </PartChip>
      ))}
      {pad?.Rs ? <PartChip focus={`${unit}.pad.Rs`} color={unit} hint="L-pad series resistor">Rs <span className="mono">{fmtOhm(pad.Rs)}</span></PartChip> : null}
      {pad?.Rp ? <PartChip focus={`${unit}.pad.Rp`} color={unit} hint="L-pad shunt resistor">Rp <span className="mono">{fmtOhm(pad.Rp)}</span></PartChip> : null}
      {branch.zobel ? <PartChip focus={`${unit}.zobel`} color={unit} hint="Zobel network across the driver">Zobel</PartChip> : null}
    </div>
  );
}
