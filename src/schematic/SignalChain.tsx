// The live signal chain: an SVG schematic of the whole system, laid out from the design.
// Wires carry the signal at the probe frequency (weight, opacity and flowing dashes follow its level),
// every part, driver and the MiniDSP opens an inline editor, and each edit is one undo step.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type SVGProps } from "react";
import { FolderOpen, Upload, Workflow } from "lucide-react";
import { BUNDLED_PROFILES, useStore } from "../state/store";
import type { UnitId } from "../types";
import { Button, EmptyState, Popover, fmtDb, fmtFreq, fmtValue } from "../ui";
import * as E from "./edits";
import { EditorBody, HoverCard, UNIT_NAME, focusIdOf, focusInspector, type Target } from "./Editors";
import { layoutChain, type ChainLayout, type Mode, type PartGlyph, type Tone, type Wire } from "./layout";
import { dbOf, flowPeriod, liveChain, strength, voltsOf, type LiveChain } from "./live";
import { Amp, FilterGlyph, Ground, PartSymbol, Source, Speaker } from "./symbols";
import "./schematic.css";

const TONE_VAR: Record<Tone, string> = { woof: "var(--woof)", mid: "var(--mid)", tw: "var(--tw)", neutral: "var(--text-2)" };
const ORDER_LABEL = ["1st", "2nd", "3rd", "4th"];
const HOVER_DELAY_MS = 260;
/** Below this the full drawing gets hard to read and the compact one takes over. */
const FULL_MIN_SCALE = 0.82;

/** Pressing outside the editor closes it, except inside another floating layer it opened (a ValuePicker list). */
const nestedLayers = { current: { contains: (n: Node | null) => n instanceof Element && !!n.closest(".cs-popover") } } as unknown as { current: HTMLElement };

type ItemProps = SVGProps<SVGGElement> & { "data-sc-item": string };

interface Interaction {
  target: Target;
  el: Element;
}

