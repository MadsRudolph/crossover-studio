// Step 1: gather the measurement files. Desktop: native dialog and window drops (paths, read in Rust).
// Browser preview: HTML drops and an <input type=file>, text files parsed in TypeScript.
import { useEffect, useRef, useState, type DragEvent } from "react";
import { AlertTriangle, FileSpreadsheet, FileText, FolderOpen, Loader2, Sparkles, Trash2, UploadCloud } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import * as platform from "../../platform";
import { Badge, Button, IconButton, toast } from "../../ui";
import { useWizard, message } from "../draft";
import { dataItems, roleDef, type WizardFile } from "../roles";
import { unitTone } from "./common";

/** Adds files or folders; tells how many files of a folder were left out as not being measurements. */
async function add(paths: string[]) {
  const { skipped } = await useWizard.getState().addPaths(paths);
  if (skipped.length)
    toast({ tone: "info", title: `${skipped.length} file${skipped.length === 1 ? "" : "s"} in the folder left out`,
            description: `Not readable as a measurement: ${skipped.slice(0, 4).join(", ")}${skipped.length > 4 ? ", …" : ""}` });
}

const FORMAT_LABEL: Record<WizardFile["format"], string> = { mat: "MAT", ltspice: "LTspice", csv: "CSV", unknown: "?" };

export function FilesStep() {
  const files = useWizard(s => s.files);
  const desktop = platform.isTauri();
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const depth = useRef(0);

  // Tauri delivers OS file drops as paths to the window, not as HTML drop events
  useEffect(() => {
    if (!desktop) return;
    let off: (() => void) | undefined, live = true;
    void platform.onFileDrop(paths => void add(paths)).then(u => { if (live) off = u; else u(); });
    return () => { live = false; off?.(); };
  }, [desktop]);

  const choose = async () => {
    if (!desktop) { input.current?.click(); return; }
    try {
      const paths = await platform.pickMeasurementFiles();
      if (paths.length) await add(paths);
    } catch (e) {
      toast({ tone: "bad", title: "Could not open the file dialog", description: message(e) });
    }
  };
  const chooseFolder = async () => {
    try {
      const dir = await platform.pickMeasurementFolder();
      if (dir) await add([dir]);
    } catch (e) {
      toast({ tone: "bad", title: "Could not open the folder dialog", description: message(e) });
    }
  };
  const example = async () => {
    setBusy(true);
    try { await useWizard.getState().loadExampleFiles(); }
    finally { setBusy(false); }
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    depth.current = 0; setOver(false);
    if (desktop) return;   // handled by onFileDrop
    const list = Array.from(e.dataTransfer.files);
    if (list.length) void useWizard.getState().addBrowserFiles(list);
  };

  return (
    <div className="wz-files">
      <p className="wz-lede">
        Add everything you measured: the Lab E system files at 0° and off axis, and the Lab D impedances and near-field
        measurements. The wizard recognises the course scripts' file names and variables and suggests a role for each one.
      </p>

      <div className={`wz-drop${over ? " is-over" : ""}${files.length ? " is-compact" : ""}`}
           onDragEnter={e => { e.preventDefault(); depth.current++; setOver(true); }}
           onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; }}
           onDragLeave={() => { depth.current = Math.max(0, depth.current - 1); if (!depth.current) setOver(false); }}
           onDrop={onDrop}>
        <span className="wz-drop-icon" aria-hidden><UploadCloud size={files.length ? 20 : 30} strokeWidth={1.5} /></span>
        <div className="wz-drop-text">
          <strong>{over ? "Drop to add" : desktop ? "Drop measurement files or folders here" : "Drop measurement files here"}</strong>
          <span>MATLAB .mat · Matlab2LTspice .txt · CSV{desktop ? "" : " (.mat needs the desktop app)"}</span>
        </div>
        <div className="wz-drop-actions">
          <Button variant="primary" icon={FileText} onClick={() => void choose()}>Choose files…</Button>
          {desktop && <Button variant="subtle" icon={FolderOpen} onClick={() => void chooseFolder()}
                              title="Add every .mat, .txt and .csv file in a folder and its sub-folders, such as your whole Lab D or Lab E data folder">
            Add a folder…
          </Button>}
          <Button variant="ghost" icon={Sparkles} onClick={() => void example()} loading={busy}
                  title="Load the Group 10 System D measurements as CSV files, to see how the import works">
            Use the example files
          </Button>
        </div>
        <input ref={input} type="file" multiple accept=".mat,.txt,.csv,text/csv,text/plain" hidden
               onChange={e => { const l = Array.from(e.target.files ?? []); e.target.value = ""; if (l.length) void useWizard.getState().addBrowserFiles(l); }} />
      </div>

      {files.length > 0 ? (
        <ul className="wz-filelist" aria-label="Files">
          {files.map(f => <FileRow key={f.id} file={f} />)}
        </ul>
      ) : (
        <FileGuide />
      )}
    </div>
  );
}

