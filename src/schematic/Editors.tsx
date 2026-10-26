// What a click on the signal chain opens: an inline editor for a part, a driver or the MiniDSP,
// and the hover card that explains a part before it is clicked. Every change goes through
// store.edit, so it is one undo step and the inspector shows the same value.
import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Crosshair, SlidersHorizontal, Trash2 } from "lucide-react";
import { ALIGNMENTS } from "../engine";
import { defaultDesign, useStore } from "../state/store";
import type { Align, UnitId } from "../types";
import { Button, Segmented, Slider, ValuePicker, fmtDb, fmtFreq, fmtOhm, fmtValue, parseNumber, useFloating } from "../ui";
import { focusables } from "../ui/hooks";
import * as E from "./edits";
import type { PartGlyph } from "./layout";
import { dbOf, partImpedance, voltsOf, type LiveChain } from "./live";

export type Target =
  | { type: "part"; part: PartGlyph }
  | { type: "driver"; unit: UnitId }
  | { type: "dsp" }
  | { type: "box" };

export const UNIT_NAME: Record<UnitId, string> = { woof: "Woofer", mid: "Midrange", tw: "Tweeter" };
export const UNIT_VAR: Record<UnitId, string> = { woof: "var(--woof)", mid: "var(--mid)", tw: "var(--tw)" };

/** Focus id the inspector should jump to for a target. */
export function focusIdOf(t: Target): string {
  if (t.type === "part") return t.part.id;
  if (t.type === "driver") return t.unit === "woof" ? "digital.pol" : `${t.unit}.pol`;
  if (t.type === "dsp") return "digital.fc";
  return "box";
}

/** Same as the shell's focusControl: clearing first lets the inspector pulse again for the same id. */
export function focusInspector(id: string) {
  const st = useStore.getState();
  st.setUi({ focus: null });
  requestAnimationFrame(() => useStore.getState().setUi({ focus: id }));
}

const polar = (z: [number, number]) => ({ mag: Math.hypot(z[0], z[1]), deg: (Math.atan2(z[1], z[0]) * 180) / Math.PI });
const fmtAngle = (deg: number) => `${deg < 0 ? "−" : ""}${Math.abs(deg).toFixed(0)}°`;

function Row({ k, v, hint }: { k: ReactNode; v: ReactNode; hint?: string }) {
  return (
    <div className="sc-row" title={hint}>
      <dt>{k}</dt>
      <dd className="mono">{v}</dd>
    </div>
  );
}

/** Impedance and level of a part at the probe frequency, for the card and the editor. */
function PartFacts({ part, live }: { part: PartGlyph; live: LiveChain | null }) {
  const Rdcr = useStore(s => s.design.Rdcr);
  if (!live) return null;
  const z = polar(partImpedance(part.kind, part.value, live.f, Rdcr));
  const db = dbOf(voltsOf(live, part.signal));
  return (
    <dl className="sc-facts">
      <Row k={<>|Z| at {fmtFreq(live.f)}</>} v={<>{fmtOhm(z.mag)} <span className="sc-dim">∠ {fmtAngle(z.deg)}</span></>}
           hint="Impedance of this part alone at the probe frequency" />
      <Row k={part.pos === "series" ? "Level after it" : "Level across it"} v={db === null ? "—" : fmtDb(db)}
           hint="Signal voltage at this node, relative to the MiniDSP input" />
    </dl>
  );
}

function DriverFacts({ unit, live }: { unit: UnitId; live: LiveChain | null }) {
  if (!live) return null;
  const rel = live.relDb[unit];
  const zd = live.zDriver[unit];
  const term = dbOf(voltsOf(live, unit === "woof" ? "woof" : `${unit}.term`));
  return (
    <dl className="sc-facts">
      <Row k={<>Level at {fmtFreq(live.f)}</>} v={rel === null ? "—" : <>{fmtDb(rel, { sign: true })} <span className="sc-dim">re system</span></>}
           hint="Acoustic level of this unit relative to the system's on-axis level" />
      <Row k={unit === "woof" ? "Drive level" : "At the terminals"} v={term === null ? "—" : fmtDb(term)}
           hint="Electrical signal relative to the MiniDSP input (amplifier gain not included)" />
      {zd && <Row k="Driver |Z|" v={<>{fmtOhm(polar(zd).mag)} <span className="sc-dim">∠ {fmtAngle(polar(zd).deg)}</span></>}
                  hint="Measured input impedance of the driver" />}
    </dl>
  );
}

