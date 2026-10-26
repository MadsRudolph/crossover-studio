// Side sheet describing the open profile: notes, units, boxes, conditions and where every series came from.
import type { ReactNode } from "react";
import type { Profile, Series, UnitId } from "../types";
import { useStore } from "../state/store";
import { Badge, Sheet, fmtFreq } from "../ui";
import { UNIT_NAME } from "./roles";

const UNITS: UnitId[] = ["woof", "mid", "tw"];
const mm = (m: number | undefined) => (m === undefined || !Number.isFinite(m) ? "—" : `${Math.round(m * 1000)} mm`.replace("-", "\u2212"));
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function ProfileDetails({ open, onClose }: { open: boolean; onClose(): void }) {
  const profile = useStore(s => s.profile);
  if (!profile) return null;
  const sub = [profile.group, profile.system && `System ${profile.system}`].filter(Boolean).join(" · ");
  return (
    <Sheet open={open} onClose={onClose} size="lg" title={profile.name} description={sub || profile.id}>
      <div className="wz-details">
        {profile.notes && <p className="wz-details-notes">{profile.notes}</p>}

        <Block title="Drivers">
          <table className="wz-table">
            <thead><tr><th>Unit</th><th>Model</th><th>Effective Ø</th><th>Frame Ø</th><th>R_E</th></tr></thead>
            <tbody>
              {UNITS.map(u => {
                const x = profile.units[u];
                return (
                  <tr key={u}>
                    <td><Badge tone={u}>{UNIT_NAME[u]}</Badge></td><td>{x.label} <span className="wz-muted">({x.kind})</span></td>
                    <td className="mono">{mm(x.diameter_m)}</td><td className="mono">{mm(x.frame_diameter_m)}</td>
                    <td className="mono">{x.Re_ohm !== undefined ? `${x.Re_ohm} Ω` : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Block>

        <Block title="Boxes and measurement">
          <dl className="wz-dl">
            <Row k="Woofer box, inner">{profile.woofer_box.inner_m.map(v => Math.round(v * 1000)).join(" × ")} mm
              <span className="wz-muted"> · {(profile.woofer_box.inner_m.reduce((a, b) => a * b, 1) * 1000).toFixed(1)} L, wall {mm(profile.woofer_box.wall_m)}</span></Row>
            <Row k="Vents">{profile.woofer_box.vents.map(v => (
              <span key={v.id} className="wz-details-vent">{v.id}: Ø {mm(v.diameter_m)}{v.estimated ? <Badge tone="warn">estimated</Badge> : null}</span>
            ))}</Row>
            <Row k="Top box, outer">{profile.top_box.outer_m.map(v => Math.round(v * 1000)).join(" × ")} mm
              <span className="wz-muted"> · offset {mm(profile.top_box.offset_x_m)}</span></Row>
            <Row k="Temperature">{profile.conditions.T_C} °C</Row>
            <Row k="Microphone distance">{profile.conditions.mic_distance_m !== undefined ? `${profile.conditions.mic_distance_m} m` : "—"}</Row>
            <Row k="Phase reference d">{profile.conditions.phase_ref_distance_m} m</Row>
            <Row k="Crossover windows">woofer/mid {fmtFreq(profile.limits.wm[0])}–{fmtFreq(profile.limits.wm[1])}, mid/tweeter {fmtFreq(profile.limits.mt[0])}–{fmtFreq(profile.limits.mt[1])}</Row>
            <Row k="Tweeter resonance">{fmtFreq(profile.limits.tw_fs_hz)}</Row>
            <Row k="Parts available">{profile.components.L.length} inductors, {profile.components.C.length} capacitors, {profile.components.R.length} resistors</Row>
          </dl>
        </Block>

        <Block title="Where the data came from">
          <table className="wz-table wz-prov">
            <thead><tr><th>Role</th><th>Source</th><th>Points</th><th>Range</th></tr></thead>
            <tbody>{provenance(profile).map(([role, s]) => <ProvRow key={role} role={role} s={s} />)}</tbody>
          </table>
        </Block>
      </div>
    </Sheet>
  );
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return <section className="wz-details-block"><h4 className="label-caps">{title}</h4>{children}</section>;
}
const Row = ({ k, children }: { k: string; children: ReactNode }) => <><dt>{k}</dt><dd>{children}</dd></>;

function provenance(p: Profile): [string, Series][] {
  const out: [string, Series][] = [];
  for (const ang of Object.keys(p.measurements.tf).sort((a, b) => +a - +b))
    for (const u of UNITS) { const s = p.measurements.tf[ang][u]; if (s) out.push([`${cap(UNIT_NAME[u])} response, ${ang}°`, s]); }
  if (p.measurements.zi.mid) out.push(["Midrange impedance", p.measurements.zi.mid]);
  if (p.measurements.zi.tw) out.push(["Tweeter impedance", p.measurements.zi.tw]);
  const w = p.measurements.woofer;
  if (w.free) out.push(["Woofer, free air", w.free]);
  if (w.closed) out.push(["Woofer, closed box", w.closed]);
  for (const v of w.vented) {
    const l = v.vents.map(x => `${x.id} ${Math.round(x.length_m * 1000)} mm`).join(" + ");
    out.push([`Woofer, vented ${l}`, v.z]);
    if (v.nf_cone) out.push([`Near field cone, ${l}`, v.nf_cone]);
    if (v.nf_vent) out.push([`Near field vent, ${l}`, v.nf_vent]);
  }
  return out;
}

function ProvRow({ role, s }: { role: string; s: Series }) {
  const src = s.source;
  const variable = src?.dataVar ? `${src.dataVar}${src.column !== undefined ? `(:,${src.column + 1})` : ""}` : null;
  return (
    <tr>
      <td>{role}</td>
      <td>
        {src ? <><span className="mono">{src.file}</span>{variable && <span className="mono wz-muted"> › {variable}</span>}
          {src.note && <div className="wz-muted wz-prov-note">{src.note}</div>}</> : <span className="wz-muted">not recorded</span>}
      </td>
      <td className="mono">{s.f.length}</td>
      <td className="mono">{s.f.length ? `${fmtFreq(s.f[0])}–${fmtFreq(s.f[s.f.length - 1])}` : "—"}</td>
    </tr>
  );
}
