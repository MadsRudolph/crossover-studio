import { forwardRef, useEffect, useRef, useState, type CSSProperties } from "react";
import { fmtSig, parseNumber } from "./format";

export interface NumberFieldProps {
  /** Value in display units (the caller converts SI at the edge). */
  value: number | null;
  onChange(value: number): void;
  unit?: string;
  min?: number;
  max?: number;
  /** Arrow-key step; Shift multiplies by 10, Alt divides by 10. */
  step?: number;
  digits?: number;
  /** Custom display text of the committed value. */
  format?(value: number): string;
  parse?(text: string): number | null;
  placeholder?: string;
  label: string;
  disabled?: boolean;
  /** Width of the input in characters. */
  size?: number;
  id?: string;
  className?: string;
  style?: CSSProperties;
}

/** Typed numeric input with unit suffix. Enter or blur commits, Escape reverts, arrows step. */
export const NumberField = forwardRef<HTMLInputElement, NumberFieldProps>(function NumberField(
  { value, onChange, unit, min = -Infinity, max = Infinity, step = 1, digits, format, parse, placeholder, label, disabled, size = 7,
    id, className, style }, ref) {
  const show = (v: number | null) => v === null || !Number.isFinite(v) ? "" : format ? format(v) : digits !== undefined ? v.toFixed(digits) : fmtSig(v, 4);
  const [draft, setDraft] = useState(show(value));
  const [bad, setBad] = useState(false);
  const editing = useRef(false);

  useEffect(() => { if (!editing.current) setDraft(show(value)); }, [value]); // eslint-disable-line react-hooks/exhaustive-deps

  const clamp = (v: number) => Math.min(max, Math.max(min, v));
  const commit = () => {
    editing.current = false;
    const v = parse ? parse(draft) : parseNumber(draft, unit);
    if (v === null || !Number.isFinite(v)) { setBad(draft.trim() !== ""); setDraft(show(value)); return; }
    const c = clamp(v);
    setBad(false);
    setDraft(show(c));
    if (c !== value) onChange(c);
  };

  return (
    <label className={`cs-numfield${bad ? " is-bad" : ""}${disabled ? " is-disabled" : ""}${className ? " " + className : ""}`} style={style}>
      <input
        ref={ref}
        id={id}
        className="mono"
        inputMode="decimal"
        spellCheck={false}
        autoComplete="off"
        size={size}
        value={draft}
        placeholder={placeholder}
        disabled={disabled}
        aria-label={label}
        aria-invalid={bad || undefined}
        onFocus={e => { editing.current = true; e.currentTarget.select(); }}
        onChange={e => { editing.current = true; setDraft(e.target.value); setBad(false); }}
        onBlur={commit}
        onKeyDown={e => {
          if (e.key === "Enter") { e.preventDefault(); commit(); e.currentTarget.select(); editing.current = true; }
          else if (e.key === "Escape") { editing.current = false; setDraft(show(value)); setBad(false); e.currentTarget.blur(); e.stopPropagation(); }
          else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault();
            const base = (parse ? parse(draft) : parseNumber(draft, unit)) ?? value ?? 0;
            const s = step * (e.shiftKey ? 10 : e.altKey ? 0.1 : 1) * (e.key === "ArrowUp" ? 1 : -1);
            const c = clamp(Number((base + s).toPrecision(12)));
            setDraft(show(c));
            onChange(c);
          }
        }}
      />
      {unit && <span className="cs-numfield-unit">{unit}</span>}
    </label>
  );
});