export function SignalChain({ compact }: { compact?: boolean }) {
  const design = useStore(s => s.design);
  const prep = useStore(s => s.prep);
  const results = useStore(s => s.results);
  const profile = useStore(s => s.profile);
  const error = useStore(s => s.error);
  const probe = useStore(s => s.probe);
  const focus = useStore(s => s.ui.focus);
  const animate = useStore(s => s.ui.animate);
  const edit = useStore(s => s.edit);

  const live = useMemo(() => liveChain(prep, design, results, probe), [prep, design, results, probe]);

  // ---- fit to the container: compact fills the height and scrolls sideways, full fits both ways
  const root = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const measure = () => setBox({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [!!profile && !!results]); // eslint-disable-line react-hooks/exhaustive-deps
  // the full drawing only where it can be shown at a readable size; otherwise the dense one
  const full = useMemo(() => layoutChain(design, "full"), [design]);
  const mode: Mode = compact || (box && box.h > 0 && (box.h - 4) / full.height < FULL_MIN_SCALE) ? "compact" : "full";
  const compactLayout = useMemo(() => (mode === "compact" ? layoutChain(design, "compact") : null), [design, mode]);
  const layout = compactLayout ?? full;
  const dense = mode === "compact";
  const scale = useMemo(() => {
    if (!box || !box.h) return 1;
    const byH = (box.h - 4) / layout.height, byW = (box.w - 4) / layout.width;
    // compact fills the height (it scrolls sideways when narrow); neither grows past the width it has
    return dense ? clamp(Math.min(byH, byW), 0.8, 1.6) : clamp(Math.min(byH, byW), FULL_MIN_SCALE, 1.6);
  }, [box, layout.width, layout.height, dense]);

  // ---- hover card and editor
  const [hover, setHover] = useState<Interaction | null>(null);
  const [editor, setEditor] = useState<Interaction | null>(null);
  const hoverTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(hoverTimer.current), []);

  const showHover = (target: Target, el: Element, now = false) => {
    if (editor) return;
    window.clearTimeout(hoverTimer.current);
    hoverTimer.current = window.setTimeout(() => setHover({ target, el }), now ? 0 : HOVER_DELAY_MS);
  };
  const hideHover = () => { window.clearTimeout(hoverTimer.current); setHover(null); };

  const open = (target: Target, el: Element) => {
    hideHover();
    if (target.type === "box") { focusInspector("box"); return; }
    setEditor({ target, el });
    focusInspector(focusIdOf(target));
  };
  const close = () => {
    const el = editor?.el as HTMLElement | SVGElement | undefined;
    setEditor(null);
    if (el?.isConnected) el.focus({ preventScroll: true });
  };

  // an edit can remove the part being edited (Remove, a lower order): close its editor then;
  // otherwise refresh the target so the editor shows the new value
  useEffect(() => {
    if (editor?.target.type !== "part") return;
    const id = editor.target.part.id;
    const now = layout.parts.find(p => p.id === id);
    if (!now) setEditor(null);
    else if (now !== editor.target.part) setEditor({ ...editor, target: { type: "part", part: now } });
  }, [layout]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!profile || !results) {
    return (
      <div ref={root} className={"sc-root sc-empty" + (compact ? " is-compact" : "")}>
        <EmptyState compact icon={Workflow} tone={error ? "bad" : "neutral"}
                    title={error ? "The design cannot be computed" : "No system loaded"}
                    description={error ?? "Open a profile or import measurements to see the signal chain."}
                    action={error ? undefined : (
                      <>
                        <Button variant="primary" size="sm" icon={Upload} onClick={() => useStore.getState().setUi({ wizard: true })}>Import measurements</Button>
                        <Button variant="subtle" size="sm" icon={FolderOpen} onClick={() => useStore.getState().loadProfile(BUNDLED_PROFILES[0])}>Open the example</Button>
                      </>
                    )} />
      </div>
    );
  }

  const selectedId = editor ? focusIdOf(editor.target) : focus;
  const isSelected = (id: string) => !!selectedId && (selectedId === id || selectedId.startsWith(id + "."));

  /** Props shared by every interactive item: hover, focus, click, keyboard. */
  const itemProps = (target: Target, label: string): ItemProps => ({
    role: "button",
    tabIndex: 0,
    "aria-label": label,
    "aria-haspopup": target.type === "box" ? undefined : "dialog",
    "data-sc-item": "",
    onPointerEnter: e => { if (e.pointerType !== "touch") showHover(target, e.currentTarget); },
    onPointerLeave: hideHover,
    onFocus: e => { if (e.currentTarget.matches(":focus-visible")) showHover(target, e.currentTarget, true); },
    onBlur: hideHover,
    onClick: e => open(target, e.currentTarget),
    onKeyDown: e => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(target, e.currentTarget); }
      else walk(e);
    },
  });

  /** Arrow keys walk the chain in reading order, as Tab does, without leaving the diagram. */
  const walk = (e: KeyboardEvent<SVGGElement>) => {
    const fwd = e.key === "ArrowRight" || e.key === "ArrowDown", back = e.key === "ArrowLeft" || e.key === "ArrowUp";
    if (!fwd && !back) return;
    e.preventDefault();
    const items = Array.from(root.current?.querySelectorAll<SVGGElement>("[data-sc-item]") ?? []);
    items[items.indexOf(e.currentTarget) + (fwd ? 1 : -1)]?.focus();
  };

  const style = { "--sc-flow-dur": `${flowPeriod(live?.f ?? probe).toFixed(2)}s` } as CSSProperties;

  return (
    <div ref={root} className={"sc-root" + (dense ? " is-compact" : "") + (animate ? " is-animated" : "")} style={style}>
      <svg
        className="sc-svg"
        width={Math.round(layout.width * scale)}
        height={Math.round(layout.height * scale)}
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        role="group"
        aria-label={`Signal chain at ${fmtFreq(live?.f ?? probe)}: MiniDSP, two amplifier channels, the passive board and three drivers`}
      >
        <Board layout={layout} live={live} />
        <Wires wires={layout.wires} live={live} />
        {layout.junctions.map((j, k) => (
          <circle key={k} className="sc-junction" cx={j.x} cy={j.y} r={dense ? 2.2 : 2.6} style={{ fill: TONE_VAR[j.tone] }} />
        ))}
        {layout.grounds.map(([x, y], k) => <Ground key={k} x={x} y={y} scale={dense ? 0.8 : 1} />)}

        <g className="sc-static">
          <Source x={layout.input.x} y={layout.input.y} />
          <text className="sc-caps sc-dim-text" x={layout.input.x} y={layout.input.y - 14} textAnchor="middle">In</text>
        </g>

        <Dsp layout={layout} selected={isSelected("digital")} props={itemProps({ type: "dsp" }, dspLabel(design.digital))} />

        {layout.amps.map(a => (
          <g key={a.ch} className="sc-static">
            <Amp x={a.x} y={a.y} w={a.w} />
            {!dense && <text className="sc-caps sc-dim-text" x={a.x + a.w / 2} y={a.y - a.w * 0.45 - 5} textAnchor="middle">Ch {a.ch}</text>}
            <title>{`Amplifier channel ${a.ch}`}</title>
          </g>
        ))}

        <BoxLabel layout={layout} props={itemProps({ type: "box" }, `Woofer box: ${results.box.label}. Open the box settings`)} />

        {layout.branches.map(b => (
          <BranchTools key={b.unit} unit={b.unit} x={b.gx + 12} y={b.y} compact={dense} onWalk={walk}
                       topo={design[b.unit].topo} pad={E.hasPad(design[b.unit])} zobel={E.hasZobel(design[b.unit])}
                       onTopo={key => { edit(E.setTopology(profile, b.unit, key)); focusInspector(`${b.unit}.topo`); }}
                       onPad={() => { edit(E.addPad(profile, b.unit)); focusInspector(`${b.unit}.pad.Rs`); }}
                       onZobel={() => { edit(E.addZobel(profile, b.unit)); focusInspector(`${b.unit}.zobel`); }} />
        ))}

        {layout.parts.map(p => (
          <Part key={p.id} part={p} selected={isSelected(p.id)} compact={dense}
                props={itemProps({ type: "part", part: p }, partLabel(p))} />
        ))}

        <g className="sc-tags" aria-hidden>
          {layout.tags.map(t => {
            const db = dbOf(voltsOf(live, t.signal));
            return db === null ? null : (
              <text key={t.key} className="sc-tag" x={t.x} y={t.y} textAnchor={t.anchor}>
                {fmtDb(db, { bare: true })}<tspan className="sc-tag-unit"> dB</tspan>
              </text>
            );
          })}
        </g>

        {layout.speakers.map(s => (
          <Driver key={s.unit} unit={s.unit} x={s.x} y={s.y} compact={dense} size={layout.m.spk} live={live}
                  pol={design.pol[s.unit]} model={profile.units[s.unit]?.label}
                  selected={focus === s.unit || isSelected(s.unit === "woof" ? "digital.pol" : `${s.unit}.pol`)}
                  props={itemProps({ type: "driver", unit: s.unit }, `${UNIT_NAME[s.unit]}${design.pol[s.unit] < 0 ? ", inverted" : ""}: edit`)}
                  onWalk={walk} onFlip={() => edit(E.flipPolarity(s.unit))} />
        ))}
      </svg>

      {hover && !editor && <HoverCard target={hover.target} anchor={hover.el} live={live} />}
      <Popover open={!!editor} onClose={close} anchor={(editor?.el ?? null) as HTMLElement | null} side="top" align="center" offset={10}
               ignore={[nestedLayers]} role="dialog" aria-label="Edit" className="sc-pop">
        {editor && <EditorBody target={editor.target} live={live} onClose={close} />}
      </Popover>
    </div>
  );
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

