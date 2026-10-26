// As built view (Task 3): the anechoic measurement of the finished system over the exact prediction of
// the design (vents plugged, as the guide measures it), how well they match, and a fault finder that
// ranks the build mistakes that would explain the difference. A fault is shown, never applied: the
// mistake is in the build, not in the design.

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, ClipboardList, FileUp, Search, X } from "lucide-react";
import { StackedPlots, type PlotHBand, type PlotSeries } from "../charts";
import { Badge, Button, Dialog, EmptyState, IconButton, ProgressBar, Segmented, Switch, fmtFreq, toast } from "../ui";
import { useStore } from "../state/store";
import type { Series, UnitId } from "../types";
import type { Prepared } from "../engine";
import { Card, PartChip, ViewHeader, crossoverLines, fmtSigned, judgeBand, splitHeights, useProbe, useSize } from "./common";
import { TRACE_META, levelAt, responseRange } from "./data";
import {
  compare, emptyData, hasData, matchVerdict, predictedCurve, predictedDb, smoothedDb, MATCH_GOOD_DB,
  type AsBuiltData, type Comparison, type TraceDetail,
} from "../asbuilt/analyse";
import { runFaults, type FaultResult } from "../asbuilt/faults";
import { loadAsBuilt, saveAsBuilt } from "../asbuilt/storage";
import { describeSeries, pickMeasurement, readMatItem } from "../asbuilt/importers";
import { demoData, demoRequested } from "../asbuilt/demo";
import type { DataItem } from "../wizard/roles";
import "./asbuilt.css";

/** An import slot: the system at an angle, or one unit on axis. */
type Slot = { kind: "sum"; angle: string } | { kind: "unit"; unit: UnitId };
const slotKey = (s: Slot) => (s.kind === "sum" ? `sum@${s.angle}` : `${s.unit}@0`);
const slotLabel = (s: Slot) => (s.kind === "sum" ? `System response ${s.angle}°` : `${TRACE_META[s.unit].name} alone, 0°`);
const C_SOUND = 345;

interface MatPick { slot: Slot; path: string; name: string; items: DataItem[]; sel: number }
type Search = { state: "idle" } | { state: "running"; done: number; total: number } | { state: "done"; list: FaultResult[] };

