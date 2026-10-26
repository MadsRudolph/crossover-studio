import { cloneElement, isValidElement, useEffect, useRef, useState, type ReactElement, type ReactNode } from "react";
import { Check } from "lucide-react";
import { Popover } from "./Popover";
import { renderIcon, type IconLike } from "./Button";
import { Kbd } from "./Kbd";
import type { Align, Side } from "./floating";

export type MenuItem =
  | { kind?: "item"; id: string; label: ReactNode; icon?: IconLike; shortcut?: string; hint?: ReactNode;
      disabled?: boolean; checked?: boolean; danger?: boolean; onSelect(): void }
  | { kind: "separator"; id: string }
  | { kind: "label"; id: string; label: ReactNode };

export interface MenuProps {
  /** The trigger element (a Button or IconButton). It gets aria-haspopup and toggles the menu. */
  trigger: ReactElement<any>;
  items: MenuItem[];
  label: string;
  side?: Side;
  align?: Align;
  /** Extra content above the items (e.g. a header). */
  header?: ReactNode;
}

/** Dropdown menu with keyboard navigation (arrows, Home/End, type-ahead, Enter, Escape). */
export function Menu({ trigger, items, label, side = "bottom", align = "start", header }: MenuProps) {
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(-1);
  const anchor = useRef<HTMLElement | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const actionable = items.map((it, i) => (it.kind ?? "item") === "item" && !(it as any).disabled ? i : -1).filter(i => i >= 0);

  useEffect(() => {
    if (!open) return;
    setHi(-1);
    requestAnimationFrame(() => list.current?.focus({ preventScroll: true }));
  }, [open]);

  const move = (dir: number) => {
    if (!actionable.length) return;
    const pos = actionable.indexOf(hi);
    const next = pos < 0 ? (dir > 0 ? 0 : actionable.length - 1) : (pos + dir + actionable.length) % actionable.length;
    setHi(actionable[next]);
  };
  const select = (i: number) => {
    const it = items[i];
    if (!it || (it.kind ?? "item") !== "item") return;
    setOpen(false);
    anchor.current?.focus();
    (it as any).onSelect();
  };

  const t = isValidElement(trigger) ? cloneElement(trigger as ReactElement<any>, {
    ref: (el: HTMLElement | null) => { anchor.current = el; },
    "aria-haspopup": "menu",
    "aria-expanded": open,
    onClick: (e: any) => { (trigger.props as any).onClick?.(e); setOpen(o => !o); },
    onKeyDown: (e: any) => {
      (trigger.props as any).onKeyDown?.(e);
      if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); }
    },
  }) : trigger;

  return (
    <>
      {t}
      <Popover open={open} onClose={() => setOpen(false)} anchor={anchor.current} side={side} align={align} ignore={[anchor]} className="cs-menu-pop">
        {header}
        <div
          ref={list}
          role="menu"
          aria-label={label}
          tabIndex={-1}
          className="cs-menu"
          onKeyDown={e => {
            if (e.key === "ArrowDown") { e.preventDefault(); move(1); }
            else if (e.key === "ArrowUp") { e.preventDefault(); move(-1); }
            else if (e.key === "Home") { e.preventDefault(); setHi(actionable[0] ?? -1); }
            else if (e.key === "End") { e.preventDefault(); setHi(actionable[actionable.length - 1] ?? -1); }
            else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); if (hi >= 0) select(hi); }
            else if (e.key === "Tab") setOpen(false);
            else if (e.key.length === 1) {
              const ch = e.key.toLowerCase();
              const hit = actionable.find(i => String((items[i] as any).label).toLowerCase().startsWith(ch));
              if (hit !== undefined) setHi(hit);
            }
          }}
        >
          {items.map((it, i) => {
            if (it.kind === "separator") return <div key={it.id} className="cs-menu-sep" role="separator" />;
            if (it.kind === "label") return <div key={it.id} className="cs-menu-label label-caps">{it.label}</div>;
            return (
              <div
                key={it.id}
                role={it.checked === undefined ? "menuitem" : "menuitemcheckbox"}
                aria-checked={it.checked}
                aria-disabled={it.disabled || undefined}
                className={"cs-menu-item" + (i === hi ? " is-hi" : "") + (it.danger ? " is-danger" : "") + (it.disabled ? " is-disabled" : "")}
                onPointerEnter={() => !it.disabled && setHi(i)}
                onPointerLeave={() => setHi(-1)}
                onClick={() => !it.disabled && select(i)}
              >
                <span className="cs-menu-icon">
                  {it.checked !== undefined ? (it.checked ? <Check size={14} strokeWidth={2.2} /> : null) : renderIcon(it.icon, 14)}
                </span>
                <span className="cs-menu-text">
                  <span>{it.label}</span>
                  {it.hint && <span className="cs-menu-hint">{it.hint}</span>}
                </span>
                {it.shortcut && <Kbd keys={it.shortcut} quiet />}
              </div>
            );
          })}
        </div>
      </Popover>
    </>
  );
}

/** Alias: a Dropdown is a Menu. */
export const Dropdown = Menu;
