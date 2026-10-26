// Step 2: which series is which. Every role row shows its source (file -> variable -> column), how sure
// the automatic suggestion is, a live magnitude preview and plain-language sanity warnings.
import { useMemo, useState, type ReactNode } from "react";
import { useShallow } from "zustand/react/shallow";
import { AlertTriangle, CircleHelp, Info, Plus, Trash2, X } from "lucide-react";
import { Badge, Button, IconButton, NumberField, Tooltip } from "../../ui";
import type { Series, UnitId } from "../../types";
import { useRoleSeries, useWizard } from "../draft";
import { angleRoles, choiceKey, choiceOf, dataItems, REQUIRED_ROLES, unusedItems, ventKey, ventLabel, ventRoles,
         type DataItem, type RoleDef, type VentConfig, type WizardFile } from "../roles";
import { gridMismatch, seriesWarnings } from "../build";
import { MiniPlot, Select } from "./common";

export function RolesStep() {
  const angles = useWizard(s => s.angles);
  const vents = useWizard(s => s.vents);
  const files = useWizard(s => s.files);
  const assignments = useWizard(s => s.assignments);
  const unused = useMemo(() => unusedItems(files, assignments), [files, assignments]);
  const auto = Object.values(assignments).filter(a => a.auto).length;

  return (
    <div className="wz-roles">
      <p className="wz-lede">
        {auto
          ? <>The wizard suggested a source for {auto} role{auto === 1 ? "" : "s"} from the file names, variables and notes. Check each preview: impedances should look like a loudspeaker's (a few ohm with resonance peaks), responses like a driver's passband.</>
          : <>Pick the series for each role. The preview and the checks update as you choose.</>}
      </p>

      <RoleGroup title="On-axis response · 0°" hint="Required. One run with all three units, so their relative phase is valid."
                 roles={REQUIRED_ROLES.filter(r => r.group === "tf0")} mismatchAngle="0" />
      <RoleGroup title="Input impedance" hint="Required. The load the passive crossover drives." roles={REQUIRED_ROLES.filter(r => r.group === "zi")} />
      <RoleGroup title="Woofer impedance" hint="Required for the box fit: free air and the closed box (vents plugged)."
                 roles={REQUIRED_ROLES.filter(r => r.group === "woofer")} />

      {vents.map(cfg => <VentGroup key={cfg.key} cfg={cfg} />)}
      {angles.map(a => (
        <RoleGroup key={a} title={`Off-axis response · ${a}°`} hint="Optional. Used for the off-axis checks and the directivity view."
                   roles={angleRoles(a)} mismatchAngle={a}
                   actions={<IconButton icon={Trash2} label={`Remove the ${a}° responses`} size="sm" variant="ghost" onClick={() => useWizard.getState().removeAngle(a)} />} />
      ))}

      <AddMore />

      {unused.length > 0 && (
        <details className="wz-unused">
          <summary>
            <Info size={13} strokeWidth={1.75} aria-hidden /> {unused.length} series not used
            <span className="wz-muted"> · raw spectra and duplicates are left out on purpose</span>
          </summary>
          <ul>
            {unused.map(it => <li key={choiceKey(it)} className="mono">{fileName(files, it.fileId)} › {it.label} <span className="wz-muted">{it.points} pts</span></li>)}
          </ul>
        </details>
      )}
    </div>
  );
}

const fileName = (files: WizardFile[], id: string) => files.find(f => f.id === id)?.name ?? id;

function RoleGroup({ title, hint, roles, mismatchAngle, actions }: {
  title: string; hint: string; roles: RoleDef[]; mismatchAngle?: string; actions?: ReactNode;
}) {
  const mismatch = useWizard(s => {
    if (mismatchAngle === undefined) return null;
    const ser: Partial<Record<UnitId, Series>> = {};
    for (const u of ["woof", "mid", "tw"] as const) {
      const a = s.assignments[`tf:${mismatchAngle}:${u}`];
      const x = a && s.series[choiceKey(a.choice)]?.series;
      if (x) ser[u] = x;
    }
    return gridMismatch(ser);
  });
  return (
    <section className="wz-group">
      <header className="wz-group-head">
        <h4>{title}</h4>
        <span className="wz-muted">{hint}</span>
        <span className="wz-grow" />
        {actions}
      </header>
      {mismatch && <p className="wz-banner is-warn"><AlertTriangle size={14} aria-hidden /> {mismatch}</p>}
      <div className="wz-rows">{roles.map(r => <RoleRow key={r.key} def={r} />)}</div>
    </section>
  );
}

