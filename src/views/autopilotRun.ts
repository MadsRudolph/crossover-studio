// The autopilot ("Design it for me") as app state: one run at a time, shared by the Guide (stepper and
// result screen) and the command palette. The run works on a copy of the design and changes nothing
// until the student accepts it; accepting is ONE undo step. Loading another profile cancels the run.
import { create } from "zustand";
import { runAutopilot, type AutopilotProgress, type AutopilotResult, type AutopilotStep } from "../engine";
import { useStore } from "../state/store";
import type { Design, Profile } from "../types";
import { toast } from "../ui";

export interface AutopilotState {
  status: "idle" | "running" | "done" | "error";
  progress: AutopilotProgress | null;
  /** Steps finished so far (live while running, all five when done). */
  steps: AutopilotStep[];
  result: AutopilotResult | null;
  /** The design the run started from: if the student edits meanwhile, accepting replaces those edits. */
  from: Design | null;
  error: string | null;
}

export const useAutopilot = create<AutopilotState>(() => ({ status: "idle", progress: null, steps: [], result: null, from: null, error: null }));

let controller: AbortController | null = null;
let runProfile: Profile | null = null;
let unsubscribe: (() => void) | null = null;

function release() {
  controller = null;
  runProfile = null;
  unsubscribe?.();
  unsubscribe = null;
}

/** Start a run on the current design (a running one is left to finish). */
export function startAutopilot() {
  const s = useStore.getState();
  if (!s.prep || !s.results || useAutopilot.getState().status === "running") return;
  const ac = new AbortController();
  controller = ac;
  runProfile = s.profile;
  const from = s.design;
  useAutopilot.setState({ status: "running", progress: null, steps: [], result: null, from, error: null });
  // another profile makes the run meaningless: cancel it
  unsubscribe = useStore.subscribe(st => { if (st.profile !== runProfile) cancelAutopilot(true); });
  runAutopilot(s.prep, structuredClone(from), {
    signal: ac.signal,
    onProgress: p => { if (controller === ac) useAutopilot.setState({ progress: p }); },
    onStep: step => { if (controller === ac) useAutopilot.setState(st => ({ steps: [...st.steps, step] })); },
  }).then(result => {
    if (controller !== ac) return;
    release();
    useAutopilot.setState({ status: "done", result, steps: result.steps, progress: null });
  }).catch(e => {
    if (controller !== ac) return;
    release();
    if (e?.name === "AbortError") useAutopilot.setState({ status: "idle", progress: null, steps: [] });
    else useAutopilot.setState({ status: "error", error: e instanceof Error ? e.message : String(e), progress: null });
  });
}

/** Stop a running autopilot (nothing is changed). */
export function cancelAutopilot(silent = false) {
  if (!controller) return;
  controller.abort();
  release();
  useAutopilot.setState({ status: "idle", progress: null, steps: [], result: null });
  if (!silent) toast({ id: "autopilot", tone: "info", title: "Autopilot stopped", description: "Your design is unchanged." });
}

/** Accept the design after step `upTo` (0-based; default: the whole result) as one undo step. */
export function acceptAutopilot(upTo?: number) {
  const { result } = useAutopilot.getState();
  if (!result) return;
  const step = upTo === undefined ? null : result.steps[upTo];
  const design = step ? step.design : result.design, score = step ? step.score : result.after.score;
  useStore.getState().setDesign(structuredClone(design));
  useAutopilot.setState({ status: "idle", result: null, steps: [], from: null });
  toast({ id: "autopilot", tone: "good", title: step ? `Autopilot accepted up to “${step.title}”` : "Autopilot design accepted",
          description: `Score ${result.before.score} → ${score}/100. Every part is from your parts list.`,
          action: { label: "Undo", onClick: () => useStore.getState().undo() } });
}

export function discardAutopilot() {
  useAutopilot.setState({ status: "idle", result: null, steps: [], from: null, error: null });
}

/** The palette command and the shortcut: open the Guide and start (or show) the run. */
export function designItForMe() {
  const s = useStore.getState();
  if (!s.results) { toast({ tone: "warn", title: "Nothing to design yet", description: "Load a profile first." }); return; }
  if (s.view !== "guide") s.setView("guide");
  if (useAutopilot.getState().status !== "running") startAutopilot();
}
