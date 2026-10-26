import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { renderIcon, type IconLike } from "./Button";
import { Tooltip } from "./Tooltip";

export interface TabItem<T extends string> {
  id: T;
  label: ReactNode;
  icon?: IconLike;
  /** Shortcut shown in the tooltip, e.g. "1". */
  shortcut?: string;
  hint?: ReactNode;
  /** Small trailing element (count, status dot). */
  badge?: ReactNode;
  disabled?: boolean;
}

export interface TabsProps<T extends string> {
  items: TabItem<T>[];
  value: T;
  onChange(id: T): void;
  label: string;
  /** id prefix used for aria-controls: the panel should carry id `${idBase}-panel`. */
  idBase?: string;
  className?: string;
}

/** Underlined tab strip with a sliding indicator. Arrow keys move between tabs (automatic activation). */
export function Tabs<T extends string>({ items, value, onChange, label, idBase = "tabs", className }: TabsProps<T>) {
  const root = useRef<HTMLDivElement>(null);
  const [bar, setBar] = useState<{ x: number; w: number } | null>(null);
  const idx = items.findIndex(t => t.id === value);

  useLayoutEffect(() => {
    const measure = () => {
      const el = root.current?.querySelector<HTMLElement>(`[data-tab="${value}"]`);
      setBar(el ? { x: el.offsetLeft, w: el.offsetWidth } : null);
    };
    measure();
    // keep the active tab in view when the strip scrolls (narrow windows)
    root.current?.querySelector<HTMLElement>(`[data-tab="${value}"]`)?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
    const ro = new ResizeObserver(measure);
    if (root.current) ro.observe(root.current);
    // fonts arriving after first paint change tab widths
    document.fonts?.ready.then(measure).catch(() => {});
    return () => ro.disconnect();
  }, [value, items.length]);

  const go = (dir: number) => {
    for (let k = 1; k <= items.length; k++) {
      const j = (idx + dir * k + items.length * 4) % items.length;
      if (!items[j].disabled) {
        onChange(items[j].id);
        root.current?.querySelector<HTMLElement>(`[data-tab="${items[j].id}"]`)?.focus();
        return;
      }
    }
  };

  return (
    <div
      ref={root}
      role="tablist"
      aria-label={label}
      className={"cs-tabs" + (className ? " " + className : "")}
      onKeyDown={e => {
        if (e.key === "ArrowRight") { e.preventDefault(); go(1); }
        if (e.key === "ArrowLeft") { e.preventDefault(); go(-1); }
      }}
    >
      {items.map(t => {
        const on = t.id === value;
        const tab = (
          <button
            key={t.id}
            type="button"
            role="tab"
            data-tab={t.id}
            id={`${idBase}-tab-${t.id}`}
            aria-selected={on}
            aria-controls={`${idBase}-panel`}
            tabIndex={on ? 0 : -1}
            disabled={t.disabled}
            className={"cs-tab" + (on ? " is-on" : "")}
            onClick={() => onChange(t.id)}
          >
            {renderIcon(t.icon, 14)}
            <span className="cs-tab-label">{t.label}</span>
            {t.badge}
          </button>
        );
        return t.shortcut || t.hint
          ? <Tooltip key={t.id} title={typeof t.label === "string" ? t.label : undefined} content={t.hint} shortcut={t.shortcut} side="bottom">{tab}</Tooltip>
          : tab;
      })}
      {bar && <span className="cs-tabs-bar" aria-hidden style={{ transform: `translateX(${bar.x}px)`, width: bar.w }} />}
    </div>
  );
}
