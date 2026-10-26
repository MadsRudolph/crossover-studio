// Public engine API. Views, the store, the 3D viewport and the exporters use ONLY these exports.
//
// Modules: complex.ts (complex helpers), digital.ts (MiniDSP biquads and their text formats),
// passive.ts (ABCD ladders and the topology library), box.ts (woofer box model and its fit),
// system.ts (the three-way sum, metrics, checks, display helpers), optimise.ts (score, search,
// tolerance), worker.ts (the optimiser off the UI thread). All quantities are SI inside.

import type { Align, BoxFit, Design, Profile } from "../types";
import { minidspText as minidspTextFor, ltspiceText as ltspiceTextFor, type FilterKind } from "./digital";
import { TOPOLOGY_LIBRARY, type Topology } from "./passive";
import { optimise as optimiseGen, score as scoreDesign, type OptimiseOptions, type OptimiseStep } from "./optimise";
import { prepare as prepareProfile, type Prepared } from "./system";
import type { OptimiseMessage, OptimiseRequest } from "./worker";

export type { Prepared, EngineState, ProbeSample, ProbeUnit, NodeVoltages, BoxCurves, BoxCurveSet, BoxValidation, ValidationCurve } from "./system";
export { prepare, compute, offAxisAngle, boxResponse, boxModelCurves, boxValidation, driverValidation, probeSample, nodeVoltages, displayPhase, V_REF } from "./system";
export { fitBox, boxConfig, tuningHz, tubeMass, type BoxFitEx, type BoxConfig } from "./box";
export { tolerance, type OptimiseOptions, type OptimiseStep } from "./optimise";
export { ALIGNMENTS, FS_DSP, sections, type Biquad, type FilterKind } from "./digital";
export { TOPOLOGY_LIBRARY, legacyTopologies, type Topology, type TopologyPart } from "./passive";
export { interpLogF, nearestIndex } from "./complex";

/** The text DigitalCrossover.m prints for the MiniDSP custom biquads (byte-identical). */
export function minidspText(_p: Prepared | null, fc: number, kind: FilterKind, align: Align): string {
  return minidspTextFor(fc, kind, align);
}

/** One LTspice Laplace expression per biquad section (byte-identical to DigitalCrossover.m). */
export function ltspiceText(_p: Prepared | null, fc: number, kind: FilterKind, align: Align): string[] {
  return ltspiceTextFor(fc, kind, align);
}

/** Passive topology library with human names and part metadata, keyed by topology key
 *  ("LP1" "LP2" "LP3" "HP1" "HP2" "HP3"). The old [pos, kind, name][] shape: legacyTopologies(). */
export function topologies(_p?: Prepared | null): Record<string, Topology> {
  return TOPOLOGY_LIBRARY;
}

/** Score (lower = better) used by the optimiser. */
export function score(p: Prepared, design: Design): number {
  return scoreDesign(p, design);
}

/** Coordinate-descent optimiser as a generator, so a worker or the UI can step it and report progress. */
export function optimise(p: Prepared, design: Design, opts?: OptimiseOptions): Generator<OptimiseStep, { score: number; des: Design }> {
  return optimiseGen(p, design, opts);
}

export interface RunOptimiseOptions extends OptimiseOptions {
  /** Called after every coordinate step with the best design so far. */
  onProgress?: (step: { progress: number; score: number; design: Design }) => void;
  /** Aborting rejects the promise with an AbortError and stops the search. */
  signal?: AbortSignal;
}

const abortError = () => new DOMException("Optimisation cancelled", "AbortError");

/** Run the optimiser in a Web Worker (inline, yielding to the event loop, where workers do not exist,
 *  e.g. in tests). Resolves with the best design and its score. */
export function runOptimise(profile: Profile, fit: BoxFit, design: Design, opts: RunOptimiseOptions = {}): Promise<{ design: Design; score: number }> {
  const { onProgress, signal, ...options } = opts;
  if (signal?.aborted) return Promise.reject(abortError());
  let worker: Worker | null = null;
  if (typeof Worker !== "undefined") {
    try { worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" }); }
    catch { worker = null; }
  }
  if (!worker) return runInline(profile, fit, design, options, onProgress, signal);

  const w = worker;
  return new Promise((resolve, reject) => {
    const finish = () => { w.terminate(); signal?.removeEventListener("abort", onAbort); };
    const onAbort = () => { finish(); reject(abortError()); };
    signal?.addEventListener("abort", onAbort, { once: true });
    w.onmessage = (e: MessageEvent<OptimiseMessage>) => {
      const m = e.data;
      if (m.type === "progress") onProgress?.({ progress: m.progress, score: m.score, design: m.design });
      else if (m.type === "done") { finish(); resolve({ design: m.design, score: m.score }); }
      else { finish(); reject(new Error(m.message)); }
    };
    w.onerror = (e) => { finish(); reject(new Error(e.message || "optimiser worker failed")); };
    // structured cloning turns the store's frozen (Immer) objects into plain, mutable copies
    const req: OptimiseRequest = { profile, fit, design, options };
    w.postMessage(req);
  });
}

async function runInline(profile: Profile, fit: BoxFit, design: Design, options: OptimiseOptions,
                         onProgress: RunOptimiseOptions["onProgress"], signal: AbortSignal | undefined): Promise<{ design: Design; score: number }> {
  const gen = optimiseGen(prepareProfile(profile, fit), design, options);
  for (;;) {
    if (signal?.aborted) throw abortError();
    const r = gen.next();
    if (r.done) return { design: r.value.des, score: r.value.score };
    onProgress?.({ progress: r.value.progress, score: r.value.score, design: r.value.des });
    await new Promise(res => setTimeout(res, 0));
  }
}
