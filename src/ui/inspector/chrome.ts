// How the inspector shares the window with the workspace: its step mode (one step open at a time, or all
// of them) and the hook the shell registers so the icon rail can ask for the full column back.
// (The column's width belongs to the shell's panel group; the inspector only reads its own size.)
import { create } from "zustand";

const MODE_KEY = "crossover-studio:inspector-mode";

/** "one": opening a step folds the others (the default, so the column never turns into a long scroll);
 *  "all": every step keeps its own open state. */
export type StepMode = "one" | "all";

function readMode(): StepMode {
  try { return localStorage.getItem(MODE_KEY) === "all" ? "all" : "one"; } catch { return "one"; }
}

interface InspectorChrome {
  mode: StepMode;
  setMode(mode: StepMode): void;
  /** Set by the shell when the inspector column can collapse to a rail: widens it again. */
  expand: (() => void) | null;
  setExpand(expand: (() => void) | null): void;
  /** Set by the shell alongside `expand`: folds the column to its rail. */
  collapse: (() => void) | null;
  setCollapse(collapse: (() => void) | null): void;
}

export const useInspectorChrome = create<InspectorChrome>(set => ({
  mode: readMode(),
  setMode(mode) {
    set({ mode });
    try { localStorage.setItem(MODE_KEY, mode); } catch { /* remembered for this session only */ }
  },
  expand: null,
  setExpand(expand) { set({ expand }); },
  collapse: null,
  setCollapse(collapse) { set({ collapse }); },
}));

/** Below this width the inspector draws its icon rail instead of the steps. */
export const RAIL_MAX_PX = 140;
