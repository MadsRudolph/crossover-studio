import { useId, useRef, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useEscape, useFocusTrap, usePresence } from "./hooks";

export interface DialogProps {
  open: boolean;
  onClose(): void;
  title?: ReactNode;
  /** One line under the title. */
  description?: ReactNode;
  children?: ReactNode;
  /** Buttons at the bottom, right aligned. */
  footer?: ReactNode;
  /** center: modal card. sheet: full-height panel sliding in from the right. */
  variant?: "center" | "sheet";
  size?: "sm" | "md" | "lg" | "xl";
  /** Element to focus first (defaults to the first focusable). */
  initialFocus?: RefObject<HTMLElement | null>;
  /** Clicking the backdrop closes (default true). */
  dismissible?: boolean;
  /** Hide the × button (e.g. for a palette that has its own input). */
  hideClose?: boolean;
  className?: string;
}

/** Modal layer with focus trap, Escape to close, scrim click to close and an enter/exit transition. */
export function Dialog({ open, onClose, title, description, children, footer, variant = "center", size = "md", initialFocus,
                         dismissible = true, hideClose, className }: DialogProps) {
  const { mounted, state } = usePresence(open, 220);
  const card = useRef<HTMLDivElement>(null);
  const titleId = useId(), descId = useId();
  useFocusTrap(card, open && mounted, initialFocus);
  useEscape(open, onClose);
  if (!mounted) return null;
  return createPortal(
    <div className={`cs-dialog-layer cs-dialog-${variant}`} data-state={state}>
      <div className="cs-scrim" aria-hidden onPointerDown={() => dismissible && onClose()} />
      <div
        ref={card}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
        className={`cs-dialog cs-dialog-${size}${className ? " " + className : ""}`}
      >
        {(title || !hideClose) && (
          <header className="cs-dialog-head">
            <div className="cs-dialog-titles">
              {title && <h2 id={titleId} className="cs-dialog-title">{title}</h2>}
              {description && <p id={descId} className="cs-dialog-desc">{description}</p>}
            </div>
            {!hideClose && (
              <button type="button" className="cs-btn cs-btn-ghost cs-btn-sm cs-btn-icononly" aria-label="Close" onClick={onClose}>
                <X size={15} strokeWidth={1.75} />
              </button>
            )}
          </header>
        )}
        <div className="cs-dialog-body">{children}</div>
        {footer && <footer className="cs-dialog-foot">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}

/** Side sheet: a Dialog that slides in from the right edge. */
export function Sheet(props: Omit<DialogProps, "variant">) {
  return <Dialog {...props} variant="sheet" />;
}
