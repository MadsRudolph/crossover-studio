// The insight registry. Every provider runs on the current design; failures are dropped, not thrown,
// so one broken provider never blanks the Guide.
import type { Insight, InsightContext, InsightProvider } from "./types";
import { assessmentInsights } from "./providers/assessment";
import { timeInsights } from "./providers/time";
import { sensitivityInsights } from "./providers/sensitivity";
import { limitsInsights } from "./providers/limits";
import { listeningInsights } from "./providers/listening";

export type { Insight, InsightContext, InsightProvider, InsightSeverity } from "./types";

export const PROVIDERS: InsightProvider[] = [assessmentInsights, timeInsights, sensitivityInsights, limitsInsights, listeningInsights];

const RANK = { bad: 0, warn: 1, info: 2, good: 3 } as const;

/** All insights for a design, most important first. */
export function collectInsights(ctx: InsightContext): Insight[] {
  const out: Insight[] = [];
  for (const p of PROVIDERS) {
    try { out.push(...p(ctx)); } catch { /* a failing provider contributes nothing */ }
  }
  return out.sort((a, b) => RANK[a.severity] - RANK[b.severity] || (b.weight ?? 0.5) - (a.weight ?? 0.5));
}