// ------------------------------------------------------------------ hover card
export function HoverCard({ target, anchor, live }: { target: Target; anchor: Element; live: LiveChain | null }) {
  const ref = useRef<HTMLDivElement>(null);
  const pos = useFloating(true, anchor as HTMLElement, ref, { side: "top", align: "center" }, 8);
  const design = useStore(s => s.design);
  const profile = useStore(s => s.profile);
  const results = useStore(s => s.results);

  let title: ReactNode, sub: ReactNode = null, body: ReactNode = null, color = "var(--text-2)";
  if (target.type === "part") {
    const p = target.part;
    color = UNIT_VAR[p.unit];
    title = <>{UNIT_NAME[p.unit]} · {p.name}</>;
    sub = p.label;
    body = (
      <>
        <div className="sc-card-value mono" style={{ color }}>{fmtValue(p.value, p.kind)}</div>
        <PartFacts part={p} live={live} />
      </>
    );
  } else if (target.type === "driver") {
    color = UNIT_VAR[target.unit];
    title = UNIT_NAME[target.unit];
    sub = profile?.units[target.unit]?.label;
    body = (
      <>
        <div className="sc-card-value">{design.pol[target.unit] === 1 ? "Normal polarity" : "Inverted polarity"}</div>
        <DriverFacts unit={target.unit} live={live} />
      </>
    );
  } else if (target.type === "dsp") {
    color = "var(--woof)";
    title = "MiniDSP";
    sub = "Digital crossover, 96 kHz";
    const lp = dbOf(voltsOf(live, "woof")), hp = dbOf(voltsOf(live, "hp"));
    body = (
      <>
        <div className="sc-card-value mono">{design.digital.align} · {fmtFreq(design.digital.fc)}</div>
        <dl className="sc-facts">
          <Row k="OUT1 low-pass" v={lp === null ? "—" : fmtDb(lp)} hint="Woofer channel, after the woofer gain" />
          <Row k="OUT2 high-pass" v={hp === null ? "—" : fmtDb(hp)} hint="Midrange and tweeter channel" />
        </dl>
      </>
    );
  } else {
    color = "var(--woof)";
    title = "Woofer box";
    sub = results?.box.label;
    body = (
      <dl className="sc-facts">
        <Row k="Tuning fB" v={fmtFreq(results?.box.fB ?? null)} />
        <Row k="f3" v={fmtFreq(results?.box.f3 ?? null)} />
      </dl>
    );
  }

  return createPortal(
    <div ref={ref} className="sc-card" role="tooltip"
         style={{ left: pos?.x ?? -9999, top: pos?.y ?? -9999, visibility: pos ? "visible" : "hidden", ["--sc-tone" as string]: color }}>
      <div className="sc-card-head">
        <span className="sc-swatch" aria-hidden />
        <span className="sc-card-title">{title}</span>
      </div>
      {sub && <div className="sc-card-sub">{sub}</div>}
      {body}
      <div className="sc-card-hint">{target.type === "box" ? "Click to open the box settings" : "Click or press Enter to edit"}</div>
    </div>,
    document.body,
  );
}

// ------------------------------------------------------------------ editor
interface EditorProps { target: Target; live: LiveChain | null; onClose(): void }

/** Body of the editor popover. Takes the keyboard focus back after the inspector has jumped to the control. */
export function EditorBody({ target, live, onClose }: EditorProps) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // the inspector focuses its own control ~60 ms after store.ui.focus changes; keep focus in the editor
    const grab = () => {
      const el = ref.current;
      if (!el || el.contains(document.activeElement)) return;
      const first = el.querySelector<HTMLElement>(".cs-vp-value, [role='radio'][aria-checked='true'], [role='slider']") ?? focusables(el)[0];
      first?.focus({ preventScroll: true });
    };
    const raf = requestAnimationFrame(grab);
    const t = window.setTimeout(grab, 180);
    return () => { cancelAnimationFrame(raf); window.clearTimeout(t); };
  }, [target.type === "part" ? target.part.id : target.type]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div ref={ref} className="sc-ed">
      {target.type === "part" ? <PartEditor part={target.part} live={live} onClose={onClose} />
        : target.type === "driver" ? <DriverEditor unit={target.unit} live={live} onClose={onClose} />
        : <DspEditor onClose={onClose} />}
    </div>
  );
}

function Header({ color, title, sub }: { color: string; title: ReactNode; sub?: ReactNode }) {
  return (
    <header className="sc-ed-head" style={{ ["--sc-tone" as string]: color }}>
      <span className="sc-swatch" aria-hidden />
      <div>
        <div className="sc-ed-title">{title}</div>
        {sub && <div className="sc-ed-sub">{sub}</div>}
      </div>
    </header>
  );
}

function Footer({ focusId, onClose, children }: { focusId: string; onClose(): void; children?: ReactNode }) {
  return (
    <footer className="sc-ed-foot">
      <Button variant="ghost" size="sm" icon={SlidersHorizontal} onClick={() => { focusInspector(focusId); onClose(); }}>
        Show in inspector
      </Button>
      {children}
    </footer>
  );
}

