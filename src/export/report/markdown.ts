// Report pack, Markdown writer: the same section as GitHub pipe tables, fenced code and inline SVG figures
// (Obsidian, VS Code and most Markdown previews draw them; paste the tables into any editor).

import type { Report, ReportSection } from "./index";
import { figureSvg } from "./svg";
import { cellText, type Table } from "./tables";

const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");

export function mdTable(t: Table, n: number): string {
  const sep = t.columns.map(c => (c.align === "r" ? "---:" : "---"));
  return [
    `**Table ${n}.** ${t.caption}`,
    "",
    `| ${t.columns.map(c => cell(c.head)).join(" | ")} |`,
    `|${sep.join("|")}|`,
    ...t.rows.map(r => `| ${r.cells.map(c => cell(cellText(c, "md"))).join(" | ")} |`),
  ].join("\n");
}

export function markdownReport(r: Report): string {
  let nt = 0, nf = 0;
  const section = (s: ReportSection) => [
    `### ${s.title}`,
    "",
    ...s.intro.flatMap(p => [p, ""]),
    ...s.tables.flatMap(t => [mdTable(t, ++nt), ""]),
    ...s.code.flatMap(c => [`**${c.title}**`, "", "```text", c.text, "```", ""]),
    ...s.figures.flatMap(f => [figureSvg(f), "", `*Figure ${++nf}. ${f.caption}*`, ""]),
  ];
  return [
    "## Loudspeaker design",
    "",
    `This section documents the design "${r.designName}" of ${r.profileName}: the measured drivers (Lab D and Lab E) combined with the simulated digital and passive crossover.`,
    "",
    ...r.sections.flatMap(section),
  ].join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

/** Split a report's Markdown into text and SVG chunks, for a preview that draws the figures. */
export function splitSvg(md: string): { kind: "text" | "svg"; text: string }[] {
  return md.split(/(<svg[\s\S]*?<\/svg>)/).filter(s => s.trim()).map(s => ({ kind: s.startsWith("<svg") ? "svg" : "text", text: s }));
}
