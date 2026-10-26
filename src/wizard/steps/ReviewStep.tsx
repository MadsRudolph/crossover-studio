// Step 5: name the profile, fit the woofer box to the impedances, show how well the model matches, save.
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Download, RefreshCw } from "lucide-react";
import { Plot } from "../../charts";
import { driverValidation, boxValidation, prepare, type ValidationCurve } from "../../engine";
import * as platform from "../../platform";
import { Badge, Button, EmptyState, Field, ProgressBar, Stat, Tabs, toast } from "../../ui";
import { message, profileId, useWizard } from "../draft";
import { isValidId, slugify } from "../build";

export function ReviewStep() {
  const fit = useWizard(s => s.fit);
  const sys = useWizard(s => s.system);
  // re-fit whenever the step opens with changed inputs; runFit itself skips an unchanged fit
  const deps = useWizard(s => s);
  useEffect(() => { useWizard.getState().runFit(); }, [deps.assignments, deps.series, deps.system, deps.vents, deps.phase.value, deps.idOverride]);

  return (
    <div className="wz-review">
      <div className="wz-review-grid">
        <Identity />
        <section className="wz-card wz-fit">
          <header>
            <h4>Woofer box fit</h4>
            <span className="wz-grow" />
            {fit.status === "ready" && <Badge tone="good">Fitted</Badge>}
          </header>
          {fit.status === "busy" || fit.status === "idle" ? (
            <div className="wz-fit-busy">
              <ProgressBar label="Fitting the woofer box" />
              <p className="wz-muted">Fitting Bl, M_MD, C_MS, R_MS and L_E to the free-air and closed-box impedances, then the vent mass of every vented curve…</p>
            </div>
          ) : fit.status === "error" ? (
            <EmptyState tone="bad" icon={AlertTriangle} title="The fit could not run" description={fit.error}
                        action={<div className="wz-row-actions">
                          <Button size="sm" onClick={() => useWizard.getState().setStep(1)}>Check the roles</Button>
                          <Button size="sm" onClick={() => useWizard.getState().setStep(2)}>Check the system</Button>
                          <Button size="sm" variant="ghost" icon={RefreshCw} onClick={() => { useWizard.setState({ fit: { status: "idle" } }); useWizard.getState().runFit(); }}>Try again</Button>
                        </div>} />
          ) : fit.fit && fit.profile ? <FitResult /> : null}
        </section>
      </div>
      {fit.status === "ready" && <Contents />}
      <p className="wz-muted wz-review-foot">
        {platform.isTauri()
          ? <>Saving writes <span className="mono">{profileId({ idOverride: useWizard.getState().idOverride, system: sys })}/profile.json</span> in the app's profile folder, copies the source files next to it and opens the profile.</>
          : <>The browser preview cannot save files: <strong>Open profile</strong> loads it for this session, and the download keeps a copy you can open in the desktop app.</>}
      </p>
    </div>
  );
}

function Identity() {
  const sys = useWizard(s => s.system);
  const idOverride = useWizard(s => s.idOverride);
  const id = profileId({ idOverride, system: sys });
  const set = (k: "name" | "group" | "system" | "notes", v: string) => useWizard.getState().setSystem(d => { d[k] = v; }, k, "user");
  return (
    <section className="wz-card wz-identity">
      <header><h4>Profile</h4></header>
      <Field label="Name" stacked hint="Shown in the profile switcher, e.g. “System B · Group 7”.">
        <input className={`wz-input wz-input-lg${sys.name.trim() ? "" : " is-empty"}`} value={sys.name} placeholder="System B · Group 7" autoFocus
               aria-label="Profile name" onChange={e => set("name", e.target.value)} />
      </Field>
      <div className="wz-form-cols">
        <Field label="Group" stacked><input className="wz-input" value={sys.group ?? ""} placeholder="Group 7" aria-label="Group" onChange={e => set("group", e.target.value)} /></Field>
        <Field label="System" stacked><input className="wz-input" value={sys.system ?? ""} placeholder="B" aria-label="System letter" onChange={e => set("system", e.target.value)} /></Field>
      </div>
      <Field label="Notes" stacked hint="Anything the next reader should know: measurement quirks, estimated values, dates.">
        <textarea className="wz-input" rows={3} value={sys.notes ?? ""} aria-label="Notes"
                  placeholder="Lab D on 6 Oct, Lab E on 20 Oct. Vent B diameter is a guess."
                  onChange={e => set("notes", e.target.value)} />
      </Field>
      <Field label="Folder id" stacked hint="The profile's folder name. Derived from the name unless you change it.">
        <span className="wz-idfield">
          <input className={`wz-input mono${isValidId(id) ? "" : " is-bad"}`} value={id} aria-label="Profile id" spellCheck={false}
                 onChange={e => useWizard.getState().setId(e.target.value === slugify(sys.name) ? null : e.target.value)} />
          {idOverride && <Button size="sm" variant="ghost" onClick={() => useWizard.getState().setId(null)}>From name</Button>}
        </span>
      </Field>
    </section>
  );
}

const fmt = (v: number, d = 3) => (Number.isFinite(v) ? v.toPrecision(d) : "—");