function dspLabel(d: { align: string; fc: number; g_woof_dB: number }) {
  return `MiniDSP: ${d.align} at ${fmtFreq(d.fc)}, woofer gain ${fmtDb(d.g_woof_dB, { sign: true })}. Edit`;
}

function partLabel(p: PartGlyph) {
  return `${UNIT_NAME[p.unit]} ${p.name}, ${p.label}, ${fmtValue(p.value, p.kind)}. Edit`;
}

/** Enter/Space activation for the small SVG controls, plus arrow walking. */
function press(fn: () => void, walk: (e: KeyboardEvent<SVGGElement>) => void) {
  return {
    onClick: fn,
    onKeyDown: (e: KeyboardEvent<SVGGElement>) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fn(); }
      else walk(e);
    },
  };
}

// ------------------------------------------------------------------ pieces

function Wires({ wires, live }: { wires: Wire[]; live: LiveChain | null }) {
  return (
    <g className="sc-wires" aria-hidden>
      {wires.map(w => {
        const pts = w.pts.map(p => p.join(",")).join(" ");
        if (w.signal === "gnd") return <polyline key={w.key} className="sc-wire is-gnd" points={pts} />;
        const color = TONE_VAR[w.tone];
        const s = strength(voltsOf(live, w.signal));
        const width = 1.1 + 2.4 * s;
        return (
          <g key={w.key}>
            <polyline className="sc-wire" points={pts} style={{ stroke: color, strokeWidth: width, strokeOpacity: 0.3 + 0.5 * s }} />
            {w.flow && s > 0.04 && (
              <polyline className="sc-flow" points={pts} style={{ stroke: color, strokeWidth: width + 0.6, strokeOpacity: 0.15 + 0.6 * s }} />
            )}
          </g>
        );
      })}
    </g>
  );
}