function VentGroup({ cfg }: { cfg: VentConfig }) {
  const ventIds = useWizard(useShallow(s => s.system.woofer_box.vents.map(v => v.id)));
  const update = (vents: VentConfig["vents"]) => useWizard.getState().updateVent(cfg.key, vents);
  const taken = useWizard(useShallow(s => s.vents.map(v => v.key)));
  const edit = (i: number, patch: Partial<VentConfig["vents"][number]>) => {
    const vents = cfg.vents.map((v, j) => (j === i ? { ...v, ...patch } : v));
    if (ventKey(vents) !== cfg.key && taken.includes(ventKey(vents))) return;
    update(vents);
  };
  const free = ventIds.filter(id => !cfg.vents.some(v => v.id === id));
  return (
    <section className="wz-group">
      <header className="wz-group-head">
        <h4>Vented box</h4>
        <div className="wz-vent-edit" aria-label={`Configuration: ${ventLabel(cfg.vents)}`}>
          {cfg.vents.map((v, i) => (
            <span key={i} className="wz-vent-chip">
              <Select value={v.id} aria-label="Vent" onChange={e => edit(i, { id: e.target.value })}>
                {[v.id, ...free].map(id => <option key={id} value={id}>vent {id}</option>)}
              </Select>
              <NumberField label="Vent length" value={Math.round(v.length_m * 1000)} unit="mm" size={4} min={5} max={2000} step={5}
                           onChange={mm => edit(i, { length_m: mm / 1000 })} />
              {cfg.vents.length > 1 && (
                <IconButton icon={X} label={`Remove vent ${v.id} from this configuration`} size="sm" variant="ghost"
                            onClick={() => update(cfg.vents.filter((_, j) => j !== i))} />
              )}
            </span>
          ))}
          {free.length > 0 && cfg.vents.length < 2 && (
            <Button size="sm" variant="ghost" icon={Plus} onClick={() => update([...cfg.vents, { id: free[0], length_m: cfg.vents[0]?.length_m ?? 0.15 }])}>
              Second vent open
            </Button>
          )}
        </div>
        <span className="wz-grow" />
        <IconButton icon={Trash2} label={`Remove the ${ventLabel(cfg.vents)} measurements`} size="sm" variant="ghost"
                    onClick={() => useWizard.getState().removeVent(cfg.key)} />
      </header>
      <div className="wz-rows">{ventRoles(cfg).map(r => <RoleRow key={r.key} def={r} />)}</div>
    </section>
  );
}

function AddMore() {
  const [angle, setAngle] = useState<number | null>(null);
  const vents = useWizard(s => s.vents);
  const ventIds = useWizard(useShallow(s => s.system.woofer_box.vents.map(v => v.id)));
  const addVent = () => {
    // next free length in 20 mm steps after the longest one so far
    const longest = Math.max(0.14, ...vents.flatMap(c => c.vents.map(v => v.length_m)));
    let L = Math.round((longest + 0.02) * 1000) / 1000;
    while (vents.some(c => c.key === ventKey([{ id: ventIds[0] ?? "A", length_m: L }]))) L += 0.02;
    useWizard.getState().addVent([{ id: ventIds[0] ?? "A", length_m: L }]);
  };
  return (
    <div className="wz-addmore">
      <Button variant="subtle" icon={Plus} onClick={addVent}>Add a vented measurement</Button>
      <form className="wz-addangle" onSubmit={e => { e.preventDefault(); if (angle) { useWizard.getState().addAngle(String(angle)); setAngle(null); } }}>
        <NumberField label="Off-axis angle" value={angle} unit="°" min={1} max={180} step={5} size={3} placeholder="30" onChange={setAngle} />
        <Button type="submit" variant="subtle" icon={Plus} disabled={!angle}>Add off-axis angle</Button>
      </form>
    </div>
  );
}

