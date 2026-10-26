// Auto-layout of the signal chain from the design. Pure geometry (SVG user units = CSS px at scale 1),
// so it can be tested without a DOM and the renderer stays a thin drawing layer.
//
//   IN ─[ MiniDSP  OUT1 LP ]─▷ ch1 ───────────────────────────── woofer
//       [          OUT2 HP ]─▷ ch2 ─┬─ midrange label ─ L1 ─┬─ ─ midrange
//                                   │  tools              C1
//                                   └─ tweeter label ── C1 ─┬─ ─ tweeter
//                                      tools               L1
//
// Two densities share one topology: "full" for a large panel, "compact" for the bottom dock
// (about 130 px tall, so the default 160 px dock shows it at full size).
import { TOPOLOGY_LIBRARY } from "../engine";
import type { Design, PassiveBranch } from "../types";
import type { BranchUnit, PartKind } from "./edits";
import type { SignalKey } from "./live";

export type Pt = [number, number];
export type Tone = "woof" | "mid" | "tw" | "neutral";
export type Mode = "full" | "compact";

export interface Metrics {
  woofY: number;
  /** Woofer row to midrange row. */
  rowGap: number;
  /** Shunt drop: lead from the junction, symbol length, tail, ground symbol height. */
  lead: number;
  sym: number;
  tail: number;
  groundH: number;
  /** Clear space between the midrange grounds and the tweeter row. */
  twGap: number;
  bottom: number;
  dspW: number;
  /** MiniDSP block extent above the woofer row and below the high-pass row. */
  dspPad: number;
  ampW: number;
  ampGap: number;
  /** Amplifier channel 2 output to the bus that feeds both branches. */
  busGap: number;
  /** Space on each branch row before the first part, holding the branch name and its tools. */
  gutter: number;
  /** Tools on one line (compact) or the order buttons over the add chips (full). */
  toolsInline: boolean;
  series: number;
  shunt: number;
  /** Half length of a series symbol. */
  half: number;
  /** Speaker symbol scale and the width of its label. */
  spk: number;
  spkLabelW: number;
  /** Board outline above the midrange row and below the tweeter grounds. */
  boardTop: number;
  boardBottom: number;
  /** Series value label above the wire, node tags below it. */
  labelDy: number;
  tagDy: number;
  termTagDy: number;
  hitAbove: number;
  hitBelow: number;
  /** Width a shunt value label takes right of its drop; extra slot room when a shunt follows a shunt. */
  shuntLabelW: number;
  shuntExtra: number;
  /** Width the terminal tag needs before a speaker. */
  termTagW: number;
}

export const METRICS: Record<Mode, Metrics> = {
  full: {
    woofY: 46, rowGap: 82, lead: 8, sym: 38, tail: 6, groundH: 8, twGap: 38, bottom: 14,
    dspW: 156, dspPad: 26, ampW: 30, ampGap: 22, busGap: 52, gutter: 156, toolsInline: false,
    series: 88, shunt: 56, half: 24, spk: 1, spkLabelW: 190, boardTop: 38, boardBottom: 8,
    labelDy: 14, tagDy: 22, termTagDy: 15, hitAbove: 28, hitBelow: 16, shuntLabelW: 58, shuntExtra: 14, termTagW: 22,
  },
  compact: {
    woofY: 17, rowGap: 36, lead: 3, sym: 20, tail: 2, groundH: 7, twGap: 9, bottom: 3,
    dspW: 150, dspPad: 13, ampW: 22, ampGap: 14, busGap: 44, gutter: 184, toolsInline: true,
    series: 74, shunt: 50, half: 18, spk: 0.72, spkLabelW: 122, boardTop: 22, boardBottom: 2,
    labelDy: 8, tagDy: 13, termTagDy: 11, hitAbove: 18, hitBelow: 12, shuntLabelW: 50, shuntExtra: 12, termTagW: 18,
  },
};

