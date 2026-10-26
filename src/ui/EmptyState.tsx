import type { ReactNode } from "react";
import { renderIcon, type IconLike } from "./Button";

export interface EmptyStateProps {
  icon?: IconLike;
  title: ReactNode;
  /** What is missing and why, in one or two sentences. */
  description?: ReactNode;
  /** The next step, usually one primary Button (plus an optional secondary). */
  action?: ReactNode;
  tone?: "neutral" | "bad";
  compact?: boolean;
}

/** Shown wherever there is nothing to draw: says what is missing and offers the way forward. */
export function EmptyState({ icon, title, description, action, tone = "neutral", compact }: EmptyStateProps) {
  return (
    <div className={`cs-empty${compact ? " is-compact" : ""} cs-empty-${tone}`} role={tone === "bad" ? "alert" : undefined}>
      {icon !== undefined && <div className="cs-empty-icon" aria-hidden>{renderIcon(icon, compact ? 20 : 26)}</div>}
      <h3 className="cs-empty-title">{title}</h3>
      {description && <p className="cs-empty-desc">{description}</p>}
      {action && <div className="cs-empty-actions">{action}</div>}
    </div>
  );
}
