import { useId, useState, type FocusEvent, type ReactNode } from "react";
import { Info } from "lucide-react";
import { Tooltip } from "./Tooltip";
import { withUnits } from "./Unit";

export interface FieldProps {
  label: ReactNode;
  /** One-line explanation, shown in a tooltip on the label's info mark. */
  hint?: ReactNode;
  /** Focus id ("mid.L1") so store.ui.focus can find, scroll to and pulse this row. */
  focusId?: string;
  /** Small trailing tag next to the label (e.g. an "estimated" badge). */
  tag?: ReactNode;
  /** Put the control under the label instead of beside it (sliders). */
  stacked?: boolean;
  /** id of the control, so clicking the label focuses it. */
  htmlFor?: string;
  children: ReactNode;
  className?: string;
}

/** One labelled control row. Every inspector control sits in one of these. */
export function Field({ label, hint, focusId, tag, stacked, htmlFor, children, className }: FieldProps) {
  const Lab = htmlFor ? "label" : "span";
  const ids = useId(), nameId = `${ids}-name`, hintId = `${ids}-hint`;
  // The hint is not a tab stop of its own (one stop per control): it opens while the control has
  // keyboard focus, and the control group points at it with aria-describedby for screen readers.
  const [keyboardFocus, setKeyboardFocus] = useState(false);
  const onFocus = (e: FocusEvent<HTMLDivElement>) => setKeyboardFocus((e.target as HTMLElement).matches(":focus-visible"));
  const onBlur = (e: FocusEvent<HTMLDivElement>) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setKeyboardFocus(false); };
  return (
    <div className={`cs-field${stacked ? " is-stacked" : ""}${className ? " " + className : ""}`} data-focus-id={focusId}>
      <div className="cs-field-label">
        <Lab className="cs-field-name" id={nameId} {...(htmlFor ? { htmlFor } : {})}>{label}</Lab>
        {hint && (
          <Tooltip content={hint} side="right" delay={250} forceOpen={keyboardFocus}>
            <span className="cs-field-hint" aria-hidden>
              <Info size={12} strokeWidth={1.75} />
            </span>
          </Tooltip>
        )}
        {hint && <span id={hintId} className="visually-hidden">{hint}</span>}
        {tag}
      </div>
      <div className="cs-field-control" role="group" aria-labelledby={nameId} aria-describedby={hint ? hintId : undefined}
           onFocus={onFocus} onBlur={onBlur}>
        {children}
      </div>
    </div>
  );
}

/** A label/value pair for read-only numbers (fB, f3, fit results). */
export function Stat({ label, value, tone, hint }: { label: ReactNode; value: ReactNode; tone?: "good" | "warn" | "bad"; hint?: string }) {
  return (
    <div className={"cs-stat" + (tone ? " cs-stat-" + tone : "")} title={hint}>
      <span className="cs-stat-label">{withUnits(label)}</span>
      <span className="cs-stat-value mono">{value}</span>
    </div>
  );
}

/** Thin determinate progress bar (0..1), or indeterminate when value is undefined. */
export function ProgressBar({ value, label }: { value?: number; label: string }) {
  return (
    <div
      className={"cs-progress" + (value === undefined ? " is-indeterminate" : "")}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value === undefined ? undefined : Math.round(value * 100)}
    >
      <div className="cs-progress-bar" style={value === undefined ? undefined : { transform: `scaleX(${Math.max(0, Math.min(1, value))})` }} />
    </div>
  );
}