function PartEditor({ part, live, onClose }: { part: PartGlyph; live: LiveChain | null; onClose(): void }) {
  const profile = useStore(s => s.profile);
  const edit = useStore(s => s.edit);
  if (!profile) return null;
  const color = UNIT_VAR[part.unit], unit = part.unit;
  const options = E.partList(profile, part.kind);

  const onChange = (v: number) => {
    if (part.role === "topo") edit(E.setPartValue(unit, part.name, v));
    else if (part.role === "pad") edit(E.setPad(unit, part.name as "Rs" | "Rp", v));
    else edit(E.setZobel(unit, part.name as "R" | "C", v));
  };
  const remove = part.role === "pad" ? () => { edit(E.removePadPart(unit, part.name as "Rs" | "Rp")); onClose(); }
    : part.role === "zobel" ? () => { edit(E.removeZobel(unit)); onClose(); }
    : null;
  const what = part.kind === "L" ? "Inductor" : part.kind === "C" ? "Capacitor" : "Resistor";
  // the unit stays out of the uppercase label: text-transform would turn "µF" into "ΜF" and "mH" into "MH"
  const unitText = part.kind === "L" ? "mH" : part.kind === "C" ? "µF" : "Ω";

  return (
    <>
      <Header color={color} title={<>{UNIT_NAME[unit]} · {part.name}</>} sub={part.label} />
      <div className="sc-ed-field">
        <span className="sc-ed-label">{what} <span className="sc-ed-unit">{unitText}</span></span>
        <ValuePicker label={`${UNIT_NAME[unit]} ${part.name}`} value={part.value} options={options} color={color}
                     format={v => fmtValue(v, part.kind)} onChange={onChange} />
      </div>
      <PartFacts part={part} live={live} />
      <Footer focusId={part.id} onClose={onClose}>
        {remove && (
          <Button variant="danger" size="sm" icon={Trash2} onClick={remove}>
            {part.role === "zobel" ? "Remove Zobel" : "Remove"}
          </Button>
        )}
      </Footer>
    </>
  );
}

const POLARITY = [
  { value: 1 as const, label: "+ Normal", hint: "Connected as marked." },
  { value: -1 as const, label: "− Inverted", hint: "Leads swapped: the unit's output is turned upside down (180°)." },
];

function DriverEditor({ unit, live, onClose }: { unit: UnitId; live: LiveChain | null; onClose(): void }) {
  const pol = useStore(s => s.design.pol[unit]);
  const info = useStore(s => s.profile?.units[unit]);
  const edit = useStore(s => s.edit);
  return (
    <>
      <Header color={UNIT_VAR[unit]} title={UNIT_NAME[unit]} sub={info?.label} />
      <div className="sc-ed-field">
        <span className="sc-ed-label">Polarity</span>
        <Segmented label={`${UNIT_NAME[unit]} polarity`} size="sm" value={pol} options={POLARITY}
                   onChange={p => edit(d => { d.pol[unit] = p; })} />
      </div>
      <DriverFacts unit={unit} live={live} />
      <Footer focusId={unit === "woof" ? "digital.pol" : `${unit}.pol`} onClose={onClose}>
        {unit === "woof" && (
          <Button variant="ghost" size="sm" icon={Crosshair} onClick={() => { focusInspector("box"); onClose(); }}>Box</Button>
        )}
      </Footer>
    </>
  );
}

const START = defaultDesign().digital;

function DspEditor({ onClose }: { onClose(): void }) {
  const dig = useStore(s => s.design.digital);
  const limits = useStore(s => s.profile?.limits);
  const edit = useStore(s => s.edit);
  const note = ALIGNMENTS.find(a => a.key === dig.align)?.note;
  return (
    <>
      <Header color="var(--woof)" title="MiniDSP" sub="OUT1 low-pass to the woofer, OUT2 high-pass to the passive board" />
      <div className="sc-ed-field">
        <span className="sc-ed-label">Alignment</span>
        <Segmented<Align> label="Alignment" size="sm" value={dig.align}
                          options={ALIGNMENTS.map(a => ({ value: a.key, label: a.key, hint: `${a.name}: ${a.note}` }))}
                          onChange={a => edit(d => { d.digital.align = a; })} />
        {note && <span className="sc-ed-note">{note}</span>}
      </div>
      <div className="sc-ed-field">
        <span className="sc-ed-label">Crossover frequency</span>
        <Slider label="Crossover frequency" value={dig.fc} min={100} max={1000} log step={1} format={v => fmtFreq(v)} parse={s => parseNumber(s)}
                band={limits?.wm} defaultValue={START.fc} color="var(--woof)"
                onInput={v => edit(d => { d.digital.fc = v; }, false)} onCommit={v => edit(d => { d.digital.fc = v; })} />
      </div>
      <div className="sc-ed-field">
        <span className="sc-ed-label">Woofer gain</span>
        <Slider label="Woofer gain" value={dig.g_woof_dB} min={-12} max={6} step={0.1} origin={0} unit="dB" digits={1}
                format={v => fmtDb(v, { sign: true })} parse={s => parseNumber(s, "dB")} defaultValue={START.g_woof_dB} color="var(--woof)"
                onInput={v => edit(d => { d.digital.g_woof_dB = v; }, false)} onCommit={v => edit(d => { d.digital.g_woof_dB = v; })} />
      </div>
      <Footer focusId="digital.fc" onClose={onClose} />
    </>
  );
}
