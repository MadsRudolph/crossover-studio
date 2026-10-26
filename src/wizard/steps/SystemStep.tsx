// Step 3: describe the system. Values start from the bundled System D example and are tagged "example"
// until the user edits them; values the measurements give (R_E, tweeter resonance) are tagged "from data".
import { useMemo, useState, type ReactNode } from "react";
import { Info, Plus, RotateCcw, Trash2 } from "lucide-react";
import type { UnitId, VentSpec } from "../../types";
import { BUNDLED_PROFILES } from "../../state/store";
import { Badge, Button, Checkbox, Field, IconButton, NumberField, Segmented, Tooltip, fmtSig } from "../../ui";
import { useWizard, type Provenance } from "../draft";
import { estimateRe, estimateResonance } from "../build";
import { choiceKey, UNIT_NAME } from "../roles";
import { LayoutSketch } from "./LayoutSketch";

const UNITS: UnitId[] = ["woof", "mid", "tw"];
type Sys = ReturnType<typeof useWizard.getState>["system"];
const set = (mut: (d: Sys) => void, path: string) => useWizard.getState().setSystem(mut, path, "user");

/** Where a value came from, as a small mark beside its label: a hollow ring for the bundled example
 *  (still to be replaced), a filled dot for a value estimated from the measurements. `course`: a value
 *  every group shares (the project guide's parts list and windows), so not an example. */
function Tag({ path, course }: { path: string; course?: boolean }) {
  const p: Provenance | undefined = useWizard(s => s.provenance[path]);
  if (p === "user" || (course && !p)) return null;
  const data = p === "data";
  const text = data ? "Estimated from your measurements" : "Example value from System D: replace it with yours";
  return (
    <Tooltip content={text} side="top" delay={200}>
      <span className={`wz-mark ${data ? "is-data" : "is-example"}`} role="img" aria-label={text} tabIndex={-1} />
    </Tooltip>
  );
}

/** One numeric row: SI value in the draft, `scale` to the display unit. */
function Num({ path, label, hint, value, scale = 1, unit, digits, min = 0, max, step, stacked, onSet }: {
  path: string; label: ReactNode; hint?: ReactNode; value: number | undefined; scale?: number; unit: string; digits?: number;
  min?: number; max?: number; step?: number; stacked?: boolean; onSet(si: number): void;
}) {
  return (
    <Field label={label} hint={hint} stacked={stacked} tag={<Tag path={path} />}>
      <NumberField label={typeof label === "string" ? label : path} value={value === undefined ? null : round(value * scale)} unit={unit}
                   digits={digits} min={min} max={max} step={step ?? 1} size={6}
                   onChange={v => onSet(v / scale)} />
    </Field>
  );
}
const round = (v: number) => Math.round(v * 1e6) / 1e6;

