// Every action the app offers from the keyboard: the command palette lists these and the global
// shortcuts call the same functions, so the two can never drift apart.
import type { ComponentType } from "react";
import {
  Activity, Camera, Crosshair, Download, Eye, FolderOpen, Import, Keyboard, Monitor, Moon, Redo2, RotateCcw, ScanEye, Sparkles,
  Sun, Undo2, Waves, Layers,
} from "lucide-react";
import { BUNDLED_PROFILES, defaultDesign, useStore } from "../../state/store";
import { VIEWS } from "../../views";
import { toast } from "../Toast";
import { fmtFreq, parseNumber } from "../format";
import { useOptimiser, toggleOptimiser } from "./optimiser";
import { useShell } from "./shellState";
import { viewKey } from "./viewKeys";
import { pickAndOpenProfile } from "../../wizard/profiles";

export interface Command {
  id: string;
  title: string;
  section: "View" | "Design" | "Probe" | "Display" | "File" | "App" | "Go to";
  /** Extra words the fuzzy search matches (synonyms). */
  keywords?: string;
  shortcut?: string;
  icon?: ComponentType<{ size?: number; strokeWidth?: number }>;
  /** Short right-aligned detail, e.g. the current value. */
  detail?: string;
  disabled?: boolean;
  run(): void;
}

const st = () => useStore.getState();

export function snapshotNow() {
  const s = st();
  if (!s.results) { toast({ tone: "warn", title: "Nothing to snapshot", description: "Load a profile first." }); return; }
  // a second snapshot of an unchanged design would only hide under the first one
  const same = s.snapshots.find(x => JSON.stringify(x.design) === JSON.stringify(s.design));
  if (same) {
    toast({ id: "snapshot", tone: "info", title: `Same as ${same.name}`, description: "Nothing new to compare: change the design first.",
            action: { label: "Compare", onClick: () => useStore.getState().setView("compare") } });
    return;
  }
  s.snapshot();
  const snap = useStore.getState().snapshots.at(-1);
  toast({ id: "snapshot", tone: "good", title: `${snap?.name ?? "Snapshot"} saved`, description: "Overlay it in the Compare view.",
          action: { label: "Compare", onClick: () => useStore.getState().setView("compare") } });
}

export function openExport() {
  if (!st().results) { toast({ tone: "warn", title: "Nothing to export yet", description: "Load a profile first." }); return; }
  st().setUi({ exportSheet: true });
}

export function focusProbe() {
  const el = document.getElementById("cs-probe-input") as HTMLInputElement | null;
  el?.focus();
  el?.select();
}

export function cycleTheme() {
  const order = ["dark", "light", "system"] as const;
  const t = st().theme;
  st().setTheme(order[(order.indexOf(t) + 1) % order.length]);
}

/** Native "open profile" flow; shared with the profile switcher so the recent list stays in step. */
export async function openProfileFromDisk() {
  await pickAndOpenProfile();
}

/** Focus ids of the inspector steps, in workflow order. */
export const STEPS: { id: string; title: string }[] = [
  { id: "box", title: "Woofer box" },
  { id: "digital", title: "Digital crossover" },
  { id: "mid", title: "Midrange passive" },
  { id: "tw", title: "Tweeter passive" },
  { id: "check", title: "Check & export" },
];

/** A probe frequency typed into the palette ("2k", "2 kHz", "500", "3.5k", "probe 1khz"), in Hz; null
 *  when the query is not just a frequency in 20 Hz-20 kHz. */
export function probeQuery(query: string): number | null {
  const m = /^\s*(?:probe\s+(?:at\s+)?)?([+]?\d[\d.,]*\s*(?:k|khz|hz)?)\s*$/i.exec(query);
  if (!m) return null;
  const f = parseNumber(m[1].replace(/hz$/i, ""));
  return f !== null && f >= 20 && f <= 20000 ? f : null;
}