export interface Wire {
  key: string;
  pts: Pt[];
  tone: Tone;
  /** Which voltage the wire carries (its weight follows it); "gnd" = return leads, drawn static. */
  signal: SignalKey | "gnd";
  /** Animated flow dashes along the wire (main signal path only). */
  flow: boolean;
}

export type PartRole = "topo" | "pad" | "zobel";

export interface PartGlyph {
  /** Focus id, as the inspector names it: "mid.L1", "tw.pad.Rs", "mid.zobel.R". */
  id: string;
  unit: BranchUnit;
  /** Short name drawn next to the symbol: "L1", "Rs", "R". */
  name: string;
  kind: PartKind;
  role: PartRole;
  pos: "series" | "shunt";
  /** Series: symbol centre on the row. Shunt: the symbol's top centre (below the junction). */
  x: number;
  y: number;
  /** Symbol length along its axis. */
  len: number;
  value: number;
  /** Human description, e.g. "Series L (amp side)". */
  label: string;
  /** Voltage after the part (series), or across it (shunt: the junction voltage). */
  signal: SignalKey;
  hit: { x: number; y: number; w: number; h: number };
  text: { x: number; y: number; anchor: "start" | "middle" | "end" };
}

export interface NodeTag { key: string; signal: SignalKey; x: number; y: number; anchor: "start" | "middle" | "end"; tone: Tone }

export interface BranchLayout {
  unit: BranchUnit;
  y: number;
  /** The bus x, where the gutter starts. */
  gx: number;
  /** First part slot. */
  x0: number;
  /** End of the last part slot. */
  xEnd: number;
}

export interface ChainLayout {
  mode: Mode;
  m: Metrics;
  width: number;
  height: number;
  rows: Record<"woof" | "mid" | "tw", number>;
  input: { x: number; y: number };
  dsp: { x: number; y: number; w: number; h: number; inY: number };
  amps: { ch: 1 | 2; x: number; y: number; w: number }[];
  speakers: { unit: "woof" | "mid" | "tw"; x: number; y: number }[];
  board: { x: number; y: number; w: number; h: number };
  boxLabel: { x: number; y: number };
  wires: Wire[];
  parts: PartGlyph[];
  tags: NodeTag[];
  grounds: Pt[];
  junctions: { x: number; y: number; tone: Tone }[];
  branches: BranchLayout[];
}

interface Element { pos: "series" | "shunt"; kind: PartKind | "RC"; name: string; id: string; role: PartRole; label: string; value: number | [number, number] }

/** The branch's elements in ladder order (topology, then the L-pad, then the Zobel), as the engine builds it. */
export function branchElements(b: PassiveBranch, unit: BranchUnit): Element[] {
  const t = TOPOLOGY_LIBRARY[b.topo];
  const out: Element[] = (t?.parts ?? []).map(p => ({
    pos: p.pos, kind: p.kind, name: p.name, id: `${unit}.${p.name}`, role: "topo" as const, label: p.label, value: b.vals[p.name] ?? 0,
  }));
  if (b.pad?.Rs) out.push({ pos: "series", kind: "R", name: "Rs", id: `${unit}.pad.Rs`, role: "pad", label: "L-pad series R", value: b.pad.Rs });
  if (b.pad?.Rp) out.push({ pos: "shunt", kind: "R", name: "Rp", id: `${unit}.pad.Rp`, role: "pad", label: "L-pad parallel R", value: b.pad.Rp });
  if (b.zobel && b.zobel.R > 0 && b.zobel.C > 0) {
    out.push({ pos: "shunt", kind: "RC", name: "Zobel", id: `${unit}.zobel`, role: "zobel", label: "Zobel", value: [b.zobel.R, b.zobel.C] });
  }
  return out;
}