function Board({ layout, live }: { layout: ChainLayout; live: LiveChain | null }) {
  const b = layout.board, compact = layout.mode === "compact";
  return (
    <g className="sc-static" aria-hidden>
      <rect className="sc-board" x={b.x} y={b.y} width={b.w} height={b.h} rx={8} />
      <text className="sc-caps sc-legend" x={b.x + 12} y={b.y + 4}>Passive board</text>
      {live && (
        <text className="sc-legend sc-legend-probe" x={b.x + b.w - 12} y={b.y + 4} textAnchor="end">
          {compact ? `dB at ${fmtFreq(live.f)}` : `levels in dB re input, at ${fmtFreq(live.f)}`}
        </text>
      )}
    </g>
  );
}

function Dsp({ layout, selected, props }: { layout: ChainLayout; selected: boolean; props: ItemProps }) {
  const d = layout.dsp, compact = layout.mode === "compact";
  const dig = useStore(s => s.design.digital);
  const { woof, mid } = layout.rows;
  const tx = d.x + 40;
  return (
    <g {...props} className={"sc-item sc-dsp" + (selected ? " is-selected" : "")}>
      <rect className="sc-hit sc-dsp-body" x={d.x} y={d.y} width={d.w} height={d.h} rx={compact ? 5 : 7} />
      <text className="sc-caps sc-dsp-title" x={d.x + d.w / 2 + 8} y={d.inY + (compact ? 3.5 : 1)} textAnchor="middle">MiniDSP</text>
      {!compact && <text className="sc-dim-text sc-small" x={d.x + d.w / 2 + 8} y={d.inY + 13} textAnchor="middle">96 kHz · 2 × 4</text>}
      <path className="sc-dsp-split" d={`M${d.x},${d.inY} H${d.x + 6} M${d.x + 6},${woof} V${mid} M${d.x + 6},${woof} H${d.x + 11} M${d.x + 6},${mid} H${d.x + 11}`} />
      {([["Out 1", woof, "LP", dig.g_woof_dB], ["Out 2", mid, "HP", 0]] as const).map(([name, y, kind, g]) => (
        <g key={name}>
          <FilterGlyph x={d.x + 14} y={y} kind={kind} small={compact} />
          {compact ? (
            <text className="sc-val" x={tx - 6} y={y + 3.5}>
              <tspan className="sc-name sc-dsp-kind">{dig.align} {kind}</tspan><tspan dx={5}>{fmtFreq(dig.fc)}</tspan>
              <tspan className="sc-dim-text" dx={5}>{fmtDb(g, { sign: true })}</tspan>
            </text>
          ) : (
            <>
              <text className="sc-caps sc-dsp-out" x={tx} y={y - 3}>{name} · {dig.align} {kind}</text>
              <text className="sc-val" x={tx} y={y + 10}>
                {fmtFreq(dig.fc)}<tspan className="sc-dim-text" dx={6}>{fmtDb(g, { sign: true })}</tspan>
              </text>
            </>
          )}
          <circle className="sc-port" cx={d.x + d.w} cy={y} r={2.4} />
        </g>
      ))}
    </g>
  );
}