export function AsBuiltView() {
  const prep = useStore(s => s.prep)!;
  const design = useStore(s => s.design);
  const profileId = useStore(s => s.profile?.id ?? "");
  const [probe, setProbe] = useProbe();

  // the imported measurements, per profile (the dev-only ?asbuilt=demo flag loads a synthetic build)
  const [demo] = useState(demoRequested);
  const [data, setData] = useState<AsBuiltData>(() => (demo ? demoData(prep, design) : loadAsBuilt(profileId).data));
  const [ventsOpen, setVentsOpen] = useState<boolean>(() => (demo ? false : loadAsBuilt(profileId).ventsOpen));
  const [loadedFor, setLoadedFor] = useState(profileId);
  if (loadedFor !== profileId) {
    // another profile was opened: show its own measurements
    const s = loadAsBuilt(profileId);
    setLoadedFor(profileId); setData(s.data); setVentsOpen(s.ventsOpen);
  }
  useEffect(() => { if (!demo) saveAsBuilt(profileId, { data, ventsOpen }); }, [demo, profileId, data, ventsOpen]);

  const [matPick, setMatPick] = useState<MatPick | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function importInto(slot: Slot) {
    setBusy(slotKey(slot));
    try {
      const r = await pickMeasurement();
      if (!r) return;
      if (r.kind === "mat") setMatPick({ slot, path: r.path, name: r.name, items: r.items, sel: 0 });
      else store(slot, r.series);
    } catch (e) {
      toast({ tone: "bad", title: "Could not read the measurement", description: String((e as Error)?.message ?? e) });
    } finally { setBusy(null); }
  }
  async function useMatItem() {
    if (!matPick) return;
    const { slot, path, name, items, sel } = matPick;
    setMatPick(null);
    try { store(slot, await readMatItem(path, name, items[sel])); }
    catch (e) { toast({ tone: "bad", title: `Could not read ${name}`, description: String((e as Error)?.message ?? e) }); }
  }
  function store(slot: Slot, s: Series) {
    setData(d => slot.kind === "sum" ? { ...d, sum: { ...d.sum, [slot.angle]: s } } : { ...d, units: { ...d.units, [slot.unit]: s } });
    const info = describeSeries(s);
    toast({ tone: "good", title: `${slotLabel(slot)} imported`, description: `${info.name}: ${info.points} points, ${fmtFreq(info.lo)}–${fmtFreq(info.hi)}`, duration: 2600 });
  }
  function remove(slot: Slot) {
    setData(d => {
      if (slot.kind === "sum") { const sum = { ...d.sum }; delete sum[slot.angle]; return { ...d, sum }; }
      const units = { ...d.units }; delete units[slot.unit]; return { ...d, units };
    });
  }

  const cmp = useMemo<{ c: Comparison | null; error: string | null }>(() => {
    try { return { c: compare(prep, design, data, ventsOpen), error: null }; }
    catch (e) { return { c: null, error: String((e as Error)?.message ?? e) }; }
  }, [prep, design, data, ventsOpen]);

  const search = useFaultSearch(prep, cmp.c);
  const [shown, setShown] = useState<Set<string>>(new Set());
  useEffect(() => setShown(new Set()), [cmp.c]);

  const sumSlots: Slot[] = prep.angles.filter(a => a === "0" || a === "30" || data.sum[a]).map(angle => ({ kind: "sum", angle }));
  const unitSlots: Slot[] = (["woof", "mid", "tw"] as const).map(unit => ({ kind: "unit", unit }));
  const slotSeries = (s: Slot) => (s.kind === "sum" ? data.sum[s.angle] : data.units[s.unit]);

  const header = (
    <ViewHeader title="As built"
      actions={cmp.c && <Switch size="sm" checked={ventsOpen} onChange={setVentsOpen}>Vents were open</Switch>}>
      The anechoic measurement of the finished speaker (Task 3) over the exact prediction of this design, with the vents
      plugged as the guide measures it. One level offset (microphone distance, amplifier gain) is removed first; the fault
      finder then ranks the build mistakes that would explain what is left.
    </ViewHeader>
  );
  const matDialog = (
    <MatDialog pick={matPick} onPick={sel => matPick && setMatPick({ ...matPick, sel })} onUse={useMatItem} onClose={() => setMatPick(null)} />
  );

  if (!hasData(data)) {
    return (
      <div className="vw-view ab-view">
        {header}
        <div className="ab-empty">
          <EmptyState icon={ClipboardList} title="Import the anechoic measurement of your finished system (Task 3)"
            description={<>
              Measure the whole speaker (MiniDSP, passive board and drivers) on axis, and at 30° if you can, and import the
              export: an LTspice .txt or a CSV file, or a .mat file in the desktop app. The prediction uses the vents plugged,
              as the guide covers them for this measurement; switch to the open vents after importing if yours were not covered.
            </>}
            action={<div className="ab-empty-actions">
              {sumSlots.map(s => <Button key={slotKey(s)} variant={s.kind === "sum" && s.angle === "0" ? "primary" : "subtle"} icon={FileUp}
                loading={busy === slotKey(s)} onClick={() => importInto(s)}>Import {slotLabel(s).toLowerCase()}</Button>)}
            </div>} />
        </div>
        {matDialog}
      </div>
    );
  }

  return (
    <div className="vw-view ab-view">
      {header}
      <ImportBar sumSlots={sumSlots} unitSlots={unitSlots} series={slotSeries} busy={busy} onImport={importInto} onRemove={remove} demo={demo} />
      {cmp.error ? (
        <EmptyState tone="bad" title="The measurement could not be compared" description={cmp.error}
          action={<Button variant="subtle" onClick={() => setData(emptyData())}>Remove the measurements</Button>} />
      ) : cmp.c && cmp.c.traces.length ? (
        <Body c={cmp.c} search={search} shown={shown} setShown={setShown} probe={probe} setProbe={setProbe} prep={prep} />
      ) : (
        <EmptyState compact title="No measurement at a measured angle"
          description="The imported angles are not in this profile. Import the system response at 0°." />
      )}
      {matDialog}
    </div>
  );
}

// ---------------------------------------------------------------- the fault search
function useFaultSearch(prep: Prepared, c: Comparison | null): Search {
  const [s, setS] = useState<Search>({ state: "idle" });
  useEffect(() => {
    if (!c || !Number.isFinite(c.fit.rms)) { setS({ state: "idle" }); return; }
    const ac = new AbortController();
    setS({ state: "running", done: 0, total: 1 });
    // a moment's delay: a burst of edits (a slider drag) starts one search, not one per step
    const t = window.setTimeout(() => {
      runFaults(prep, c.design, c.ms, c.fit.rms, { signal: ac.signal, onProgress: (done, total) => setS({ state: "running", done, total }) })
        .then(list => setS({ state: "done", list }), e => { if ((e as Error)?.name !== "AbortError") setS({ state: "done", list: [] }); });
    }, 150);
    return () => { window.clearTimeout(t); ac.abort(); };
  }, [prep, c]);
  return s;
}

