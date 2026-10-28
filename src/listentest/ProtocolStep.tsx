// Step 1 of the listening-test view: the protocol builder. What is compared (design variants copied from
// the current design or a snapshot, the flat reference, speakers in the room), the programme, the rated
// attributes with their descriptors and the frequency region each points at, and the procedure
// (listeners, repetitions, seed, level matching).

import { Camera, Dices, Plus, RotateCcw, Speaker, Trash2, Waves } from "lucide-react";
import { Button, IconButton, NumberField, Segmented } from "../ui";
import { useStore } from "../state/store";
import { Card } from "../views/common";
import {
  ATTRIBUTE_LINKS, DEFAULT_ATTRIBUTES, ITEM_SUGGESTIONS, MAX_VARIANTS, newId, oursVariant,
  type Attribute, type Item, type Protocol, type SignalKind, type Variant,
} from "./model";
import { balancedListenerCount, williams } from "./random";
import { regionText } from "./stats";
import { useListenTest } from "./store";
import { Select, TextInput } from "./parts";

const SIGNALS: { value: SignalKind; label: string }[] = [
  { value: "pink", label: "Pink noise" }, { value: "band-wm", label: "W/M band noise" },
  { value: "band-mt", label: "M/T band noise" }, { value: "sweep", label: "Sweep" },
];
const KIND_LABEL: Record<Variant["kind"], string> = { design: "Design", flat: "Flat", room: "Room speaker" };
const VIEW_TITLE: Record<string, string> = { box: "Box", response: "Response", directivity: "Directivity", verdict: "Verdict" };

