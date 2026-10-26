// LTspice export: the whole three-way system as a ready-to-run folder.
//
// Port of the project's gen_system.py / gen_templates.py layout (Figure 1 of the 2026 project guide):
//   Vin -> E_LP1 -> E_LP2 -> lp2 -> [box ratio, Box_woof.txt] -> Vspkr_woof -> TF_woof -> Pout_woof
//   Vin -> E_HP1 -> E_HP2 -> Vhp -> passive LP ladder -> Yi_mid -> Vspkr_mid (Zi_mid) -> TF_mid -> Pout_mid
//                               -> passive HP ladder -> Yi_tw  -> Vspkr_tw  (Zi_tw)  -> TF_tw  -> Pout_tw
//   V(Psum<angle>) = series E sources g_u * p_u * V(Pout<angle>_u), one loop per measured angle.
// The data files follow Matlab2LTspice.m: (f, dB, unwrapped phase in degrees), the transfer functions
// carry the profile's phase distance, the input impedances are written as admittances (Bi sources).
//
// Everything here is pure (strings in, strings out) so the export can be tested and verified headless.

import type { Design, Profile, Series, UnitId } from "../types";
import { boxResponse, ltspiceText, type Prepared } from "../engine";
import { branchParts, safeName, type BomPart } from "./parts";

/** Propagation speed Matlab2LTspice/phaseunwrap use for the distance compensation (m/s). */
export const C_PHASE = 345;

export interface ExportFile { name: string; contents: string }
export interface LtspiceExport {
  /** Main schematic file name, e.g. "System_system-d-group10.asc". */
  schematic: string;
  files: ExportFile[];
  /** Measured angles that got a sum loop: "0" -> V(Psum), "30" -> V(Psum30). */
  sums: { angle: string; node: string }[];
}

const UNIT_LONG: Record<UnitId, string> = { woof: "woofer", mid: "midrange", tw: "tweeter" };

const LETTERS: Record<string, string> = { ø: "o", Ø: "O", æ: "ae", Æ: "AE", œ: "oe", Œ: "OE", ß: "ss", đ: "d", Đ: "D", ł: "l", Ł: "L" };

/** LTspice reads schematics and includes as ANSI: keep names in comments to plain ASCII. */
export function ascii(s: string): string {
  return s.replace(/[·•]/g, "-").replace(/[″“”]/g, '"').replace(/[′‘’]/g, "'").replace(/[–—]/g, "-").replace(/µ/g, "u").replace(/⌀/g, "D ")
    // letters NFKD does not decompose (Danish ø and æ, German ß, ...): spell them, so "Søren" stays readable
    .replace(/[øØæÆœŒßđĐłŁ]/g, c => LETTERS[c])
    .normalize("NFKD").replace(/[^\x20-\x7e\r\n\t]/g, "");
}

// ---------------------------------------------------------------- number formats
/** Python's "%.10E": mantissa with 10 decimals, exponent with sign and at least two digits. */
export function fmtE(x: number): string {
  if (!Number.isFinite(x)) x = 0;
  const [m, e] = x.toExponential(10).split("e");
  const ex = parseInt(e, 10);
  return `${m}E${ex < 0 ? "-" : "+"}${String(Math.abs(ex)).padStart(2, "0")}`;
}

/** Python's "%g" for part values on the schematic ("0.82m", "6.8u", "4.7"). */
function g6(x: number): string {
  if (x === 0) return "0";
  const ex = Math.floor(Math.log10(Math.abs(x)));
  if (ex < -4 || ex >= 6) {
    const [m, e] = x.toExponential(5).split("e");
    const ee = parseInt(e, 10);
    return `${m.replace(/\.?0+$/, "")}e${ee < 0 ? "-" : "+"}${String(Math.abs(ee)).padStart(2, "0")}`;
  }
  return String(Number(x.toPrecision(6)));
}

export function partValue(kind: "L" | "C" | "R", v: number): string {
  return kind === "L" ? `${g6(v * 1e3)}m` : kind === "C" ? `${g6(v * 1e6)}u` : g6(v);
}