export function SystemStep() {
  const sys = useWizard(s => s.system);
  const provenance = useWizard(s => s.provenance);
  const examples = useMemo(() => ALL_PATHS.filter(p => !provenance[p]).length, [provenance]);

  return (
    <div className="wz-system">
      <p className="wz-lede">
        The box fit and the 3D model need the physical sizes; the checks need your design rules. Everything starts from
        Group 10's System D. {examples > 0
          ? <>Replace the <strong>{examples} example values</strong>, marked <span className="wz-mark is-example" aria-hidden />, with your own: a ruler and the data sheets are enough. Values marked <span className="wz-mark is-data" aria-hidden /> come from your measurements.</>
          : <>Every value is now yours.</>}
      </p>

      <div className="wz-system-grid">
        <div className="wz-system-forms">
          <Card title="Drivers" hint="The effective diameter sets the radiating area S_D = πD²/4 (about the cone plus half the surround).">
            <div className="wz-driver-cards">{UNITS.map(u => <DriverCard key={u} u={u} />)}</div>
          </Card>

          <Card title="Woofer box" hint="Inner dimensions give the box volume V_B. Positions are measured on the front face from the box centre line (x, + to the right seen from the front) and from the floor (y).">
            <div className="wz-form-cols">
              <Num path="woofer_box.inner.w" label="Inner width" value={sys.woofer_box.inner_m[0]} scale={1000} unit="mm" onSet={v => set(d => { d.woofer_box.inner_m[0] = v; }, "woofer_box.inner.w")} />
              <Num path="woofer_box.inner.h" label="Inner height" value={sys.woofer_box.inner_m[1]} scale={1000} unit="mm" onSet={v => set(d => { d.woofer_box.inner_m[1] = v; }, "woofer_box.inner.h")} />
              <Num path="woofer_box.inner.d" label="Inner depth" value={sys.woofer_box.inner_m[2]} scale={1000} unit="mm" onSet={v => set(d => { d.woofer_box.inner_m[2] = v; }, "woofer_box.inner.d")} />
              <Num path="woofer_box.wall" label="Wall thickness" value={sys.woofer_box.wall_m} scale={1000} unit="mm" onSet={v => set(d => { d.woofer_box.wall_m = v; }, "woofer_box.wall")} />
              <Num path="woofer_box.driver.x" label="Woofer centre x" min={-1000} value={sys.woofer_box.driver_pos_m[0]} scale={1000} unit="mm" onSet={v => set(d => { d.woofer_box.driver_pos_m[0] = v; }, "woofer_box.driver.x")} />
              <Num path="woofer_box.driver.y" label="Woofer centre y" value={sys.woofer_box.driver_pos_m[1]} scale={1000} unit="mm" onSet={v => set(d => { d.woofer_box.driver_pos_m[1] = v; }, "woofer_box.driver.y")} />
            </div>
            <Stat2 label="Box volume" value={`${fmtSig(sys.woofer_box.inner_m.reduce((a, b) => a * b, 1) * 1000, 3)} L`} />
            <Vents />
          </Card>

          <Card title="Top box (midrange + tweeter)" hint="Outer size, and where it sits on the woofer box. The front faces are flush.">
            <div className="wz-form-cols">
              <Num path="top_box.outer.w" label="Outer width" value={sys.top_box.outer_m[0]} scale={1000} unit="mm" onSet={v => set(d => { d.top_box.outer_m[0] = v; }, "top_box.outer.w")} />
              <Num path="top_box.outer.h" label="Outer height" value={sys.top_box.outer_m[1]} scale={1000} unit="mm" onSet={v => set(d => { d.top_box.outer_m[1] = v; }, "top_box.outer.h")} />
              <Num path="top_box.outer.d" label="Outer depth" value={sys.top_box.outer_m[2]} scale={1000} unit="mm" onSet={v => set(d => { d.top_box.outer_m[2] = v; }, "top_box.outer.d")} />
              <Num path="top_box.offset" label="Offset x" min={-1000} hint="Centre of the top box relative to the woofer box centre line, + to the right seen from the front."
                   value={sys.top_box.offset_x_m} scale={1000} unit="mm" onSet={v => set(d => { d.top_box.offset_x_m = v; }, "top_box.offset")} />
              <Num path="top_box.mid.y" label="Midrange centre y" hint="From the bottom of the top box." value={sys.top_box.mid_pos_m[1]} scale={1000} unit="mm" onSet={v => set(d => { d.top_box.mid_pos_m[1] = v; }, "top_box.mid.y")} />
              <Num path="top_box.tw.y" label="Tweeter centre y" hint="From the bottom of the top box." value={sys.top_box.tw_pos_m[1]} scale={1000} unit="mm" onSet={v => set(d => { d.top_box.tw_pos_m[1] = v; }, "top_box.tw.y")} />
              <Num path="top_box.mid.x" label="Midrange centre x" min={-1000} value={sys.top_box.mid_pos_m[0]} scale={1000} unit="mm" onSet={v => set(d => { d.top_box.mid_pos_m[0] = v; }, "top_box.mid.x")} />
              <Num path="top_box.tw.x" label="Tweeter centre x" min={-1000} value={sys.top_box.tw_pos_m[0]} scale={1000} unit="mm" onSet={v => set(d => { d.top_box.tw_pos_m[0] = v; }, "top_box.tw.x")} />
            </div>
          </Card>

          <Card title="Measurement" hint="As logged on the Lab E day.">
            <div className="wz-form-cols">
              <Num path="conditions.T" label="Temperature" min={-30} max={60} value={sys.conditions.T_C} unit="°C" step={0.5}
                   hint="Sets the speed of sound and the air density in the box model." onSet={v => set(d => { d.conditions.T_C = v; }, "conditions.T")} />
              <Num path="conditions.mic" label="Microphone distance" value={sys.conditions.mic_distance_m} unit="m" step={0.01}
                   hint="Distance from the speaker to the microphone in the anechoic room." onSet={v => set(d => { d.conditions.mic_distance_m = v; }, "conditions.mic")} />
            </div>
          </Card>

          <Card title="Design rules" hint="The checks and the optimiser use these. Take them from your project guide.">
            <Rules />
          </Card>

          <Card title="Available components" hint="The value pickers only offer these parts. The default is Appendix 1 of the 2026 project guide.">
            <Components />
          </Card>
        </div>

        <aside className="wz-system-aside">
          <div className="wz-sketch-card">
            <h4 className="label-caps">Front view</h4>
            <LayoutSketch system={sys} />
            <p className="wz-muted">Updates as you type. Drivers are drawn at their effective diameter, vents at their inner diameter.</p>
          </div>
        </aside>
      </div>
    </div>
  );
}

