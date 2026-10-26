import { ChevronRight, Download, Sparkles, Square } from "lucide-react";
import { useStore } from "../../state/store";
import type { Check } from "../../types";
import { Button, Field, ProgressBar, Section, Slider, StatusDot } from "..";
import { fmtFixed } from "../format";
import { useOptimiser } from "../shell/optimiser";
import { focusControl, openExport } from "../shell/commands";
import { CHECK_FOCUS } from "./focus";
import type { SectionCommon } from "./common";

const NO_CHECKS: Check[] = [];

export function CheckSection({ open, onOpenChange, status }: SectionCommon) {
  const checks = useStore(s => s.results?.checks) ?? NO_CHECKS;
  const Rdcr = useStore(s => s.design.Rdcr);
  const edit = useStore(s => s.edit);
  const opt = useOptimiser();
  const passed = checks.filter(c => c.state === "good").length;

  return (
    <Section id="check" step={5} color="var(--accent)" title="Check & export" status={status} open={open} onOpenChange={onOpenChange}
             summary={checks.length ? `${passed} of ${checks.length} checks pass` : undefined}>
      <ul className="insp-checks" aria-label="Design checks">
        {checks.map(c => (
          <li key={c.id} data-focus-id={`check.${c.id}`}>
            <button type="button" className={`insp-check is-${c.state}`} onClick={() => focusControl(CHECK_FOCUS[c.id] ?? "check")}
                    title={CHECK_FOCUS[c.id] ? "Jump to the control that changes this" : undefined}>
              <StatusDot state={c.state} />
              <span className="insp-check-text">
                <span className="insp-check-title">{c.title}</span>
                <span className="insp-check-detail">{c.detail}</span>
              </span>
              <ChevronRight className="insp-check-go" size={14} aria-hidden />
            </button>
          </li>
        ))}
      </ul>

      <Field stacked label="Coil resistance" focusId="check.Rdcr"
             hint="DC resistance of the air-core coils per mH of inductance. 0 = ideal coils; real ones are about 0.3–0.6 Ω/mH and lower the level a little.">
        <Slider label="Coil resistance" value={Rdcr} min={0} max={1} step={0.01} digits={2} unit="Ω/mH" defaultValue={0}
                onInput={v => edit(d => { d.Rdcr = v; }, false)} onCommit={v => edit(d => { d.Rdcr = v; })} />
      </Field>

      <div className="insp-actions">
        {opt.running ? (
          <div className="insp-opt-run">
            <div className="insp-opt-row">
              <span className="mono">Searching… {Math.round(opt.progress * 100)}%</span>
              {opt.score !== null && <span className="mono insp-opt-score">score {fmtFixed(opt.score, 2)}</span>}
              <Button size="sm" variant="subtle" icon={Square} onClick={opt.stop}>Stop</Button>
            </div>
            <ProgressBar value={opt.progress} label="Optimiser progress" />
          </div>
        ) : (
          <Button block variant="subtle" icon={Sparkles} onClick={opt.start} disabled={!checks.length}
                  title="Search the parts list for the flattest response that passes the checks (O)">
            Optimise
          </Button>
        )}
        <Button block variant="primary" icon={Download} onClick={openExport} disabled={!checks.length}>Export design</Button>
      </div>
    </Section>
  );
}
