/// <reference types="node" />
// Report pack on the bundled System D profile and the default design: units in every table, the course's
// axis-label rules, phase partners, clean CSV files, balanced LaTeX, determinism and the quiz sheet.
// Also writes the LaTeX folder to disk so scripts/verify_report.py can compile it with tectonic.
import { describe, expect, it } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { assess, compute, fitBox, prepare } from "../../engine";
import { BUNDLED_PROFILES, defaultDesign } from "../../state/store";
import type { Design } from "../../types";
import { bom } from "../parts";
import { ALL_SECTIONS, buildReport, reportLatexFiles, reportMarkdown, splitSvg, type ReportInput } from ".";
import { allFigures } from "./figures";
import { breakLine, texEscape, texSymbol } from "./latex";
import { cellText, numText, partCell } from "./tables";

const OUT = process.env.XS_REPORT_DIR ?? join(tmpdir(), "xs-report");
const profile = BUNDLED_PROFILES[0];
const prep = prepare(profile, fitBox(profile));

function input(design: Design = defaultDesign(profile), designName = "Reference design"): ReportInput {
  const results = compute(prep, design);
  return { profile, prep, design, results, assessment: assess(prep, design, results), designName };
}
const x = input();
const report = buildReport(x, ALL_SECTIONS);
const files = reportLatexFiles(report);
const file = (n: string) => files.find(f => f.name === n)?.contents ?? "";
const tex = file("report_system-d-group10.tex");

// a number followed by one of the report's units (Markdown text of a cell)
const UNIT_RE = /\d\s(Hz|dB|dB re 1 Pa\/V|Ω|L|mm|g|T m|mH|µF|kg\/m⁴|%)(\s|$|\))/;

describe("tables", () => {
  const tables = report.sections.flatMap(s => s.tables);

  it("covers every section's tables", () => {
    expect(tables.map(t => t.id)).toEqual(["box-ts", "box-setting", "box-vents", "digital", "passive-topo", "passive-bom", "response", "checks", "verdict"]);
  });

  it("puts a unit on every number, except quality factors and scores", () => {
    for (const t of tables) for (const r of t.rows) r.cells.forEach((c, i) => {
      const col = t.columns[i];
      if (c.kind === "num") {
        if (c.unitless) { expect(["Q", "score"]).toContain(c.unitless); return; }
        expect(c.unit, `${t.id}: ${cellText(c)}`).not.toBeNull();
        expect(cellText(c), t.id).toMatch(UNIT_RE);
      } else if (!col.prose && i > 0) {
        // a value written as text holds no bare number (the first column names the quantity; "L1_mid" is a name)
        expect(c.text, `${t.id}: "${c.text}"`).not.toMatch(/(?<![\w./])\d+(\.\d+)?(?![\w./])(?!\s?(Hz|kHz|dB|mm|Ω|deg))/);
      }
    });
  });

  it("holds the design's numbers", () => {
    const md = reportMarkdown(report);
    expect(md).toMatch(/\| f_B \| 24\.6 Hz \|/);
    expect(md).toMatch(/\| f_c \| 325 Hz \|/);
    expect(md).toMatch(/\| L1_mid \| 0\.82 mH \|/);
    expect(md).toMatch(/\| C1_tw \| 5\.6 µF \|/);
    expect(md).toMatch(/\| Rs_tw \| 4\.7 Ω \|/);
  });

  it("formats numbers without a negative zero and with an explicit sign where asked", () => {
    expect(numText({ kind: "num", value: -0.01, unit: null, digits: 1 })).toBe("0.0");
    expect(numText({ kind: "num", value: 1.78, unit: null, digits: 1, sign: true })).toBe("+1.8");
    expect(cellText(partCell("C", 6.8e-6), "plain")).toBe("6.8 uF");
    expect(cellText(partCell("L", 0.00082))).toBe("0.82 mH");
  });
});

