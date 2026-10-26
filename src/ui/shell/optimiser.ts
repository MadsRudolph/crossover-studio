// Runs the design optimiser (engine runOptimise: a worker, or inline where workers do not exist) and
// shares its progress with every place that shows it (title bar, inspector step 5, command palette).
// Each step previews the best design so far without an undo step; the result is committed as ONE undo
// step, so Ctrl+Z returns to the design from before the run. Stop keeps the best design found so far.
// A run belongs to the profile it started on: loading another profile cancels it and drops its results.
import { create } from "zustand";
import type { Design, Profile } from "../../types";
import { runOptimise, score } from "../../engine";
import { useStore } from "../../state/store";
import { toast } from "../Toast";
import { fmtFixed } from "../format";

interface OptimiserState {
  running: boolean;
  progress: number;
  score: number | null;
  startScore: number | null;
  start(): void;
  /** Ends the run and keeps the best design found so far. */
  stop(): void;
}

let controller: AbortController | null = null;
let before: Design | null = null;
let best: Design | null = null;
/** The profile object the running optimiser works on; its previews and result apply only while it is loaded. */
let runProfile: Profile | null = null;
let unsubscribeProfile: (() => void) | null = null;

const stillOnRunProfile = () => runProfile !== null && useStore.getState().profile === runProfile;

function preview(d: Design) {
  if (!stillOnRunProfile()) return;
  // a live step: the store keeps the pre-run design as the gesture base for the final undo step
  useStore.getState().edit(draft => { Object.assign(draft, structuredClone(d)); }, false);
}

/** Commit `result` with the pre-run design as its one undo step (null: put the pre-run design back). */
function commit(result: Design | null) {
  const s = useStore.getState();
  if (!before || !stillOnRunProfile()) return;
  if (result) s.setDesign(structuredClone(result));
  // closes the preview gesture without an undo step (setDesign/edit skip a step for an unchanged design)
  else s.edit(draft => { Object.assign(draft, structuredClone(before!)); }, true);
}

/** Drop the run state; called when a run ends or its profile goes away. */
function release() {
  controller = null;
  before = best = null;
  runProfile = null;
  unsubscribeProfile?.();
  unsubscribeProfile = null;
}

function finish(kind: "done" | "stopped" | "error", message?: string) {
  const st = useOptimiser.getState();
  const from = st.startScore, to = st.score;
  commit(kind === "error" ? null : best);
  release();
  useOptimiser.setState({ running: false });
  if (kind === "error") {
    toast({ tone: "bad", title: "The optimiser stopped with an error", description: message });
    return;
  }
  const improved = from !== null && to !== null && to < from - 1e-6;
  toast({
    id: "optimise",
    tone: improved ? "good" : "info",
    title: kind === "stopped" ? (improved ? "Optimiser stopped, best design kept" : "Optimiser stopped") : improved ? "Design optimised" : "Already at the optimum",
    description: improved
      ? `Score ${fmtFixed(from!, 2)} → ${fmtFixed(to!, 2)} (lower is better). Every part is from your parts list.`
      : kind === "stopped" ? "Nothing better was found before it stopped." : "No combination of the listed parts scored better than the current design.",
    action: improved ? { label: "Undo", onClick: () => useStore.getState().undo() } : undefined,
  });
}

export const useOptimiser = create<OptimiserState>((set, get) => ({
  running: false,
  progress: 0,
  score: null,
  startScore: null,
  start() {
    if (get().running) return;
    const s = useStore.getState();
    if (!s.prep || !s.profile || !s.fit) {
      toast({ tone: "warn", title: "Nothing to optimise yet", description: "Load a profile with measurements first." });
      return;
    }
    before = structuredClone(s.design);
    best = null;
    runProfile = s.profile;
    // another profile (palette, wizard, switcher) ends the run: abort it and forget its designs
    unsubscribeProfile = useStore.subscribe((st, prev) => {
      if (st.profile === prev.profile || st.profile === runProfile) return;
      controller?.abort();
      release();
      set({ running: false, progress: 0 });
      toast({ id: "optimise", tone: "info", title: "Optimiser cancelled", description: "Another profile was loaded, so the run was dropped." });
    });
    let s0: number | null = null;
    try { s0 = score(s.prep, s.design); } catch { /* the score is informational */ }
    set({ running: true, progress: 0, score: s0, startScore: s0 });
    const ctl = new AbortController();
    controller = ctl;
    runOptimise(s.profile, s.fit, s.design, {
      signal: ctl.signal,
      onProgress: step => {
        if (controller !== ctl) return;
        best = step.design;
        set({ progress: step.progress, score: step.score });
        preview(step.design);
      },
    }).then(
      r => { if (controller !== ctl) return; best = r.design; set({ progress: 1, score: r.score }); finish("done"); },
      e => {
        if (controller !== ctl) return;
        if (e instanceof DOMException && e.name === "AbortError") finish("stopped");
        else finish("error", e instanceof Error ? e.message : String(e));
      },
    );
  },
  stop() {
    if (!get().running) return;
    controller?.abort();
  },
}));

/** Toggle: start when idle, stop when running (the O shortcut and the title-bar button). */
export function toggleOptimiser() {
  const o = useOptimiser.getState();
  if (o.running) o.stop(); else o.start();
}
