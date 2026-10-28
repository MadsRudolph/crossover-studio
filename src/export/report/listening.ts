// Report pack, part 5: the listening test (project Task 4) as a report subsection: the method in prose,
// a method table, the attribute table (descriptor, scale ends, frequency region, control), the ratings
// as mean ± 95 % CI per attribute and variant, the plain-language conclusions, and a dot-and-whisker
// figure (pgfplots in the .tex, inline SVG in the Markdown). Built only when ratings exist.

import { ATTRIBUTE_LINKS, SCALE_MAX, SCALE_MIN, type Protocol, type Rating } from "../../listentest/model";
import { analyse, conclusions, regionText, type Analysis } from "../../listentest/stats";
import { PALETTE } from "./figures";
import { xmlEscape } from "./svg";
import { texEscape } from "./latex";
import { num, txt, type Row, type Table } from "./tables";

export interface ListeningInput { protocol: Protocol; ratings: Rating[] }

/** A figure that is not on a frequency axis: the writers place it as given and number it. */
export interface RawFigure { id: string; caption: string; tex: string; svg: string }

const VARIANT_COLORS = ["c1", "c2", "c3", "c4", "c5", "c6"] as const;
const colorOf = (k: number) => VARIANT_COLORS[k % VARIANT_COLORS.length];

const count = (n: number, one: string, many = one + "s") => `${n} ${n === 1 ? one : many}`;

export function hasListeningResults(x?: ListeningInput | null): x is ListeningInput {
  return !!x && x.ratings.length > 0 && x.protocol.variants.length > 0;
}

// ---------------------------------------------------------------- prose
function intro(p: Protocol, a: Analysis): string[] {
  const kinds = p.variants.map(v => v.name).join(", ");
  const items = p.items.map(i => i.name + (i.kind === "signal" ? " (test signal)" : "")).join("; ");
  const blind = p.variants.length > 1
    ? `The variants were presented blind under random letters (a new assignment per listener) in an order from a Williams balanced Latin square (seed ${p.seed}), so every variant took every position and followed every other equally often.`
    : "Only one variant was rated, as an absolute judgement on the scale.";
  return [
    `The design was judged in a methodical listening test following IEC 60268-13 (listening tests on loudspeakers) and Bech and Zacharov, Perceptual Audio Evaluation (2006). Venue: ${p.venue}. ${count(a.listeners, "listener")} rated ${count(p.variants.length, "variant")} (${kinds}) on ${count(p.items.length, "programme item")} (${items}), ${count(p.reps, "time")} each.`,
    `${blind} Level matching: ${p.levelNote}`,
    `Each attribute was rated from ${SCALE_MIN} to ${SCALE_MAX} with labelled ends and a one-line descriptor the listeners read first. A listener's repetitions were averaged before the statistics, so the listener is the unit of analysis${a.unit === "repetition" ? " (with a single listener the repetitions are the samples instead, which says nothing about other listeners)" : ""}; the 95 % confidence intervals use Student's t for the small sample, and two variants are compared on the paired per-listener difference.`,
  ];
}

// ---------------------------------------------------------------- tables
function methodTable(p: Protocol, a: Analysis): Table {
  const row = (q: string, v: string): Row => ({ cells: [txt(q), txt(v)] });
  return {
    id: "listening-method", caption: "Listening test procedure.",
    columns: [{ head: "Item", align: "l" }, { head: "Choice", align: { p: 0.62 }, prose: true }],
    rows: [
      row("Venue", p.venue),
      row("Listeners", `${a.listeners} (planned ${p.listeners}), ${count(p.reps, "repetition")} each`),
      row("Variants", p.variants.map(v => v.name).join(", ")),
      row("Programme", p.items.map(i => i.name).join("; ")),
      row("Scale", `${SCALE_MIN} to ${SCALE_MAX} per attribute, labelled ends`),
      row("Order", p.variants.length > 1 ? `Blind letters, Williams balanced Latin square, seed ${p.seed}` : "Single variant"),
      row("Level", p.levelNote),
    ],
  };
}

