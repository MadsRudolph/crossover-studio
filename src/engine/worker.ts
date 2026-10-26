// Optimiser worker: runs the coordinate descent off the UI thread and reports every step.
// Protocol: one request in, then any number of "progress" messages and one "done" or "error".
// Cancelling is done by the caller terminating the worker.

import type { BoxFit, Design, Profile } from "../types";
import { optimise, type OptimiseOptions } from "./optimise";
import { prepare } from "./system";

export interface OptimiseRequest { profile: Profile; fit: BoxFit; design: Design; options?: OptimiseOptions }
export type OptimiseMessage =
  | { type: "progress"; progress: number; score: number; design: Design }
  | { type: "done"; score: number; design: Design }
  | { type: "error"; message: string };

const ctx = self as unknown as { postMessage(m: OptimiseMessage): void; onmessage: ((e: MessageEvent<OptimiseRequest>) => void) | null };

ctx.onmessage = (e) => {
  try {
    const { profile, fit, design, options } = e.data;
    const gen = optimise(prepare(profile, fit), design, options);
    for (;;) {
      const r = gen.next();
      if (r.done) { ctx.postMessage({ type: "done", score: r.value.score, design: r.value.des }); break; }
      ctx.postMessage({ type: "progress", progress: r.value.progress, score: r.value.score, design: r.value.des });
    }
  } catch (err) {
    ctx.postMessage({ type: "error", message: err instanceof Error ? err.message : String(err) });
  }
};