function RoleRow({ def }: { def: RoleDef }) {
  const a = useWizard(s => s.assignments[def.key]);
  const files = useWizard(s => s.files);
  const owner = useWizard(s => s.assignments);
  const st = useRoleSeries(def.key);
  const items = useMemo(() => files.map(f => ({ file: f, items: dataItems(f) })).filter(g => g.items.length), [files]);
  const value = a ? choiceKey(a.choice) : "";
  const current = a ? items.flatMap(g => g.items).find(it => choiceKey(it) === value) : undefined;
  const file = a ? files.find(f => f.id === a.choice.fileId) : undefined;
  const warnings = st?.series ? seriesWarnings(def.quantity, st.series, def.unit) : [];

  const usedBy = (it: DataItem) => {
    const r = Object.values(owner).find(x => x.role !== def.key && choiceKey(x.choice) === choiceKey(it));
    if (!r) return "";
    const tf = /^tf:([^:]+):(woof|mid|tw)$/.exec(r.role);
    return ` (now: ${tf ? `${tf[2]} ${tf[1]}°` : r.role.replace(/^vent:/, "").replace(/:/g, " ")})`;
  };
  const pick = (key: string) => {
    if (!key) { useWizard.getState().assign(def.key, null); return; }
    const it = items.flatMap(g => g.items).find(x => choiceKey(x) === key);
    if (it) useWizard.getState().assign(def.key, choiceOf(it));
  };

  // .mat: the frequency vector can be changed when several real vectors have the right length
  const freqOptions = file?.format === "mat" && current
    ? (file.info?.variables ?? []).filter(v => !v.complex && v.dims.length === 2 && Math.min(...v.dims) === 1 && v.dims[0] * v.dims[1] === current.points
                                         && v.class !== "char" && v.class !== "logical").map(v => v.name)
    : [];

  const chip = !a ? (def.required ? <Badge tone="bad">Missing</Badge> : <Badge>Optional</Badge>)
    : !a.auto ? <Badge tone="accent">Manual</Badge>
    : a.confidence >= 0.85 ? <Badge tone="good">Auto</Badge>
    : <Badge tone="warn">Check</Badge>;

  return (
    <div className={`wz-row${!a && def.required ? " is-missing" : ""}`}>
      <div className="wz-row-info">
        <div className="wz-row-title">
          {def.unit && <span className={`wz-unit-dot is-${def.unit}`} aria-hidden />}
          <span>{def.title}</span>
          <Tooltip content={def.hint} side="right"><span className="wz-help" tabIndex={0} aria-label={def.hint}><CircleHelp size={12} strokeWidth={1.75} /></span></Tooltip>
        </div>
        <div className="wz-row-status">
          {chip}
          {a && <span className="wz-reason" title={a.reason}>{a.auto ? a.reason : "Chosen by hand."}</span>}
        </div>
      </div>

      <div className="wz-row-source">
        <Select value={value} onChange={e => pick(e.target.value)} aria-label={`Source for ${def.title}`}>
          <option value="">{def.required ? "Choose a series…" : "Not used"}</option>
          {items.map(g => (
            <optgroup key={g.file.id} label={g.file.name}>
              {g.items.map(it => (
                <option key={choiceKey(it)} value={choiceKey(it)}>
                  {g.file.format === "mat" ? it.label : "whole file"} · {it.points} pts{it.complex ? "" : " · real"}{usedBy(it)}
                </option>
              ))}
            </optgroup>
          ))}
        </Select>
        {freqOptions.length > 1 && a && (
          <label className="wz-freqvar">
            <span className="wz-muted">frequency</span>
            <Select value={a.choice.freqVar ?? ""} aria-label="Frequency variable"
                    onChange={e => useWizard.getState().assign(def.key, { ...a.choice, freqVar: e.target.value })}>
              {freqOptions.map(n => <option key={n} value={n}>{n}</option>)}
            </Select>
          </label>
        )}
        {st?.status === "error" && <p className="wz-msg is-bad"><AlertTriangle size={13} aria-hidden /> {st.error}</p>}
        {warnings.map(w => <p key={w.text} className={`wz-msg is-${w.level}`}><AlertTriangle size={13} aria-hidden /> {cap(w.text)}.</p>)}
        {st?.series?.source?.note && <p className="wz-msg is-note" title={st.series.source.note}>{st.series.source.note}</p>}
      </div>

      <div className="wz-row-plot">
        {st?.status === "ready" && st.series ? (
          <MiniPlot series={st.series} quantity={def.quantity} unit={def.unit} label={def.title} />
        ) : (
          <div className={`wz-plot-empty${st?.status === "loading" ? " is-loading" : ""}`}>
            {st?.status === "loading" ? "Reading…" : a ? "No preview" : def.required ? "Needed" : "—"}
          </div>
        )}
      </div>
    </div>
  );
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
