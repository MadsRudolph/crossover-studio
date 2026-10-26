import { cloneElement, isValidElement, useEffect, useId, useRef, useState, type ReactElement, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useFloating, type Side } from "./floating";
import { Kbd } from "./Kbd";

// One tooltip open at a time; moving between triggers inside the grace period skips the delay,
// so scanning along a toolbar feels immediate after the first one appears.
let lastHide = 0;
const GRACE_MS = 400;

export interface TooltipProps {
  /** Text or rich content. Nothing renders when empty. */
  content: ReactNode;
  /** Optional title line above the content. */
  title?: ReactNode;
  /** Keyboard shortcut shown at the right, e.g. "Mod+K" or "S". */
  shortcut?: string;
  side?: Side;
  /** Delay before showing, ms. */
  delay?: number;
  /** The trigger: a single element that accepts pointer and focus handlers. */
  children: ReactElement<any>;
  disabled?: boolean;
  /** Show it now, anchored to the trigger (e.g. while the control it explains has keyboard focus). */
  forceOpen?: boolean;
}

export function Tooltip({ content, title, shortcut, side = "top", delay = 450, children, disabled, forceOpen }: TooltipProps) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const floating = useRef<HTMLDivElement>(null);
  const id = useId();
  const pos = useFloating(open, anchor, floating, { side });

  const show = (el: HTMLElement) => {
    if (disabled || (!content && !title)) return;
    window.clearTimeout(timer.current);
    setAnchor(el);
    const wait = performance.now() - lastHide < GRACE_MS ? 60 : delay;
    timer.current = window.setTimeout(() => setOpen(true), wait);
  };
  const hide = () => {
    window.clearTimeout(timer.current);
    if (open) lastHide = performance.now();
    setOpen(false);
  };
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const triggerEl = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (forceOpen && triggerEl.current && !disabled && (content || title)) { setAnchor(triggerEl.current); setOpen(true); }
    else if (!forceOpen) setOpen(false);
  }, [forceOpen]); // eslint-disable-line react-hooks/exhaustive-deps
  // a press means the person is acting, not reading: get out of the way
  useEffect(() => { if (disabled) hide(); }, [disabled]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!isValidElement(children)) return children;
  const p = children.props as Record<string, any>;
  const chain = (name: string, fn: (e: any) => void) => (e: any) => { p[name]?.(e); fn(e); };
  const trigger = cloneElement(children as ReactElement<any>, {
    ref: (el: HTMLElement | null) => {
      triggerEl.current = el;
      const r = p.ref;
      if (typeof r === "function") r(el); else if (r && typeof r === "object") r.current = el;
    },
    onPointerEnter: chain("onPointerEnter", e => { if (e.pointerType !== "touch") show(e.currentTarget); }),
    onPointerLeave: chain("onPointerLeave", hide),
    onPointerDown: chain("onPointerDown", hide),
    onFocus: chain("onFocus", e => { if ((e.currentTarget as HTMLElement).matches(":focus-visible")) show(e.currentTarget); }),
    onBlur: chain("onBlur", hide),
    "aria-describedby": open ? id : p["aria-describedby"],
  });

  return (
    <>
      {trigger}
      {open && createPortal(
        <div
          ref={floating}
          id={id}
          role="tooltip"
          className="cs-tooltip"
          data-side={pos?.side ?? side}
          style={{ left: pos?.x ?? -9999, top: pos?.y ?? -9999, visibility: pos ? "visible" : "hidden" }}
        >
          {(title || shortcut) && (
            <div className="cs-tooltip-head">
              {title && <span className="cs-tooltip-title">{title}</span>}
              {shortcut && <Kbd keys={shortcut} />}
            </div>
          )}
          {content && <div className="cs-tooltip-body">{content}</div>}
        </div>,
        document.body,
      )}
    </>
  );
}