const stamp = () => new Date().toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export function ProtocolStep({ protocol }: { protocol: Protocol }) {
  const edit = useListenTest(s => s.editProtocol);
  const design = useStore(s => s.design);
  const snapshots = useStore(s => s.snapshots);
  const p = protocol;
  const full = p.variants.length >= MAX_VARIANTS;
  const ours = oursVariant(p);

  const addVariant = (v: Omit<Variant, "id">) => edit(x => {
    const first = !x.variants.some(o => o.ours) && v.kind !== "flat";
    x.variants.push({ ...v, id: newId("v"), ...(first ? { ours: true } : {}) });
  });
  const setVariant = (id: string, patch: Partial<Variant>) => edit(x => { const v = x.variants.find(o => o.id === id); if (v) Object.assign(v, patch); });
  const setOurs = (id: string) => edit(x => { for (const v of x.variants) v.ours = v.id === id ? true : undefined; });
  const setItem = (id: string, patch: Partial<Item>) => edit(x => { const v = x.items.find(o => o.id === id); if (v) Object.assign(v, patch); });
  const setAttr = (id: string, patch: Partial<Attribute>) => edit(x => { const v = x.attributes.find(o => o.id === id); if (v) Object.assign(v, patch); });

  const rows = williams(p.variants.length).length;
  const balanced = balancedListenerCount(p.variants.length, p.items.length, p.reps);
  const trials = p.items.length * p.reps;

  return (
    <div className="lt-cols">
      <div className="lt-col">
        <Card title="What is compared" actions={<span className="lt-kind">{p.variants.length} of {MAX_VARIANTS}</span>}>
          {p.variants.length === 0 && <p className="lt-msg">Add at least one variant. Two or more make a blind comparison; one alone is rated on its own.</p>}
          <ul className="lt-list">
            {p.variants.map(v => (
              <li key={v.id} className={"lt-row is-design" + (v.id === ours?.id ? " is-ours" : "")}>
                <TextInput value={v.name} onChange={name => setVariant(v.id, { name })} label="Variant name" />
                <span className="lt-kind" title={v.origin ? `From the ${v.origin}` : undefined}>{KIND_LABEL[v.kind]}</span>
                <Button size="sm" variant={v.id === ours?.id ? "subtle" : "ghost"} aria-pressed={v.id === ours?.id} disabled={v.kind === "flat"}
                        title="The group's own design or speaker: its ratings drive the advice" onClick={() => setOurs(v.id)}>Ours</Button>
                <IconButton size="sm" variant="ghost" icon={Trash2} label={`Remove ${v.name}`} onClick={() => edit(x => { x.variants = x.variants.filter(o => o.id !== v.id); })} />
              </li>
            ))}
          </ul>
          <div className="lt-adds">
            <Button size="sm" icon={Plus} disabled={full} onClick={() => addVariant({ name: `Design ${stamp()}`, kind: "design", design: structuredClone(design), origin: "current design" })}>Current design</Button>
            <Select<string> label="Add a snapshot" value="" disabled={full || !snapshots.length}
                    onChange={id => { const s = snapshots.find(o => o.id === id); if (s) addVariant({ name: s.name, kind: "design", design: structuredClone(s.design), origin: `snapshot "${s.name}"` }); }}
                    options={[{ value: "", label: snapshots.length ? "Add a snapshot…" : "No snapshots (S takes one)" }, ...snapshots.map(s => ({ value: s.id, label: s.name }))]} />
            <Button size="sm" icon={Waves} disabled={full || p.variants.some(v => v.kind === "flat")} onClick={() => addVariant({ name: "Flat reference", kind: "flat" })}>Flat</Button>
            <Button size="sm" icon={Speaker} disabled={full} onClick={() => addVariant({ name: p.variants.some(v => v.kind === "room") ? "Reference speaker" : "Our speaker", kind: "room" })}>Room speaker</Button>
          </div>
          <p className="lt-help">
            <b>Design</b> variants are frozen copies (<Camera size={11} aria-hidden /> a snapshot or the design as it is now), so later edits do not change the
            test. They and <b>Flat</b> play in the app, level matched. A <b>room speaker</b> (your built speaker, another group&apos;s box, a commercial
            reference) is rated with the printed sheets in the IEC room. A known reference anchors the scale (<cite>Bech &amp; Zacharov</cite>, ch. 7).
          </p>
        </Card>

        <Card title="Programme">
          <ul className="lt-list">
            {p.items.map(it => (
              <li key={it.id} className="lt-row is-item">
                <TextInput value={it.name} onChange={name => setItem(it.id, { name })} label="Programme item" placeholder="Artist, title" />
                <Select<string> label="Kind" value={it.kind === "signal" ? it.signal ?? "pink" : "track"}
                        onChange={k => setItem(it.id, k === "track" ? { kind: "track", signal: undefined } : { kind: "signal", signal: k as SignalKind })}
                        options={[{ value: "track", label: "Music track" }, ...SIGNALS]} />
                <IconButton size="sm" variant="ghost" icon={Trash2} label={`Remove ${it.name}`} disabled={p.items.length <= 1}
                            onClick={() => edit(x => { x.items = x.items.filter(o => o.id !== it.id); })} />
              </li>
            ))}
          </ul>
          <div className="lt-adds">
            {ITEM_SUGGESTIONS.filter(s => !p.items.some(i => i.name.startsWith(s.name))).map(s => (
              <button key={s.name} type="button" className="vw-qchip" title={s.note} onClick={() => edit(x => { x.items.push({ ...s, id: newId("it") }); })}>
                <Plus size={11} aria-hidden /> {s.name}
              </button>
            ))}
          </div>
          <p className="lt-help">
            Name the real tracks you will play. Short excerpts (15–30 s) that reveal the attributes work best: a solo voice for the midrange, an acoustic bass
            line for the box, cymbals for the tweeter, and one track every listener knows well (IEC 60268-13, programme material).
          </p>
        </Card>

        <Card title="Procedure">
          <div className="lt-fields">
            <span className="lt-label">Title</span>
            <TextInput value={p.title} onChange={title => edit(x => { x.title = title; })} label="Test title" />
            <span className="lt-label">Venue</span>
            <TextInput value={p.venue} onChange={venue => edit(x => { x.venue = venue; })} label="Venue" />
            <span className="lt-label">Listeners</span>
            <span className="lt-inline">
              <NumberField label="Listeners" value={p.listeners} min={1} max={40} step={1} digits={0} size={4} onChange={v => edit(x => { x.listeners = Math.round(v); })} />
              <span className="lt-label">Repetitions</span>
              <NumberField label="Repetitions" value={p.reps} min={1} max={5} step={1} digits={0} size={3} onChange={v => edit(x => { x.reps = Math.round(v); })} />
            </span>
            <span className="lt-label">Seed</span>
            <span className="lt-inline">
              <NumberField label="Random seed" value={p.seed} min={0} max={2 ** 31 - 1} step={1} digits={0} size={8} onChange={v => edit(x => { x.seed = Math.round(v); })} />
              <Button size="sm" variant="ghost" icon={Dices} onClick={() => edit(x => { x.seed = 1 + Math.floor(Math.random() * 99999); })}>Reshuffle</Button>
            </span>
            <span className="lt-label">Level</span>
            <textarea className="lt-textarea" rows={2} aria-label="Level matching" value={p.levelNote} onChange={e => { const levelNote = e.target.value; edit(x => { x.levelNote = levelNote; }); }} />
            <span className="lt-label">Notes</span>
            <textarea className="lt-textarea" rows={2} aria-label="Notes for the test leader" placeholder="Anything the test leader should remember" value={p.notes}
                      onChange={e => { const notes = e.target.value; edit(x => { x.notes = notes; }); }} />
          </div>
          <p className="lt-help">
            {p.variants.length > 1
              ? <>Each listener does <b>{trials} trials</b> ({p.items.length} items × {p.reps} repetitions). The order of the variants comes from a {rows}-row Williams Latin square:
                  it is fully balanced when listeners × trials is a multiple of {rows}{p.listeners === balanced || (p.listeners * trials) % rows === 0 ? " (it is now)" : `, e.g. with ${balanced} listeners`}.</>
              : <>Each listener does <b>{trials} trials</b>.</>}{" "}
            Repetitions show whether a listener is consistent. Matching the level to ±0.5 dB matters most: louder almost always sounds better (IEC 60268-13).
          </p>
        </Card>
      </div>

      <div className="lt-col">
        <Card title="Attributes · 1–7 scale" actions={
          <Button size="sm" variant="ghost" icon={RotateCcw} title="Restore the six default attributes"
                  onClick={() => edit(x => { x.attributes = DEFAULT_ATTRIBUTES.map(a => ({ ...a })); })}>Defaults</Button>}>
          <ul className="lt-list">
            {p.attributes.map(a => {
              const link = ATTRIBUTE_LINKS[a.id];
              return (
                <li key={a.id} className="lt-row is-attr">
                  <div className="lt-attr-body">
                    <TextInput value={a.name} onChange={name => setAttr(a.id, { name })} label="Attribute" />
                    <TextInput small value={a.descriptor} onChange={descriptor => setAttr(a.id, { descriptor })} label="Descriptor for the listeners" placeholder="One line the listener reads" />
                    <div className="lt-attr-ends">
                      <span className="mono">1</span><TextInput small value={a.low} onChange={low => setAttr(a.id, { low })} label="Meaning of 1" />
                      <span className="mono">7</span><TextInput small value={a.high} onChange={high => setAttr(a.id, { high })} label="Meaning of 7" />
                      <Segmented<"high" | "low"> size="sm" label="Better end" value={a.better} onChange={better => setAttr(a.id, { better })}
                        options={[{ value: "high", label: "7 best", hint: "A high rating is good" }, { value: "low", label: "1 best", hint: "A low rating is good (e.g. harshness)" }]} />
                    </div>
                    <span className="lt-link">
                      {link ? <><span className="mono">{regionText(link.band)}</span> → {link.control} · {VIEW_TITLE[link.view] ?? link.view} view</>
                            : "Custom attribute: no frequency region linked"}
                    </span>
                  </div>
                  <IconButton size="sm" variant="ghost" icon={Trash2} label={`Remove ${a.name}`} disabled={p.attributes.length <= 1}
                              onClick={() => edit(x => { x.attributes = x.attributes.filter(o => o.id !== a.id); })} />
                </li>
              );
            })}
          </ul>
          <div className="lt-adds">
            <Button size="sm" icon={Plus} onClick={() => edit(x => { x.attributes.push({ id: newId("at"), name: "New attribute", descriptor: "", low: "low", high: "high", better: "high" }); })}>Attribute</Button>
          </div>
          <p className="lt-help">
            Each attribute gets a written descriptor and labelled scale ends, so every listener rates the same thing (<cite>Bech &amp; Zacharov</cite>, ch. 4). Keep
            it to about six: more makes listeners tired and the answers noisy.
          </p>
        </Card>

      </div>
    </div>
  );
}
