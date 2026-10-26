import { useCallback, useRef, useState } from "react";
import { useStore } from "../../state/store";
import { UNIT_IDS } from "../../types";
import { worstState } from "../Badge";
import { BoxSection } from "./BoxSection";
import { DigitalSection } from "./DigitalSection";
import { PassiveSection } from "./PassiveSection";
import { CheckSection } from "./CheckSection";
import { STEP_CHECKS, useInspectorFocus } from "./focus";
import { UNIT_COLOR } from "./common";

const OPEN_KEY = "crossover-studio:inspector-open";
const STEP_IDS = ["box", "digital", "mid", "tw", "check"] as const;
type StepId = (typeof STEP_IDS)[number];

function readOpen(): Record<StepId, boolean> {
  const all = { box: true, digital: true, mid: true, tw: true, check: true };
  try { return { ...all, ...JSON.parse(localStorage.getItem(OPEN_KEY) || "{}") }; } catch { return all; }
}

/** The left column: the design as a numbered workflow, top to bottom. */
export function Inspector() {
  const root = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(readOpen);
  const profile = useStore(s => s.profile);
  const checks = useStore(s => s.results?.checks);

  const setStep = useCallback((id: string, v: boolean) => {
    setOpen(o => {
      if (!(id in o) || o[id as StepId] === v) return o;
      const n = { ...o, [id]: v };
      try { localStorage.setItem(OPEN_KEY, JSON.stringify(n)); } catch { /* remembered for this session only */ }
      return n;
    });
  }, []);
  useInspectorFocus(root, useCallback((step: string) => setStep(step, true), [setStep]));

  const status = (id: StepId) => {
    if (!checks) return null;
    if (id === "check") return worstState(checks.map(c => c.state));
    return worstState(checks.filter(c => STEP_CHECKS[id]?.includes(c.id)).map(c => c.state));
  };
  const common = (id: StepId) => ({ open: open[id], onOpenChange: (v: boolean) => setStep(id, v), status: status(id) });

  return (
    <aside className="insp" ref={root} aria-label="Design inspector">
      {profile && (
        <header className="insp-head">
          <div className="insp-head-title">
            <span className="label-caps">System</span>
            <span className="insp-head-name">{profile.name}</span>
          </div>
          <ul className="insp-units">
            {UNIT_IDS.map(u => (
              <li key={u} title={`${profile.units[u].role}: ${profile.units[u].label}`}>
                <span className="insp-unit-dot" style={{ background: UNIT_COLOR[u] }} />
                <span className="insp-unit-role">{profile.units[u].role}</span>
                <span className="insp-unit-label">{profile.units[u].label}</span>
              </li>
            ))}
          </ul>
        </header>
      )}
      <div className="insp-scroll">
        <BoxSection {...common("box")} />
        <DigitalSection {...common("digital")} />
        <PassiveSection unit="mid" step={3} {...common("mid")} />
        <PassiveSection unit="tw" step={4} {...common("tw")} />
        <CheckSection {...common("check")} />
        <p className="insp-foot">Drag a slider, hold <b>Shift</b> for fine steps, double-click to reset. Click any number to type it.</p>
      </div>
    </aside>
  );
}
