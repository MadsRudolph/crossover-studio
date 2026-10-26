// The single app store (Zustand + Immer). Views read from it and call its actions; nothing else holds state.
// Results are recomputed synchronously on every design change (the engine takes a few ms).

import { create } from "zustand";
import { produce } from "immer";
import type { BoxFit, Design, Profile, Results, UnitId } from "../types";
import { compute, fitBox, prepare, type Prepared } from "../engine";
import bundledSystemD from "../../profiles/system-d-group10/profile.json";
import defaultDesignRaw from "../../fixtures/design.json";

export type ViewId = "system" | "verdict" | "response" | "phase" | "impedance" | "filters" | "box" | "directivity" | "compare";
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
  /** The design from before the current live gesture (a slider drag, an optimiser preview); the commit
   *  that ends the gesture pushes this, not the already-dragged design, as its undo step. */
  gestureBase: Design | null;
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
  /** Rename or recolour a snapshot. */
  updateSnapshot(id: string, patch: Partial<Pick<Snapshot, "name" | "color">>): void;
  /** Replace the whole snapshot list (opening a design file, undoing a delete). */
  setSnapshots(list: Snapshot[]): void;
  setProbe(f: number): void;
  setView(v: ViewId): void;
  setTheme(t: Theme): void;
  setUi(patch: Partial<UiState>): void;
}

/** The course's starting design, with the box taken from the profile when one is given: no vents means a
 *  closed box; vent A starts at its first measured length (else the middle of its range); vent B takes
 *  its own diameter and range. */
export function defaultDesign(profile?: Profile | null): Design {
  const d = structuredClone(defaultDesignRaw) as any;
  const box: Design["box"] = { mode: "one", L: 0.16, L2: 0.16, a2: 0.025, fill: d.box?.fill ?? 1 };
  if (profile) {
    const vents = profile.woofer_box?.vents ?? [];
    const mid = (r: [number, number] | undefined, fallback: number) => (r ? Math.round(((r[0] + r[1]) / 2) * 1000) / 1000 : fallback);
    if (!vents.length) box.mode = "plugged";
    else {
      const [a, b] = vents;
      const measured = (profile.measurements?.woofer?.vented ?? [])
        .filter(m => m.vents.length === 1 && m.vents[0].id === a.id).map(m => m.vents[0].length_m).sort((x, y) => x - y);
      const inRange = (L: number, r?: [number, number]) => !r || (L >= r[0] && L <= r[1]);
      box.L = measured[0] ?? (inRange(0.16, a.length_range_m) ? 0.16 : mid(a.length_range_m, 0.16));
      if (b) {
        box.a2 = b.diameter_m / 2;
        box.L2 = inRange(box.L, b.length_range_m) ? box.L : mid(b.length_range_m, box.L);
      }
    }
  }
  return {
    box,
    digital: d.digital, mid: d.mid, tw: { ...d.tw, pad: d.tw.pad ?? {} },
    pol: d.pol, Rdcr: d.Rdcr ?? 0,
  };
}

/** Snapshot colours in the order new snapshots take them: theme tokens (tokens.css --snap-1..7), so each
 *  theme gets its own legible shade and none of them reads as a driver colour. */
export const SNAP_COLORS = [1, 2, 3, 4, 5, 6, 7].map(i => `var(--snap-${i})`);

const sameDesign = (a: Design, b: Design) => a === b || JSON.stringify(a) === JSON.stringify(b);
const STORE_KEY = "crossover-studio:v1";

function recompute(s: Pick<State, "prep" | "design">): { results: Results | null; error: string | null } {
  if (!s.prep) return { results: null, error: null };
  try { return { results: compute(s.prep, s.design), error: null }; }
  catch (e) { return { results: null, error: String(e) }; }
}

function persisted(): Partial<Pick<State, "theme" | "view">> & { designs?: Record<string, Design> } {
  try { return JSON.parse(localStorage.getItem(STORE_KEY) || "{}"); } catch { return {}; }
}

const VIEW_IDS: readonly ViewId[] = ["system", "verdict", "response", "phase", "impedance", "filters", "box", "directivity", "compare"];

/** `?view=<id>` opens a given view (deep links, screenshots); it is not remembered over the user's own choice. */
function urlView(): ViewId | undefined {
  try {
    const v = new URLSearchParams(window.location.search).get("view");
    return VIEW_IDS.includes(v as ViewId) ? (v as ViewId) : undefined;
  } catch { return undefined; }
}

/** `?sheet=import|export` opens the import wizard or the export sheet on start (deep links, screenshots). */
function urlSheet(): "import" | "export" | undefined {
  try {
    const v = new URLSearchParams(window.location.search).get("sheet");
    return v === "import" || v === "export" ? v : undefined;
  } catch { return undefined; }
}