export function layoutChain(design: Design, mode: Mode): ChainLayout {
  const m = METRICS[mode];
  const drop = m.lead + m.sym + m.tail + m.groundH;
  const woofY = m.woofY;
  const midY = woofY + m.rowGap;
  const twY = midY + drop + m.twGap;
  const inY = Math.round((woofY + midY) / 2);

  const wires: Wire[] = [], parts: PartGlyph[] = [], tags: NodeTag[] = [], grounds: Pt[] = [];
  const junctions: ChainLayout["junctions"] = [];
  const wire = (key: string, pts: Pt[], tone: Tone, signal: Wire["signal"], flow = true) => wires.push({ key, pts, tone, signal, flow });

  // ---- source, MiniDSP, amplifiers
  const input = { x: 20, y: inY };
  const dspX = 44, dspX1 = dspX + m.dspW;
  const dsp = { x: dspX, y: woofY - m.dspPad, w: m.dspW, h: midY - woofY + 2 * m.dspPad, inY };
  wire("in", [[input.x + 9, inY], [dspX, inY]], "neutral", "in");
  const ampX = dspX1 + m.ampGap, ampOut = ampX + m.ampW;
  const amps: ChainLayout["amps"] = [{ ch: 1, x: ampX, y: woofY, w: m.ampW }, { ch: 2, x: ampX, y: midY, w: m.ampW }];
  wire("dsp.out1", [[dspX1, woofY], [ampX, woofY]], "woof", "woof");
  wire("dsp.out2", [[dspX1, midY], [ampX, midY]], "neutral", "hp");
  tags.push({ key: "tag.in", signal: "in", x: input.x, y: inY + (mode === "compact" ? 19 : 24), anchor: "middle", tone: "neutral" });

  // ---- passive branches
  const busX = ampOut + m.busGap;
  wire("amp2.out", [[ampOut, midY], [busX, midY]], "neutral", "hp");
  wire("bus", [[busX, midY], [busX, twY]], "neutral", "hp");
  junctions.push({ x: busX, y: midY, tone: "neutral" });
  tags.push({ key: "tag.hp", signal: "hp", x: ampOut + 4, y: midY + m.termTagDy, anchor: "start", tone: "neutral" });

  const branches: BranchLayout[] = [];
  // x = where the last part slot ends; clear = how far right the speaker must sit so labels and tags do not collide
  const ends: Record<BranchUnit, { x: number; clear: number }> = { mid: { x: 0, clear: 0 }, tw: { x: 0, clear: 0 } };
  for (const [unit, y] of [["mid", midY], ["tw", twY]] as const) {
    const tone: Tone = unit;
    const x0 = busX + m.gutter;
    wire(`${unit}.feed`, [[busX, y], [x0, y]], tone, "hp");
    const els = branchElements(design[unit], unit);
    let x = x0, signal: SignalKey = "hp", labelRight = 0;
    els.forEach((el, k) => {
      if (el.pos === "series") {
        const slot = m.series, cx = x + slot / 2;
        const after = el.id;
        wire(`${el.id}.a`, [[x, y], [cx - m.half, y]], tone, signal);
        wire(`${el.id}.b`, [[cx + m.half, y], [x + slot, y]], tone, after);
        parts.push({
          id: el.id, unit, name: el.name, kind: el.kind as PartKind, role: el.role, pos: "series", x: cx, y, len: 2 * m.half,
          value: el.value as number, label: el.label, signal: after,
          hit: { x: x + 6, y: y - m.hitAbove, w: slot - 12, h: m.hitAbove + m.hitBelow },
          text: { x: cx, y: y - m.labelDy, anchor: "middle" },
        });
        // a node tag only where the voltage differs from the driver terminal shown at the speaker
        if (els.slice(k + 1).some(e => e.pos === "series")) {
          tags.push({ key: `tag.${after}`, signal: after, x: x + slot - 3, y: y + m.tagDy, anchor: "end", tone });
        }
        signal = after;
        x += slot;
      } else {
        // a shunt followed by another shunt needs room for its value label before the next drop
        const slot = m.shunt + (els[k + 1]?.pos === "shunt" ? m.shuntExtra : 0);
        const jx = x + Math.round(m.shunt * 0.36), top = y + m.lead;
        labelRight = Math.max(labelRight, jx + m.shuntLabelW);
        wire(`${el.id}.h`, [[x, y], [x + slot, y]], tone, signal);
        wire(`${el.id}.lead`, [[jx, y], [jx, top]], tone, signal, false);
        wire(`${el.id}.tail`, [[jx, top + m.sym], [jx, top + m.sym + m.tail]], "neutral", "gnd", false);
        junctions.push({ x: jx, y, tone });
        grounds.push([jx, top + m.sym + m.tail]);
        const hit = { x: jx - 10, y: top - 2, w: slot - 8, h: m.sym + 4 };
        if (el.kind === "RC") {
          // the Zobel's R over its C on one drop; each half is its own part so either can be edited
          const [R, C] = el.value as [number, number];
          const rLen = Math.round(m.sym * 0.56), cLen = m.sym - rLen;
          parts.push({ id: `${el.id}.R`, unit, name: "R", kind: "R", role: "zobel", pos: "shunt", x: jx, y: top, len: rLen, value: R,
                       label: "Zobel R", signal, hit: { ...hit, h: rLen + 2 }, text: { x: jx + 9, y: top + rLen / 2, anchor: "start" } });
          parts.push({ id: `${el.id}.C`, unit, name: "C", kind: "C", role: "zobel", pos: "shunt", x: jx, y: top + rLen, len: cLen, value: C,
                       label: "Zobel C", signal, hit: { ...hit, y: top + rLen + 2, h: cLen + 2 }, text: { x: jx + 9, y: top + rLen + cLen / 2 + 1, anchor: "start" } });
        } else {
          parts.push({ id: el.id, unit, name: el.name, kind: el.kind as PartKind, role: el.role, pos: "shunt", x: jx, y: top, len: m.sym,
                       value: el.value as number, label: el.label, signal, hit, text: { x: jx + 9, y: top + m.sym / 2, anchor: "start" } });
        }
        x += slot;
      }
    });
    ends[unit] = { x, clear: Math.max(x, labelRight + m.termTagW) };
    branches.push({ unit, y, gx: busX, x0, xEnd: x });
  }

  // ---- drivers in one column, far enough right for the longest branch
  const minRun = busX + m.gutter + 2 * m.series;
  const spkX = Math.max(minRun, ends.mid.clear + 30, ends.tw.clear + 30);
  wire("woof.run", [[ampOut, woofY], [spkX, woofY]], "woof", "woof");
  tags.push({ key: "tag.woof", signal: "woof", x: ampOut + 4, y: woofY + m.termTagDy, anchor: "start", tone: "woof" });
  for (const [unit, y] of [["mid", midY], ["tw", twY]] as const) {
    wire(`${unit}.run`, [[ends[unit].x, y], [spkX, y]], unit, `${unit}.term`);
    tags.push({ key: `tag.${unit}.term`, signal: `${unit}.term`, x: spkX - 6, y: y + m.termTagDy, anchor: "end", tone: unit });
  }
  const speakers: ChainLayout["speakers"] = [
    { unit: "woof", x: spkX, y: woofY }, { unit: "mid", x: spkX, y: midY }, { unit: "tw", x: spkX, y: twY },
  ];

  const boardTop = midY - m.boardTop;
  const board = { x: busX - 12, y: boardTop, w: spkX - 14 - (busX - 12), h: twY + drop + m.boardBottom - boardTop };
  const width = Math.ceil(spkX + 32 * m.spk + m.spkLabelW);
  const height = Math.ceil(board.y + board.h + m.bottom);

  return {
    mode, m, width, height, rows: { woof: woofY, mid: midY, tw: twY }, input, dsp, amps, speakers, board,
    boxLabel: { x: Math.round((ampOut + spkX) / 2), y: woofY - (mode === "compact" ? 6 : 10) },
    wires, parts, tags, grounds, junctions, branches,
  };
}
