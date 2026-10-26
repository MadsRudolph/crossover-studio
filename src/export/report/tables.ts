// Report pack, part 1: the value model and the tables. Every number is a Cell that carries its unit, so the
// LaTeX writer can set it with siunitx, the Markdown writer as "22.6 Hz" and the quiz sheet as plain text,
// all from one value. The tables of each report section are built here from the engine's results.

import type { Assessment, BoxFitEx, Prepared } from "../../engine";
import { GROUPS, TOPOLOGY_LIBRARY, ALIGNMENTS } from "../../engine";
import type { Design, Profile, Results } from "../../types";
import { bom, type BomKind } from "../parts";

// ---------------------------------------------------------------- units
export interface Unit {
  /** Markdown and screen text, e.g. "Ω", "µF", "kg/m⁴". */
  md: string;
  /** Plain ASCII for the quiz sheet (DTU forms): "ohm", "uF", "kg/m^4". */
  plain: string;
  /** siunitx unit argument, e.g. "\\ohm". */
  tex: string;
  /** LaTeX set after the \SI{}{} (a reference: " re \\SI{1}{\\pascal\\per\\volt}"). */
  texAfter?: string;
}

const u = (md: string, plain: string, tex: string, texAfter?: string): Unit => ({ md, plain, tex, texAfter });
export const UNITS = {
  Hz: u("Hz", "Hz", "\\hertz"),
  dB: u("dB", "dB", "\\decibel"),
  dBPaV: u("dB re 1 Pa/V", "dB re 1 Pa/V", "\\decibel", " re \\SI{1}{\\pascal\\per\\volt}"),
  ohm: u("Ω", "ohm", "\\ohm"),
  litre: u("L", "L", "\\litre"),
  mm: u("mm", "mm", "\\milli\\metre"),
  gram: u("g", "g", "\\gram"),
  Tm: u("T m", "T m", "\\tesla\\metre"),
  mH: u("mH", "mH", "\\milli\\henry"),
  uF: u("µF", "uF", "\\micro\\farad"),
  kgm4: u("kg/m⁴", "kg/m^4", "\\kilo\\gram\\per\\metre\\tothe{4}"),
  percent: u("%", "%", "\\percent"),
} as const;

// ---------------------------------------------------------------- cells, tables
/** Why a number may stand without a unit: a quality factor, a 0-100 score. Nothing else may. */
export type Unitless = "Q" | "score";

export type Cell =
  | { kind: "text"; text: string }
  | { kind: "num"; value: number; unit: Unit | null; unitless?: Unitless;
      /** Decimals (fixed), or significant digits with trailing zeros dropped when `sig` is set. */
      digits: number; sig?: boolean; sign?: boolean;
      /** Short remark after the value, e.g. "estimated". */
      note?: string };

export const txt = (text: string): Cell => ({ kind: "text", text });
export const num = (value: number, unit: Unit | null, digits = 1, o: { sig?: boolean; sign?: boolean; note?: string; unitless?: Unitless } = {}): Cell =>
  ({ kind: "num", value, unit, digits, ...o });

/** The number of a num cell as text, ASCII: fixed decimals or trimmed significant digits, never "-0". */
export function numText(c: Extract<Cell, { kind: "num" }>): string {
  if (!Number.isFinite(c.value)) return "n/a";
  let s = c.sig ? String(Number(c.value.toPrecision(c.digits))) : c.value.toFixed(c.digits);
  if (/^-0(\.0*)?$/.test(s)) s = s.slice(1);
  if (c.sign && c.value > 0 && !/^0(\.0*)?$/.test(s)) s = "+" + s;
  return s;
}

/** A cell as Markdown / screen text ("22.6 Hz") or as plain ASCII for the quiz ("22.6 Hz", "4.7 ohm"). */
export function cellText(c: Cell, mode: "md" | "plain" = "md"): string {
  if (c.kind === "text") return c.text;
  const n = numText(c);
  const unit = c.unit && Number.isFinite(c.value) ? ` ${mode === "md" ? c.unit.md : c.unit.plain}` : "";
  return n + unit + (c.note ? ` (${c.note})` : "");
}

export type Align = "l" | "r" | { p: number };

export interface Column {
  head: string;
  align: Align;
  /** Free prose from the engine (a check's detail): may hold numbers in running text. */
  prose?: boolean;
}