/** Inspector controls the palette can jump to, with the words people search for. */
function partTargets(s: ReturnType<typeof st>): { id: string; title: string; keywords: string }[] {
  const out: { id: string; title: string; keywords: string }[] = [
    { id: "box.mode", title: "Woofer box vents", keywords: "box port vent plugged closed reflex" },
    { id: "box.L", title: "Vent length", keywords: "box port tube length tuning fb" },
    { id: "box.fill", title: "Box filling", keywords: "damping wool stuffing" },
    { id: "digital.align", title: "MiniDSP alignment", keywords: "digital crossover lr4 bw linkwitz butterworth slope" },
    { id: "digital.fc", title: "MiniDSP crossover frequency", keywords: "digital fc xover low-pass high-pass" },
    { id: "digital.gain", title: "Woofer gain", keywords: "digital level attenuation minidsp db" },
    { id: "digital.pol", title: "Woofer polarity", keywords: "digital invert phase" },
    { id: "check.Rdcr", title: "Coil resistance (DCR)", keywords: "inductor resistance dcr loss" },
  ];
  const KIND: Record<string, string> = { L: "coil inductor", C: "cap capacitor", R: "resistor" };
  for (const [unit, name] of [["mid", "Midrange"], ["tw", "Tweeter"]] as const) {
    const b = s.design[unit];
    out.push({ id: `${unit}.topo`, title: `${name} filter order`, keywords: "passive topology order slope 1st 2nd 3rd" });
    for (const part of Object.keys(b.vals))
      out.push({ id: `${unit}.${part}`, title: `${name} ${part}`, keywords: `passive part ${KIND[part[0]] ?? ""}` });
    out.push(
      { id: `${unit}.pad.Rs`, title: `${name} L-pad Rs`, keywords: "l-pad lpad attenuator series resistor level" },
      { id: `${unit}.pad.Rp`, title: `${name} L-pad Rp`, keywords: "l-pad lpad attenuator parallel shunt resistor level" },
      { id: `${unit}.zobel`, title: `${name} Zobel network`, keywords: "zobel rc impedance compensation" },
      { id: `${unit}.pol`, title: `${name} polarity`, keywords: "invert phase" },
    );
  }
  return out;
}

/** Set the inspector focus even when it already points at the same id, so the pulse plays again. */
export function focusControl(id: string) {
  st().setUi({ focus: null });
  requestAnimationFrame(() => st().setUi({ focus: id }));
}