// ---------------------------------------------------------------- import bar
function ImportBar({ sumSlots, unitSlots, series, busy, onImport, onRemove, demo }: {
  sumSlots: Slot[]; unitSlots: Slot[]; series: (s: Slot) => Series | undefined; busy: string | null;
  onImport: (s: Slot) => void; onRemove: (s: Slot) => void; demo: boolean;
}) {
  const anyUnit = unitSlots.some(s => series(s));
  const [open, setOpen] = useState(anyUnit);
  const item = (s: Slot) => {
    const sr = series(s);
    if (!sr) return (
      <Button key={slotKey(s)} size="sm" variant="subtle" icon={FileUp} loading={busy === slotKey(s)} onClick={() => onImport(s)}>
        Import {slotLabel(s).toLowerCase()}
      </Button>
    );
    const d = describeSeries(sr);
    return (
      <span key={slotKey(s)} className="ab-file" title={sr.source?.note}>
        <span className="ab-file-slot">{slotLabel(s)}</span>
        <span className="ab-file-name">{d.name}</span>
        <span className="ab-file-meta mono">{d.points} pts · {fmtFreq(d.lo)}–{fmtFreq(d.hi)}</span>
        <IconButton size="sm" variant="ghost" icon={X} label={`Remove ${slotLabel(s).toLowerCase()}`} onClick={() => onRemove(s)} />
      </span>
    );
  };
  return (
    <div className="ab-bar" aria-label="Imported measurements">
      {demo && <Badge tone="accent" title="Loaded by the ?asbuilt=demo flag; not saved">Demo: tweeter inverted, +4 dB</Badge>}
      {sumSlots.map(item)}
      <button type="button" className="ab-disclose" aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />} Per unit (optional)
      </button>
      {open && unitSlots.map(item)}
    </div>
  );
}

function MatDialog({ pick, onPick, onUse, onClose }: { pick: MatPick | null; onPick: (i: number) => void; onUse: () => void; onClose: () => void }) {
  return (
    <Dialog open={!!pick} onClose={onClose} size="sm" title={pick ? `Which series in ${pick.name}?` : ""}
      description={pick ? `For the ${slotLabel(pick.slot).toLowerCase()}. Complex series with a matching frequency vector are listed first.` : undefined}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={onUse}>Use this series</Button></>}>
      {pick && (
        <label className="ab-select-row">
          <span className="vw-ro-label">Variable and column</span>
          <select className="ab-select" value={pick.sel} onChange={e => onPick(Number(e.target.value))}>
            {pick.items.map((it, i) => (
              <option key={i} value={i}>
                {it.label} · {it.points} points{it.complex ? "" : " · real only"} · f = {it.freqVar}
              </option>
            ))}
          </select>
        </label>
      )}
    </Dialog>
  );
}