function FileRow({ file }: { file: WizardFile }) {
  const roles = useWizard(useShallow(s => Object.values(s.assignments).filter(a => a.choice.fileId === file.id).map(a => a.role)));
  const vents = useWizard(s => s.vents);
  const items = dataItems(file);
  const Icon = file.format === "csv" ? FileSpreadsheet : FileText;
  const tag = file.info?.variables.find(v => v.name === "note" && v.text)?.text;
  const detail = file.status === "reading" ? "Reading…"
    : file.status === "error" ? file.error
    : file.format === "mat"
      ? `${file.info?.variables.length ?? 0} variables · ${items.length ? `${items.length} usable series` : "no usable series"}${tag ? ` · “${tag}”` : ""}`
      : `${file.table?.f.length ?? file.info?.points ?? 0} points${(file.table?.header ?? file.info?.header) ? ` · ${(file.table?.header ?? file.info?.header ?? "").slice(0, 60)}` : ""}`;
  return (
    <li className={`wz-file is-${file.status}`}>
      <span className="wz-file-icon" aria-hidden>
        {file.status === "reading" ? <Loader2 size={16} className="cs-spin" /> : file.status === "error" ? <AlertTriangle size={16} /> : <Icon size={16} strokeWidth={1.6} />}
      </span>
      <div className="wz-file-main">
        <div className="wz-file-name">
          <span className="mono">{file.name}</span>
          <Badge tone={file.format === "mat" ? "accent" : "neutral"}>{FORMAT_LABEL[file.format]}</Badge>
        </div>
        <div className={`wz-file-detail${file.status === "error" ? " is-bad" : ""}`}>{detail}</div>
      </div>
      <div className="wz-file-roles">
        {file.status === "ready" && !roles.length && <span className="wz-muted">not used yet</span>}
        {roles.slice(0, 4).map(r => {
          const d = roleDef(r, vents);
          return <Badge key={r} tone={unitTone(d?.unit)}>{shortRole(r, d?.title)}</Badge>;
        })}
        {roles.length > 4 && <Badge>+{roles.length - 4}</Badge>}
      </div>
      <IconButton icon={Trash2} label={`Remove ${file.name}`} size="sm" variant="ghost" onClick={() => useWizard.getState().removeFile(file.id)} />
    </li>
  );
}

function shortRole(role: string, title?: string): string {
  const tf = /^tf:([^:]+):(woof|mid|tw)$/.exec(role);
  if (tf) return `${{ woof: "Woofer", mid: "Mid", tw: "Tweeter" }[tf[2]]} ${tf[1]}°`;
  const v = /^vent:([^:]+):(z|nf_cone|nf_vent)$/.exec(role);
  if (v) return `${v[1].replace(/([A-Z])(\d+)/g, "$1 $2 mm")} ${v[2] === "z" ? "Z" : v[2] === "nf_cone" ? "NF cone" : "NF vent"}`;
  return title ?? role;
}

function FileGuide() {
  const rows: [string, string, string][] = [
    ["Lab E", "labE_system_0.mat, labE_system_30.mat", "p/V of all three units at each angle (H, one column per unit)"],
    ["Lab D", "labD_midrange.mat, labD_tweeter.mat", "input impedance of the passively filtered units (Z)"],
    ["Lab D", "labD_woofer_free.mat, labD_woofer_closed.mat", "woofer impedance in free air and in the closed box"],
    ["Lab D", "labD_vent_L160.mat, labD_nf_cone_L160.mat, …", "vented impedance and near field, one set per vent length (optional)"],
    ["Text", "TF_mid.txt, Zi_tw.txt, Z_woofer_free.csv", "Matlab2LTspice exports or CSV with f,re,im or f,dB,phase"],
  ];
  return (
    <div className="wz-guide">
      <h4 className="label-caps">What to add</h4>
      <table>
        <tbody>
          {rows.map(([lab, files, what]) => (
            <tr key={files}><td><Badge>{lab}</Badge></td><td className="mono">{files}</td><td>{what}</td></tr>
          ))}
        </tbody>
      </table>
      <p className="wz-muted">
        Re-saved files work too: the names only help the automatic suggestions, you can assign every role by hand in the next step.
        MATLAB v7.3 files cannot be read; re-save them with <span className="mono">save(…, '-v7')</span>.
      </p>
    </div>
  );
}
