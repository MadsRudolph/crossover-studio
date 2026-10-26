import type { ReactNode } from "react";
import type { CheckState } from "../types";
import { withUnits } from "./Unit";

export type Tone = "neutral" | "accent" | "good" | "warn" | "bad" | "woof" | "mid" | "tw";

/** Small label chip. Tones map to the shared colour tokens. */
export function Badge({ tone = "neutral", children, title, solid }: { tone?: Tone; children: ReactNode; title?: string; solid?: boolean }) {
  return <span className={`cs-badge cs-tone-${tone}${solid ? " is-solid" : ""}`} title={title}>{withUnits(children)}</span>;
}

const STATE_LABEL: Record<CheckState, string> = { good: "OK", warn: "Check", bad: "Problem" };

/** Coloured dot for a check state. `pulse` draws attention to a problem. */
export function StatusDot({ state, pulse, label }: { state: CheckState | "idle" | "busy"; pulse?: boolean; label?: string }) {
  return (
    <span
      className={`cs-dot cs-dot-${state}${pulse ? " is-pulse" : ""}`}
      role="img"
      aria-label={label ?? (state in STATE_LABEL ? STATE_LABEL[state as CheckState] : state)}
    />
  );
}

/** Worst state of a list, for roll-up indicators. */
export function worstState(states: CheckState[]): CheckState | null {
  if (!states.length) return null;
  return states.includes("bad") ? "bad" : states.includes("warn") ? "warn" : "good";
}