export interface QuizRef { name: string; col: number }

export interface Row {
  cells: Cell[];
  /** Name(s) of this row's number(s) on the quiz sheet, and which cell holds each. */
  quiz?: QuizRef | QuizRef[];
}

export interface Table {
  /** Stable id: LaTeX label tab:xs-<id>. */
  id: string;
  caption: string;
  columns: Column[];
  rows: Row[];
}

const PARAM_COLS: Column[] = [{ head: "Quantity", align: "l" }, { head: "Symbol", align: "l" }, { head: "Value", align: "r" }];
/** A three-column quantity / symbol / value row whose value goes on the quiz sheet under `symbol`. */
const param = (label: string, symbol: string, value: Cell, quizName = symbol): Row =>
  ({ cells: [txt(label), txt(symbol), value], quiz: { name: quizName, col: 2 } });

// ---------------------------------------------------------------- the inputs every section reads
export interface ReportInput {
  profile: Profile;
  prep: Prepared;
  design: Design;
  results: Results;
  assessment: Assessment;
  designName: string;
}

const BOX_MODE: Record<Design["box"]["mode"], string> = {
  plugged: "closed (vents plugged)", one: "vented, one vent", two: "vented, two vents",
};

// ---------------------------------------------------------------- 1. woofer box
export function boxTables(x: ReportInput): Table[] {
  const fit = x.prep.fit as BoxFitEx, ts = fit.ts, d = fit.drv, box = x.design.box, res = x.results.box;
  const tsTable: Table = {
    id: "box-ts", caption: "Woofer parameters fitted to the Lab D impedance measurements (free air, closed and vented box).",
    columns: PARAM_COLS,
    rows: [
      param("Resonance frequency", "f_s", num(ts.fs, UNITS.Hz, 1)),
      param("Mechanical quality factor", "Q_ms", num(ts.Qms, null, 2, { unitless: "Q" })),
      param("Electrical quality factor", "Q_es", num(ts.Qes, null, 3, { unitless: "Q" })),
      param("Total quality factor", "Q_ts", num(ts.Qts, null, 3, { unitless: "Q" })),
      param("Equivalent compliance volume", "V_as", num(ts.Vas_L, UNITS.litre, 1)),
      param("Moving mass incl. air load", "M_ms", num(ts.Mms * 1e3, UNITS.gram, 1)),
      param("Force factor", "Bl", num(d.Bl, UNITS.Tm, 2)),
      param("Voice-coil resistance", "R_E", num(fit.RE, UNITS.ohm, 2)),
      param("Voice-coil inductance", "L_E", num(d.Le * 1e3, UNITS.mH, 2)),
    ],
  };

  const wb = x.profile.woofer_box, ventA = wb.vents[0], ventB = wb.vents[1];
  const rows: Row[] = [{ cells: [txt("Box setting"), txt("mode"), txt(BOX_MODE[box.mode] ?? box.mode)] }];
  const open = (box.mode === "one" || box.mode === "two") && ventA;
  if (open) {
    rows.push(param(`Vent ${ventA.id} length`, "L_A", num(box.L * 1e3, UNITS.mm, 0)));
    rows.push(param(`Vent ${ventA.id} inner diameter`, "d_A", num(ventA.diameter_m * 1e3, UNITS.mm, 0, { note: ventA.estimated ? "estimated" : undefined })));
  }
  if (box.mode === "two" && ventB) {
    const est = ventB.estimated && Math.abs(box.a2 * 2 - ventB.diameter_m) < 1e-9;
    rows.push(param(`Vent ${ventB.id} length`, "L_B", num(box.L2 * 1e3, UNITS.mm, 0)));
    rows.push(param(`Vent ${ventB.id} inner diameter`, "d_B", num(box.a2 * 2e3, UNITS.mm, 0, { note: est ? "estimated" : undefined })));
  }
  rows.push(param("Effective box volume (filling)", "fill", num(res.fill * 100, UNITS.percent, 0)));
  if (res.MAP) rows.push(param("Acoustic vent mass", "M_AP", num(res.MAP, UNITS.kgm4, 1)));
  if (res.fB) rows.push(param("Box tuning frequency", "f_B", num(res.fB, UNITS.Hz, 1)));
  rows.push(param("Lower -3 dB frequency", "f_3", num(res.f3, UNITS.Hz, 1)));
  rows.push(param("Bass ripple above the 150-300 Hz level", "ripple", num(res.ripple, UNITS.dB, 1, { sign: true })));
  const boxTable: Table = { id: "box-setting", caption: `Woofer box as designed (${res.label}).`, columns: PARAM_COLS, rows };

  const out = [tsTable, boxTable];
  if (fit.ventFits?.length) out.push({
    id: "box-vents", caption: "Effective vent mass fitted to each measured vent length (Lab D), and the box tuning it gives.",
    columns: [{ head: "Measured vents", align: "l" }, { head: "M_AP", align: "r" }, { head: "f_B", align: "r" }],
    rows: fit.ventFits.map(v => ({
      cells: [txt(v.label), num(v.MAP, UNITS.kgm4, 1), num(v.fB, UNITS.Hz, 1)], quiz: [{ name: `M_AP(${v.label})`, col: 1 }, { name: `f_B(${v.label})`, col: 2 }],
    })),
  });
  return out;
}

