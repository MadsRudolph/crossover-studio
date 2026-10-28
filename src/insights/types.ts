// Insights: short, tested observations about the current design that any part of the app can show.
// Each feature contributes a provider (src/insights/providers/*.ts). The Guide view ranks them all and
// shows the few that matter now; every other view shows the ones that point at it, so the user can
// follow a problem from wherever they notice it to the view that explains it.

import type { BoxFit, Design, Profile, Results } from "../types";
import type { Prepared } from "../engine";
import type { ViewId } from "../state/store";

export type InsightSeverity = "bad" | "warn" | "info" | "good";

export interface InsightContext {
  profile: Profile;
  fit: BoxFit;
  prep: Prepared;
  design: Design;
  results: Results;
}

export interface Insight {
  /** Stable id, e.g. "time.gd-step" (provider prefix + topic). */
  id: string;
  severity: InsightSeverity;
  /** One line, plain language: "The tweeter arrives 0.4 ms before the midrange". */
  title: string;
  /** Two or three sentences: what it means for the sound and why it happens. */
  detail: string;
  /** The view that explains this best ("Show me" opens it). */
  view: ViewId;
  /** Views that should also show this as a hint (besides `view`). */
  alsoIn?: ViewId[];
  /** Frequency of interest (Hz): "Show me" sets the probe here. */
  at?: number;
  band?: [number, number];
  /** Inspector control that changes this most directly, e.g. "tw.pad.Rs". */
  focus?: string;
  /** A tested change that fixes or improves it: applying sets the design (one undo step). */
  fix?: { label: string; design: Design };
  /** Higher = more important among insights of the same severity (0..1). */
  weight?: number;
}

/** Providers must be cheap (a few ms) and pure; they run after every committed design change. */
export type InsightProvider = (ctx: InsightContext) => Insight[];
