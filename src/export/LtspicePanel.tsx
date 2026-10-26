// LTspice tab: writes a complete, ready-to-run folder (schematic, plot settings, measured tables) and
// shows the Laplace strings for anyone who prefers to paste them into their own schematic.
import { Check, CircuitBoard, Copy, FileText, FolderOpen, LineChart, Table2 } from "lucide-react";
import { useMemo, useState } from "react";
import type { Prepared } from "../engine";
import { ltspiceText } from "../engine";
import { isTauri } from "../platform";
import type { Design } from "../types";
import { Button, EmptyState, IconButton, ProgressBar, fmtFreq, fmtLength, toast } from "../ui";
import { bytesLabel, copyText, pickFolder, writeFolder } from "./io";
import { buildLtspice, type ExportFile } from "./ltspice";

function describe(f: ExportFile, schematic: string): { icon: typeof FileText; what: string } {
  if (f.name === schematic) return { icon: CircuitBoard, what: "Schematic: digital E sources, passive boards, sum loops" };
  if (f.name.endsWith(".plt")) return { icon: LineChart, what: "Plot settings: system sum, units, amplifier load" };
  if (f.name === "README.txt") return { icon: FileText, what: "What every node and file is" };
  if (f.name.startsWith("Zi_")) return { icon: Table2, what: `Input impedance of the ${f.name.includes("mid") ? "midrange" : "tweeter"} (as admittance)` };
  if (f.name === "Box_woof.txt") return { icon: Table2, what: "Box tuning: designed box over the plugged box" };
  const m = /^TF(\d*|m\d+)_(woof|mid|tw)\.txt$/.exec(f.name);
  if (m) {
    const ang = m[1] ? m[1].replace(/^m/, "−") : "0";
    return { icon: Table2, what: `Measured p/V of the ${{ woof: "woofer", mid: "midrange", tw: "tweeter" }[m[2] as "woof"]} at ${ang}°` };
  }
  return { icon: FileText, what: "" };
}

export function LtspicePanel({ prep, design, designName }: { prep: Prepared; design: Design; designName: string }) {
  const built = useMemo(() => {
    try { return { ex: buildLtspice(prep, design, designName), error: null }; }
    catch (e) { return { ex: null, error: String((e as Error)?.message ?? e) }; }
  }, [prep, design, designName]);
  const [busy, setBusy] = useState<number | null>(null);
  const [done, setDone] = useState<string | null>(null);

  if (!built.ex) return <EmptyState tone="bad" icon={CircuitBoard} title="The LTspice export cannot be built" description={built.error} />;
  const ex = built.ex;
  const total = ex.files.reduce((n, f) => n + f.contents.length, 0);

  const run = async () => {
    let dir: string | null = null;
    if (isTauri()) {
      try { dir = await pickFolder("Choose a folder for the LTspice files"); }
      catch (e) { toast({ tone: "bad", title: "Could not open the folder picker", description: String(e) }); return; }
      if (!dir) return;
    }
    setBusy(0); setDone(null);
    try {
      await writeFolder(dir, ex.files, i => setBusy(i));
      setDone(dir ?? "your downloads");
      toast({ tone: "good", title: "LTspice folder written", description: `${ex.files.length} files${dir ? ` in ${dir}` : ""}. Open ${ex.schematic} and run.` });
    } catch (e) {
      toast({ tone: "bad", title: "Could not write the LTspice files", description: String((e as Error)?.message ?? e) });
    } finally { setBusy(null); }
  };

  const dg = design.digital;
  const strings = { LPF: ltspiceText(prep, dg.fc, "LPF", dg.align), HPF: ltspiceText(prep, dg.fc, "HPF", dg.align) };

  return (
    <div className="xs-panel">
      <div className="xs-hero">
        <div className="xs-hero-text">
          <h3>Complete system, ready to run</h3>
          <p>
            Figure 1 of the project guide, already wired: the MiniDSP biquads as E sources, both passive boards with
            your parts, every driver's measured impedance and response, and the sum at
            {" "}{ex.sums.map(s => s.angle === "0" ? "0°" : `${s.angle}°`).join(" and ")} as <span className="mono">{ex.sums.map(s => s.node).join(", ")}</span>.
          </p>
        </div>
        <Button variant="primary" icon={FolderOpen} loading={busy !== null} onClick={run} disabled={busy !== null}>
          {isTauri() ? "Export to folder…" : "Download files"}
        </Button>
      </div>
      {busy !== null && <ProgressBar value={busy / ex.files.length} label={`Writing ${busy} of ${ex.files.length}`} />}
      {done && busy === null && (
        <p className="xs-done" role="status"><Check size={14} aria-hidden /> Written to <span className="mono">{done}</span>. Open <span className="mono">{ex.schematic}</span> in LTspice and press Run.</p>
      )}

      <section className="xs-files" aria-label="Files in the export">
        <div className="xs-files-head label-caps"><span>{ex.files.length} files</span><span className="mono">{bytesLabel(total)}</span></div>
        <ul>
          {ex.files.map(f => {
            const d = describe(f, ex.schematic);
            const Icon = d.icon;
            return (
              <li key={f.name} className={f.name === ex.schematic ? "is-main" : undefined}>
                <Icon size={15} aria-hidden />
                <span className="xs-file-name mono">{f.name}</span>
                <span className="xs-file-what">{d.what}</span>
                <span className="xs-file-size mono">{bytesLabel(f.contents.length)}</span>
              </li>
            );
          })}
        </ul>
        <p className="xs-note">
          The files go straight into the folder you pick, so choose an empty one: files with the same names are replaced.
          The transfer functions carry the profile's phase distance (<span className="mono">{fmtLength(prep.profile.conditions.phase_ref_distance_m)}</span>), as Matlab2LTspice writes them.
        </p>
      </section>

      <section className="xs-laplace" aria-labelledby="xs-laplace-h">
        <h3 id="xs-laplace-h" className="label-caps">Laplace strings for your own schematic</h3>
        <p className="xs-note">One per biquad, the same text DigitalCrossover.m prints as LaplaceTXT_E1 / E2 ({dg.align} at {fmtFreq(dg.fc)}).</p>
        {(["LPF", "HPF"] as const).flatMap(k => strings[k].map((s, i) => (
          <div className="xs-laplace-row" key={k + i}>
            <span className={`xs-laplace-tag mono xs-tag-${k === "LPF" ? "woof" : "mid"}`}>{k === "LPF" ? "LP" : "HP"} E{i + 1}</span>
            <code className="mono" title={s}>{s}</code>
            <IconButton icon={Copy} size="sm" label={`Copy ${k} E${i + 1}`} onClick={() => copyText(s, `${k === "LPF" ? "Low-pass" : "High-pass"} E${i + 1} string`)} />
          </div>
        )))}
      </section>
    </div>
  );
}