export function buildCommands(): Command[] {
  const s = st();
  const opt = useOptimiser.getState();
  const m = s.results?.metrics;
  const has = !!s.results;
  const cmds: Command[] = [];

  VIEWS.forEach((v, i) => cmds.push({
    id: `view.${v.id}`, title: `Show ${v.title}`, section: "View", shortcut: viewKey(i), icon: v.icon,
    keywords: "view tab open", detail: s.view === v.id ? "current" : undefined, run: () => st().setView(v.id),
  }));

  cmds.push(
    { id: "design.optimise", title: opt.running ? "Stop optimiser" : "Optimise design", section: "Design", shortcut: "O", icon: Sparkles,
      keywords: "auto tune best search improve", disabled: !has && !opt.running, run: toggleOptimiser },
    { id: "design.snapshot", title: "Take snapshot", section: "Design", shortcut: "S", icon: Camera, keywords: "save compare reference",
      disabled: !has, run: snapshotNow },
    { id: "design.undo", title: "Undo", section: "Design", shortcut: "Mod+Z", icon: Undo2, disabled: !s.history.length, run: () => st().undo() },
    { id: "design.redo", title: "Redo", section: "Design", shortcut: "Mod+Shift+Z", icon: Redo2, disabled: !s.future.length, run: () => st().redo() },
    { id: "design.reset", title: "Reset design to the starting point", section: "Design", icon: RotateCcw, keywords: "default restore clear",
      disabled: !has, run: () => { st().setDesign(defaultDesign(st().profile)); toast({ title: "Design reset", action: { label: "Undo", onClick: () => st().undo() } }); } },
    { id: "file.export", title: "Export…", section: "File", shortcut: "E", icon: Download, keywords: "minidsp ltspice biquad bom report save",
      disabled: !has, run: openExport },
    { id: "file.report", title: "Export report…", section: "File", icon: Download, keywords: "latex overleaf markdown pgfplots quiz numbers figures",
      disabled: !has, run: () => { try { localStorage.setItem("crossover-studio:export-tab", "report"); } catch { /* storage unavailable */ } openExport(); } },
    { id: "file.import", title: "Import measurements…", section: "File", icon: Import, keywords: "new profile wizard mat csv txt lab",
      run: () => st().setUi({ wizard: true }) },
    { id: "file.open", title: "Open profile…", section: "File", icon: FolderOpen, keywords: "load json", run: () => void openProfileFromDisk() },
    ...BUNDLED_PROFILES.map(p => ({
      id: `file.bundled.${p.id}`, title: `Load ${p.name}`, section: "File" as const, icon: FolderOpen, keywords: "profile example bundled",
      detail: s.profile?.id === p.id ? "loaded" : "bundled", run: () => st().loadProfile(p),
    })),
  );

  const probe = (id: string, title: string, f: number | null | undefined, keywords: string) => cmds.push({
    id, title, section: "Probe", icon: Crosshair, keywords: "probe cursor marker " + keywords, detail: f ? fmtFreq(f) : "not found",
    disabled: !f, run: () => { if (f) st().setProbe(f); },
  });
  probe("probe.xwm", "Probe the woofer/midrange crossover", m?.x_wm, "xover");
  probe("probe.xmt", "Probe the midrange/tweeter crossover", m?.x_mt, "xover");
  probe("probe.fc", "Probe the digital crossover frequency", s.design.digital.fc, "minidsp fc");
  if (s.profile) probe("probe.twfs", "Probe the tweeter resonance", s.profile.limits.tw_fs_hz, "fs");
  if (s.results?.box.fB) probe("probe.fb", "Probe the box tuning", s.results.box.fB, "vent port fb");
  probe("probe.1k", "Probe 1 kHz", 1000, "");
  cmds.push({ id: "probe.focus", title: "Type a probe frequency", section: "Probe", shortcut: "P", icon: Crosshair, run: focusProbe });

  const u = s.ui;
  cmds.push(
    { id: "display.xray", title: u.xray ? "Hide x-ray" : "Show x-ray", section: "Display", shortcut: "X", icon: ScanEye,
      keywords: "3d inside transparent", run: () => st().setUi({ xray: !st().ui.xray }) },
    { id: "display.waves", title: u.waves ? "Hide sound waves" : "Show sound waves", section: "Display", icon: Waves,
      keywords: "3d animation radiation", run: () => st().setUi({ waves: !st().ui.waves }) },
    { id: "display.tolerance", title: u.showTolerance ? "Hide tolerance band" : "Show tolerance band", section: "Display", icon: Layers,
      keywords: "monte carlo spread parts", run: () => st().setUi({ showTolerance: !st().ui.showTolerance }) },
    { id: "display.powersum", title: u.showPowerSum ? "Hide power sum" : "Show power sum", section: "Display", icon: Activity,
      keywords: "cancellation", run: () => st().setUi({ showPowerSum: !st().ui.showPowerSum }) },
    { id: "display.angle0", title: "Show on-axis (0°)", section: "Display", icon: Eye, detail: u.angle === "0" ? "current" : undefined,
      keywords: "angle", run: () => st().setUi({ angle: "0" }) },
  );
  if (s.prep?.angles.includes("30")) cmds.push(
    { id: "display.angle30", title: "Show off-axis (30°)", section: "Display", icon: Eye, detail: u.angle === "30" ? "current" : undefined,
      keywords: "angle", run: () => st().setUi({ angle: "30" }) },
    { id: "display.angleBoth", title: "Show 0° and 30° together", section: "Display", icon: Eye, detail: u.angle === "both" ? "current" : undefined,
      keywords: "angle both", run: () => st().setUi({ angle: "both" }) },
  );

  STEPS.forEach((step, i) => cmds.push({
    id: `goto.${step.id}`, title: `Go to step ${i + 1}: ${step.title}`, section: "Go to", keywords: "inspector section",
    run: () => focusControl(step.id),
  }));
  if (has) for (const t of partTargets(s)) cmds.push({
    id: `goto.${t.id}`, title: `Go to ${t.title}`, section: "Go to", keywords: `inspector control ${t.keywords}`, run: () => focusControl(t.id),
  });

  cmds.push(
    { id: "app.theme.dark", title: "Dark theme", section: "App", icon: Moon, detail: s.theme === "dark" ? "current" : undefined,
      keywords: "appearance colour", run: () => st().setTheme("dark") },
    { id: "app.theme.light", title: "Light theme", section: "App", icon: Sun, detail: s.theme === "light" ? "current" : undefined,
      keywords: "appearance colour", run: () => st().setTheme("light") },
    { id: "app.theme.system", title: "Theme follows the system", section: "App", icon: Monitor, detail: s.theme === "system" ? "current" : undefined,
      keywords: "appearance colour auto", run: () => st().setTheme("system") },
    { id: "app.help", title: "Keyboard shortcuts and help", section: "App", shortcut: "?", icon: Keyboard, keywords: "about version",
      run: () => useShell.getState().setHelp(true) },
  );
  return cmds;
}

export { fuzzy } from "./fuzzy";
