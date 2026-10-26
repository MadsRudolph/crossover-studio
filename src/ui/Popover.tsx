import { useRef, type CSSProperties, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { useFloating, type Align, type Side } from "./floating";
import { useEscape, useOutsidePress } from "./hooks";

export interface PopoverProps {
  open: boolean;
  onClose(): void;
  /** Element the popover hangs from. */
  anchor: HTMLElement | null;
  side?: Side;
  align?: Align;
  offset?: number;
  /** Make the popover at least as wide as its anchor (dropdown lists). */
  matchWidth?: boolean;
  /** Extra elements whose clicks do not count as "outside" (usually the trigger, so it can toggle). */
  ignore?: RefObject<HTMLElement | null>[];
  className?: string;
  style?: CSSProperties;
  role?: string;
  "aria-label"?: string;
  children: ReactNode;
}

/** A floating surface anchored to an element. Closes on Escape and on a press outside. */
export function Popover({ open, onClose, anchor, side = "bottom", align = "start", offset = 6, matchWidth, ignore = [],
                          className, style, role, children, ...aria }: PopoverProps) {
  const ref = useRef<HTMLDivElement>(null);
  const pos = useFloating(open, anchor, ref, { side, align }, offset);
  useOutsidePress([ref, ...ignore], open, onClose);
  useEscape(open, onClose);
  if (!open) return null;
  return createPortal(
    <div
      ref={ref}
      role={role}
      aria-label={aria["aria-label"]}
      className={"cs-popover" + (className ? " " + className : "")}
      data-side={pos?.side ?? side}
      style={{
        left: pos?.x ?? -9999, top: pos?.y ?? -9999, visibility: pos ? "visible" : "hidden",
        minWidth: matchWidth && anchor ? anchor.getBoundingClientRect().width : undefined, ...style,
      }}
    >
      {children}
    </div>,
    document.body,
  );
}
