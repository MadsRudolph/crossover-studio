// The single app store (Zustand + Immer). Views read from it and call its actions; nothing else holds state.
// Results are recomputed synchronously on every design change (the engine takes a few ms).

import { create } from "zustand";
import { produce } from "immer";
import type { BoxFit, Design, Profile, Results, UnitId } from "../types";
import { compute, fitBox, prepare, type Prepared } from "../engine";
import bundledSystemD from "../../profiles/system-d-group10/profile.json";
import defaultDesignRaw from "../../fixtures/design.json";

export type ViewId = "system" | "response" | "phase" | "impedance" | "filters" | "box" | "directivity" | "compare";
export type Theme = "dark" | "light" | "system";

export interface Snapshot { id: string; name: string; color: string; design: Design; results: Results }

export interface UiState {
  xray: boolean;
  waves: boolean;
  animate: boolean;
  /** Which measurement angle(s) the response/phase views show. */
  angle: string | "both";
  visible: Record<UnitId | "sum", boolean>;
  showTolerance: boolean;
  showPowerSum: boolean;
  /** Inspector control to highlight (set by clicking a part in the schematic or 3D view), e.g. "mid.L1". */
  focus: string | null;
  commandPalette: boolean;
  wizard: boolean;
  exportSheet: boolean;
}

export interface State {
  profile: Profile | null;
  fit: BoxFit | null;
  prep: Prepared | null;
  design: Design;
  results: Results | null;
  error: string | null;
  history: Design[];
  future: Design[];
  snapshots: Snapshot[];
  /** Probe frequency (Hz), snapped to the grid by the views that need a sample. */
  probe: number;
  view: ViewId;
  theme: Theme;
  ui: UiState;

  loadProfile(profile: Profile): void;
  /** Mutate the design. commit=false for live slider drags (no undo step); commit=true pushes one undo step. */
  edit(mut: (d: Design) => void, commit?: boolean): void;
  setDesign(d: Design): void;
  undo(): void;
  redo(): void;
  snapshot(name?: string): void;
  removeSnapshot(id: string): void;
  setProbe(f: number): void;
  setView(v: ViewId): void;
  setTheme(t: Theme): void;
  setUi(patch: Partial<UiState>): void;
}

export function defaultDesign(): Design {
  const d = structuredClone(defaultDesignRaw) as any;
  return {
    box: { mode: "one", L: 0.16, L2: 0.16, a2: 0.025, fill: d.box?.fill ?? 1 },
    digital: d.digital, mid: d.mid, tw: { ...d.tw, pad: d.tw.pad ?? {} },
    pol: d.pol, Rdcr: d.Rdcr ?? 0,
  };
}

const SNAP_COLORS = ["#7aa2ff", "#f2a65a", "#c792ea", "#5fd3bc", "#ff7a90"];
const STORE_KEY = "crossover-studio:v1";

function recompute(s: Pick<State, "prep" | "design">): { results: Results | null; error: string | null } {
  if (!s.prep) return { results: null, error: null };
  try { return { results: compute(s.prep, s.design), error: null }; }
  catch (e) { return { results: null, error: String(e) }; }
}

function persisted(): Partial<Pick<State, "theme" | "view">> & { designs?: Record<string, Design> } {
  try { return JSON.parse(localStorage.getItem(STORE_KEY) || "{}"); } catch { return {}; }
}

export const useStore = create<State>()((set, get) => ({
  profile: null, fit: null, prep: null,
  design: defaultDesign(),
  results: null, error: null,
  history: [], future: [], snapshots: [],
  probe: 1000,
  view: persisted().view ?? "system",
  theme: persisted().theme ?? "dark",
  ui: { xray: false, waves: true, animate: true, angle: "0", visible: { woof: true, mid: true, tw: true, sum: true },
        showTolerance: false, showPowerSum: false, focus: null, commandPalette: false, wizard: false, exportSheet: false },

  loadProfile(profile) {
    try {
      const fit = fitBox(profile);
      const prep = prepare(profile, fit);
      const saved = persisted().designs?.[profile.id];
      const design = saved ?? get().design;
      set({ profile, fit, prep, design, history: [], future: [], snapshots: [], ...recompute({ prep, design }) });
    } catch (e) {
      set({ error: `Could not load ${profile.name}: ${e}` });
    }
  },
  edit(mut, commit = true) {
    const s = get();
    const design = produce(s.design, mut);
    const history = commit ? [...s.history, s.design].slice(-200) : s.history;
    set({ design, history, future: commit ? [] : s.future, ...recompute({ prep: s.prep, design }) });
    save(get());
  },
  setDesign(d) {
    const s = get();
    set({ design: d, history: [...s.history, s.design].slice(-200), future: [], ...recompute({ prep: s.prep, design: d }) });
    save(get());
  },
  undo() {
    const s = get(); if (!s.history.length) return;
    const design = s.history[s.history.length - 1];
    set({ design, history: s.history.slice(0, -1), future: [s.design, ...s.future], ...recompute({ prep: s.prep, design }) });
    save(get());
  },
  redo() {
    const s = get(); if (!s.future.length) return;
    const design = s.future[0];
    set({ design, history: [...s.history, s.design], future: s.future.slice(1), ...recompute({ prep: s.prep, design }) });
    save(get());
  },
  snapshot(name) {
    const s = get(); if (!s.results) return;
    const n = s.snapshots.length;
    set({ snapshots: [...s.snapshots, { id: crypto.randomUUID(), name: name ?? `Snapshot ${n + 1}`, color: SNAP_COLORS[n % SNAP_COLORS.length],
                                        design: s.design, results: s.results }] });
  },
  removeSnapshot(id) { set({ snapshots: get().snapshots.filter(x => x.id !== id) }); },
  setProbe(f) { set({ probe: Math.min(20000, Math.max(20, f)) }); },
  setView(view) { set({ view }); save(get()); },
  setTheme(theme) { set({ theme }); save(get()); },
  setUi(patch) { set({ ui: { ...get().ui, ...patch } }); },
}));

function save(s: State) {
  try {
    const prev = persisted();
    const designs = { ...(prev.designs ?? {}) };
    if (s.profile) designs[s.profile.id] = s.design;
    localStorage.setItem(STORE_KEY, JSON.stringify({ theme: s.theme, view: s.view, designs }));
  } catch { /* storage unavailable: nothing to do */ }
}

/** The profile that ships with the app (Group 10, System D), so it opens in a working state. */
export const BUNDLED_PROFILES: Profile[] = [bundledSystemD as unknown as Profile];
