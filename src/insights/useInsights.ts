// The current design's insights, computed once per Results object and shared by every view. Inputs that
// live outside the design (data-sheet values, listening-test ratings) bump a version, so the insights
// follow them without a design change.
import { useStore } from "../state/store";
import type { Results } from "../types";
import { collectInsights, type Insight } from "./index";
import { useInsightsVersion } from "./invalidate";

const cache = new WeakMap<Results, { version: number; list: Insight[] }>();

export function useInsights(): Insight[] {
  const v = useInsightsVersion();
  const profile = useStore(s => s.profile), fit = useStore(s => s.fit), prep = useStore(s => s.prep);
  const design = useStore(s => s.design), results = useStore(s => s.results);
  if (!profile || !fit || !prep || !results) return [];
  let hit = cache.get(results);
  if (!hit || hit.version !== v) { hit = { version: v, list: collectInsights({ profile, fit, prep, design, results }) }; cache.set(results, hit); }
  return hit.list;
}