function Card({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="wz-card">
      <header>
        <h4>{title}</h4>
        {hint && <Tooltip content={hint} side="right"><span className="wz-help" tabIndex={0} aria-label={hint}><Info size={12} strokeWidth={1.75} /></span></Tooltip>}
      </header>
      {children}
    </section>
  );
}

const Stat2 = ({ label, value }: { label: string; value: string }) => (
  <p className="wz-inline-stat"><span className="wz-muted">{label}</span> <span className="mono">{value}</span></p>
);

function DriverCard({ u }: { u: UnitId }) {
  const unit = useWizard(s => s.system.units[u]);
  const z = useWizard(s => { const a = s.assignments[u === "woof" ? "woofer:free" : `zi:${u}`]; return a ? s.series[choiceKey(a.choice)]?.series : undefined; });
  const reEst = useMemo(() => (z ? estimateRe(z, u === "woof" ? 5 : 20, u === "tw" ? 20000 : 1000) : null), [z, u]);
  const p = (k: string) => `units.${u}.${k}`;
  const showEst = reEst !== null && Math.abs(reEst - (unit.Re_ohm ?? 0)) > 0.02;
  return (
    <div className={`wz-driver is-${u}`}>
      <div className="wz-driver-head"><span className={`wz-unit-dot is-${u}`} aria-hidden /> {UNIT_NAME[u]}</div>
      <Field label="Model" stacked tag={<Tag path={p("label")} />}>
        <input className="wz-input" value={unit.label} placeholder="e.g. Scan-Speak 26W/8534G00" aria-label={`${UNIT_NAME[u]} model`} spellCheck={false}
               onChange={e => set(d => { d.units[u].label = e.target.value; }, p("label"))} />
      </Field>
      <div className="wz-driver-grid">
        <Field label="Type" stacked tag={<Tag path={p("kind")} />}>
          <Segmented size="sm" block label={`${UNIT_NAME[u]} type`} value={unit.kind}
                     options={[{ value: "cone", label: "Cone" }, { value: "dome", label: "Dome" }]}
                     onChange={v => set(d => { d.units[u].kind = v as "cone" | "dome"; }, p("kind"))} />
        </Field>
        <Num stacked path={p("Re_ohm")} label={<>R<sub>E</sub></>} hint="Voice-coil DC resistance, measured with a multimeter."
             value={unit.Re_ohm} unit="Ω" step={0.1} digits={2} onSet={v => set(d => { d.units[u].Re_ohm = v; }, p("Re_ohm"))} />
        <Num stacked path={p("D")} label="Effective Ø" hint="Cone plus about half the surround: S_D = πD²/4."
             value={unit.diameter_m} scale={1000} unit="mm" onSet={v => set(d => { d.units[u].diameter_m = v; }, p("D"))} />
        <Num stacked path={p("frame")} label="Frame Ø" hint="Outer frame, for the 3D model only." value={unit.frame_diameter_m} scale={1000} unit="mm"
             onSet={v => set(d => { d.units[u].frame_diameter_m = v; }, p("frame"))} />
      </div>
      {showEst && (
        <button type="button" className="wz-suggest" title="The smallest real part of the impedance: it reads a little low, a multimeter is better."
                onClick={() => useWizard.getState().setSystem(d => { d.units[u].Re_ohm = Math.round(reEst! * 100) / 100; }, p("Re_ohm"), "data")}>
          Use R_E ≈ {reEst!.toFixed(2)} Ω from the impedance
        </button>
      )}
    </div>
  );
}