// ---------------------------------------------------------------- 2. digital crossover
export function alignName(a: Design["digital"]["align"]): string {
  const m = ALIGNMENTS.find(x => x.key === a);
  return m ? `${a} (${m.name})` : a;
}
const polText = (p: 1 | -1) => (p === 1 ? "normal (+)" : "inverted (-)");

export function digitalTables(x: ReportInput): Table[] {
  const dg = x.design.digital, pol = x.design.pol;
  return [{
    id: "digital", caption: "MiniDSP crossover (RBJ biquads at 96 kHz, as DigitalCrossover.m) and polarities.",
    columns: PARAM_COLS,
    rows: [
      param("Crossover frequency", "f_c", num(dg.fc, UNITS.Hz, 0)),
      { cells: [txt("Alignment"), txt("align"), txt(alignName(dg.align))], quiz: { name: "alignment", col: 2 } },
      param("Woofer gain (output 1)", "g_woof", num(dg.g_woof_dB, UNITS.dB, 1, { sign: true })),
      { cells: [txt("Woofer polarity"), txt("pol_woof"), txt(polText(pol.woof))], quiz: { name: "pol_woof", col: 2 } },
      { cells: [txt("Midrange polarity"), txt("pol_mid"), txt(polText(pol.mid))], quiz: { name: "pol_mid", col: 2 } },
      { cells: [txt("Tweeter polarity"), txt("pol_tw"), txt(polText(pol.tw))], quiz: { name: "pol_tw", col: 2 } },
    ],
  }];
}

// ---------------------------------------------------------------- 3. passive crossover
const PART_UNIT: Record<BomKind, Unit> = { L: UNITS.mH, C: UNITS.uF, R: UNITS.ohm };
const PART_SCALE: Record<BomKind, number> = { L: 1e3, C: 1e6, R: 1 };
export const partCell = (kind: BomKind, v: number): Cell => num(v * PART_SCALE[kind], PART_UNIT[kind], 4, { sig: true });

/** "2nd order low-pass (series L, shunt C, 12 dB/oct) + L-pad + Zobel". */
export function topologyText(design: Design, unit: "mid" | "tw"): string {
  const b = design[unit], t = TOPOLOGY_LIBRARY[b.topo];
  const base = t ? `${t.name} ${t.type === "LP" ? "low-pass" : "high-pass"} (${t.description})` : b.topo;
  const extra = [b.pad?.Rs || b.pad?.Rp ? "L-pad" : "", b.zobel && b.zobel.R > 0 && b.zobel.C > 0 ? "Zobel" : ""].filter(Boolean);
  return [base, ...extra].join(" + ");
}