/** numpy.unwrap on radians. */
function unwrap(ph: number[]): number[] {
  const out = ph.slice();
  let off = 0;
  for (let i = 1; i < ph.length; i++) {
    const d = ph[i] - ph[i - 1];
    if (d > Math.PI) off -= 2 * Math.PI * Math.round(d / (2 * Math.PI));
    else if (d < -Math.PI) off += 2 * Math.PI * Math.round(-d / (2 * Math.PI));
    out[i] = ph[i] + off;
  }
  return out;
}

// ---------------------------------------------------------------- Matlab2LTspice tables
/** One table source in Matlab2LTspice's format. `header` is the first line (the source definition). */
export function tableText(header: string, f: ArrayLike<number>, re: ArrayLike<number>, im: ArrayLike<number>, comment: string[] = []): string {
  const ph = unwrap(Array.from({ length: f.length }, (_, i) => Math.atan2(im[i], re[i])));
  const lines = comment.map(c => `* ${c}`);
  lines.push(header);
  for (let i = 0; i < f.length; i++)
    lines.push(`+(${fmtE(f[i])},${fmtE(20 * Math.log10(Math.hypot(re[i], im[i])))},${fmtE(ph[i] * 180 / Math.PI)})`);
  return lines.join("\n") + "\n";
}

/** Transfer-function table with the distance compensation H * exp(j 2 pi f d / c). */
export function tfText(s: Series, header: string, distance_m: number, comment: string[] = []): string {
  const n = s.f.length, re = new Float64Array(n), im = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const k = 2 * Math.PI * s.f[i] * distance_m / C_PHASE, c = Math.cos(k), sn = Math.sin(k);
    re[i] = s.re[i] * c - s.im[i] * sn; im[i] = s.re[i] * sn + s.im[i] * c;
  }
  return tableText(header, s.f, re, im, comment);
}

/** Input impedance as admittance (the Bi source draws I = Y V from the speaker node). */
export function admittanceText(z: Series, header: string, comment: string[] = []): string {
  const n = z.f.length, re = new Float64Array(n), im = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const d = z.re[i] * z.re[i] + z.im[i] * z.im[i];
    re[i] = z.re[i] / d; im[i] = -z.im[i] / d;
  }
  return tableText(header, z.f, re, im, comment);
}

/** Node / file tag of an angle: "0" -> "", "30" -> "30", "-30" -> "m30". */
export function angleTag(a: string): string {
  return a === "0" ? "" : a.replace(/^-/, "m").replace(/\./g, "p").replace(/[^A-Za-z0-9]/g, "");
}

// ---------------------------------------------------------------- schematic builder
// Pin offsets of LTspice's built-in symbols (Lab A gen_ltspice.py PINS); R90 rotates (x, y) -> (-y, x).
const WIN_ABOVE = ["WINDOW 0 -30 56 VBottom 2", "WINDOW 3 -2 56 VBottom 2"];
const WIN_CAP_R0 = ["WINDOW 0 40 18 Left 2", "WINDOW 3 40 52 Left 2"];
const SYM = { L: "ind", C: "cap", R: "res" } as const;

