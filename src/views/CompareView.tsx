// Compare view: the snapshot manager (rename, colour, A/B, restore, delete), every snapshot's sum over
// the current design, the B − A difference, and a table of what changed in the metrics and checks.

import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Camera, Check as CheckIcon, GitCompareArrows, Pencil, RotateCcw, Trash2 } from "lucide-react";
import { StackedPlots, type PlotSeries } from "../charts";
import { assess, score } from "../engine";
import { Button, EmptyState, IconButton, Menu, StatusDot, toast, fmtFreq } from "../ui";
import { snapshotNow } from "../ui/shell/commands";
import { create } from "zustand";
import { SNAP_COLORS, useStore, type Snapshot } from "../state/store";
import type { Design, Results } from "../types";
import { Card, ViewHeader, crossoverLines, judgeBand, splitHeights, useProbe, useSize } from "./common";
import { METRIC_ROWS, db, diff, levelAt, responseRange } from "./data";

export const CURRENT = "current";

/** Which two entries the Compare view sets against each other: "current" or a snapshot id. */
export const useCompare = create<{ a: string | null; b: string; set(p: Partial<{ a: string | null; b: string }>): void }>(set => ({
  a: null, b: CURRENT, set: p => set(p),
}));

/** Names for the store's snapshot colours, for the colour menu. */
const COLOR_NAMES = ["Violet", "Teal", "Olive", "Orchid", "Mauve", "Indigo", "Steel"];
const PALETTE = SNAP_COLORS.map((value, i) => ({ name: COLOR_NAMES[i] ?? `Colour ${i + 1}`, value }));

interface Entry { id: string; name: string; color: string; design: Design; results: Results }

function patchSnapshot(id: string, patch: Partial<Pick<Snapshot, "name" | "color">>) {
  useStore.getState().updateSnapshot(id, patch);
}