export function passiveTables(x: ReportInput): Table[] {
  const rows = bom(x.profile, x.design);
  return [
    {
      id: "passive-topo", caption: "Passive crossover topologies (the boards between amplifier channel 2 and the drivers).",
      columns: [{ head: "Board", align: "l" }, { head: "Topology", align: "l" }],
      rows: [
        { cells: [txt("Midrange"), txt(topologyText(x.design, "mid"))], quiz: { name: "topology_mid", col: 1 } },
        { cells: [txt("Tweeter"), txt(topologyText(x.design, "tw"))], quiz: { name: "topology_tw", col: 1 } },
      ],
    },
    {
      id: "passive-bom", caption: x.design.Rdcr > 0
        ? `Parts list. Inductors modelled with ${x.design.Rdcr} ohm per mH coil resistance.`
        : "Parts list, in ladder order from the amplifier to the driver. Basket: in the course component list.",
      columns: [{ head: "Ref", align: "l" }, { head: "Value", align: "r" }, { head: "Role", align: "l" }, { head: "Board", align: "l" }, { head: "Basket", align: "l" }],
      rows: rows.map(r => ({
        cells: [txt(r.ref), partCell(r.kind, r.value), txt(r.role), txt(r.board), txt(r.source === "basket" ? "yes" : "no")],
        quiz: { name: r.ref, col: 1 },
      })),
    },
  ];
}

// ---------------------------------------------------------------- 4. system response
const hz = (v: number | null) => (v === null ? txt("no crossing") : num(v, UNITS.Hz, 0));

export function responseTables(x: ReportInput): Table[] {
  const m = x.results.metrics, off = m.offAngle ?? "30";
  const rows: Row[] = [
    param("On-axis level, median 150 Hz-15 kHz", "level_0", num(m.on.level, UNITS.dBPaV, 1)),
    param("On-axis spread, 150 Hz-15 kHz, 1/6 octave", "spread_0", num(m.on.spread, UNITS.dB, 1)),
    param("On-axis deviation, rms", "rms_0", num(m.on.rms, UNITS.dB, 2)),
  ];
  if (m.off30) rows.push(
    param(`${off} deg spread, 150 Hz-15 kHz, 1/6 octave`, `spread_${off}`, num(m.off30.spread, UNITS.dB, 1)),
    param(`${off} deg level, median`, `level_${off}`, num(m.off30.level, UNITS.dBPaV, 1)),
  );
  rows.push(
    { cells: [txt("Acoustic crossover woofer/midrange"), txt("x_wm"), hz(m.x_wm)], quiz: { name: "x_wm", col: 2 } },
    { cells: [txt("Acoustic crossover midrange/tweeter"), txt("x_mt"), hz(m.x_mt)], quiz: { name: "x_mt", col: 2 } },
    param("Minimum load of amplifier channel 2, 200 Hz-15 kHz", "Z_min", num(m.Zamp2_min, UNITS.ohm, 2)),
  );
  return [{ id: "response", caption: "System response metrics (measured drivers, simulated crossover).", columns: PARAM_COLS, rows }];
}

// ---------------------------------------------------------------- 6. checks and verdict
const STATE: Record<string, string> = { good: "pass", warn: "warning", bad: "fail" };

/** Weighted score (0-100) of each criterion group, in GROUPS order; groups without weight are left out. */
export function groupScores(a: Assessment): { id: string; title: string; score: number }[] {
  return GROUPS.flatMap(g => {
    const cs = a.criteria.filter(c => c.group === g.id && c.weight > 0);
    const w = cs.reduce((s, c) => s + c.weight, 0);
    return w > 0 ? [{ id: g.id, title: g.title, score: Math.round(100 * cs.reduce((s, c) => s + c.weight * c.score, 0) / w) }] : [];
  });
}

export function checkTables(x: ReportInput): Table[] {
  const a = x.assessment;
  return [
    {
      id: "checks", caption: "Design checks (the thresholds of the app's Check panel).",
      columns: [{ head: "State", align: "l" }, { head: "Check", align: "l" }, { head: "Detail", align: { p: 0.5 }, prose: true }],
      rows: x.results.checks.map(c => ({ cells: [txt(STATE[c.state] ?? c.state), txt(c.title), txt(c.detail)] })),
    },
    {
      id: "verdict", caption: `Verdict: ${a.rating}. ${a.headline}`,
      columns: [{ head: "Group", align: "l" }, { head: "Score (of 100)", align: "r" }],
      rows: [
        ...groupScores(a).map(g => ({ cells: [txt(g.title), num(g.score, null, 0, { unitless: "score" })], quiz: { name: `score_${g.id}`, col: 1 } })),
        { cells: [txt("Overall"), num(a.score, null, 0, { unitless: "score" })], quiz: { name: "score", col: 1 } },
      ],
    },
  ];
}
