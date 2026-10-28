// Tab strip with a sliding indicator. Optionally grouped (a label and a hairline before each group) and
// self-collapsing: with `collapse`, it steps down through densities until it fits its space: labels on
// every tab, tighter labels, icons for the groups other than the open view's, and finally icons for
// every tab but the active one (then with less padding). Collapsed tabs keep their label for screen readers and the tooltip.
import { Fragment, useLayoutEffect, useRef, useState, type ReactNode } from "react";
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
  /** Group id (see TabsProps.groups). */
  group?: string;
}

export interface TabsProps<T extends string> {
  items: TabItem<T>[];
  value: T;
  onChange(id: T): void;
  label: string;
  /** id prefix used for aria-controls: the panel should carry id `${idBase}-panel`. */
  idBase?: string;
  className?: string;
  /** Group titles, in order; items with a `group` are shown under them. */
  groups?: { id: string; title: string }[];
  /** Step down to icon tabs when the labels do not fit (see the header comment). */
  collapse?: boolean;
}

/** Densities from roomiest to most compact (data-density on the strip; styled in primitives.css). */
const DENSITIES = ["full", "tight", "group", "compact", "tiny"] as const;

/** Underlined tab strip with a sliding indicator. Arrow keys move between tabs (automatic activation). */
export function Tabs<T extends string>({ items, value, onChange, label, idBase = "tabs", className, groups, collapse }: TabsProps<T>) {
  const root = useRef<HTMLDivElement>(null);
  const [bar, setBar] = useState<{ x: number; w: number } | null>(null);
  const idx = items.findIndex(t => t.id === value);
  const activeGroup = items[idx]?.group;

  useLayoutEffect(() => {
    // the roomiest density whose content fits the strip's space (no paint in between)
    const fit = () => {
      const el = root.current;
      if (!el || !collapse) return;
      for (const d of DENSITIES) {
        el.dataset.density = d;
        if (el.scrollWidth <= el.clientWidth + 1) break;
      }
    };
    const measure = () => {
      fit();
      const el = root.current?.querySelector<HTMLElement>(`[data-tab="${value}"]`);
      setBar(el ? { x: el.offsetLeft, w: el.offsetWidth } : null);
    };
    measure();
    // keep the active tab in view when the strip scrolls (narrow windows)
    root.current?.querySelector<HTMLElement>(`[data-tab="${value}"]`)?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
    const ro = new ResizeObserver(measure);
    if (root.current) ro.observe(root.current);
    // a collapsed strip only grows back when its container does: watch that too
    if (collapse && root.current?.parentElement) ro.observe(root.current.parentElement);
    // fonts arriving after first paint change tab widths
    document.fonts?.ready.then(measure).catch(() => {});
    return () => ro.disconnect();
  }, [value, items.length, collapse]);

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
      {items.map((t, i) => {
        const on = t.id === value;
        // a group's label (and a hairline from the previous group) before its first tab; a group of
        // one tab needs no label, the tab names itself
        const g = t.group !== undefined && t.group !== items[i - 1]?.group ? groups?.find(x => x.id === t.group) : undefined;
        const size = g ? items.filter(x => x.group === g.id).length : 0;
        const head = g && (
          <span className={"cs-tabs-group" + (i ? " has-rule" : "") + (g.id === activeGroup ? " is-active" : "")} aria-hidden>
            {size > 1 && <span className="cs-tabs-group-label">{g.title}</span>}
          </span>
        );
        const other = t.group !== undefined && t.group !== activeGroup;
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
            className={"cs-tab" + (on ? " is-on" : "") + (other ? " is-other-group" : "")}
            onClick={() => onChange(t.id)}
          >
            {renderIcon(t.icon, 14)}
            <span className="cs-tab-label">{t.label}</span>
            {t.badge}
          </button>
        );
        const wrapped = t.shortcut || t.hint || collapse
          ? <Tooltip title={typeof t.label === "string" ? t.label : undefined} content={t.hint} shortcut={t.shortcut} side="bottom">{tab}</Tooltip>
          : tab;
        return <Fragment key={t.id}>{head}{wrapped}</Fragment>;
      })}
      {bar && <span className="cs-tabs-bar" aria-hidden style={{ transform: `translateX(${bar.x}px)`, width: bar.w }} />}
    </div>
  );
}
