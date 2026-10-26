import { Check, Minus } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";

export interface SwitchProps {
  checked: boolean;
  onChange(checked: boolean): void;
  /** Visible label (also the accessible name). Omit and pass aria-label for a bare switch. */
  children?: ReactNode;
  "aria-label"?: string;
  disabled?: boolean;
  size?: "sm" | "md";
  id?: string;
}

/** On/off switch for settings that take effect immediately. */
export function Switch({ checked, onChange, children, disabled, size = "md", id, ...aria }: SwitchProps) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={aria["aria-label"]}
      disabled={disabled}
      className={`cs-switch cs-switch-${size}${checked ? " is-on" : ""}`}
      onClick={() => onChange(!checked)}
    >
      <span className="cs-switch-track" aria-hidden><span className="cs-switch-knob" /></span>
      {children && <span className="cs-switch-label">{children}</span>}
    </button>
  );
}

/** Alias kept for readability where "toggle" reads better than "switch". */
export const Toggle = Switch;

export interface CheckboxProps {
  checked: boolean | "mixed";
  onChange(checked: boolean): void;
  children?: ReactNode;
  "aria-label"?: string;
  disabled?: boolean;
  /** Colour of the checked box, a CSS colour token (e.g. "var(--woof)" for a trace toggle). */
  color?: string;
  id?: string;
}

export function Checkbox({ checked, onChange, children, disabled, color, id, ...aria }: CheckboxProps) {
  const on = checked === true, mixed = checked === "mixed";
  return (
    <button
      id={id}
      type="button"
      role="checkbox"
      aria-checked={mixed ? "mixed" : on}
      aria-label={aria["aria-label"]}
      disabled={disabled}
      className={"cs-check" + (on || mixed ? " is-on" : "")}
      style={color ? ({ "--check-color": color } as CSSProperties) : undefined}
      onClick={() => onChange(!on)}
    >
      <span className="cs-check-box" aria-hidden>
        {on && <Check size={11} strokeWidth={3} />}
        {mixed && <Minus size={11} strokeWidth={3} />}
      </span>
      {children && <span className="cs-check-label">{children}</span>}
    </button>
  );
}
