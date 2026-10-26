// Report pack, LaTeX writer: \section{Loudspeaker design} with booktabs tables, siunitx numbers and
// pgfplots groupplots that read one CSV file per figure. The .tex is plain ASCII, so it compiles with
// pdflatex, XeLaTeX and LuaLaTeX alike (Overleaf's default is pdflatex).

import { ascii, type ExportFile } from "../ltspice";
import { PALETTE, yRange, type Figure } from "./figures";
import type { CodeBlock, Report, ReportSection } from "./index";
import { numText, type Align, type Cell, type Table } from "./tables";

// ---------------------------------------------------------------- text
const UNICODE: [RegExp, string][] = [
  [/µ/g, "\\textmu{}"], [/Ω/g, "$\\Omega$"], [/°/g, "\\textdegree{}"], [/±/g, "$\\pm$"], [/≤/g, "$\\le$"], [/≥/g, "$\\ge$"],
  [/−/g, "-"], [/–/g, "--"], [/—/g, "---"], [/×/g, "$\\times$"], [/·/g, "$\\cdot$"], [/⁴/g, "\\textsuperscript{4}"],
  [/⌀/g, "diameter "], [/→/g, "$\\to$"], [/[“]/g, "``"], [/[”]/g, "''"], [/[‘’′]/g, "'"], [/″/g, "''"],
];

/** Plain text to LaTeX: TeX specials escaped, typographic characters as ASCII macros. */
export function texEscape(s: string): string {
  let t = s.replace(/[\\{}$&%#_^~]/g, c => ({
    "\\": "\\textbackslash{}", "{": "\\{", "}": "\\}", $: "\\$", "&": "\\&", "%": "\\%", "#": "\\#", _: "\\_",
    "^": "\\^{}", "~": "\\textasciitilde{}",
  }[c] as string));
  for (const [re, rep] of UNICODE) t = t.replace(re, rep);
  return ascii(t);
}

/** A symbol like "f_s" or "M_AP" as math with an upright subscript; longer names as typewriter text. */
export function texSymbol(s: string): string {
  const m = /^([A-Za-z]{1,2})_([A-Za-z0-9]+)$/.exec(s);
  if (m) return `$${m[1]}_\\mathrm{${m[2]}}$`;
  if (/^[A-Za-z]{1,2}$/.test(s)) return `$${s}$`;
  return `\\texttt{${texEscape(s)}}`;
}

function texCell(c: Cell, symbolCol: boolean): string {
  if (c.kind === "text") return symbolCol ? texSymbol(c.text) : texEscape(c.text);
  if (!Number.isFinite(c.value)) return "n/a";
  const n = numText(c), note = c.note ? ` (${texEscape(c.note)})` : "";
  // siunitx keeps an explicit plus sign (retain-explicit-plus is off by default, so ask for it here)
  const opt = c.sign && n.startsWith("+") ? "[retain-explicit-plus]" : "";
  return (c.unit ? `\\SI${opt}{${n}}{${c.unit.tex}}${c.unit.texAfter ?? ""}` : `\\num${opt}{${n}}`) + note;
}

const colSpec = (a: Align) => (typeof a === "string" ? a : `p{${a.p}\\linewidth}`);

export function texTable(t: Table): string {
  const sym = t.columns.findIndex(c => c.head === "Symbol");
  const row = (cells: string[]) => `    ${cells.join(" & ")} \\\\`;
  return [
    "\\begin{table}[htbp]",
    "  \\centering",
    `  \\caption{${texEscape(t.caption)}}`,
    `  \\label{tab:xs-${t.id}}`,
    `  \\begin{tabular}{${t.columns.map(c => colSpec(c.align)).join("")}}`,
    "    \\toprule",
    row(t.columns.map(c => (/^[A-Za-z]{1,2}_[A-Za-z0-9]+$/.test(c.head) ? texSymbol(c.head) : texEscape(c.head)))),
    "    \\midrule",
    ...t.rows.map(r => row(r.cells.map((c, i) => texCell(c, i === sym)))),
    "    \\bottomrule",
    "  \\end{tabular}",
    "\\end{table}",
  ].join("\n");
}

// ---------------------------------------------------------------- figures
const fmt = (v: number) => {
  if (!Number.isFinite(v)) return "nan";
  const s = String(Number(v.toPrecision(6)));
  return s === "-0" ? "0" : s;
};

/** The CSV a figure reads: f plus one column per series, finite numbers or "nan" (skipped by pgfplots). */
export function figureCsv(fig: Figure): string {
  const cols = fig.panels.flatMap(p => p.series);
  const lines = [["f", ...cols.map(s => s.col)].join(",")];
  for (let i = 0; i < fig.x.length; i++) lines.push([String(Number(fig.x[i].toPrecision(7))), ...cols.map(s => fmt(s.y[i]))].join(","));
  return lines.join("\n") + "\n";
}

const colorName = (k: string) => `xs${k}`;

