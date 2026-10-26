// Report pack, part 4: the quiz-numbers sheet. Every number the report tables hold, one
// "name = value unit" per line, in plain ASCII so it pastes into a DTU Learn quiz or form as it is
// (no LaTeX, no special symbols: "ohm", "uF", "deg").

import { ascii } from "../ltspice";
import { cellText, type QuizRef, type Table } from "./tables";

export interface QuizGroup { title: string; tables: Table[] }

/** One line per quiz-tagged cell of the tables, grouped under "# <section>" headings. */
export function quizText(groups: QuizGroup[], header: string[]): string {
  const lines = header.map(h => `# ${h}`);
  for (const g of groups) {
    const items: string[] = [];
    for (const t of g.tables) for (const r of t.rows) {
      const refs: QuizRef[] = r.quiz ? (Array.isArray(r.quiz) ? r.quiz : [r.quiz]) : [];
      for (const q of refs) items.push(`${q.name} = ${cellText(r.cells[q.col], "plain")}`);
    }
    if (items.length) lines.push("", `# ${g.title}`, ...items);
  }
  // the tables are built from engine text that may hold typographic characters: keep the sheet ASCII
  return ascii(lines.join("\n").replace(/[−–—]/g, "-").replace(/°/g, " deg").replace(/Ω/g, "ohm").replace(/±/g, "+/-")) + "\n";
}