class Asc {
  lines: string[] = [];
  w(x1: number, y1: number, x2: number, y2: number) { if (x1 !== x2 || y1 !== y2) this.lines.push(`WIRE ${x1} ${y1} ${x2} ${y2}`); }
  flag(x: number, y: number, n: string) { this.lines.push(`FLAG ${x} ${y} ${n}`); }
  /** Comment (directive=false) or SPICE directive text. Multi-line text uses LTspice's literal \n. */
  t(x: number, y: number, txt: string, directive = false) {
    this.lines.push(`TEXT ${x} ${y} Left 2 ${directive ? "!" : ";"}${txt.replace(/\n/g, "\\n")}`);
  }
  rect(x1: number, y1: number, x2: number, y2: number) { this.lines.push(`RECTANGLE Normal ${x1} ${y1} ${x2} ${y2} 2`); }
  sym(kind: string, x: number, y: number, rot: string, name: string, value: string, extra: string[] = [], win: string[] = []) {
    this.lines.push(`SYMBOL ${kind} ${x} ${y} ${rot}`, ...win, `SYMATTR InstName ${name}`, `SYMATTR Value ${value}`, ...extra);
  }
  /** E source with its + output at (x, y); control and - output by flags. hide keeps a long value off the sheet. */
  e(x: number, y: number, name: string, val: string, cin: string, cneg = "0", oneg = "0", hide = false, lead = 48) {
    this.sym("e", x, y - 16, "R0", name, val, [], ["WINDOW 0 24 104 Left 2", `WINDOW 3 24 136 ${hide ? "Invisible" : "Left"} 2`]);
    // a named - output gets a short lead down, so its label clears the symbol
    if (oneg === "0") this.flag(x, y + 80, oneg);
    else { this.w(x, y + 80, x, y + 160); this.flag(x, y + 160, oneg); }
    this.w(x - 48, y + 16, x - 48 - lead, y + 16); this.flag(x - 48 - lead, y + 16, cin);
    this.w(x - 48, y + 64, x - 96, y + 64); this.flag(x - 96, y + 64, cneg);
  }
  /** 0 V current sense, current flows left -> right; pins at x and x + 80. */
  yi(x: number, y: number, name: string): number {
    this.sym("voltage", x - 16, y, "R270", name, "0", [], ["WINDOW 0 32 56 VTop 2", "WINDOW 3 -32 56 VBottom 2"]);
    return x + 80;
  }
  /** Horizontal element from (xl, y); returns the x of its right pin. */
  hser(kind: "L" | "C" | "R", xl: number, y: number, name: string, value: string, spice?: string): number {
    const len = kind === "C" ? 64 : 80;
    this.sym(SYM[kind], xl + len + (kind === "C" ? 0 : 16), y - 16, "R90", name, value, spice ? [`SYMATTR SpiceLine ${spice}`] : [], WIN_ABOVE);
    return xl + len;
  }
  /** Vertical element from the rail node (x, y) down; returns its bottom pin y. */
  vert(kind: "L" | "C" | "R", x: number, y: number, name: string, value: string, spice?: string): number {
    const extra = spice ? [`SYMATTR SpiceLine ${spice}`] : [];
    if (kind === "C") { this.sym("cap", x - 16, y, "R0", name, value, extra, WIN_CAP_R0); return y + 64; }
    this.sym(SYM[kind], x - 16, y - 16, "R0", name, value, extra); return y + 80;
  }
  dump(w: number, h: number): string { return `Version 4\nSHEET 1 ${w} ${h}\n${this.lines.join("\n")}\n`; }
}

/** LTspice inductor series resistance: the design's coil resistance (ohm per mH). */
const rser = (L: number, Rdcr: number) => `Rser=${Rdcr > 0 ? g6(Rdcr * L * 1e3) : "0"}`;

/** Draw one passive branch on the rail at height y from x; returns the end x. */
function drawBranch(a: Asc, x: number, y: number, parts: BomPart[], Rdcr: number): number {
  a.w(x, y, x + 64, y); x += 64;
  for (const p of parts) {
    if (p.pos === "series") {
      x = a.hser(p.kind, x, y, p.ref, partValue(p.kind, p.value), p.kind === "L" ? rser(p.value, Rdcr) : undefined);
      a.w(x, y, x + 32, y); x += 32;
    } else if (p.zobelC === undefined) {
      a.w(x, y, x + 48, y); x += 48;
      const yb = a.vert(p.kind, x, y, p.ref, partValue(p.kind, p.value), p.kind === "L" ? rser(p.value, Rdcr) : undefined);
      a.flag(x, yb, "0");
      a.w(x, y, x + 112, y); x += 112;
    } else {
      // Zobel: R from the rail, C from the R's foot to ground
      a.w(x, y, x + 48, y); x += 48;
      const ym = a.vert("R", x, y, p.ref, partValue("R", p.value));
      const yb = a.vert("C", x, ym + 16, p.zobelC.ref, partValue("C", p.zobelC.value));
      a.w(x, ym, x, ym + 16); a.flag(x, yb, "0");
      a.w(x, y, x + 112, y); x += 112;
    }
  }
  return x;
}

