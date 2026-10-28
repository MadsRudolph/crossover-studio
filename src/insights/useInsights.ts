// The current design's insights, computed once per Results object and shared by every view.
import { useStore } from "../state/store";
import type { Results } from "../types";
import { collectInsights, type Insight } from "./index";

const cache = new WeakMap<Results, Insight[]>();

export function useInsights(): Insight[] {
  const profile = useStore(s => s.profile), fit = useStore(s => s.fit), prep = useStore(s => s.prep);
  const design = useStore(s => s.design), results = useStore(s => s.results);
  if (!profile || !fit || !prep || !results) return [];
  let list = cache.get(results);
  if (!list) { list = collectInsights({ profile, fit, prep, design, results }); cache.set(results, list); }
  return list;
}