function FitResult() {
  const fit = useWizard(s => s.fit);
  const f = fit.fit!, profile = fit.profile!;
  const curves = useMemo(() => {
    const p = prepare(profile, f);
    const drv = driverValidation(p);
    const out: { id: string; label: string; c: ValidationCurve }[] = [];
    if (drv.free) out.push({ id: "free", label: "Free air", c: drv.free });
    if (drv.closed) out.push({ id: "closed", label: "Closed box", c: drv.closed });
    boxValidation(p).forEach((v, i) => out.push({ id: `v${i}`, label: v.label, c: v.Z }));
    return out;
  }, [f, profile]);
  const [tab, setTab] = useState(curves[0]?.id ?? "free");
  const cur = curves.find(c => c.id === tab) ?? curves[0];
  const notes = f.notes ?? [];
  const q = f.quality;
  const qTone = (v: number, good: number, ok: number) => (v < good ? "good" : v < ok ? "warn" : "bad") as "good" | "warn" | "bad";

  const plot = useMemo(() => {
    if (!cur) return null;
    const { c } = cur, x = c.f;
    const absC = (z: { re: Float64Array; im: Float64Array }) => Float64Array.from(x, (_, i) => Math.hypot(z.re[i], z.im[i]));
    return { x, meas: absC(c.meas), model: absC(c.model) };
  }, [cur]);

  return (
    <div className="wz-fit-result">
      <div className="wz-stats is-ts">
        <Stat label="f_s" value={`${fmt(f.ts.fs)} Hz`} />
        <Stat label="Q_ms" value={fmt(f.ts.Qms)} />
        <Stat label="Q_es" value={fmt(f.ts.Qes)} />
        <Stat label="Q_ts" value={fmt(f.ts.Qts)} />
        <Stat label="V_as" value={`${fmt(f.ts.Vas_L)} L`} />
        <Stat label="M_ms" value={`${fmt(f.ts.Mms * 1000)} g`} />
        <Stat label="Bl" value={`${fmt(f.drv.Bl)} T·m`} />
        <Stat label="L_e" value={`${fmt(f.drv.Le * 1000)} mH`} />
        <Stat label="R_E" value={`${fmt(f.RE)} Ω`} />
        <Stat label="Driver fit error" value={q.driver.toExponential(1)} tone={qTone(q.driver, 0.02, 0.08)}
              hint="Mean squared log error of the free-air and closed-box impedance, lower is better (System D: 5.5e-3)." />
        {f.ventFits?.length ? <Stat label="Vent fit error" value={q.vents.toExponential(1)} tone={qTone(q.vents, 0.1, 0.3)}
                                    hint="The same for the vented curves (System D: 4.9e-2)." /> : null}
        {f.ventFits?.map(v => <Stat key={v.label} label={`f_B, ${v.label}`} value={`${fmt(v.fB)} Hz`} />)}
      </div>
      {curves.length > 0 && plot && (
        <div className="wz-fit-plot">
          <Tabs label="Impedance fit" items={curves.map(c => ({ id: c.id, label: c.label }))} value={cur!.id} onChange={setTab} idBase="wz-fit" />
          <div id="wz-fit-panel" role="tabpanel">
            <Plot height={220} xRange={[5, 400]} yUnit="Ω" yLabel="|Z|"
                  series={[{ id: "meas", label: "Measured", x: plot.x, y: plot.meas, color: "ref", width: 2 },
                           { id: "model", label: "Model", x: plot.x, y: plot.model, color: "woof", dash: [5, 3] }]}
                  ariaLabel={`Impedance fit, ${cur!.label}`} />
          </div>
        </div>
      )}
      {notes.length > 0 && (
        <ul className="wz-notes">{notes.map(n => <li key={n}><AlertTriangle size={13} aria-hidden /> {n}</li>)}</ul>
      )}
    </div>
  );
}

function Contents() {
  const profile = useWizard(s => s.fit.profile);
  if (!profile) return null;
  const m = profile.measurements;
  const angles = Object.keys(m.tf).sort((a, b) => +a - +b);
  const download = async () => {
    try {
      const p = useWizard.getState().fit.profile!;
      await platform.saveText(`${p.id}.json`, JSON.stringify(p, null, 1), "json");
    } catch (e) {
      toast({ tone: "bad", title: "Could not write the file", description: message(e) });
    }
  };
  return (
    <section className="wz-card wz-contents">
      <header>
        <h4>In this profile</h4>
        <span className="wz-grow" />
        <Button size="sm" variant="ghost" icon={Download} onClick={() => void download()}>Download profile.json</Button>
      </header>
      <ul>
        <li><span className="wz-muted">Responses</span> {angles.map(a => <Badge key={a}>{a}°</Badge>)}</li>
        <li><span className="wz-muted">Input impedance</span> <Badge tone="mid">midrange</Badge> <Badge tone="tw">tweeter</Badge></li>
        <li><span className="wz-muted">Woofer</span> {m.woofer.free && <Badge tone="woof">free air</Badge>} {m.woofer.closed && <Badge tone="woof">closed box</Badge>}
          {m.woofer.vented.map(v => <Badge key={v.vents.map(x => x.id + x.length_m).join()} tone="woof">{v.vents.map(x => `${x.id} ${Math.round(x.length_m * 1000)} mm`).join(" + ")}{v.nf_cone || v.nf_vent ? " + near field" : ""}</Badge>)}
        </li>
        <li><span className="wz-muted">Phase reference</span> <span className="mono">{profile.conditions.phase_ref_distance_m.toFixed(3)} m</span></li>
        <li><span className="wz-muted">Parts</span> <span className="mono">{profile.components.L.length} L · {profile.components.C.length} C · {profile.components.R.length} R</span></li>
      </ul>
    </section>
  );
}
