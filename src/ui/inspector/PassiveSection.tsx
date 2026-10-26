import { useMemo } from "react";
import { seedParts, topologies, type Topology } from "../../engine";
import { useStore } from "../../state/store";
import type { PassiveBranch } from "../../types";
import { Field, Section, Segmented, Stat, Switch, ValuePicker } from "..";
import { fmtDb, fmtValue, type PartKind } from "../format";
import { POLARITY_OPTIONS, UNIT_COLOR, carryValues, type SectionCommon } from "./common";

type Unit = "mid" | "tw";

/** The topology's chain spelled out for the tooltip: "2nd order, 12 dB/oct: series L1 → shunt C1". */
function describeTopo(t: Topology): { label: string; hint: string } {
  return {
    label: t.name.replace(" order", ""),
    hint: `${t.name} ${t.type === "LP" ? "low-pass" : "high-pass"}: ${t.description}. ` +
      t.parts.map(p => `${p.pos} ${p.name}`).join(" → "),
  };
}

/** Nearest value of `list` to `v` on a log scale. */
function nearest(list: number[], v: number): number {
  return list.reduce((b, x) => Math.abs(Math.log(x / v)) < Math.abs(Math.log(b / v)) ? x : b, list[0]);
}

/** The L-pad's attenuation into a resistive load R (the tweeter's Re), dB. */
function padDb(Rs: number, Rp: number | null | undefined, R: number): number {
  const par = Rp ? (Rp * R) / (Rp + R) : R;
  return 20 * Math.log10(par / (Rs + par));
}

/** Part values a branch had before its topology changed, per unit and part name, so stepping
 *  2nd → 3rd → 2nd brings back the tuned values instead of the middle of the parts list. */
const remembered: Record<Unit, Record<string, number>> = { mid: {}, tw: {} };