function BoxLabel({ layout, props }: { layout: ChainLayout; props: ItemProps }) {
  const box = useStore(s => s.results?.box);
  if (!box) return null;
  const text = `${box.label}${box.fB ? ` · fB ${fmtFreq(box.fB)}` : ""}`;
  const { x, y } = layout.boxLabel;
  const w = Math.max(60, text.length * 6.1 + 18);
  return (
    <g {...props} className="sc-item sc-boxlabel">
      <rect className="sc-hit sc-box-pill" x={x - w / 2} y={y - 11} width={w} height={15} rx={7.5} />
      <text className="sc-box-text" x={x} y={y} textAnchor="middle">{text}</text>
    </g>
  );
}

function Part({ part: p, selected, compact, props }: { part: PartGlyph; selected: boolean; compact: boolean; props: ItemProps }) {
  const transform = p.pos === "series" ? `translate(${p.x - p.len / 2},${p.y})` : `translate(${p.x},${p.y}) rotate(90)`;
  const value = fmtValue(p.value, p.kind);
  return (
    <g {...props} className={"sc-item sc-part" + (selected ? " is-selected" : "") + (p.role !== "topo" ? " is-optional" : "")}
       style={{ ["--sc-tone" as string]: TONE_VAR[p.unit] }}>
      <rect className="sc-hit" x={p.hit.x} y={p.hit.y} width={p.hit.w} height={p.hit.h} rx={6} />
      <g transform={transform}><PartSymbol kind={p.kind} len={p.len} /></g>
      {p.pos === "series" ? (
        <text className="sc-val" x={p.text.x} y={p.text.y} textAnchor="middle">
          <tspan className="sc-name">{p.name}</tspan><tspan dx={compact ? 4 : 5}>{value}</tspan>
        </text>
      ) : p.role === "zobel" ? (
        <text className="sc-val" x={p.text.x} y={p.text.y + (compact ? 3 : 4)}>
          <tspan className="sc-name">{p.name}</tspan><tspan dx={compact ? 3 : 4}>{value}</tspan>
        </text>
      ) : (
        <text className="sc-val" x={p.text.x} y={p.text.y - (compact ? 1.5 : 2)}>
          <tspan className="sc-name">{p.name}</tspan>
          <tspan x={p.text.x} dy={compact ? 9.5 : 13}>{value}</tspan>
        </text>
      )}
    </g>
  );
}

function Driver({ unit, x, y, compact, size, live, pol, model, selected, props, onWalk, onFlip }: {
  unit: UnitId; x: number; y: number; compact: boolean; size: number; live: LiveChain | null; pol: 1 | -1; model?: string;
  selected: boolean; props: ItemProps; onWalk(e: KeyboardEvent<SVGGElement>): void; onFlip(): void;
}) {
  const rel = live?.relDb[unit] ?? null;
  const lx = x + Math.round(32 * size) + 4;
  const short = model && model.length > 30 ? model.slice(0, 29) + "…" : model;
  const inverted = pol < 0;
  const pr = compact ? 5.5 : 7;
  const px = x - (compact ? 11 : 14), py = y - (compact ? 9 : 14);
  return (
    <g style={{ ["--sc-tone" as string]: TONE_VAR[unit] }}>
      <g {...props} className={"sc-item sc-driver" + (selected ? " is-selected" : "")}>
        <rect className="sc-hit" x={x - 4} y={y - 22 * size} width={lx - x + (compact ? 108 : 158)} height={44 * size} rx={compact ? 5 : 7} />
        <Speaker x={x} y={y} size={size} />
        <text className="sc-caps sc-driver-name" x={lx} y={y - (compact ? 2 : 6)}>{UNIT_NAME[unit]}</text>
        <text className="sc-val" x={lx} y={y + (compact ? 9 : 8)}>
          {rel === null ? "—" : fmtDb(rel, { sign: true })}<tspan className="sc-dim-text"> re system</tspan>
        </text>
        {!compact && short && <text className="sc-dim-text sc-small" x={lx} y={y + 21}>{short}</text>}
      </g>
      <g className={"sc-item sc-pol" + (inverted ? " is-inverted" : "")} role="switch" tabIndex={0} aria-checked={inverted} data-sc-item=""
         aria-label={`Invert ${UNIT_NAME[unit].toLowerCase()} polarity`} {...press(onFlip, onWalk)}>
        <title>{inverted ? "Inverted: click to connect normally" : "Normal polarity: click to invert"}</title>
        <circle className="sc-hit sc-pol-dot" cx={px} cy={py} r={pr} />
        <path className="sc-pol-glyph" d={inverted ? `M${px - pr / 2},${py} H${px + pr / 2}` : `M${px - pr / 2},${py} H${px + pr / 2} M${px},${py - pr / 2} V${py + pr / 2}`} />
      </g>
    </g>
  );
}

