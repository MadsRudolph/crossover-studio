/// <reference types="node" />
// Report pack with the listening test: the subsection appears only with ratings, holds the method,
// attribute and result tables and the conclusions, sets the means with siunitx, has a balanced pgfplots
// figure and an SVG in the Markdown, and stays deterministic. Writes the LaTeX folder for
// scripts/verify_report.py (XS_REPORT_LT_DIR, default <tmp>/xs-report-listening).
import { describe, expect, it } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { assess, compute, fitBox, prepare } from "../../engine";
import { BUNDLED_PROFILES, defaultDesign } from "../../state/store";
import { demoDoc } from "../../listentest/demo";
import { ALL_SECTIONS, buildReport, reportLatexFiles, reportMarkdown, splitSvg, type ReportInput } from ".";

const OUT = process.env.XS_REPORT_LT_DIR ?? join(tmpdir(), "xs-report-listening");
const profile = BUNDLED_PROFILES[0];
const prep = prepare(profile, fitBox(profile));
const design = defaultDesign(profile);
const results = compute(prep, design);
const base: ReportInput = { profile, prep, design, results, assessment: assess(prep, design, results), designName: "Reference design" };
const doc = demoDoc(profile, design);
const x: ReportInput = { ...base, listening: { protocol: doc.protocol, ratings: doc.ratings } };

describe("listening-test section", () => {
  const report = buildReport(x, ALL_SECTIONS);
  const files = reportLatexFiles(report), tex = files[0].contents, md = reportMarkdown(report);

  it("is left out without ratings, chosen or not", () => {
    for (const input of [base, { ...base, listening: { protocol: doc.protocol, ratings: [] } }])
      expect(buildReport(input, ALL_SECTIONS).sections.map(s => s.id)).not.toContain("listening");
  });

  it("comes after the checks, with the method, attribute and result tables", () => {
    const ids = report.sections.map(s => s.id);
    expect(ids.indexOf("listening")).toBe(ids.indexOf("checks") + 1);
    const s = report.sections.find(s => s.id === "listening")!;
    expect(s.tables.map(t => t.id)).toEqual(["listening-method", "listening-attributes", "listening-results"]);
    expect(s.intro.join(" ")).toMatch(/IEC 60268-13/);
    expect(s.intro.join(" ")).toMatch(/Bech and Zacharov/);
    expect(s.intro.join(" ")).toMatch(/Williams balanced Latin square/);
    expect(s.outro!.some(p => /^Tweeter Rs one step up had less harshness \/ sibilance, \d\.\d vs \d\.\d/.test(p))).toBe(true);
  });

  it("writes balanced, ASCII LaTeX with booktabs, siunitx numbers and a pgfplots figure with error bars", () => {
    expect(tex).toContain("\\subsection{Listening test (Task 4)}");
    expect(tex).toContain("\\label{tab:xs-listening-results}");
    expect(tex).toMatch(/\\num\{\d\.\d\} & \\num\{\d\.\d\} & 6 \\\\/);
    expect(tex).toContain("error bars/.cd, x dir=both, x explicit");
    expect(tex).toContain("\\label{fig:xs-listening}");
    const stack: string[] = [];
    for (const m of tex.matchAll(/\\(begin|end)\{([^}]+)\}/g)) { if (m[1] === "begin") stack.push(m[2]); else expect(stack.pop()).toBe(m[2]); }
    expect(stack).toEqual([]);
    for (const f of files) expect(/^[\x09\x0a\x0d\x20-\x7e]*$/.test(f.contents), f.name).toBe(true);
    // the colours it uses are the ones the header defines
    for (const m of tex.matchAll(/\\addplot\[(xs\w+), only marks/g)) expect(tex).toContain(`\\definecolor{${m[1]}}`);
  });

  it("gives the Markdown a table and one more inline SVG", () => {
    expect(md).toContain("### Listening test (Task 4)");
    expect(md).toMatch(/\| Attribute \| Variant \| Mean \| 95 % CI ± \| n \|/);
    const without = reportMarkdown(buildReport(base, ALL_SECTIONS));
    expect(splitSvg(md).filter(c => c.kind === "svg").length).toBe(splitSvg(without).filter(c => c.kind === "svg").length + 1);
  });

  it("is deterministic", () => {
    const again = buildReport(x, ALL_SECTIONS);
    expect(reportLatexFiles(again)).toEqual(files);
    expect(reportMarkdown(again)).toBe(md);
  });

  it("writes the LaTeX folder for scripts/verify_report.py", () => {
    mkdirSync(OUT, { recursive: true });
    for (const f of files) writeFileSync(join(OUT, f.name), f.contents);
    writeFileSync(join(OUT, "report.md"), md);
  });
});