export function PassiveSection({ unit, step, open, onOpenChange, status }: SectionCommon & { unit: Unit; step: number }) {
  const branch = useStore(s => s.design[unit]);
  const pol = useStore(s => s.design.pol[unit]);
  const prep = useStore(s => s.prep);
  const profile = useStore(s => s.profile);
  const edit = useStore(s => s.edit);

  const library = useMemo(() => topologies(prep), [prep]);
  const type = unit === "mid" ? "LP" : "HP";
  const keys = Object.keys(library).filter(k => library[k].type === type).sort((a, b) => library[a].order - library[b].order);
  const parts = library[branch.topo]?.parts ?? [];
  if (!profile || !prep) return null;

  const color = UNIT_COLOR[unit];
  const comp = profile.components;
  const listFor = (kind: PartKind) => kind === "L" ? comp.L : kind === "C" ? comp.C : comp.R;
  const title = unit === "mid" ? "Midrange passive" : "Tweeter passive";
  const unitInfo = profile.units[unit];

  const setTopo = (key: string) => {
    const cur = useStore.getState().design;
    const old = cur[unit].vals, mem = remembered[unit];
    let vals = carryValues(library[key].parts, old, mem, listFor);
    // parts this topology adds that have no value of their own yet: tune them on the spot, so a
    // 3rd-order L2 does not start as a copy of L1 (which can put a 10 dB peak at the crossover)
    const fresh = library[key].parts.map(p => p.name)
      .filter(n => old[n] === undefined && !(mem[n] !== undefined && listFor(library[key].parts.find(p => p.name === n)!.kind).includes(mem[n])));
    if (fresh.length) {
      const trial = structuredClone(cur);
      trial[unit] = { ...trial[unit], topo: key, vals };
      try { vals = seedParts(prep, trial, unit, fresh); } catch { /* keep the carried values */ }
    }
    edit(d => {
      const b = d[unit] as PassiveBranch;
      Object.assign(remembered[unit], b.vals);
      b.topo = key;
      b.vals = vals;
    });
  };

  const valueSummary = parts.map(p => fmtValue(branch.vals[p.name], p.kind)).join(" · ");
  const zobelSummary = branch.zobel ? " · Zobel" : "";
  const pad = branch.pad ?? {};
  const padSummary = pad.Rs || pad.Rp ? ` · pad ${fmtValue(pad.Rs || null, "R", { bare: true, empty: "0" })}/${fmtValue(pad.Rp ?? null, "R", { bare: true, empty: "∞" })} Ω` : "";

  return (
    <Section id={unit} step={step} color={color} title={title} status={status} open={open} onOpenChange={onOpenChange}
             summary={`${branch.topo} · ${valueSummary}${padSummary}${zobelSummary}`}>
      <Field label="Filter" focusId={`${unit}.topo`}
             hint={`The passive ${unit === "mid" ? "low-pass in front of the midrange" : "high-pass in front of the tweeter"}. Higher order = steeper, more parts.`}>
        <Segmented label={`${title} filter order`} size="sm" value={branch.topo} onChange={setTopo}
                   options={keys.map(k => ({ value: k, ...describeTopo(library[k]) }))} />
      </Field>

      {parts.map(({ pos, kind, name, label }) => (
        <Field key={name} label={<>{name} <span className="insp-pos">{pos}</span></>} focusId={`${unit}.${name}`}
               hint={`${label}: ${pos === "series" ? "in series with" : "across"} the ${unitInfo.role}. ${kind === "L" ? "Coil value in mH" : kind === "C" ? "Capacitor value in µF" : "Resistor in Ω"}, from your parts list.`}>
          <ValuePicker label={`${title} ${name}`} value={branch.vals[name]} options={listFor(kind)} color={color}
                       format={v => fmtValue(v, kind)} onChange={v => edit(d => { d[unit].vals[name] = v; })} />
        </Field>
      ))}

      <Field label={<>Rs <span className="insp-pos">L-pad</span></>} focusId={`${unit}.pad.Rs`}
             hint={`Series resistor of the L-pad: lowers the ${unitInfo.role} level. Off = no attenuation.`}>
        <ValuePicker label={`${title} L-pad series resistor`} value={pad.Rs ?? 0} options={[0, ...comp.R]} color={color}
                     format={v => fmtValue(v, "R", { empty: "off" })}
                     describe={v => unitInfo.Re_ohm ? fmtDb(padDb(v, pad.Rp, unitInfo.Re_ohm)) : null}
                     onChange={v => edit(d => { d[unit].pad = { ...(d[unit].pad ?? {}), Rs: v }; })} />
      </Field>
      <Field label={<>Rp <span className="insp-pos">L-pad</span></>} focusId={`${unit}.pad.Rp`}
             hint="Parallel resistor of the L-pad: keeps the load the filter sees from rising too much. Off = not fitted.">
        <ValuePicker label={`${title} L-pad parallel resistor`} value={pad.Rp ?? null} options={[null, ...comp.R]} color={color}
                     format={v => fmtValue(v, "R", { empty: "off" })}
                     onChange={v => edit(d => { d[unit].pad = { ...(d[unit].pad ?? {}), Rp: v }; })} />
      </Field>
      {unitInfo.Re_ohm && (pad.Rs || pad.Rp) ? (
        <div className="insp-stats">
          <Stat label="Pad attenuation" value={fmtDb(padDb(pad.Rs ?? 0, pad.Rp, unitInfo.Re_ohm))}
                hint={`Into the ${unitInfo.role}'s Re = ${unitInfo.Re_ohm} Ω (resistive estimate)`} />
        </div>
      ) : null}

      <Field label="Zobel network" focusId={`${unit}.zobel`}
             hint={`R + C across the ${unitInfo.role} that cancels its rising voice-coil inductance, so the filter sees a flatter load.`}>
        <Switch aria-label={`${title} Zobel network`} size="sm" checked={!!branch.zobel}
                onChange={on => edit(d => {
                  const re = unitInfo.Re_ohm ?? 6;
                  d[unit].zobel = on ? { R: nearest(comp.R, re * 1.25), C: nearest(comp.C, 4.7e-6) } : null;
                })} />
      </Field>
      {branch.zobel && (
        <>
          <Field label={<>R <span className="insp-pos">Zobel</span></>} focusId={`${unit}.zobel.R`} hint="Usually about 1.25 × the voice-coil resistance Re.">
            <ValuePicker label={`${title} Zobel resistor`} value={branch.zobel.R} options={comp.R} color={color}
                         format={v => fmtValue(v, "R")} onChange={v => edit(d => { const z = d[unit].zobel; if (z) z.R = v; })} />
          </Field>
          <Field label={<>C <span className="insp-pos">Zobel</span></>} focusId={`${unit}.zobel.C`} hint="About Le / R², with Le the voice-coil inductance.">
            <ValuePicker label={`${title} Zobel capacitor`} value={branch.zobel.C} options={comp.C} color={color}
                         format={v => fmtValue(v, "C")} onChange={v => edit(d => { const z = d[unit].zobel; if (z) z.C = v; })} />
          </Field>
        </>
      )}

      <Field label="Polarity" focusId={`${unit}.pol`}
             hint={`Invert the ${unitInfo.role} if it cancels its neighbour around the crossover (a dip in the sum).`}>
        <Segmented label={`${title} polarity`} size="sm" value={pol} options={POLARITY_OPTIONS}
                   onChange={p => edit(d => { d.pol[unit] = p; })} />
      </Field>
    </Section>
  );
}
