// Positioning for tooltips, popovers and menus: place a floating box next to an anchor rectangle,
// flip to the other side when it would leave the viewport, then clamp it inside with a margin.
import { useLayoutEffect, useState, type RefObject } from "react";

export type Side = "top" | "bottom" | "left" | "right";
export type Align = "start" | "center" | "end";
export interface Placement { side: Side; align?: Align }

const MARGIN = 8;

export function place(anchor: DOMRect, size: { width: number; height: number }, want: Placement, offset = 6):
  { x: number; y: number; side: Side } {
  const vw = window.innerWidth, vh = window.innerHeight;
  const align = want.align ?? "center";
  const fits = (side: Side) =>
    side === "top" ? anchor.top - offset - size.height >= MARGIN
    : side === "bottom" ? anchor.bottom + offset + size.height <= vh - MARGIN
    : side === "left" ? anchor.left - offset - size.width >= MARGIN
    : anchor.right + offset + size.width <= vw - MARGIN;
  const opposite: Record<Side, Side> = { top: "bottom", bottom: "top", left: "right", right: "left" };
  const side = fits(want.side) || !fits(opposite[want.side]) ? want.side : opposite[want.side];

  let x: number, y: number;
  if (side === "top" || side === "bottom") {
    y = side === "top" ? anchor.top - offset - size.height : anchor.bottom + offset;
    x = align === "start" ? anchor.left : align === "end" ? anchor.right - size.width : anchor.left + anchor.width / 2 - size.width / 2;
  } else {
    x = side === "left" ? anchor.left - offset - size.width : anchor.right + offset;
    y = align === "start" ? anchor.top : align === "end" ? anchor.bottom - size.height : anchor.top + anchor.height / 2 - size.height / 2;
  }
  x = Math.min(Math.max(MARGIN, x), Math.max(MARGIN, vw - MARGIN - size.width));
  y = Math.min(Math.max(MARGIN, y), Math.max(MARGIN, vh - MARGIN - size.height));
  return { x: Math.round(x), y: Math.round(y), side };
}

/** Keeps a floating element positioned against an anchor while open (follows scroll and resize). */
export function useFloating(open: boolean, anchor: HTMLElement | null, floating: RefObject<HTMLElement | null>,
                            placement: Placement, offset = 6) {
  const [pos, setPos] = useState<{ x: number; y: number; side: Side } | null>(null);
  useLayoutEffect(() => {
    if (!open || !anchor) { setPos(null); return; }
    const update = () => {
      const el = floating.current;
      if (!el || !anchor.isConnected) return;
      const r = el.getBoundingClientRect();
      setPos(place(anchor.getBoundingClientRect(), { width: r.width, height: r.height }, placement, offset));
    };
    update();
    const ro = new ResizeObserver(update);
    if (floating.current) ro.observe(floating.current);
    ro.observe(anchor);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => { ro.disconnect(); window.removeEventListener("resize", update); window.removeEventListener("scroll", update, true); };
  }, [open, anchor, floating, placement.side, placement.align, offset]);
  return pos;
}