describe("figures", () => {
  const figs = allFigures(x);

  it("are the six figures of the spec, each with its CSV in the folder", () => {
    expect(figs.map(f => f.file)).toEqual(["fig_box.csv", "fig_box_impedance.csv", "fig_filters.csv", "fig_response.csv", "fig_load.csv", "fig_offaxis.csv"]);
    for (const f of figs) expect(files.some(g => g.name === f.file), f.file).toBe(true);
  });

  it("never put [unit] brackets in an axis label and name the unit in parentheses", () => {
    for (const f of figs) for (const label of [f.xlabel, ...f.panels.map(p => p.ylabel)]) {
      expect(label).not.toMatch(/[[\]]/);
      expect(/^[A-Z][^[\]]*\([^)]+\)$/.test(label) || label.includes(" / "), label).toBe(true);
    }
    expect(tex).not.toMatch(/(xlabel|ylabel)=\{[^}]*[[\]]/);
  });

  it("give every magnitude series a phase partner in the same figure", () => {
    for (const f of figs) {
      const all = f.panels.flatMap(p => p.series);
      for (const s of all.filter(s => s.kind === "mag"))
        expect(all.some(q => q.kind === "phase" && q.partner === s.col), `${f.id}: ${s.col}`).toBe(true);
      for (const s of all.filter(s => s.kind === "phase")) expect(all.some(q => q.col === s.partner), `${f.id}: ${s.col}`).toBe(true);
    }
  });

  it("write CSV files with equal columns on the figure's grid and no infinities", () => {
    for (const f of figs) {
      const lines = file(f.file).trimEnd().split("\n"), head = lines[0].split(",");
      expect(head[0]).toBe("f");
      expect(new Set(head).size, f.file).toBe(head.length);
      expect(lines.length - 1, f.file).toBe(f.x.length);
      expect(f.x.length).toBe(f.id.startsWith("box") ? 400 : prep.f.length);
      for (const l of lines.slice(1)) {
        const cells = l.split(",");
        expect(cells.length, f.file).toBe(head.length);
        for (const c of cells) expect(c === "nan" || Number.isFinite(Number(c)), `${f.file}: ${c}`).toBe(true);
      }
      expect(file(f.file)).not.toMatch(/Infinity|NaN/);
    }
  });
});

describe("LaTeX", () => {
  it("balances every \\begin with its \\end, in the .tex and the preview", () => {
    for (const t of [tex, file("main_preview.tex")]) {
      const stack: string[] = [];
      for (const m of t.matchAll(/\\(begin|end)\{([^}]+)\}/g)) {
        if (m[1] === "begin") stack.push(m[2]);
        else expect(stack.pop()).toBe(m[2]);
      }
      expect(stack).toEqual([]);
    }
  });

  it("references only CSV files it writes, and \\inputs the files it writes", () => {
    const refs = [...tex.matchAll(/\{\\xsdatapath ([^}]+)\}/g)].map(m => m[1]);
    expect(refs.length).toBeGreaterThan(10);
    for (const r of new Set(refs)) expect(files.map(f => f.name)).toContain(r);
    for (const m of file("main_preview.tex").matchAll(/\\input\{([^}]+)\}/g)) expect(files.map(f => f.name)).toContain(`${m[1]}.tex`);
  });

  it("is plain ASCII, sets numbers with siunitx and uses booktabs and the packages it lists", () => {
    for (const f of files) expect(/^[\x09\x0a\x0d\x20-\x7e]*$/.test(f.contents), f.name).toBe(true);
    expect(tex).toContain("\\section{Loudspeaker design}");
    expect(tex).toMatch(/\\SI\{24\.6\}\{\\hertz\}/);
    expect(tex).toMatch(/\\SI\{0\.82\}\{\\milli\\henry\}/);
    expect(tex).toContain("\\toprule");
    expect(tex).toContain("\\begin{groupplot}[group style={group size=1 by 2");
    expect(tex).toContain("table[x=f, y=sum_db, col sep=comma]{\\xsdatapath fig_response.csv}");
    const pre = file("preamble_snippet.tex");
    for (const p of ["booktabs", "siunitx", "pgfplots", "compat=1.18", "groupplots"]) expect(pre).toContain(p);
  });

  it("writes only the chosen subsections", () => {
    const r = buildReport(x, ["digital", "quiz"]);
    const t = reportLatexFiles(r);
    const body = t[0].contents;
    expect([...body.matchAll(/\\subsection\{([^}]+)\}/g)].map(m => m[1])).toEqual(["Digital crossover", "Quiz numbers"]);
    expect(t.filter(f => f.name.endsWith(".csv"))).toEqual([]);
    expect(body).toContain("biquad1,");
  });

  it("escapes text and sets symbols as math", () => {
    expect(texEscape("50 % & #1_a {x} ±2 dB, 4.7 Ω, 20 µPa, 30°")).toBe("50 \\% \\& \\#1\\_a \\{x\\} $\\pm$2 dB, 4.7 $\\Omega$, 20 \\textmu{}Pa, 30\\textdegree{}");
    expect(texSymbol("f_s")).toBe("$f_\\mathrm{s}$");
    expect(texSymbol("M_AP")).toBe("$M_\\mathrm{AP}$");
    expect(texSymbol("pol_woof")).toBe("\\texttt{pol\\_woof}");
    const long = "Laplace=(0.000111435745339139+0.000222871490678279*exp(-s*1.04166666666667e-05)+0.000111435745339139*exp(-2*s*1.04166666666667e-05))";
    const lines = breakLine(long);
    expect(lines.every(l => l.length <= 78)).toBe(true);
    expect(lines.map(l => l.trimStart()).join("")).toBe(long);
  });
});