function attributeTable(p: Protocol): Table {
  return {
    id: "listening-attributes", caption: "Rated attributes: descriptor read by the listeners, scale ends, and the frequency region and control each one points at.",
    columns: [{ head: "Attribute", align: { p: 0.15 } }, { head: "Descriptor", align: { p: 0.26 }, prose: true }, { head: "1 / 7", align: { p: 0.15 }, prose: true },
      { head: "Region", align: "l", prose: true }, { head: "Control", align: { p: 0.15 }, prose: true }],
    rows: p.attributes.map(at => {
      const l = ATTRIBUTE_LINKS[at.id];
      return { cells: [txt(at.name), txt(at.descriptor), txt(`${at.low} / ${at.high}`), txt(l ? regionText(l.band) : "-"), txt(l?.control ?? "-")] };
    }),
  };
}

function resultTable(p: Protocol, a: Analysis): Table {
  const rows: Row[] = [];
  for (const at of p.attributes) {
    const all = a.byAttribute.get(at.id)?.[0];
    if (!all) continue;
    let first = true;                                     // the attribute's name only on its first row
    for (const c of all.cells) {
      if (!c.ci.n) continue;
      const v = p.variants.find(x => x.id === c.variant)!;
      rows.push({ cells: [txt(first ? at.name : ""), txt(v.name), num(c.ci.mean, null, 1, { unitless: "score" }),
        Number.isFinite(c.ci.half) ? num(c.ci.half, null, 1, { unitless: "score" }) : txt("-"), txt(String(c.ci.n))] });
      first = false;
    }
  }
  return {
    id: "listening-results", caption: `Ratings on the ${SCALE_MIN}-${SCALE_MAX} scale, all programme items: mean and half-width of the 95 % confidence interval (Student's t) over the ${a.unit === "listener" ? "listeners" : "repetitions"}.`,
    columns: [{ head: "Attribute", align: "l" }, { head: "Variant", align: "l" }, { head: "Mean", align: "r" }, { head: "95 % CI ±", align: "r" }, { head: "n", align: "r" }],
    rows,
  };
}

// ---------------------------------------------------------------- the figure
interface Dot { attr: number; variant: number; mean: number; half: number }

function dots(p: Protocol, a: Analysis): Dot[] {
  const out: Dot[] = [];
  p.attributes.forEach((at, i) => a.byAttribute.get(at.id)?.[0].cells.forEach((c, k) => {
    if (c.ci.n) out.push({ attr: i, variant: k, mean: c.ci.mean, half: Number.isFinite(c.ci.half) ? c.ci.half : 0 });
  }));
  return out;
}

const r2 = (v: number) => String(Math.round(v * 100) / 100);
/** Vertical offset of variant k of n inside one attribute row (in row units). */
const offset = (k: number, n: number) => (k - (n - 1) / 2) * Math.min(0.22, 0.7 / Math.max(1, n));

function texRatings(p: Protocol, ds: Dot[], caption: string): string {
  const n = p.variants.length, K = p.attributes.length;
  const out = [
    "\\begin{figure}[htbp]",
    "  \\centering",
    "  \\begin{tikzpicture}",
    `    \\begin{axis}[width=0.8\\linewidth, height=${Math.max(5, 1.1 * K + 2).toFixed(1)}cm, xmin=${SCALE_MIN - 0.3}, xmax=${SCALE_MAX + 0.3}, xtick={${SCALE_MIN},...,${SCALE_MAX}},`,
    `      xlabel={Rating (${SCALE_MIN} to ${SCALE_MAX})}, ytick={1,...,${K}}, yticklabels={${p.attributes.map(a => `{${texEscape(a.name)}}`).join(",")}}, y dir=reverse,`,
    `      ymin=0.4, ymax=${K + 0.6}, xmajorgrids, grid style={black!15}, tick label style={font=\\footnotesize}, label style={font=\\small},`,
    "      legend columns=3, legend cell align=left, legend style={at={(0.5,1.03)}, anchor=south, draw=none, font=\\footnotesize, /tikz/every even column/.append style={column sep=8pt}}]",
  ];
  p.variants.forEach((v, k) => {
    const pts = ds.filter(d => d.variant === k).map(d => `(${r2(d.mean)},${r2(d.attr + 1 + offset(k, n))}) +- (${r2(d.half)},0)`);
    if (!pts.length) return;
    out.push(`    \\addplot[xs${colorOf(k)}, only marks, mark=*, mark size=1.8pt, error bars/.cd, x dir=both, x explicit] coordinates {${pts.join(" ")}};`);
    out.push(`    \\addlegendentry{${texEscape(v.name)}}`);
  });
  out.push("    \\end{axis}", "  \\end{tikzpicture}", `  \\caption{${texEscape(caption)}}`, "  \\label{fig:xs-listening}", "\\end{figure}");
  return out.join("\n");
}

