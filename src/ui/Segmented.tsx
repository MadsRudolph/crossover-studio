import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { renderIcon, type IconLike } from "./Button";
import { Tooltip } from "./Tooltip";

export interface SegmentOption<T extends string | number> {
  value: T;
  label: ReactNode;
  icon?: IconLike;
  /** Tooltip line for this option. */
  hint?: ReactNode;
  disabled?: boolean;
  /** Optional colour token for the selected state, e.g. "var(--woof)". */
  color?: string;
}

export interface SegmentedProps<T extends string | number> {
  options: SegmentOption<T>[];
  value: T;
  onChange(value: T): void;
  /** Accessible name of the group. */
  label: string;
  size?: "sm" | "md";
  block?: boolean;
  className?: string;
}

/** A row of mutually exclusive options with a sliding selection; arrow keys move the choice. */
export function Segmented<T extends string | number>({ options, value, onChange, label, size = "md", block, className }: SegmentedProps<T>) {
  const root = useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = useState<{ x: number; w: number } | null>(null);
  const idx = options.findIndex(o => o.value === value);

  useLayoutEffect(() => {
    const el = root.current?.querySelector<HTMLElement>(`[data-index="${idx}"]`);
    if (!el) { setThumb(null); return; }
    const measure = () => setThumb({ x: el.offsetLeft, w: el.offsetWidth });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(root.current!);
    return () => ro.disconnect();
  }, [idx, options.length]);

  const move = (dir: number) => {
    for (let k = 1; k <= options.length; k++) {
      const j = (idx + dir * k + options.length * 4) % options.length;
      if (!options[j].disabled) {
        onChange(options[j].value);
        root.current?.querySelector<HTMLElement>(`[data-index="${j}"]`)?.focus();
        return;
      }
    }
  };

  const active = options[idx];
  return (
    <div
      ref={root}
      role="radiogroup"
      aria-label={label}
      className={`cs-seg cs-seg-${size}${block ? " cs-seg-block" : ""}${className ? " " + className : ""}`}
      onKeyDown={e => {
        if (e.key === "ArrowRight" || e.key === "ArrowDown") { e.preventDefault(); move(1); }
        if (e.key === "ArrowLeft" || e.key === "ArrowUp") { e.preventDefault(); move(-1); }
      }}
    >
      {thumb && (
        <span
          className="cs-seg-thumb"
          aria-hidden
          style={{ transform: `translateX(${thumb.x}px)`, width: thumb.w, ...(active?.color ? { ["--seg-color" as string]: active.color } : {}) }}
        />
      )}
      {options.map((o, i) => {
        const btn = (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            data-index={i}
            aria-checked={i === idx}
            tabIndex={i === idx || (idx < 0 && i === 0) ? 0 : -1}
            disabled={o.disabled}
            className={"cs-seg-opt" + (i === idx ? " is-on" : "")}
            onClick={() => onChange(o.value)}
          >
            {renderIcon(o.icon, size === "sm" ? 13 : 14)}
            {o.label !== "" && <span>{o.label}</span>}
          </button>
        );
        return o.hint ? <Tooltip key={String(o.value)} content={o.hint} side="bottom">{btn}</Tooltip> : btn;
      })}
    </div>
  );
}
