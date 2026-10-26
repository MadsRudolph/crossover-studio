import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Check, ChevronLeft, ChevronRight } from "lucide-react";
import { Popover } from "./Popover";

export interface ValuePickerProps<T> {
  value: T;
  /** The allowed values, in order (e.g. the E12 parts the profile lists). */
  options: T[];
  format(value: T): string;
  onChange(value: T): void;
  /** Accessible name, e.g. "Midrange L1". */
  label: string;
  /** Secondary text per option in the list (e.g. "≈ −6 dB"). */
  describe?(value: T): ReactNode;
  /** Colour of the value text, a CSS colour token. */
  color?: string;
  disabled?: boolean;
  id?: string;
  className?: string;
}

const same = (a: unknown, b: unknown) =>
  a === b || (typeof a === "number" && typeof b === "number" && Math.abs(a - b) <= 1e-9 * Math.max(Math.abs(a), Math.abs(b)));

/** Index of `v` in `opts`, or of the nearest option (for numbers), so stepping works from a non-standard value too. */
function locate<T>(v: T, opts: T[]): { index: number; exact: boolean } {
  const i = opts.findIndex(o => same(o, v));
  if (i >= 0) return { index: i, exact: true };
  if (typeof v === "number") {
    let best = 0;
    opts.forEach((o, k) => {
      if (typeof o === "number" && Math.abs(Math.log(Math.abs(o) || 1e-12) - Math.log(Math.abs(v) || 1e-12)) <
          Math.abs(Math.log(Math.abs(opts[best] as number) || 1e-12) - Math.log(Math.abs(v) || 1e-12))) best = k;
    });
    return { index: best, exact: false };
  }
  return { index: -1, exact: false };
}

/**
 * ‹ value › stepper over a discrete list: arrows or the mouse wheel step through the parts,
 * clicking the value opens the whole list. A value outside the list is shown with a marker.
 */
export function ValuePicker<T>({ value, options, format, onChange, label, describe, color, disabled, id, className }: ValuePickerProps<T>) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const { index, exact } = locate(value, options);
  const [hi, setHi] = useState(index);

  const stepTo = (i: number) => {
    const j = Math.min(options.length - 1, Math.max(0, i));
    if (j !== index || !exact) onChange(options[j]);
  };
  // from a value between two parts, "next" means the part just above, "previous" the one just below
  const step = (dir: 1 | -1) => {
    if (exact) return stepTo(index + dir);
    const n = options[index] as unknown as number, v = value as unknown as number;
    stepTo(dir > 0 ? (n > v ? index : index + 1) : (n < v ? index : index - 1));
  };

  // the wheel needs a non-passive listener so it can keep the inspector from scrolling while stepping
  const stepRef = useRef(step);
  stepRef.current = step;
  useEffect(() => {
    const el = root.current;
    if (!el || disabled) return;
    // trackpads send many small deltas: accumulate to about one mouse-wheel notch per step
    let acc = 0;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      acc += e.deltaMode === 1 ? e.deltaY * 40 : e.deltaY;
      if (Math.abs(acc) < 40) return;
      stepRef.current(acc < 0 ? 1 : -1);
      acc = 0;
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [disabled]);

  useEffect(() => {
    if (!open) return;
    setHi(index);
    requestAnimationFrame(() => {
      list.current?.querySelector<HTMLElement>(`[data-index="${Math.max(0, index)}"]`)?.scrollIntoView({ block: "center" });
      list.current?.focus({ preventScroll: true });
    });
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const choose = (i: number) => { onChange(options[i]); setOpen(false); button.current?.focus(); };

  return (
    <div
      ref={root}
      className={`cs-vp${disabled ? " is-disabled" : ""}${open ? " is-open" : ""}${className ? " " + className : ""}`}
      style={color ? ({ "--vp-color": color } as CSSProperties) : undefined}
    >
      <button type="button" className="cs-vp-step" tabIndex={-1} aria-label={`Previous ${label}`}
              disabled={disabled || (exact && index <= 0)} onClick={() => step(-1)}>
        <ChevronLeft size={14} strokeWidth={2} />
      </button>
      <button
        ref={button}
        id={id}
        type="button"
        className="cs-vp-value mono"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${label}: ${format(value)}`}
        onClick={() => setOpen(o => !o)}
        onKeyDown={e => {
          if (e.key === "ArrowUp" || e.key === "ArrowRight") { e.preventDefault(); step(1); }
          else if (e.key === "ArrowDown" || e.key === "ArrowLeft") { e.preventDefault(); step(-1); }
          else if (e.key === "Home") { e.preventDefault(); stepTo(0); }
          else if (e.key === "End") { e.preventDefault(); stepTo(options.length - 1); }
        }}
      >
        <span>{format(value)}</span>
        {!exact && <span className="cs-vp-custom" title="Not in the parts list">*</span>}
      </button>
      <button type="button" className="cs-vp-step" tabIndex={-1} aria-label={`Next ${label}`}
              disabled={disabled || (exact && index >= options.length - 1)} onClick={() => step(1)}>
        <ChevronRight size={14} strokeWidth={2} />
      </button>

      <Popover open={open} onClose={() => setOpen(false)} anchor={root.current} matchWidth ignore={[root]} className="cs-vp-pop">
        <div
          ref={list}
          role="listbox"
          tabIndex={-1}
          aria-label={label}
          aria-activedescendant={hi >= 0 ? `${id ?? label}-opt-${hi}` : undefined}
          className="cs-vp-list"
          onKeyDown={e => {
            if (e.key === "ArrowDown") { e.preventDefault(); setHi(h => Math.min(options.length - 1, h + 1)); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setHi(h => Math.max(0, h - 1)); }
            else if (e.key === "Home") { e.preventDefault(); setHi(0); }
            else if (e.key === "End") { e.preventDefault(); setHi(options.length - 1); }
            else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); if (hi >= 0) choose(hi); }
            else if (e.key === "Tab") setOpen(false);
          }}
        >
          {options.map((o, i) => (
            <div
              key={i}
              id={`${id ?? label}-opt-${i}`}
              data-index={i}
              role="option"
              aria-selected={exact && i === index}
              className={"cs-vp-opt" + (i === hi ? " is-hi" : "") + (exact && i === index ? " is-on" : "")}
              onPointerEnter={() => setHi(i)}
              onClick={() => choose(i)}
              ref={el => { if (el && i === hi && open) el.scrollIntoView({ block: "nearest" }); }}
            >
              <span className="cs-vp-check">{exact && i === index && <Check size={13} strokeWidth={2.25} />}</span>
              <span className="mono">{format(o)}</span>
              {describe && <span className="cs-vp-desc">{describe(o)}</span>}
            </div>
          ))}
        </div>
      </Popover>
    </div>
  );
}
