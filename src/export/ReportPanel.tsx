// Report tab: the design as a "Loudspeaker design" section for the group report. A LaTeX folder for
// Overleaf (booktabs tables, siunitx numbers, pgfplots figures from CSV), the same as Markdown with SVG
// figures, and the quiz-numbers sheet for DTU Learn. Regenerate it after every design iteration.
import { Check, ClipboardList, Copy, Download, FileText, FolderOpen } from "lucide-react";
import { useMemo, useState } from "react";
import { assess, type Prepared } from "../engine";
import { isTauri } from "../platform";
import { useStore } from "../state/store";
import type { Design, Profile } from "../types";
import { Button, EmptyState, ProgressBar, Toggle, toast } from "../ui";
import { bytesLabel, copyText, pickFolder, saveTextFile, writeFolder } from "./io";
import { ALL_SECTIONS, SECTIONS, buildReport, reportLatexFiles, reportMarkdown, splitSvg, type SectionId } from "./report";
import "./report.css";

const SECTIONS_KEY = "crossover-studio:report-sections";

function initialSections(): SectionId[] {
  try {
    const v = JSON.parse(localStorage.getItem(SECTIONS_KEY) ?? "null");
    if (Array.isArray(v)) return ALL_SECTIONS.filter(id => v.includes(id));
  } catch { /* storage unavailable or not JSON */ }
  return ALL_SECTIONS;
}

export function ReportPanel({ profile, prep, design, designName }: { profile: Profile; prep: Prepared; design: Design; designName: string }) {
  const results = useStore(s => s.results);
  const [chosen, setChosen] = useState<SectionId[]>(initialSections);
  const [busy, setBusy] = useState<number | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const built = useMemo(() => {
    if (!results) return { error: "The design has no results yet.", out: null };
    try {
      const report = buildReport({ profile, prep, design, results, assessment: assess(prep, design, results), designName }, chosen);
      return { error: null, out: { report, files: reportLatexFiles(report), md: reportMarkdown(report) } };
    } catch (e) { return { error: String((e as Error)?.message ?? e), out: null }; }
  }, [profile, prep, design, results, designName, chosen]);

  const toggle = (id: SectionId, on: boolean) => {
    const next = ALL_SECTIONS.filter(s => (s === id ? on : chosen.includes(s)));
    setChosen(next); setDone(null);
    try { localStorage.setItem(SECTIONS_KEY, JSON.stringify(next)); } catch { /* storage unavailable */ }
  };

  if (!built.out) return <EmptyState tone="bad" icon={FileText} title="The report cannot be built" description={built.error ?? ""} />;
  const { report, files, md } = built.out;
  const none = chosen.length === 0;
  const tex = files[0];
  const tables = report.sections.reduce((n, s) => n + s.tables.length, 0);
  const figures = report.sections.reduce((n, s) => n + s.figures.length, 0);
  const total = files.reduce((n, f) => n + f.contents.length, 0);

  const saveFolder = async () => {
    let dir: string | null = null;
    if (isTauri()) {
      try { dir = await pickFolder("Choose a folder for the report files"); }
      catch (e) { toast({ tone: "bad", title: "Could not open the folder picker", description: String(e) }); return; }
      if (!dir) return;
    }
    setBusy(0); setDone(null);
    try {
      await writeFolder(dir, files, i => setBusy(i));
      setDone(dir ?? "your downloads");
      toast({ tone: "good", title: "Report folder written", description: `${files.length} files${dir ? ` in ${dir}` : ""}. Compile main_preview.tex, or \\input ${tex.name} in your report.` });
    } catch (e) {
      toast({ tone: "bad", title: "Could not write the report files", description: String((e as Error)?.message ?? e) });
    } finally { setBusy(null); }
  };

  return (
    <div className="xs-panel">
      <div className="xs-hero">
        <div className="xs-hero-text">
          <h3>Report section for Overleaf</h3>
          <p>
            The design as <span className="mono">\section{"{"}Loudspeaker design{"}"}</span>: booktabs tables with siunitx numbers, pgfplots
            figures drawn from CSV files, and every number on a quiz sheet. Regenerate it after each design change so the report never
            falls behind.
          </p>
        </div>
        <Button variant="primary" icon={FolderOpen} loading={busy !== null} disabled={busy !== null || none} onClick={saveFolder}>
          {isTauri() ? "Save LaTeX folder…" : "Download LaTeX files"}
        </Button>
      </div>
      {busy !== null && <ProgressBar value={busy / files.length} label={`Writing ${busy} of ${files.length}`} />}
      {done && busy === null && (
        <p className="xs-done" role="status"><Check size={14} aria-hidden /> Written to <span className="mono">{done}</span>. Compile <span className="mono">main_preview.tex</span>, or copy <span className="mono">preamble_snippet.tex</span> into your preamble and <span className="mono">\input{"{"}{tex.name.replace(/\.tex$/, "")}{"}"}</span>.</p>
      )}

      <div className="rp-grid">
        <section className="rp-sections" aria-labelledby="rp-sections-h">
          <h3 id="rp-sections-h" className="label-caps">Sections</h3>
          <ul>
            {SECTIONS.map(s => (
              <li key={s.id}>
                <Toggle size="sm" checked={chosen.includes(s.id)} onChange={on => toggle(s.id, on)}>{s.title}</Toggle>
                <span className="rp-hint">{s.hint}</span>
              </li>
            ))}
          </ul>
          <p className="xs-note rp-lang">Language: English, matching the report. Figures follow the Lab A grading rules: no [unit] brackets, a phase panel for every complex quantity, dB with its reference.</p>
          <div className="rp-actions">
            <Button size="sm" variant="subtle" icon={Copy} disabled={none} onClick={() => copyText(md, "Report (Markdown)")}>Copy Markdown</Button>
            <Button size="sm" variant="subtle" icon={Download} disabled={none}
                    onClick={() => saveTextFile(`report_${report.base}.md`, md, "md", "Report")}>Save .md</Button>
            <Button size="sm" variant="subtle" icon={ClipboardList} onClick={() => copyText(report.quiz, "Quiz numbers")}>Copy quiz numbers</Button>
          </div>
        </section>

        <section className="rp-preview" aria-labelledby="rp-preview-h">
          <div className="xs-files-head label-caps">
            <span id="rp-preview-h">Preview</span>
            <span className="mono">{none ? "nothing chosen" : `${tables} tables · ${figures} figures · ${files.length} files · ${bytesLabel(total)}`}</span>
          </div>
          {none ? (
            <EmptyState icon={FileText} title="No section chosen" description="Switch on at least one section on the left to build the report." />
          ) : (
            <div className="rp-scroll" tabIndex={0} aria-label="Report preview (Markdown with figures)">
              {splitSvg(md).map((c, i) => c.kind === "svg"
                // the SVG is generated here from numbers and escaped labels, never from user markup
                ? <div key={i} className="rp-fig" dangerouslySetInnerHTML={{ __html: c.text }} />
                : <pre key={i} className="rp-md mono">{c.text.trim()}</pre>)}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