function svgRatings(p: Protocol, ds: Dot[]): string {
  const W = 720, ML = 170, MR = 20, MT = 34, ROW = 34, K = p.attributes.length, H = MT + K * ROW + 42;
  const FONT = "Helvetica, Arial, sans-serif", INK = "#222222", GRID = "#e3e3e3";
  const x = (v: number) => ML + (v - (SCALE_MIN - 0.3)) / (SCALE_MAX - SCALE_MIN + 0.6) * (W - ML - MR);
  const y = (row: number) => MT + (row + 0.5) * ROW;
  const n = p.variants.length, parts: string[] = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="${FONT}" font-size="12">`);
  parts.push(`<rect width="${W}" height="${H}" fill="#ffffff"/>`);
  for (let v = SCALE_MIN; v <= SCALE_MAX; v++) {
    parts.push(`<line x1="${r2(x(v))}" y1="${MT}" x2="${r2(x(v))}" y2="${MT + K * ROW}" stroke="${GRID}"/>`);
    parts.push(`<text x="${r2(x(v))}" y="${MT + K * ROW + 16}" text-anchor="middle" fill="${INK}">${v}</text>`);
  }
  parts.push(`<text x="${r2((ML + W - MR) / 2)}" y="${H - 6}" text-anchor="middle" fill="${INK}">Rating (${SCALE_MIN} to ${SCALE_MAX})</text>`);
  p.attributes.forEach((a, i) => parts.push(`<text x="${ML - 10}" y="${r2(y(i) + 4)}" text-anchor="end" fill="${INK}">${xmlEscape(a.name)}</text>`));
  let lx = ML;
  p.variants.forEach((v, k) => {
    const c = PALETTE[colorOf(k)];
    parts.push(`<circle cx="${lx + 5}" cy="16" r="4" fill="${c}"/><text x="${lx + 14}" y="20" fill="${INK}">${xmlEscape(v.name)}</text>`);
    lx += 30 + v.name.length * 6.4;
  });
  for (const d of ds) {
    const c = PALETTE[colorOf(d.variant)], cy = r2(y(d.attr) + offset(d.variant, n) * ROW);
    if (d.half > 0) parts.push(`<line x1="${r2(x(d.mean - d.half))}" y1="${cy}" x2="${r2(x(d.mean + d.half))}" y2="${cy}" stroke="${c}" stroke-width="1.5"/>`);
    parts.push(`<circle cx="${r2(x(d.mean))}" cy="${cy}" r="4" fill="${c}"/>`);
  }
  parts.push("</svg>");
  return parts.join("");
}

// ---------------------------------------------------------------- the section
export interface ListeningSection {
  intro: string[];
  tables: Table[];
  conclusions: string[];
  figure: RawFigure;
}

export function listeningSection(x: ListeningInput): ListeningSection {
  const p = x.protocol, a = analyse(p, x.ratings), ds = dots(p, a);
  const caption = `Listening test ratings, all programme items: mean and 95 % confidence interval per attribute and variant (${a.unit === "listener" ? `n = ${a.listeners} listeners` : "one listener, repetitions as samples"}).`;
  const concl = conclusions(p, a).map(c => c.text + (c.action ? ` ${c.action}` : ""));
  return {
    intro: intro(p, a),
    tables: [methodTable(p, a), attributeTable(p), resultTable(p, a)],
    conclusions: concl.length ? ["Conclusions, attribute by attribute:", ...concl] : [],
    figure: { id: "listening", caption, tex: texRatings(p, ds, caption), svg: svgRatings(p, ds) },
  };
}
