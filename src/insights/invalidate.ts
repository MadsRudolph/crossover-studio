// Inputs the insights read from outside the design (the data-sheet values typed into the Limits view,
// the listening-test ratings) bump a version, so every insight cache drops what it holds and the Guide
// and the hint strips follow them without a design change.
import { useSyncExternalStore } from "react";
import { onLimitOverrides } from "./providers/limits";
import { useListenTest } from "../listentest/store";

let version = 0;
const listeners = new Set<() => void>();
const bump = () => { version++; listeners.forEach(l => l()); };
onLimitOverrides(bump);
useListenTest.subscribe((s, prev) => { if (s.doc !== prev.doc) bump(); });

export const insightsVersion = () => version;
export const onInsightsInvalidated = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

/** The current version, re-rendering the caller when it changes. */
export function useInsightsVersion(): number {
  return useSyncExternalStore(onInsightsInvalidated, insightsVersion);
}
