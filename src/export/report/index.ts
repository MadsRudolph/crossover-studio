// Report pack: a "Loudspeaker design" report section built from the current design, as a LaTeX folder
// (booktabs tables, siunitx numbers, pgfplots figures over CSV files) and as Markdown (pipe tables, inline
// SVG figures), plus a plain-text quiz-numbers sheet. Everything here is pure and deterministic: the same
// design gives byte-identical files, so a group can regenerate the section after every design iteration.
//
// Modules: tables.ts (value model, tables), figures.ts (figure data), svg.ts (SVG plotter),
// latex.ts and markdown.ts (writers), quiz.ts (the quiz sheet).

import { minidspFileText } from "../minidsp";
import { ltspiceText } from "../../engine";
import { safeName } from "../parts";
import type { ExportFile } from "../ltspice";
import { boxFigures, filterFigures, offAxisFigures, responseFigures, type Figure } from "./figures";
import { quizText } from "./quiz";
import { alignName, boxTables, checkTables, digitalTables, passiveTables, responseTables, type ReportInput, type Table } from "./tables";
import { latexFiles } from "./latex";
import { markdownReport } from "./markdown";

export type { ReportInput } from "./tables";
export { figureSvg } from "./svg";
export { splitSvg } from "./markdown";

export type SectionId = "box" | "digital" | "passive" | "response" | "offaxis" | "checks" | "quiz";

export const SECTIONS: { id: SectionId; title: string; hint: string }[] = [
  { id: "box", title: "Woofer box (Task 1)", hint: "Fitted T/S parameters, box setting, SPL, excursion, vent speed and the impedance fit" },
  { id: "digital", title: "Digital crossover", hint: "Crossover frequency, alignment, woofer gain, polarities, MiniDSP and LTspice text" },
  { id: "passive", title: "Passive crossover", hint: "Topologies, parts list, transfer to the driver terminals" },
  { id: "response", title: "System response", hint: "Units and sum on axis with the ±2 dB band, amplifier load, metrics" },
  { id: "offaxis", title: "Off axis", hint: "The sum at every measured angle" },
  { id: "checks", title: "Checks & verdict", hint: "Every check and the verdict scores" },
  { id: "quiz", title: "Quiz numbers", hint: "Every number above as name = value unit" },
];
export const ALL_SECTIONS: SectionId[] = SECTIONS.map(s => s.id);

export interface CodeBlock {
  title: string;
  text: string;
  /** Long single-line strings (LTspice Laplace): the LaTeX copy may break them for print. */
  breakable?: boolean;
}

export interface ReportSection {
  id: SectionId;
  title: string;
  /** Short paragraphs, plain text (the writers escape them). */
  intro: string[];
  tables: Table[];
  code: CodeBlock[];
  figures: Figure[];
}

export interface Report {
  /** File-safe profile name: report_<base>.tex. */
  base: string;
  profileName: string;
  designName: string;
  sections: ReportSection[];
  /** The plain-text quiz sheet (every section's numbers, whatever is selected). */
  quiz: string;
}

// ---------------------------------------------------------------- sections
function boxSection(x: ReportInput): ReportSection {
  const fit = x.prep.fit, res = x.results.box;
  return {
    id: "box", title: "Woofer box (Task 1)",
    intro: [
      `The woofer is modelled as a lumped electro-mechano-acoustic circuit. Its parameters are fitted jointly to the Lab D impedance curves (free air, closed box and every measured vent length); the vent's effective acoustic mass M_AP is fitted per measured length rather than taken from the tube formula.`,
      `The box is set to ${res.label}${res.fB ? `, which tunes it to ${res.fB.toFixed(1)} Hz` : ""}; the lower -3 dB point of the model is ${res.f3.toFixed(1)} Hz. The measured woofer response (Lab E) was taken with the vent plugged, so the system model multiplies it by the model's ratio of the designed box over the plugged box. Fit residual (mean squared log error): driver ${fit.quality.driver.toExponential(2)}, vents ${fit.quality.vents.toExponential(2)}.`,
    ],
    tables: boxTables(x), code: [], figures: boxFigures(x),
  };
}