function plt(panes: [string[], [number, number]][]): string {
  const out = ["[AC Analysis]", "{", `   Npanes: ${panes.length}`];
  let id = 524290;
  for (const [traces, [lo, hi]] of panes) {
    out.push("   {", `      traces: ${traces.length} ${traces.map(t => `{${id++},0,"${t}"}`).join(" ")}`,
      "      X: (' ',0,20,0,20000)", `      Y[0]: (' ',0,${lo},20,${hi})`, "      Y[1]: (' ',0,-180,45,180)",
      "      Log: 1 2 0", "      GridStyle: 1", "      PltMag: 1", "      PltPhi: 1 0", "   }");
  }
  out.push("}");
  return out.join("\r\n") + "\r\n";
}

// ---------------------------------------------------------------- the export
function alignmentName(d: Design) { return `${d.digital.align} at ${g6(d.digital.fc)} Hz`; }

/** p(design box) / p(vents plugged) of the fitted box model, on the profile's grid. */
export function boxRatio(p: Prepared, design: Design): { f: Float64Array; re: Float64Array; im: Float64Array } {
  const f = Array.from(p.f);
  const des = boxResponse(p, design, f).p1m;
  const ref = boxResponse(p, { ...design, box: { ...design.box, mode: "plugged", fill: 1 } }, f).p1m;
  const n = f.length, re = new Float64Array(n), im = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const br = ref.re[i], bi = ref.im[i], d = br * br + bi * bi, ar = des.re[i], ai = des.im[i];
    re[i] = (ar * br + ai * bi) / d; im[i] = (ai * br - ar * bi) / d;
  }
  return { f: p.f, re, im };
}