describe("output", () => {
  it("is deterministic: two runs give byte-identical files", () => {
    const again = buildReport(input(), ALL_SECTIONS);
    expect(reportLatexFiles(again)).toEqual(files);
    expect(reportMarkdown(again)).toBe(reportMarkdown(report));
    expect(again.quiz).toBe(report.quiz);
  });

  it("gives Markdown with pipe tables and one inline SVG per figure", () => {
    const md = reportMarkdown(report);
    expect(md.startsWith("## Loudspeaker design")).toBe(true);
    expect((md.match(/<svg /g) ?? []).length).toBe(allFigures(x).length);
    expect(md).toMatch(/\|---\|---\|---:\|/);
    const chunks = splitSvg(md);
    expect(chunks.filter(c => c.kind === "svg").length).toBe(allFigures(x).length);
    expect(chunks.map(c => c.text).join("")).toBe(md.replace(/\n+$/, "\n").replace(/\n\n(?=<svg)/g, "\n\n"));
  });

  it("quiz sheet: f_B, f_3, f_c, every part and the score, plain ASCII and no backslash", () => {
    const q = report.quiz;
    expect(q).toMatch(/^f_B = 24\.6 Hz$/m);
    expect(q).toMatch(/^f_3 = 33\.1 Hz$/m);
    expect(q).toMatch(/^f_c = 325 Hz$/m);
    expect(q).toMatch(/^score = \d+$/m);
    expect(q).toMatch(/^M_AP\(A 160 mm\) = 67\.4 kg\/m\^4$/m);
    for (const r of bom(profile, x.design)) expect(q).toContain(`${r.ref} = ${cellText(partCell(r.kind, r.value), "plain")}`);
    expect(q).not.toContain("\\");
    expect(/^[\x0a\x20-\x7e]*$/.test(q)).toBe(true);
    for (const l of q.trimEnd().split("\n")) expect(l === "" || l.startsWith("# ") || / = /.test(l), l).toBe(true);
  });

  it("builds for a closed box and an inverted tweeter as well", () => {
    const d = defaultDesign(profile);
    d.box = { ...d.box, mode: "plugged" }; d.pol.tw = -1;
    const r = buildReport(input(d), ALL_SECTIONS);
    const box = r.sections[0].figures[0];
    expect(box.panels.map(p => p.ylabel)).not.toContain("Vent speed (m/s)");
    expect(r.quiz).toMatch(/^pol_tw = inverted \(-\)$/m);
    expect(r.quiz).not.toMatch(/^f_B = /m);
  });

  it("writes the LaTeX folder for scripts/verify_report.py", () => {
    mkdirSync(OUT, { recursive: true });
    for (const f of files) writeFileSync(join(OUT, f.name), f.contents);
    writeFileSync(join(OUT, "report.md"), reportMarkdown(report));
    writeFileSync(join(OUT, "quiz.txt"), report.quiz);
  });
});