export function CompareView() {
  const prep = useStore(s => s.prep)!;
  const results = useStore(s => s.results)!;
  const design = useStore(s => s.design);
  const snapshots = useStore(s => s.snapshots);
  const angleChoice = useStore(s => s.ui.angle);
  const sel = useCompare();
  const [probe, setProbe] = useProbe();
  // a snapshot's results may come from an older profile fit: judge them defensively
  const verdictOf = (e: Entry) => { try { return Math.round(assess(prep, e.design, e.results).score); } catch { return null; } };
  const [ref, size] = useSize<HTMLDivElement>();
  const angle = angleChoice !== "both" && results.angles[angleChoice] ? angleChoice : "0";

  const current: Entry = { id: CURRENT, name: "Current design", color: "var(--sum)", design, results };
  const entries: Entry[] = [current, ...snapshots];
  const byId = (id: string | null) => entries.find(e => e.id === id);
  // A defaults to the newest snapshot, B to the current design
  const A = byId(sel.a) ?? (snapshots.length ? snapshots[snapshots.length - 1] : current);
  const B = byId(sel.b) ?? current;

  const series = useMemo<PlotSeries[]>(() => {
    const out: PlotSeries[] = [];
    for (const s of snapshots) {
      const r = s.results.angles[angle] ?? s.results.angles["0"];
      const key = s.id === A.id || s.id === B.id;
      out.push({ id: s.id, label: s.name, x: s.results.f, y: db(r.sum), color: s.color, dash: [5, 4], width: key ? 2 : 1.25, opacity: key ? 1 : 0.55 });
    }
    out.push({ id: CURRENT, label: "Current", x: results.f, y: db(results.angles[angle].sum), color: "sum", width: 2.25 });
    return out;
  }, [snapshots, results, angle, A.id, B.id]);

  const delta = useMemo<PlotSeries[]>(() => {
    if (A.id === B.id) return [];
    const ra = A.results.angles[angle] ?? A.results.angles["0"], rb = B.results.angles[angle] ?? B.results.angles["0"];
    return [
      { id: "d", label: `${B.name} − ${A.name}`, x: results.f, y: diff(db(rb.sum), db(ra.sum)), color: "accent", width: 2 },
      { id: "z", x: [20, 20000], y: [0, 0], color: "text-3", width: 1, quiet: true },
    ];
  }, [A, B, angle, results.f]);

  const level = levelAt(results.metrics, angle);
  const [hTop, hBottom] = splitHeights(size.height, [1.8, 1]);
  // fit the sums: 3 dB headroom, whole 5 dB steps, never deeper than 40 dB under the system level
  const yFit = useMemo<[number, number]>(() => {
    let lo = Infinity, hi = -Infinity;
    for (const s of series) for (let i = 0; i < s.y.length; i++) {
      const v = (s.y as ArrayLike<number>)[i];
      if (Number.isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    }
    if (!Number.isFinite(lo)) return responseRange(level, 30, 9);
    const top = Math.ceil((hi + 3) / 5) * 5;
    // at least 30 dB tall, so the grid keeps the coarse steps of the Response view
    return [Math.min(Math.floor(Math.max(lo - 3, level - 40) / 5) * 5, top - 30), top];
  }, [series, level]);

  return (
    <div className="vw-view">
      <ViewHeader title="Compare"
        actions={<Button icon={Camera} onClick={snapshotNow} size="sm">Take snapshot <span className="vw-kbd">S</span></Button>}>
        Snapshots freeze a design and its results. Overlay their sums on the current design, pick any two as A and B to see
        the difference and what changed in the numbers, and restore one with a click.
      </ViewHeader>
      <div className="vw-compare">
        <aside className="vw-cmp-side">
          <Card title="Snapshots" actions={<span className="vw-muted mono">{snapshots.length}</span>}>
            <ul className="vw-snaps">
              {entries.map(e => <SnapshotRow key={e.id} entry={e} isA={A.id === e.id} isB={B.id === e.id} />)}
            </ul>
            {!snapshots.length && (
              <EmptyState compact icon={GitCompareArrows} title="No snapshots yet"
                description="Press S (or the button above) before trying something, then compare the two designs here." />
            )}
          </Card>
          {A.id !== B.id ? <MetricsTable a={A} b={B} prepScore={(d: Design) => score(prep, d)} verdict={verdictOf} /> : (
            <Card title="Metrics">
              <p className="vw-muted vw-pad">A and B are the same design. {snapshots.length ? "Mark another row as A or B" : "Take a snapshot, change something, and the differences appear here"}.</p>
            </Card>
          )}
        </aside>
        <div className="vw-plots" ref={ref}>
          {size.height > 0 && (
            <StackedPlots xRange={[20, 20000]} probeHz={probe} onProbe={setProbe} syncId="compare"
              plots={[
                { key: "sum", height: delta.length ? hTop : size.height, series, bands: [judgeBand(level)], yRange: yFit,
                  yLabel: "Level", yUnit: "dB", vLines: crossoverLines(results.metrics),
                  title: <span className="vw-plot-title">System sum · {angle}°</span>, ariaLabel: "Sums of the snapshots" },
                ...(delta.length ? [{ key: "delta", height: hBottom, series: delta, yRange: [-6, 6] as [number, number], yLabel: "B − A", yUnit: "dB",
                  title: <span className="vw-plot-title">Difference B − A</span>, ariaLabel: "Difference between B and A" }] : []),
              ]} />
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- one row of the manager
function SnapshotRow({ entry, isA, isB }: { entry: Entry; isA: boolean; isB: boolean }) {
  const setSel = useCompare(s => s.set);
  const isCurrent = entry.id === CURRENT;
  const [editing, setEditing] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const m = entry.results.metrics;

  const commit = (text: string) => {
    const name = text.trim();
    if (name && name !== entry.name) patchSnapshot(entry.id, { name });
    setEditing(false);
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") commit(e.currentTarget.value);
    else if (e.key === "Escape") { e.stopPropagation(); setEditing(false); }
  };
  const restore = () => {
    const st = useStore.getState();
    st.setDesign(structuredClone(entry.design));
    toast({ tone: "good", title: `Restored ${entry.name}`, description: "The previous design is one undo away.",
            action: { label: "Undo", onClick: () => useStore.getState().undo() } });
  };
  const remove = () => {
    const st = useStore.getState(), at = st.snapshots.findIndex(s => s.id === entry.id), snap = st.snapshots[at];
    st.removeSnapshot(entry.id);
    toast({ title: `Deleted ${entry.name}`, action: { label: "Undo", onClick: () => {
      const next = [...useStore.getState().snapshots]; next.splice(at, 0, snap); useStore.getState().setSnapshots(next);
    } } });
  };

  const swatch = <span className={"vw-snap-swatch" + (isCurrent ? " is-current" : "")} style={{ ["--snap" as string]: entry.color }} />;
  return (
    <li className={"vw-snap" + (isCurrent ? " is-current" : "")}>
      {isCurrent ? swatch : (
        <Menu label={`Colour of ${entry.name}`} trigger={<button type="button" className="vw-snap-color" aria-label={`Colour of ${entry.name}`}>{swatch}</button>}
              items={PALETTE.map(c => ({ id: c.value, label: c.name, checked: c.value === entry.color,
                                        icon: <span className="vw-snap-swatch" style={{ ["--snap" as string]: c.value }} />,
                                        onSelect: () => patchSnapshot(entry.id, { color: c.value }) }))} />
      )}
      <div className="vw-snap-main">
        {editing ? (
          <input ref={input} className="vw-snap-input" defaultValue={entry.name} autoFocus aria-label="Snapshot name"
                 onKeyDown={onKey} onBlur={e => commit(e.currentTarget.value)} />
        ) : (
          <button type="button" className="vw-snap-name" disabled={isCurrent} onDoubleClick={() => setEditing(true)}
                  title={isCurrent ? undefined : "Double-click to rename"}>{entry.name}</button>
        )}
        <span className="vw-snap-meta mono">
          {m.on.spread.toFixed(1)} dB · {m.x_wm ? fmtFreq(m.x_wm) : "—"} / {m.x_mt ? fmtFreq(m.x_mt) : "—"} · {entry.design.digital.align}
        </span>
      </div>
      <div className="vw-snap-ab" role="group" aria-label={`Use ${entry.name} as`}>
        <button type="button" className={"vw-ab" + (isA ? " is-on" : "")} aria-pressed={isA} onClick={() => setSel({ a: entry.id })}>A</button>
        <button type="button" className={"vw-ab" + (isB ? " is-on" : "")} aria-pressed={isB} onClick={() => setSel({ b: entry.id })}>B</button>
      </div>
      {!isCurrent && (
        <div className="vw-snap-tools">
          <IconButton icon={Pencil} label="Rename" size="sm" variant="ghost" onClick={() => setEditing(true)} />
          <IconButton icon={RotateCcw} label="Restore this design" size="sm" variant="ghost" onClick={restore} />
          <IconButton icon={Trash2} label="Delete snapshot" size="sm" variant="ghost" onClick={remove} />
        </div>
      )}
    </li>
  );
}

// ---------------------------------------------------------------- the numbers
/** B − A with its unit: a signed difference, whole hertz above 10 Hz and one decimal below. */
export function fmtDelta(d: number, unit: string, digits: number): string {
  const n = unit === "Hz" ? (Math.abs(d) >= 10 ? 0 : 1) : digits;
  const mag = Math.abs(d).toFixed(n);
  const sign = Number(mag) === 0 ? "±" : d > 0 ? "+" : "−";
  return `${sign}${mag}${unit ? " " + unit : ""}`;
}

function MetricsTable({ a, b, prepScore, verdict }: { a: Entry; b: Entry; prepScore(d: Design): number; verdict(e: Entry): number | null }) {
  const scores = useMemo(() => [prepScore(a.design), prepScore(b.design)], [a.design, b.design]); // eslint-disable-line react-hooks/exhaustive-deps
  const verdicts = useMemo(() => [verdict(a), verdict(b)], [a.results, b.results]); // eslint-disable-line react-hooks/exhaustive-deps
  const fmt = (v: number | null, unit: string, digits: number) =>
    v === null || !Number.isFinite(v) ? "—" : unit === "Hz" ? fmtFreq(v) : `${v.toFixed(digits)}${unit ? " " + unit : ""}`;
  const tone = (d: number, better: -1 | 0 | 1, digits: number) =>
    better === 0 || Math.abs(d) < 0.5 * 10 ** -digits ? "" : d * better > 0 ? " is-good" : " is-bad";
  const rows = [
    // the 0-100 score the Verdict view and the status bar show, then the optimiser's own cost (lower is better)
    { id: "verdict", label: "Verdict score", unit: "", better: 1 as const, digits: 0, va: verdicts[0], vb: verdicts[1] },
    { id: "score", label: "Optimiser cost", unit: "", better: -1 as const, digits: 3, va: scores[0], vb: scores[1] },
    ...METRIC_ROWS.map(r => ({ id: r.id, label: r.label, unit: r.unit, better: r.better, digits: r.digits, va: r.get(a.results), vb: r.get(b.results) })),
  ];
  const checksA = new Map(a.results.checks.map(c => [c.id, c]));

  return (
    <Card title={<>Metrics <span className="vw-ab-tag">A</span> {a.name} <span className="vw-ab-tag">B</span> {b.name}</>}>
      <table className="vw-diff">
        <thead><tr><th /><th>A</th><th>B</th><th>B − A</th></tr></thead>
        <tbody>
          {rows.map(r => {
            const d = r.va !== null && r.vb !== null ? r.vb - r.va : NaN;
            return (
              <tr key={r.id}>
                <th scope="row">{r.label}</th>
                <td className="mono">{fmt(r.va, r.unit, r.digits)}</td>
                <td className="mono">{fmt(r.vb, r.unit, r.digits)}</td>
                <td className={"mono" + (Number.isFinite(d) ? tone(d, r.better, r.digits) : "")}>
                  {Number.isFinite(d) ? fmtDelta(d, r.unit, r.digits) : "—"}
                </td>
              </tr>
            );
          })}
          {b.results.checks.map(c => {
            const ca = checksA.get(c.id);
            return (
              <tr key={"c:" + c.id} className="vw-diff-check">
                <th scope="row">{c.title}</th>
                <td>{ca ? <StatusDot state={ca.state} /> : "—"}</td>
                <td><StatusDot state={c.state} /></td>
                <td>{ca && ca.state !== c.state ? (rank(c.state) > rank(ca.state) ? <span className="is-good">better</span> : <span className="is-bad">worse</span>) : <CheckIcon size={12} className="vw-muted" aria-label="unchanged" />}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Card>
  );
}

const rank = (s: "good" | "warn" | "bad") => (s === "good" ? 2 : s === "warn" ? 1 : 0);
