import { forwardRef, useId, useState, type CSSProperties, type HTMLAttributes, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { StatusDot } from "./Badge";
import type { CheckState } from "../types";

export interface PanelProps extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  title?: ReactNode;
  /** Controls at the right of the header. */
  actions?: ReactNode;
  /** Remove the body padding (plots that fill the panel). */
  flush?: boolean;
  /** Raised surface (cards inside a view) instead of the flat panel colour. */
  raised?: boolean;
}

/** A titled surface. Views use it for cards; the shell uses it for dock and inspector frames. */
export const Panel = forwardRef<HTMLElement, PanelProps>(function Panel({ title, actions, flush, raised, className, children, ...rest }, ref) {
  return (
    <section ref={ref} className={`cs-panel${raised ? " is-raised" : ""}${className ? " " + className : ""}`} {...rest}>
      {(title || actions) && (
        <header className="cs-panel-head">
          {title && <h2 className="cs-panel-title">{title}</h2>}
          {actions && <div className="cs-panel-actions">{actions}</div>}
        </header>
      )}
      <div className={"cs-panel-body" + (flush ? " is-flush" : "")}>{children}</div>
    </section>
  );
});

export interface SectionProps {
  /** Stable id; also written as data-focus-id so store.ui.focus can find the section. */
  id: string;
  /** Workflow step number shown in the header circle. */
  step?: number;
  /** Colour of the step dot, a CSS colour token (e.g. "var(--mid)"). */
  color?: string;
  title: ReactNode;
  /** One-line summary of the current settings, shown in the header. */
  summary?: ReactNode;
  /** Roll-up state of the checks that belong to this step. */
  status?: CheckState | null;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?(open: boolean): void;
  /** Extra controls at the right of the header (stop propagation yourself if they are buttons). */
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}

/** A collapsible step of the workflow, with a numbered header. Height animates; content stays mounted. */
export function Section({ id, step, color, title, summary, status, open: openProp, defaultOpen = true, onOpenChange,
                          actions, children, className, style }: SectionProps) {
  const [openState, setOpenState] = useState(defaultOpen);
  const open = openProp ?? openState;
  const bodyId = useId();
  const toggle = () => { const n = !open; setOpenState(n); onOpenChange?.(n); };
  return (
    <section
      className={`cs-section${open ? " is-open" : ""}${className ? " " + className : ""}`}
      data-focus-id={id}
      style={{ ...(color ? { ["--step-color" as string]: color } : {}), ...style }}
    >
      <header className="cs-section-head">
        <button type="button" className="cs-section-toggle" aria-expanded={open} aria-controls={bodyId} onClick={toggle}>
          {step !== undefined && <span className="cs-section-step mono" aria-hidden>{step}</span>}
          <span className="cs-section-titles">
            <span className="cs-section-title">{title}</span>
            {summary && <span className="cs-section-summary mono">{summary}</span>}
          </span>
          {status && <StatusDot state={status} />}
          <ChevronDown className="cs-section-chev" size={15} strokeWidth={1.75} aria-hidden />
        </button>
        {actions && <div className="cs-section-actions">{actions}</div>}
      </header>
      <div className="cs-section-collapse" id={bodyId} aria-hidden={!open} inert={!open}>
        <div className="cs-section-inner">
          <div className="cs-section-body">{children}</div>
        </div>
      </div>
    </section>
  );
}