export function texFigure(fig: Figure): string {
  const n = fig.panels.length;
  const out = [
    "\\begin{figure}[htbp]",
    "  \\centering",
    "  \\begin{tikzpicture}",
    `    \\begin{groupplot}[group style={group size=1 by ${n}, vertical sep=0.55cm, xlabels at=edge bottom, xticklabels at=edge bottom},`,
    `      width=0.9\\linewidth, height=${n > 2 ? "4.4" : "5.2"}cm, xmode=log, xmin=${fmt(fig.xrange[0])}, xmax=${fmt(fig.xrange[1])},`,
    `      xlabel={${texEscape(fig.xlabel)}}, log ticks with fixed point, grid=both, minor grid style={black!8}, major grid style={black!20},`,
    "      unbounded coords=jump, tick label style={font=\\footnotesize}, label style={font=\\small}, every axis plot/.append style={line width=0.8pt}]",
  ];
  fig.panels.forEach((p, pi) => {
    const yr = yRange(p);
    const legend = pi === 0 ? ", legend columns=2, legend cell align=left, legend style={at={(0.5,1.03)}, anchor=south, draw=none, font=\\footnotesize, /tikz/every even column/.append style={column sep=8pt}}" : "";
    out.push(`    \\nextgroupplot[ylabel={${texEscape(p.ylabel)}}, ymin=${fmt(yr.min)}, ymax=${fmt(yr.max)}, ytick distance=${fmt(yr.step)}${legend}]`);
    if (p.band) {
      const [x0, x1] = p.band.x, [y0, y1] = p.band.y.map(fmt);
      out.push(`    \\addplot[draw=none, fill=black, fill opacity=0.08, forget plot] coordinates {(${x0},${y0}) (${x1},${y0}) (${x1},${y1}) (${x0},${y1})} -- cycle;`);
    }
    for (const s of p.series) {
      out.push(`    \\addplot[${colorName(s.color)}${s.dash ? ", dashed" : ""}${s.color === "sum" ? ", line width=1.1pt" : ""}] table[x=f, y=${s.col}, col sep=comma]{\\xsdatapath ${fig.file}};`);
      if (pi === 0) out.push(`    \\addlegendentry{${texEscape(s.legend)}}`);
    }
  });
  out.push(
    "    \\end{groupplot}",
    "  \\end{tikzpicture}",
    `  \\caption{${texEscape(fig.caption)}}`,
    `  \\label{fig:xs-${fig.id.replace(/_/g, "-")}}`,
    "\\end{figure}",
  );
  return out.join("\n");
}

// ---------------------------------------------------------------- code
/** Break a long line for print at the operators of an LTspice expression, at most `width` characters. */
export function breakLine(s: string, width = 78): string[] {
  const out: string[] = [];
  let rest = s;
  while (rest.length > width) {
    let k = -1;
    for (let i = width; i > width / 2; i--) if ("+*/(".includes(rest[i])) { k = i; break; }
    if (k < 0) k = width;
    out.push(rest.slice(0, k));
    rest = "    " + rest.slice(k);
  }
  out.push(rest);
  return out;
}

function texCode(c: CodeBlock): string {
  const lines = c.text.split("\n").flatMap(l => (c.breakable ? breakLine(l) : [l]));
  return [
    `\\paragraph{${texEscape(c.title)}}${c.breakable ? " (lines broken for print; paste the unbroken text from the app)" : ""}`,
    "{\\footnotesize",
    "\\begin{verbatim}",
    ...lines.map(ascii),
    "\\end{verbatim}",
    "}",
  ].join("\n");
}

// ---------------------------------------------------------------- files
function texSection(s: ReportSection): string {
  return [
    `\\subsection{${texEscape(s.title)}}`,
    `\\label{sec:xs-${s.id}}`,
    "",
    ...s.intro.flatMap(p => [texEscape(p), ""]),
    ...s.tables.flatMap(t => [texTable(t), ""]),
    ...s.code.flatMap(c => [texCode(c), ""]),
    ...s.figures.flatMap(f => [texFigure(f), ""]),
  ].join("\n");
}

export const PREAMBLE = [
  "% Packages the Crossover Studio report section needs. Copy these lines into your preamble",
  "% (Overleaf: main.tex, before \\begin{document}).",
  "\\usepackage{booktabs}",
  "\\usepackage{siunitx}",
  "\\usepackage{pgfplots}",
  "\\pgfplotsset{compat=1.18}",
  "\\usepgfplotslibrary{groupplots}",
  "% Optional: the folder the fig_*.csv files are in, relative to the main .tex, with a trailing slash:",
  "% \\newcommand{\\xsdatapath}{loudspeaker/}",
  "",
].join("\n");

export function latexFiles(r: Report): ExportFile[] {
  const tex = `report_${r.base}.tex`;
  const figs = r.sections.flatMap(s => s.figures);
  const head = [
    `% Loudspeaker design section written by Crossover Studio: ${ascii(r.profileName)}, design "${ascii(r.designName)}".`,
    "% Regenerate it from the app after every design change instead of editing the numbers by hand.",
    "% Needs the packages in preamble_snippet.tex. Figures read fig_*.csv from \\xsdatapath (default: the main folder).",
    "% Phase columns hold nan at each +/-180 deg wrap, so the plotted line breaks there instead of jumping.",
    "\\providecommand{\\xsdatapath}{}",
    ...Object.entries(PALETTE).map(([k, hex]) => `\\definecolor{${colorName(k)}}{HTML}{${hex.slice(1).toUpperCase()}}`),
    "",
    "\\section{Loudspeaker design}",
    "\\label{sec:xs-design}",
    "",
    texEscape(`This section documents the design "${r.designName}" of ${r.profileName}: the measured drivers (Lab D and Lab E) combined with the simulated digital and passive crossover.`),
    "",
  ];
  const body = r.sections.map(texSection);
  const main = [
    "% Standalone preview of the Crossover Studio report section: compile this file on its own.",
    "\\documentclass[11pt,a4paper]{article}",
    "\\usepackage[margin=2.2cm]{geometry}",
    "\\input{preamble_snippet}",
    "\\begin{document}",
    `\\input{report_${r.base}}`,
    "\\end{document}",
    "",
  ].join("\n");
  return [
    { name: tex, contents: [...head, ...body].join("\n").replace(/\n{3,}/g, "\n\n") },
    ...figs.map(f => ({ name: f.file, contents: figureCsv(f) })),
    { name: "preamble_snippet.tex", contents: PREAMBLE },
    { name: "main_preview.tex", contents: main },
  ];
}