export const useStore = create<State>()((set, get) => ({
  profile: null, fit: null, prep: null,
  design: defaultDesign(),
  results: null, error: null,
  history: [], future: [], gestureBase: null, snapshots: [],
  probe: 1000,
  view: urlView() ?? persisted().view ?? "system",
  theme: persisted().theme ?? "dark",
  ui: { xray: false, waves: true, animate: true, angle: "0", visible: { woof: true, mid: true, tw: true, sum: true },
        showTolerance: false, showPowerSum: false, focus: null, commandPalette: false,
        wizard: urlSheet() === "import", exportSheet: urlSheet() === "export" },

  loadProfile(profile) {
    try {
      const fit = fitBox(profile);
      const prep = prepare(profile, fit);
      // The design remembered for this profile, else the course's default. A remembered design that no longer
      // computes (an older app version, a changed profile) is dropped rather than leaving the app in an error state.
      const saved = persisted().designs?.[profile.id];
      let design = saved ?? defaultDesign(profile);
      let out = recompute({ prep, design });
      if (out.error && saved) { design = defaultDesign(profile); out = recompute({ prep, design }); }
      // an angle choice the new profile has not measured falls back to on axis
      const ui = get().ui, angle = ui.angle === "both" || prep.angles.includes(ui.angle) ? ui.angle : "0";
      set({ profile, fit, prep, design, history: [], future: [], gestureBase: null, snapshots: [], ui: { ...ui, angle }, ...out });
    } catch (e) {
      set({ error: `Could not load ${profile.name}: ${e}` });
    }
  },
  edit(mut, commit = true) {
    const s = get();
    const design = produce(s.design, mut);
    if (!commit) {
      // a live step: remember where the gesture started, the commit that ends it records that
      set({ design, gestureBase: s.gestureBase ?? s.design, ...recompute({ prep: s.prep, design }) });
    } else {
      const base = s.gestureBase ?? s.design;
      // releasing a thumb without moving it (or a no-op edit) leaves no empty undo step
      const changed = !sameDesign(base, design);
      set({ design, gestureBase: null,
            history: changed ? [...s.history, base].slice(-200) : s.history,
            future: changed ? [] : s.future,
            ...recompute({ prep: s.prep, design }) });
    }
    save(get());
  },
  setDesign(d) {
    const s = get();
    const base = s.gestureBase ?? s.design;
    set({ design: d, gestureBase: null, history: sameDesign(base, d) ? s.history : [...s.history, base].slice(-200), future: [],
          ...recompute({ prep: s.prep, design: d }) });
    save(get());
  },
  undo() {
    const s = get();
    // an unfinished gesture is undone back to where it started
    if (s.gestureBase) {
      const design = s.gestureBase;
      set({ design, gestureBase: null, future: [s.design, ...s.future], ...recompute({ prep: s.prep, design }) });
      save(get()); return;
    }
    if (!s.history.length) return;
    const design = s.history[s.history.length - 1];
    set({ design, history: s.history.slice(0, -1), future: [s.design, ...s.future], ...recompute({ prep: s.prep, design }) });
    save(get());
  },
  redo() {
    const s = get(); if (!s.future.length) return;
    const design = s.future[0];
    set({ design, gestureBase: null, history: [...s.history, s.gestureBase ?? s.design], future: s.future.slice(1),
          ...recompute({ prep: s.prep, design }) });
    save(get());
  },
  snapshot(name) {
    const s = get(); if (!s.results) return;
    const n = s.snapshots.length;
    set({ snapshots: [...s.snapshots, { id: crypto.randomUUID(), name: name ?? `Snapshot ${n + 1}`, color: SNAP_COLORS[n % SNAP_COLORS.length],
                                        design: s.design, results: s.results }] });
  },
  removeSnapshot(id) { set({ snapshots: get().snapshots.filter(x => x.id !== id) }); },
  updateSnapshot(id, patch) { set({ snapshots: get().snapshots.map(x => (x.id === id ? { ...x, ...patch } : x)) }); },
  setSnapshots(list) { set({ snapshots: list }); },
  setProbe(f) { set({ probe: Math.min(20000, Math.max(20, f)) }); },
  setView(view) { set({ view }); save(get()); },
  setTheme(theme) { set({ theme }); save(get()); },
  setUi(patch) { set({ ui: { ...get().ui, ...patch } }); },
}));

function save(s: State) {
  // mid-gesture designs (a drag, an optimiser preview) are not remembered: only what the gesture commits
  if (s.gestureBase) return;
  try {
    const prev = persisted();
    const designs = { ...(prev.designs ?? {}) };
    if (s.profile) designs[s.profile.id] = s.design;
    localStorage.setItem(STORE_KEY, JSON.stringify({ theme: s.theme, view: s.view, designs }));
  } catch { /* storage unavailable: nothing to do */ }
}

/** The profile that ships with the app (Group 10, System D), so it opens in a working state. */
export const BUNDLED_PROFILES: Profile[] = [bundledSystemD as unknown as Profile];