/** Build the complete LTspice folder for a design. `designName` only goes into comments. */
export function buildLtspice(p: Prepared, design: Design, designName?: string): LtspiceExport {
  const prof = p.profile, M = prof.measurements, dist = prof.conditions.phase_ref_distance_m;
  const dg = design.digital;
  const base = `System_${safeName(prof.id)}`;
  const title = ascii(`${prof.name}${designName ? ` - ${designName}` : ""}`);
  const files: ExportFile[] = [];
  const stamp = ascii(`Crossover Studio export for ${prof.name}`);

  // ---- data files
  const angles = p.angles;          // complete angles only, ascending, "0" first
  for (const ang of angles) {
    const tag = angleTag(ang);
    for (const u of ["woof", "mid", "tw"] as UnitId[]) {
      const s = M.tf[ang][u]!;
      const src = u === "woof" ? "Vspkr_woof" : `Vspkr_${u}`;
      files.push({ name: `TF${tag}_${u}.txt`, contents: tfText(s, `BvTF${tag}_${u} Pout${tag}_${u} 0  V=V(${src},0) DB FREQ=  `, dist,
        [`${stamp}: ${UNIT_LONG[u]} p/V at ${ang} deg${s.source ? ` (${ascii(s.source.file)})` : ""}, phase distance-compensated with d = ${dist} m`]) });
    }
  }
  for (const u of ["mid", "tw"] as const)
    files.push({ name: `Zi_${u}.txt`, contents: admittanceText(M.zi[u]!, `BiZin_${u} Vspkr_${u} 0  I=V(Vspkr_${u},0) DB FREQ= `,
      [`${stamp}: ${UNIT_LONG[u]} input impedance as admittance 1/Zi${M.zi[u]!.source ? ` (${ascii(M.zi[u]!.source!.file)})` : ""}`]) });
  const ratio = boxRatio(p, design);
  const boxLabel = ascii(design.box.label || describeBox(design));
  files.push({ name: "Box_woof.txt", contents: tableText("BvBox_woof Vspkr_woof 0  V=V(lp2,0) DB FREQ= ", ratio.f, ratio.re, ratio.im,
    [`${stamp}: box tuning on the woofer, ${boxLabel}: p(designed box) / p(vents plugged) of the fitted box model`]) });

  // ---- schematic
  const LP = ltspiceText(p, dg.fc, "LPF", dg.align), HP = ltspiceText(p, dg.fc, "HPF", dg.align);
  while (LP.length < 2) LP.push("1");
  while (HP.length < 2) HP.push("1");
  const a = new Asc();
  a.t(-400, -400, `${title}: ${alignmentName(design)} digital crossover, passive ${design.mid.topo} midrange / ${design.tw.topo} tweeter. Generated by Crossover Studio; edit the design there, not here.`);
  a.t(-400, -368, "Digital E slots = DigitalCrossover.m form (MiniDSP at 96 kHz). V(Psum) = system on axis" +
    (angles.length > 1 ? `, ${angles.filter(x => x !== "0").map(x => `V(Psum${angleTag(x)}) = ${x} deg`).join(", ")}` : "") + ", for 1 V at the MiniDSP input.");
  a.sym("voltage", -400, -16, "R0", "V1", "0", ["SYMATTR Value2 AC 1"], ["WINDOW 0 -56 40 Right 2", "WINDOW 3 -56 72 Right 2"]);
  a.flag(-400, 0, "Vin"); a.flag(-400, 80, "0");
  ([["LP", "lp2", LP, "woofer: digital LPF (MiniDSP output 1)"], ["HP", "Vhp", HP, "mid + tweeter: digital HPF (MiniDSP output 2)"]] as const)
    .forEach(([tag, out, strs, txt], row) => {
      const y = row * 320, low = tag.toLowerCase();
      a.t(-80, y - 96, txt);
      a.e(0, y, `E_${tag}1`, strs[0], "Vin", "0", "0", true); a.w(0, y, 112, y); a.flag(112, y, `${low}1`);
      a.e(256, y, `E_${tag}2`, strs[1], `${low}1`, "0", "0", true); a.w(256, y, 400, y); a.flag(400, y, out);
      a.t(-80, y + 176, `${dg.align} ${tag === "LP" ? "low" : "high"}-pass at ${g6(dg.fc)} Hz: one biquad per E source (value hidden; Ctrl+right-click to see it)`);
    });
  a.t(560, -16, `lp2 -> Vspkr_woof: box tuning (${boxLabel}) vs the plugged box Lab E measured, in Box_woof.txt`);

  let xmax = 0;
  (["mid", "tw"] as const).forEach((u, row) => {
    const y = 768 + row * 384;
    const parts = branchParts(design, u);
    a.flag(0, y, "Vhp");
    const x = drawBranch(a, 0, y, parts, design.Rdcr || 0);
    a.w(x, y, x + 64, y);
    a.rect(16, y - 144, x + 16, y + 176);
    a.t(32, y - 128, `passive ${u === "mid" ? "LPF" : "HPF"} (${UNIT_LONG[u]}): ${parts.map(q => `${q.ref} ${partValue(q.kind, q.value)}`).join(", ")}`);
    const xe = a.yi(x + 144, y, `Yi_${u}`); a.w(x + 64, y, x + 144, y); a.w(xe, y, xe + 96, y); a.flag(xe + 96, y, `Vspkr_${u}`);
    xmax = Math.max(xmax, xe + 96);
  });

  const sums: LtspiceExport["sums"] = [];
  const x0 = Math.max(1840, xmax + 400);
  angles.forEach((ang, k) => {
    const sfx = angleTag(ang), x = x0 + k * 640;
    a.t(x - 160, -96, `sum, ${ang === "0" ? "on axis" : `${ang} deg`}`);
    const nodes = ["0", `s${sfx}1`, `s${sfx}2`, `Psum${sfx}`];
    (["woof", "mid", "tw"] as const).forEach((u, j) => {
      const y = 160 + j * 256;
      a.e(x, y, `E_S${sfx}${u}`, `{g_${u}*p_${u}}`, `Pout${sfx}_${u}`, "0", nodes[j], false, 128);
      a.w(x, y, x + 112, y); a.flag(x + 112, y, nodes[j + 1]);
    });
    sums.push({ angle: ang, node: `V(Psum${sfx})` });
  });
  const gw = 10 ** (dg.g_woof_dB / 20);
  a.t(x0 - 160, 1100, `.param g_woof=${g6(gw)} g_mid=1 g_tw=1   p_woof=${design.pol.woof} p_mid=${design.pol.mid} p_tw=${design.pol.tw}`, true);
  a.t(x0 - 160, 1140, `g_woof = ${dg.g_woof_dB >= 0 ? "+" : ""}${dg.g_woof_dB.toFixed(1)} dB = the MiniDSP output 1 gain; p_ = polarity of each unit (+1 / -1)`);
  if (design.Rdcr > 0) a.t(x0 - 160, 1180, `Coil resistance ${g6(design.Rdcr)} ohm/mH is in each inductor's Rser.`);
  const incs = [...files.map(f => f.name)];
  incs.forEach((n, i) => a.t(-400 + (i % 5) * 400, 1500 + Math.floor(i / 5) * 40, `.inc ${n}`, true));
  a.t(-400, 1500 + Math.ceil(incs.length / 5) * 40 + 40, ".ac dec 200 20 20000", true);

  const sumNodes = sums.map(s => s.node);
  files.unshift(
    { name: `${base}.asc`, contents: a.dump(Math.max(3200, x0 + angles.length * 640 + 400), 2000) },
    { name: `${base}.plt`, contents: plt([[sumNodes, [0.05, 5]], [["V(Pout_woof)", "V(Pout_mid)", "V(Pout_tw)", "V(Psum)"], [1e-3, 5]],
                                          [["V(Vhp)/(I(Yi_mid)+I(Yi_tw))"], [1, 100]]]) },
    { name: "README.txt", contents: readme(prof, design, base, files.map(f => f.name), sums) },
  );
  return { schematic: `${base}.asc`, files, sums };
}