function BranchTools({ unit, x, y, compact, topo, pad, zobel, onTopo, onPad, onZobel, onWalk }: {
  unit: E.BranchUnit; x: number; y: number; compact: boolean; topo: string; pad: boolean; zobel: boolean;
  onTopo(key: string): void; onPad(): void; onZobel(): void; onWalk(e: KeyboardEvent<SVGGElement>): void;
}) {
  const keys = E.topologyKeys(unit);
  // compact: order buttons and add chips on one line under the wire; full: chips on a second line
  const bw = compact ? 25 : 30, bh = compact ? 13 : 17, gap = 2;
  const y1 = y + (compact ? 5 : 9), y2 = compact ? y1 : y1 + bh + 6;
  const chipW = compact ? 46 : 58;
  const chipX0 = compact ? x + keys.length * (bw + gap) + 5 : x;
  const name = UNIT_NAME[unit].toLowerCase();
  const chips: { key: string; label: string; hint: string; run(): void }[] = [];
  if (!pad) chips.push({ key: "pad", label: "L-pad", hint: `Add an L-pad (series Rs, parallel Rp) to lower the ${name} level`, run: onPad });
  if (!zobel) chips.push({ key: "zobel", label: "Zobel", hint: `Add a Zobel (R + C across the ${name}) to flatten its impedance`, run: onZobel });
  return (
    <g className="sc-tools" style={{ ["--sc-tone" as string]: TONE_VAR[unit] }}>
      <text className="sc-caps sc-branch-name" x={x} y={y - (compact ? 6 : 10)}>
        {UNIT_NAME[unit]}<tspan className="sc-dim-text"> · {unit === "mid" ? "low-pass" : "high-pass"}</tspan>
      </text>
      <g role="radiogroup" aria-label={`${UNIT_NAME[unit]} filter order`}>
        {keys.map((k, i) => {
          const on = k === topo;
          const bx = x + i * (bw + gap);
          return (
            <g key={k} className={"sc-item sc-seg" + (on ? " is-on" : "")} role="radio" aria-checked={on} tabIndex={0} data-sc-item=""
               aria-label={`${UNIT_NAME[unit]} filter, ${ORDER_LABEL[i] ?? k} order`} {...press(() => { if (!on) onTopo(k); }, onWalk)}>
              <title>{`${ORDER_LABEL[i] ?? k} order, ${6 * (i + 1)} dB/oct`}</title>
              <rect className="sc-hit sc-seg-box" x={bx} y={y1} width={bw} height={bh} rx={4} />
              <text className="sc-seg-text" x={bx + bw / 2} y={y1 + bh / 2 + (compact ? 3 : 3.5)} textAnchor="middle">{ORDER_LABEL[i] ?? k}</text>
            </g>
          );
        })}
      </g>
      {chips.map((c, i) => {
        const cx = chipX0 + i * (chipW + 3);
        return (
          <g key={c.key} className="sc-item sc-chip" role="button" tabIndex={0} aria-label={c.hint} data-sc-item="" {...press(c.run, onWalk)}>
            <title>{c.hint}</title>
            <rect className="sc-hit sc-chip-box" x={cx} y={y2} width={chipW} height={bh} rx={bh / 2} />
            <text className="sc-chip-text" x={cx + chipW / 2} y={y2 + bh / 2 + (compact ? 3 : 3.5)} textAnchor="middle">+ {c.label}</text>
          </g>
        );
      })}
    </g>
  );
}
