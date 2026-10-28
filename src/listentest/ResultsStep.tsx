// Step 4 of the listening-test view: the results. Mean ± 95 % CI per attribute and variant (all items or
// one item), the plain-language conclusions, and for each attribute the frequency region and control
// it points at, with "show" links to that view and control and, where the change is mechanical, the
// tested fix from the listening insight provider.

import { useMemo, useState } from "react";
import { ArrowUpRight, Crosshair, Eraser, Wand2 } from "lucide-react";
import { Badge, Button, Segmented, toast } from "../ui";
import { focusControl } from "../ui/shell/commands";
import { useStore, type ViewId } from "../state/store";
import { Card } from "../views/common";
import { listeningInsights } from "../insights/providers/listening";
import { ATTRIBUTE_LINKS, oursVariant, type Protocol, type Rating } from "./model";
import { analyse, conclusions, regionText } from "./stats";
import { useListenTest } from "./store";
import { Legend, RatingChart } from "./parts";

const VIEW_TITLE: Partial<Record<ViewId, string>> = { box: "Box", response: "Response", directivity: "Directivity", verdict: "Verdict" };

export function ResultsStep({ protocol, ratings, onRun }: { protocol: Protocol; ratings: Rating[]; onRun(): void }) {
  const p = protocol;
  const clear = useListenTest(s => s.clearRatings);
  const profile = useStore(s => s.profile), fit = useStore(s => s.fit), prep = useStore(s => s.prep);
  const design = useStore(s => s.design), results = useStore(s => s.results);
  const setView = useStore(s => s.setView), setProbe = useStore(s => s.setProbe), setDesign = useStore(s => s.setDesign), undo = useStore(s => s.undo);
  const [item, setItem] = useState("all");
  const a = useMemo(() => analyse(p, ratings), [p, ratings]);
  const concl = useMemo(() => conclusions(p, a), [p, a]);
  const ours = oursVariant(p);
  // the provider's tested fixes, by attribute (it reads the same document from the store)
  const fixes = useMemo(() => {
    if (!profile || !fit || !prep || !results) return new Map<string, { label: string; design: typeof design }>();
    const out = new Map<string, { label: string; design: typeof design }>();
    try { for (const i of listeningInsights({ profile, fit, prep, design, results })) if (i.fix) out.set(i.id.replace(/^listening\./, ""), i.fix); }
    catch { /* no fixes then */ }
    return out;
  }, [profile, fit, prep, design, results, ratings]);   // eslint-disable-line react-hooks/exhaustive-deps

  if (!ratings.length)
    return (
      <Card title="Results">
        <p className="lt-msg">No ratings yet. Run a session in step 3 (in the app, or type in the printed sheets); the analysis appears here as you go.</p>
        <div className="lt-adds"><Button variant="primary" onClick={onRun}>Go to Run</Button></div>
      </Card>
    );

  const rows = p.attributes.map(at => a.byAttribute.get(at.id)!.find(r => r.item === item)!).filter(Boolean);
  const expected = p.listeners * p.reps * p.items.length * p.variants.length * p.attributes.length;
  const show = (view: ViewId, band: [number, number]) => { setView(view); setProbe(Math.sqrt(band[0] * band[1])); };
  const apply = (label: string, d: typeof design) => {
    setDesign(structuredClone(d));
    toast({ tone: "good", title: `Applied: ${label}`, description: "Take a snapshot and test it against the old design.", action: { label: "Undo", onClick: undo } });
  };

  return (
    <div className="lt-cols is-results">
      <div className="lt-col">
        <Card title="Ratings · mean and 95 % CI" actions={
          <Segmented<string> size="sm" label="Programme item" value={item} onChange={setItem}
            options={[{ value: "all", label: "All items" }, ...p.items.map(i => ({ value: i.id, label: i.name.length > 16 ? i.name.slice(0, 15) + "…" : i.name, hint: i.name }))]} />}>
          <div className="lt-summary">
            <Badge tone={a.listeners >= 2 ? "neutral" : "warn"}>{`${a.listeners} of ${p.listeners} listeners`}</Badge>
            <Badge>{`${ratings.length} of ${expected} ratings`}</Badge>
            <Badge>{a.unit === "listener" ? "listener means" : "one listener: repetitions"}</Badge>
          </div>
          <div className="lt-legend-wrap"><Legend protocol={p} ours={ours?.id} /></div>
          <RatingChart protocol={p} rows={rows} ours={ours?.id} />
          <p className="lt-help">
            Dots are means, bars the 95 % confidence interval (Student&apos;s t, n = {a.unit === "listener" ? "listeners" : "repetitions"}). The shaded half of each row is the
            bad side of that scale. A listener&apos;s repetitions are averaged first, so each listener counts once (<cite>Bech &amp; Zacharov</cite>, ch. 9).
          </p>
        </Card>

        <Card title="Table">
          <table className="lt-table">
            <thead><tr><th>Attribute</th><th>Variant</th><th>Mean</th><th>95 % CI</th><th>n</th></tr></thead>
            <tbody>
              {rows.flatMap(r => r.cells.filter(c => c.ci.n).map((c, k) => (
                <tr key={r.attr.id + c.variant}>
                  <td className="is-attr">{k === 0 ? r.attr.name : ""}</td>
                  <td>{p.variants.find(v => v.id === c.variant)?.name}</td>
                  <td className="num">{c.ci.mean.toFixed(1)}</td>
                  <td className="num">{Number.isFinite(c.ci.half) ? `${c.ci.lo.toFixed(1)}–${c.ci.hi.toFixed(1)}` : "—"}</td>
                  <td className="num">{c.ci.n}</td>
                </tr>
              )))}
            </tbody>
          </table>
        </Card>
      </div>

      <div className="lt-col">
        <Card title="What it says" actions={
          <Button size="sm" variant="ghost" icon={Eraser} onClick={() => {
            const keep = ratings;
            clear();
            toast({ title: "Ratings cleared", action: { label: "Undo", onClick: () => { const s = useListenTest.getState(); if (s.doc) s.replace({ ...s.doc, ratings: keep }); } } });
          }}>Clear ratings</Button>}>
          <ul className="lt-concl">
            {concl.map(c => {
              const at = p.attributes.find(x => x.id === c.attr)!, link = ATTRIBUTE_LINKS[c.attr], fix = fixes.get(c.attr);
              return (
                <li key={c.attr} className={"is-" + c.tone}>
                  <span className="lt-concl-attr">{at.name}</span>
                  {c.text}
                  {c.action && <div className="lt-concl-action">{c.action}</div>}
                  {link && (
                    <div className="lt-link">
                      <span className="mono">{regionText(link.band)}</span> → {link.control}
                      <Button size="sm" variant="ghost" icon={ArrowUpRight} onClick={() => show(link.view, link.band)}>{VIEW_TITLE[link.view] ?? link.view}</Button>
                      {link.focus && <Button size="sm" variant="ghost" icon={Crosshair} onClick={() => focusControl(link.focus!)}>Control</Button>}
                      {fix && c.action && <Button size="sm" variant="subtle" icon={Wand2} title="Tested: the verdict score barely moves" onClick={() => apply(fix.label, fix.design)}>{fix.label}</Button>}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          <p className="lt-help">
            “Preferred” compares the two best variants on the paired difference per listener. A result only counts when its 95 % CI excludes zero;
            otherwise it is a tendency, and more listeners or repetitions would settle it. The section goes into the report pack (Export → Report).
          </p>
        </Card>
      </div>
    </div>
  );
}