function digitalSection(x: ReportInput): ReportSection {
  const dg = x.design.digital;
  const laplace = (kind: "LPF" | "HPF") => ltspiceText(null, dg.fc, kind, dg.align).map((s, i) => `LaplaceTXT_E${i + 1}: ${s}`).join("\n");
  return {
    id: "digital", title: "Digital crossover",
    intro: [
      `The MiniDSP splits the signal at ${dg.fc} Hz with a ${alignName(dg.align)} alignment: output 1 low-passes the woofer, output 2 high-passes the midrange and tweeter, whose passive boards share amplifier channel 2. The biquads are the RBJ designs at 96 kHz of the course's DigitalCrossover.m; the coefficients below are its text, ready for the MiniDSP custom biquad dialog.`,
    ],
    tables: digitalTables(x),
    code: [
      { title: "MiniDSP output 1 (woofer, low-pass)", text: minidspFileText(dg.fc, "LPF", dg.align) },
      { title: "MiniDSP output 2 (midrange and tweeter, high-pass)", text: minidspFileText(dg.fc, "HPF", dg.align) },
      { title: "LTspice Laplace strings, low-pass", text: laplace("LPF"), breakable: true },
      { title: "LTspice Laplace strings, high-pass", text: laplace("HPF"), breakable: true },
    ],
    figures: [],
  };
}

function passiveSection(x: ReportInput): ReportSection {
  return {
    id: "passive", title: "Passive crossover",
    intro: [
      "Each passive board is an ABCD ladder from the amplifier to the driver, loaded with the driver's measured input impedance (Lab D), so the transfer includes the interaction with the real voice-coil impedance. Parts are chosen from the course component list where possible.",
    ],
    tables: passiveTables(x), code: [], figures: filterFigures(x),
  };
}

function responseSection(x: ReportInput): ReportSection {
  return {
    id: "response", title: "System response",
    intro: [
      "The system response sums the measured Lab E transfer function of every unit (one run per angle, so the relative phase and the driver offsets are real) multiplied by its simulated crossover path. The judging band is 150 Hz to 15 kHz after 1/6-octave smoothing.",
    ],
    tables: responseTables(x), code: [], figures: responseFigures(x),
  };
}

function offAxisSection(x: ReportInput): ReportSection {
  const figs = offAxisFigures(x);
  return {
    id: "offaxis", title: "Off axis",
    intro: [figs.length
      ? "The same crossover applied to the off-axis Lab E runs shows how evenly the system radiates; the drivers' directivity and their vertical offsets decide the off-axis sum."
      : "Only the on-axis measurement is in the profile, so there is no off-axis response to show."],
    tables: [], code: [], figures: figs,
  };
}

function checksSection(x: ReportInput): ReportSection {
  return {
    id: "checks", title: "Checks & verdict",
    intro: ["The checks apply the design rules of the project guide and Lecture 9; the verdict weighs them into a 0-100 score. The listening test (Task 4) remains the final judge."],
    tables: checkTables(x), code: [], figures: [],
  };
}

/** Build the report for the chosen sections (in the fixed section order). */
export function buildReport(x: ReportInput, include: readonly SectionId[]): Report {
  const builders: Record<Exclude<SectionId, "quiz">, (x: ReportInput) => ReportSection> = {
    box: boxSection, digital: digitalSection, passive: passiveSection, response: responseSection, offaxis: offAxisSection, checks: checksSection,
  };
  const content = (Object.keys(builders) as Exclude<SectionId, "quiz">[]).map(id => builders[id](x));
  const quiz = quizText(content.map(s => ({ title: s.title, tables: s.tables })),
                        [`${x.profile.name}: ${x.designName}`, "Crossover Studio quiz numbers, one name = value unit per line"]);
  const sections: ReportSection[] = content.filter(s => include.includes(s.id));
  if (include.includes("quiz")) sections.push({
    id: "quiz", title: "Quiz numbers",
    intro: ["Every number of this section as plain text, for the DTU Learn quiz."],
    tables: [], figures: [], code: [{ title: "Quiz numbers", text: quiz.trimEnd() }],
  });
  return { base: safeName(x.profile.id), profileName: x.profile.name, designName: x.designName, sections, quiz };
}

/** The LaTeX folder: report_<profile>.tex, one CSV per figure, preamble_snippet.tex and main_preview.tex. */
export function reportLatexFiles(r: Report): ExportFile[] {
  return latexFiles(r);
}

/** The report as one Markdown document with inline SVG figures. */
export function reportMarkdown(r: Report): string {
  return markdownReport(r);
}
