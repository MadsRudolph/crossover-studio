// Global keyboard shortcuts (docs/DESIGN.md): Ctrl/Cmd+K palette, Ctrl+Z / Ctrl+Y (Ctrl+Shift+Z) undo/redo,
// 1-9 views, S snapshot, O optimise, E export, P probe, X x-ray, ? help.
// Single-key shortcuts stand down while the person types in a field or a dialog/menu is open.
import { useEffect } from "react";
import { useStore } from "../../state/store";
import { VIEWS } from "../../views";
import { layerOpen } from "../hooks";
import { toggleOptimiser } from "./optimiser";
import { focusProbe, openExport, snapshotNow } from "./commands";
import { useShell } from "./shellState";

export interface ShortcutDoc { keys: string; what: string }

/** The list the help dialog shows, in reading order. */
export const SHORTCUTS: { group: string; items: ShortcutDoc[] }[] = [
  { group: "General", items: [
    { keys: "Mod+K", what: "Command palette: find any action" },
    { keys: "Mod+Z", what: "Undo" },
    { keys: "Mod+Shift+Z", what: "Redo (also Ctrl+Y)" },
    { keys: "?", what: "This help" },
  ] },
  { group: "Design", items: [
    { keys: "O", what: "Optimise (again to stop)" },
    { keys: "S", what: "Snapshot the current design" },
    { keys: "E", what: "Export" },
  ] },
  { group: "Views", items: [
    { keys: "1–9", what: "Switch view (System, Verdict, Response, …)" },
    { keys: "P", what: "Type a probe frequency" },
    { keys: "X", what: "X-ray the 3D model" },
  ] },
  { group: "Controls", items: [
    { keys: "Shift", what: "Hold while dragging a slider for fine steps" },
    { keys: "Up", what: "Arrows step a focused slider or part value" },
    { keys: "Enter", what: "Click a slider readout, type a value, Enter" },
  ] },
];

function isTyping(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag === "INPUT") {
    const type = (el as HTMLInputElement).type;
    return !["checkbox", "radio", "button", "range"].includes(type);
  }
  return false;
}

export function useGlobalShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = useStore.getState();
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();

      if (mod && key === "k") {
        e.preventDefault();
        s.setUi({ commandPalette: !s.ui.commandPalette });
        return;
      }
      if (e.defaultPrevented || e.repeat && !mod) return;
      const typing = isTyping(e.target);

      if (mod && !e.altKey) {
        // inside a text field the browser's own undo applies
        if (typing || layerOpen()) return;
        if (key === "z" && !e.shiftKey) { e.preventDefault(); s.undo(); }
        else if ((key === "z" && e.shiftKey) || key === "y") { e.preventDefault(); s.redo(); }
        return;
      }
      if (typing || layerOpen() || e.altKey) return;

      if (/^[1-9]$/.test(e.key)) {
        const v = VIEWS[Number(e.key) - 1];
        if (v) { e.preventDefault(); s.setView(v.id); }
        return;
      }
      if (e.key === "?") { e.preventDefault(); useShell.getState().setHelp(true); return; }
      if (e.shiftKey) return;
      switch (key) {
        case "s": e.preventDefault(); snapshotNow(); break;
        case "o": e.preventDefault(); toggleOptimiser(); break;
        case "e": e.preventDefault(); openExport(); break;
        case "p": e.preventDefault(); focusProbe(); break;
        case "x": e.preventDefault(); s.setUi({ xray: !s.ui.xray }); break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