function Vents() {
  const vents = useWizard(s => s.system.woofer_box.vents);
  const pos = useWizard(s => s.system.woofer_box.vent_pos_m);
  const add = () => set(d => {
    const id = String.fromCharCode(65 + d.woofer_box.vents.length);
    d.woofer_box.vents.push({ id, diameter_m: 0.05, estimated: true, length_range_m: [0.08, 0.3] });
    d.woofer_box.vent_pos_m.push([0.13 * (d.woofer_box.vents.length % 2 ? -1 : 1), 0.075]);
  }, "woofer_box.vents");
  return (
    <div className="wz-vents">
      <div className="wz-vents-head">
        <span className="label-caps">Vents</span>
        <Tag path="woofer_box.vents" />
        <span className="wz-grow" />
        {vents.length < 2 && <Button size="sm" variant="ghost" icon={Plus} onClick={add}>Add vent</Button>}
      </div>
      <table className="wz-table wz-vent-table">
        <thead>
          <tr><th>Vent</th><th>Inner Ø</th><th /><th>Length range</th><th>Mouth x</th><th>Mouth y</th><th /></tr>
        </thead>
        <tbody>
          {vents.map((v, i) => <VentRow key={i} i={i} v={v} pos={pos[i] ?? [0, 0]} removable={vents.length > 1} />)}
        </tbody>
      </table>
    </div>
  );
}

function VentRow({ i, v, pos, removable }: { i: number; v: VentSpec; pos: [number, number]; removable: boolean }) {
  const path = "woofer_box.vents";
  const range = v.length_range_m ?? [0.05, 0.3];
  const mm = (x: number) => Math.round(x * 10000) / 10;
  return (
    <tr>
      <td className="mono">{v.id}</td>
      <td><NumberField label={`Vent ${v.id} diameter`} value={mm(v.diameter_m)} unit="mm" size={4} min={5} max={500}
                       onChange={x => set(d => { d.woofer_box.vents[i].diameter_m = x / 1000; d.woofer_box.vents[i].estimated = false; }, path)} /></td>
      <td><Checkbox checked={!!v.estimated} onChange={c => set(d => { d.woofer_box.vents[i].estimated = !!c; }, path)}>estimated</Checkbox></td>
      <td>
        <span className="wz-pair is-nowrap">
        <NumberField label={`Vent ${v.id} shortest length`} value={mm(range[0])} unit="mm" size={4} min={0} max={2000}
                     onChange={x => set(d => { d.woofer_box.vents[i].length_range_m = [x / 1000, range[1]]; }, path)} />
        <span className="wz-muted">–</span>
        <NumberField label={`Vent ${v.id} longest length`} value={mm(range[1])} unit="mm" size={4} min={0} max={2000}
                     onChange={x => set(d => { d.woofer_box.vents[i].length_range_m = [range[0], x / 1000]; }, path)} />
        </span>
      </td>
      <td>
        <NumberField label={`Vent ${v.id} mouth x`} value={mm(pos[0])} unit="mm" size={4} min={-1000} max={1000}
                     onChange={x => set(d => { d.woofer_box.vent_pos_m[i] = [x / 1000, pos[1]]; }, path)} />
      </td>
      <td>
        <NumberField label={`Vent ${v.id} mouth y`} value={mm(pos[1])} unit="mm" size={4} min={0} max={2000}
                     onChange={x => set(d => { d.woofer_box.vent_pos_m[i] = [pos[0], x / 1000]; }, path)} />
      </td>
      <td>{removable && <IconButton icon={Trash2} size="sm" variant="ghost" label={`Remove vent ${v.id}`}
                                    onClick={() => set(d => { d.woofer_box.vents.splice(i, 1); d.woofer_box.vent_pos_m.splice(i, 1); }, path)} />}</td>
    </tr>
  );
}

