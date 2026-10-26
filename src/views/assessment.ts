// The verdict of the current design, shared by the Verdict view, the System view's checks card, the
// inspector and the status bar. assess() is cached per Results object, so each design is judged once.

import { useEffect, useState } from "react";
import { assess, suggest, type Assessment, type Suggestion } from "../engine";
import { useStore } from "../state/store";
import type { Results } from "../types";

const cache = new WeakMap<Results, Assessment | null>();

export function useAssessment(): Assessment | null {
  const prep = useStore(s => s.prep);
  const design = useStore(s => s.design);
  const results = useStore(s => s.results);
  if (!prep || !results) return null;
  if (!cache.has(results)) {
    try { cache.set(results, assess(prep, design, results)); } catch { cache.set(results, null); }
  }
  return cache.get(results) ?? null;
}

/** Tested suggestions for the current design, worked out a moment after the design settles
 *  (about 50 ms of trial designs), so live slider drags stay smooth. */
export function useSuggestions(a: Assessment | null): { list: Suggestion[]; busy: boolean } {
  const prep = useStore(s => s.prep);
  const design = useStore(s => s.design);
  const [state, setState] = useState<{ design: unknown; list: Suggestion[] }>({ design: null, list: [] });
  useEffect(() => {
    if (!prep || !a || state.design === design) return;
    const t = window.setTimeout(() => {
      try { setState({ design, list: suggest(prep, design, a) }); } catch { setState({ design, list: [] }); }
    }, 300);
    return () => window.clearTimeout(t);
  }, [prep, design, a]); // eslint-disable-line react-hooks/exhaustive-deps
  return { list: state.list, busy: state.design !== design };
}

export const RATING_TONE: Record<Assessment["rating"], "good" | "warn" | "bad"> = {
  Excellent: "good", Good: "good", Fair: "warn", "Needs work": "bad", Poor: "bad",
};