// ---------------------------------------------------------------- plots and cards
function Body({ c, search, shown, setShown, probe, setProbe, prep }: {
  c: Comparison; search: Search; shown: Set<string>; setShown: (s: Set<string>) => void;
  probe: number; setProbe: (f: number) => void; prep: Prepared;
}) {
  const angles = c.traces.map(t => t.target.key);
  const [pickedKey, setPickedKey] = useState<string>(angles[0]);
  const t = c.traces.find(x => x.target.key === pickedKey) ?? c.traces[0];
  const [ref, size] = useSize<HTMLDivElement>();
  const faults = search.state === "done" ? search.list : [];
  const overlay = faults.filter(f => shown.has(f.h.id));

  const series = useMemo(() => plotSeries(prep, c, t, overlay), [prep, c, t, overlay]);
  const level = levelAt(c.results.metrics, t.target.angle);
  const m = c.results.metrics;
  const [h1, h2, h3] = splitHeights(size.height, [2.1, 1.2, 1.1], 8, 120);
  // ±9 dB unless the worst deviation needs more, in 3 dB steps
  const devSpan = Math.max(9, Math.ceil((Math.abs(t.worst?.dB ?? 0) + 1) / 3) * 3);
  const hBand: PlotHBand[] = [{ from: -MATCH_GOOD_DB, to: MATCH_GOOD_DB, color: "good", opacity: 0.1, label: `±${MATCH_GOOD_DB} dB` }];

  return (
    <div className="ab-main">
      <div className="ab-left">
        {c.traces.length > 1 && (
          <Segmented<string> size="sm" label="Measurement shown" value={t.target.key} onChange={setPickedKey}
            options={c.traces.map(x => ({ value: x.target.key, label: traceName(x) }))} />
        )}
        <div className="vw-plots" ref={ref}>
          {size.height > 0 && (
            <StackedPlots xRange={[20, 20000]} probeHz={probe} onProbe={setProbe} syncId="asbuilt"
              plots={[
                { key: "mag", height: h1, series: series.mag, bands: t.target.trace === "sum" ? [judgeBand(level)] : [],
                  yRange: responseRange(level), yLabel: "Level", yUnit: "dB", vLines: crossoverLines(m),
                  title: <span className="vw-plot-title">Measured and predicted, 1/6 octave</span>, ariaLabel: "Measured and predicted response" },
                { key: "dev", height: h2, series: series.dev, hBands: hBand, yRange: [-devSpan, devSpan], yLabel: "Deviation", yUnit: "dB",
                  vLines: crossoverLines(m, false), title: <span className="vw-plot-title">Measured − predicted</span>, ariaLabel: "Deviation" },
                { key: "phase", height: h3, series: series.phase, yRange: [-180, 180], yLabel: "Phase", yUnit: "°",
                  vLines: crossoverLines(m, false),
                  title: <span className="vw-plot-title">Phase difference{t.delay !== null ? `, ${fmtDelay(t.delay)} delay removed` : ""}</span>,
                  ariaLabel: "Phase difference" },
              ]} />
          )}
        </div>
      </div>
      <div className="ab-right">
        <MatchCard c={c} t={t} setProbe={setProbe} />
        <FaultCard c={c} search={search} shown={shown} setShown={setShown} />
      </div>
    </div>
  );
}

function traceName(t: TraceDetail): string {
  return t.target.trace === "sum" ? `System ${t.target.angle}°` : `${TRACE_META[t.target.trace].name} 0°`;
}

function plotSeries(p: Prepared, c: Comparison, t: TraceDetail, overlay: FaultResult[]) {
  const f = p.f, g = c.fit.offset, m = c.ms.find(x => x.target.key === t.target.key)!;
  const mag: PlotSeries[] = [
    { id: "pred", label: "Predicted", x: f, y: t.pred, color: "ref", dash: [6, 4], width: 1.75 },
    { id: "meas", label: "Measured", x: f, y: t.meas, color: "sum", width: 2.25 },
  ];
  const dev: PlotSeries[] = [{ id: "dev", label: "Measured − predicted", x: f, y: t.dev, color: "sum", width: 1.75 }];
  const phase: PlotSeries[] = [{ id: "ph", label: "Phase difference", x: f, y: t.phase, color: "sum", width: 1.5, wrapPhase: true }];
  for (const fr of overlay) {
    // the hypothesis drawn at the measurement's level: its own offset relative to the design's
    const z = predictedCurve(fr.results, t.target), y = smoothedDb(p, z), yc = predictedDb(p, m, z);
    const k = fr.offset - g, hy = y.map(v => v + k), hd = new Float64Array(f.length);
    for (let i = 0; i < f.length; i++) hd[i] = t.meas[i] - (yc[i] + k);
    mag.push({ id: `h:${fr.h.id}`, label: `If: ${shortTitle(fr.h.title)}`, x: f, y: hy, color: "accent", dash: [4, 3], width: 1.5 });
    dev.push({ id: `hd:${fr.h.id}`, label: `Left if: ${shortTitle(fr.h.title)}`, x: f, y: hd, color: "accent", dash: [4, 3], width: 1.25 });
  }
  return { mag, dev, phase };
}

const shortTitle = (s: string) => s.split(":")[0];
const fmtDelay = (s: number) => `${fmtSigned(s * 1e3, 2)} ms`;