function Rules() {
  const limits = useWizard(s => s.system.limits);
  const tw = useWizard(s => { const a = s.assignments["zi:tw"]; return a ? s.series[choiceKey(a.choice)]?.series : undefined; });
  const est = useMemo(() => (tw ? estimateResonance(tw) : null), [tw]);
  return (
    <div className="wz-form-cols">
      <Field label="Woofer/mid crossover" hint="The woofer/midrange crossover should fall in this window." tag={<Tag path="limits.wm" course />}>
        <span className="wz-pair">
          <NumberField label="Woofer/mid window low" value={limits.wm[0]} unit="Hz" size={5} min={20} max={20000}
                       onChange={v => set(d => { d.limits.wm[0] = v; }, "limits.wm")} />
          <span className="wz-muted">–</span>
          <NumberField label="Woofer/mid window high" value={limits.wm[1]} unit="Hz" size={5} min={20} max={20000}
                       onChange={v => set(d => { d.limits.wm[1] = v; }, "limits.wm")} />
        </span>
      </Field>
      <Field label="Mid/tweeter crossover" hint="The midrange/tweeter crossover should fall in this window." tag={<Tag path="limits.mt" course />}>
        <span className="wz-pair">
          <NumberField label="Mid/tweeter window low" value={limits.mt[0]} unit="Hz" size={5} min={20} max={20000}
                       onChange={v => set(d => { d.limits.mt[0] = v; }, "limits.mt")} />
          <span className="wz-muted">–</span>
          <NumberField label="Mid/tweeter window high" value={limits.mt[1]} unit="Hz" size={5} min={20} max={20000}
                       onChange={v => set(d => { d.limits.mt[1] = v; }, "limits.mt")} />
        </span>
      </Field>
      <Field label="Tweeter resonance" tag={<Tag path="limits.tw_fs_hz" />}
             hint="The tweeter must be crossed well above it. Estimated from the peak of the tweeter impedance.">
        <span className="wz-pair">
          <NumberField label="Tweeter resonance" value={limits.tw_fs_hz} unit="Hz" size={5} min={100} max={20000}
                       onChange={v => set(d => { d.limits.tw_fs_hz = v; }, "limits.tw_fs_hz")} />
          {est && Math.abs(est - limits.tw_fs_hz) > 1 && (
            <Button size="sm" variant="ghost" onClick={() => useWizard.getState().setSystem(d => { d.limits.tw_fs_hz = Math.round(est); }, "limits.tw_fs_hz", "data")}>
              Use {Math.round(est)} Hz from Zi
            </Button>
          )}
        </span>
      </Field>
    </div>
  );
}

const PART: Record<"L" | "C" | "R", { unit: string; scale: number; name: string }> = {
  L: { unit: "mH", scale: 1e3, name: "Inductors" },
  C: { unit: "µF", scale: 1e6, name: "Capacitors" },
  R: { unit: "Ω", scale: 1, name: "Resistors" },
};

function Components() {
  const comps = useWizard(s => s.system.components);
  return (
    <div className="wz-components">
      {(["L", "C", "R"] as const).map(k => <PartList key={k} k={k} values={comps[k]} />)}
      <Button size="sm" variant="ghost" icon={RotateCcw}
              onClick={() => useWizard.getState().setSystem(d => { d.components = structuredClone(BUNDLED_PROFILES[0].components); }, ["components.L", "components.C", "components.R"], "user")}>
        Reset to Appendix 1
      </Button>
    </div>
  );
}

function PartList({ k, values }: { k: "L" | "C" | "R"; values: number[] }) {
  const meta = PART[k];
  const show = (vs: number[]) => vs.map(v => fmtSig(v * meta.scale, 3)).join(", ");
  const [draft, setDraft] = useState<string | null>(null);
  const [bad, setBad] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    const parts = draft.split(/[,;\s]+/).filter(Boolean);
    const nums = parts.map(t => Number(t.replace(",", ".")));
    const wrong = parts.filter((_, i) => !(nums[i] > 0));
    if (wrong.length) { setBad(`Not a positive number: ${wrong.join(", ")}`); return; }
    setBad(null); setDraft(null);
    const vs = [...new Set(nums.map(n => n / meta.scale))].sort((a, b) => a - b);
    set(d => { d.components[k] = vs; }, `components.${k}`);
  };
  return (
    <Field label={`${meta.name} (${meta.unit})`} stacked tag={<><Tag path={`components.${k}`} course /><Badge>{values.length}</Badge></>}>
      <textarea className={`wz-input wz-parts mono${bad ? " is-bad" : ""}`} rows={2} spellCheck={false} aria-label={`${meta.name} in ${meta.unit}`}
                value={draft ?? show(values)} onChange={e => setDraft(e.target.value)} onBlur={commit}
                onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); commit(); } if (e.key === "Escape") { setDraft(null); setBad(null); } }} />
      {bad && <p className="wz-msg is-bad">{bad}</p>}
    </Field>
  );
}

/** Every value the step shows, for the "N values marked example" count. */
const ALL_PATHS = [
  ...UNITS.flatMap(u => ["label", "kind", "D", "frame", "Re_ohm"].map(k => `units.${u}.${k}`)),
  "woofer_box.inner.w", "woofer_box.inner.h", "woofer_box.inner.d", "woofer_box.wall", "woofer_box.driver.x", "woofer_box.driver.y", "woofer_box.vents",
  "top_box.outer.w", "top_box.outer.h", "top_box.outer.d", "top_box.offset", "top_box.mid.x", "top_box.mid.y", "top_box.tw.x", "top_box.tw.y",
  "conditions.T", "conditions.mic", "limits.tw_fs_hz",
];