function describeBox(d: Design): string {
  const b = d.box;
  if (b.mode === "plugged") return "vents plugged (closed box)";
  if (b.mode === "one") return `one vent, L = ${(b.L * 1e3).toFixed(0)} mm`;
  return `two vents (L ${(b.L * 1e3).toFixed(0)} + ${(b.L2 * 1e3).toFixed(0)} mm)`;
}

function readme(prof: Profile, d: Design, base: string, data: string[], sums: LtspiceExport["sums"]): string {
  return ascii([
    `${prof.name}: three-way system in LTspice, exported by Crossover Studio.`,
    "",
    `Open ${base}.asc in LTspice and run it (.ac dec 200 20 20000). Keep the .txt files in the same folder:`,
    "the schematic includes them with .inc and relative paths.",
    "",
    "Nodes",
    ...sums.map(s => `  ${s.node.padEnd(14)} system response at ${s.angle === "0" ? "0 deg (on axis)" : `${s.angle} deg`}, p/V for 1 V into the MiniDSP`),
    "  V(Pout_woof)   woofer, V(Pout_mid) midrange, V(Pout_tw) tweeter (before gain and polarity)",
    "  V(Vspkr_mid)   voltage at the midrange terminals; V(Vspkr_tw) the same for the tweeter",
    "  V(Vhp)/(I(Yi_mid)+I(Yi_tw))   load seen by amplifier channel 2",
    "",
    "Digital crossover",
    `  ${d.digital.align} at ${g6(d.digital.fc)} Hz, MiniDSP at 96 kHz. E_LP1/E_LP2 = output 1 (woofer), E_HP1/E_HP2 = output 2.`,
    "  A slot holding 1 is unused (a 2nd-order alignment has one biquad).",
    `  Woofer gain ${d.digital.g_woof_dB.toFixed(1)} dB and the polarities are .params next to the sum loops.`,
    "",
    "Data files (Matlab2LTspice format: frequency, dB, unwrapped phase in degrees)",
    ...data.map(n => `  ${n}`),
    `  TF files are distance-compensated with d = ${prof.conditions.phase_ref_distance_m} m (c = ${C_PHASE} m/s), the same for every unit.`,
    "  Zi files hold the admittance 1/Zi (Bi sources), as the course template expects.",
    "  Box_woof.txt turns the woofer response (measured with the vent plugged) into the designed box.",
    "",
  ].join("\r\n"));
}