function MatchCard({ c, t, setProbe }: { c: Comparison; t: TraceDetail; setProbe: (f: number) => void }) {
  const v = matchVerdict(c.fit.rms), g = c.fit.offset;
  return (
    <Card title="Match" className="ab-card">
      <div className="ab-match">
        <div className={`ab-rms is-${v.state}`}>
          <span className="mono">{Number.isFinite(c.fit.rms) ? c.fit.rms.toFixed(2) : "—"}</span><small>dB RMS</small>
        </div>
        <div className="ab-match-text">
          <Badge tone={v.state} solid>{v.label}</Badge>
          <span className="vw-muted">1/6-octave deviation over 150 Hz–15 kHz{c.traces.length > 1 ? `, all ${c.traces.length} measurements` : ""}</span>
        </div>
      </div>
      <dl className="ab-facts">
        <dt>Level offset</dt>
        <dd><span className="mono">{fmtSigned(g, 1)} dB</span>
          <span className="ab-fact-note">{Math.abs(g) < 0.5 ? "the predicted level" : `the measurement is ${Math.abs(g).toFixed(1)} dB ${g > 0 ? "louder" : "quieter"}: mic distance or amplifier gain`}</span></dd>
        <dt>Delay</dt>
        <dd>{t.delay !== null
          ? <><span className="mono">{fmtSigned(t.delay * 1e3, 2)} ms</span><span className="ab-fact-note">{fmtSigned(t.delay * C_SOUND * 100, 0)} cm of path at 345 m/s, removed from the phase plot</span></>
          : <span className="ab-fact-note">not fitted: too little valid phase in 1–8 kHz</span>}</dd>
        <dt>Worst</dt>
        <dd>{t.worst
          ? <button type="button" className="ab-link" onClick={() => setProbe(t.worst!.f)} title="Put the probe there">
              <span className="mono">{fmtSigned(t.worst.dB, 1)} dB</span> at <span className="mono">{fmtFreq(t.worst.f)}</span>
            </button>
          : "—"}</dd>
        {c.traces.length > 1 && <>
          <dt>Per curve</dt>
          <dd className="ab-per">{c.traces.map(x => <span key={x.target.key}>{traceName(x)} <span className="mono">{x.rms.toFixed(2)} dB</span></span>)}</dd>
        </>}
      </dl>
    </Card>
  );
}

function FaultCard({ c, search, shown, setShown }: { c: Comparison; search: Search; shown: Set<string>; setShown: (s: Set<string>) => void }) {
  const toggle = (id: string) => { const n = new Set(shown); if (n.has(id)) n.delete(id); else n.add(id); setShown(n); };
  const good = c.fit.rms <= MATCH_GOOD_DB;
  return (
    <Card title="Likely build faults" className="ab-card ab-faults"
      actions={search.state === "running" ? <Badge tone="neutral">{search.done}/{search.total}</Badge> : undefined}>
      {search.state === "running" && (
        <div className="ab-progress">
          <ProgressBar value={search.total ? search.done / search.total : undefined} label="Testing build faults" />
          <span className="vw-muted">Testing build faults: {search.done} of {search.total}…</span>
        </div>
      )}
      {search.state === "done" && !search.list.length && (
        <EmptyState compact icon={Search} title={good ? "Nothing to explain" : "No single build fault explains it"}
          description={good
            ? "The measurement follows the prediction within the tolerance of the parts and the measurement."
            : "None of the common mistakes (polarity, a part one step off, a short or open, the MiniDSP settings) brings the curves together. Check the vents, the microphone position, and the driver measurements the design is based on."} />
      )}
      {search.state === "done" && search.list.length > 0 && (
        <>
          {good && <p className="vw-muted ab-note">The curves already match well: these are only candidates for what is left.</p>}
          <ol className="ab-fault-list">
            {search.list.map((f, i) => (
              <li key={f.h.id} className={shown.has(f.h.id) ? "is-shown" : undefined}>
                <span className="ab-rank mono">{i + 1}</span>
                <div className="ab-fault-body">
                  <span className="ab-fault-title">{f.h.title}</span>
                  <span className="ab-fault-rms mono">{c.fit.rms.toFixed(2)} → {f.rms.toFixed(2)} dB RMS</span>
                  <span className="ab-fault-fix">{f.h.fix}</span>
                  <div className="ab-fault-actions">
                    <Switch size="sm" checked={shown.has(f.h.id)} onChange={() => toggle(f.h.id)}>Show</Switch>
                    <PartChip focus={f.h.focus} hint="Show this part in the inspector (the design is not changed)">Jump to part</PartChip>
                  </div>
                </div>
              </li>
            ))}
          </ol>
          <p className="vw-foot">Each fault is tested on its own against the measurement, with its own level offset. Nothing here changes the design: fix the build, then measure again.</p>
        </>
      )}
    </Card>
  );
}

