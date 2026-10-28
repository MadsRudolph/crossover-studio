import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { ChevronDown, ChevronsDownUp, ChevronsUpDown, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useStore } from "../../state/store";
import { UNIT_IDS, type CheckState } from "../../types";
import { StatusDot, worstState } from "../Badge";
import { IconButton } from "../Button";
import { Tooltip } from "../Tooltip";
import { STEPS } from "../shell/commands";
import { BoxSection } from "./BoxSection";
import { DigitalSection } from "./DigitalSection";
import { PassiveSection } from "./PassiveSection";
import { CheckSection } from "./CheckSection";
import { STEP_CHECKS, useInspectorFocus } from "./focus";
import { UNIT_COLOR } from "./common";
import { RAIL_MAX_PX, useInspectorChrome, type StepMode } from "./chrome";

const OPEN_KEY = "crossover-studio:inspector-open";
const UNITS_KEY = "crossover-studio:inspector-units";
const STEP_IDS = ["box", "digital", "mid", "tw", "check"] as const;
type StepId = (typeof STEP_IDS)[number];
type OpenState = Record<StepId, boolean>;

/** Colour of each step's number, as in the section headers. */
const STEP_COLOR: Record<StepId, string> = { box: "var(--woof)", digital: "var(--woof)", mid: "var(--mid)", tw: "var(--tw)", check: "var(--accent)" };

/** In "one" mode only the first open step stays open (a saved all-open state is folded on load). */
function fold(o: OpenState, mode: StepMode): OpenState {
  if (mode === "all") return o;
  const first = STEP_IDS.find(id => o[id]) ?? "box";
  return { box: false, digital: false, mid: false, tw: false, check: false, [first]: true };
}

function readOpen(mode: StepMode): OpenState {
  const all = { box: true, digital: true, mid: true, tw: true, check: true };
  try { return fold({ ...all, ...JSON.parse(localStorage.getItem(OPEN_KEY) || "{}") }, mode); } catch { return fold(all, mode); }
}

function readUnitsOpen(): boolean {
  try { return localStorage.getItem(UNITS_KEY) === "1"; } catch { return false; }
}

/** Width of an element, updated on resize (the rail takes over when the shell narrows the column). */
function useWidth<T extends HTMLElement>(ref: RefObject<T | null>): number {
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(Math.round(el.getBoundingClientRect().width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return w;
}

/** The left column: the design as a numbered workflow, top to bottom. One step is open at a time unless
 *  the person asks for all of them; a narrow column shows the steps as an icon rail. */
export function Inspector() {
  const root = useRef<HTMLDivElement>(null);
  const mode = useInspectorChrome(s => s.mode);
  const setMode = useInspectorChrome(s => s.setMode);
  const expand = useInspectorChrome(s => s.expand);
  const collapse = useInspectorChrome(s => s.collapse);
  const [open, setOpen] = useState(() => readOpen(mode));
  const [unitsOpen, setUnitsOpen] = useState(readUnitsOpen);
  const profile = useStore(s => s.profile);
  const checks = useStore(s => s.results?.checks);
  const width = useWidth(root);
  const rail = width > 0 && width <= RAIL_MAX_PX;

  const setStep = useCallback((id: string, v: boolean) => {
    setOpen(o => {
      if (!(id in o)) return o;
      const single = useInspectorChrome.getState().mode === "one";
      // in "one" mode opening a step folds the rest; closing it leaves the column folded
      const n: OpenState = single && v ? { box: false, digital: false, mid: false, tw: false, check: false, [id]: true } : { ...o, [id]: v };
      if (STEP_IDS.every(k => n[k] === o[k])) return o;
      try { localStorage.setItem(OPEN_KEY, JSON.stringify(n)); } catch { /* remembered for this session only */ }
      return n;
    });
  }, []);
  const railRef = useRef(rail);
  railRef.current = rail;
  // a part clicked elsewhere while the column is a rail widens it, so the control can be shown
  useInspectorFocus(root, useCallback((step: string) => {
    setStep(step, true);
    if (railRef.current) useInspectorChrome.getState().expand?.();
  }, [setStep]));

  const switchMode = () => {
    const next: StepMode = mode === "one" ? "all" : "one";
    setMode(next);
    setOpen(o => (next === "all" ? { box: true, digital: true, mid: true, tw: true, check: true } : fold(o, next)));
  };
  const toggleUnits = () => {
    setUnitsOpen(v => {
      try { localStorage.setItem(UNITS_KEY, v ? "0" : "1"); } catch { /* remembered for this session only */ }
      return !v;
    });
  };

  const status = (id: StepId): CheckState | null => {
    if (!checks) return null;
    if (id === "check") return worstState(checks.map(c => c.state));
    return worstState(checks.filter(c => STEP_CHECKS[id]?.includes(c.id)).map(c => c.state));
  };
  const common = (id: StepId) => ({ open: open[id], onOpenChange: (v: boolean) => setStep(id, v), status: status(id) });

  const railNav = (
    <nav className="insp-rail" aria-label="Workflow steps">
      {expand && (
        <IconButton size="sm" icon={PanelLeftOpen} label="Show the inspector" tooltipSide="right"
                    hint="Widen the column again to edit the steps." onClick={expand} className="insp-rail-open" />
      )}
      {STEP_IDS.map((id, i) => {
        const st = status(id);
        const title = STEPS.find(s => s.id === id)?.title ?? id;
        return (
          <Tooltip key={id} title={`${i + 1} · ${title}`} side="right"
                   content={expand ? "Open the inspector at this step." : undefined}>
            <button type="button" className={"insp-rail-step" + (open[id] ? " is-open" : "")}
                    style={{ ["--step-color" as string]: STEP_COLOR[id] }} aria-label={`Step ${i + 1}: ${title}`}
                    onClick={() => { setStep(id, true); expand?.(); }}>
              <span className="insp-rail-num mono" aria-hidden>{i + 1}</span>
              {st && <span className="insp-rail-dot"><StatusDot state={st} /></span>}
            </button>
          </Tooltip>
        );
      })}
    </nav>
  );

  return (
    <aside className={"insp" + (rail ? " is-rail" : "")} ref={root} aria-label="Design inspector">
      {rail ? railNav : (
        <>
          {profile && (
            <header className={"insp-head" + (unitsOpen ? " is-open" : "")}>
              <div className="insp-head-row">
                <button type="button" className="insp-head-toggle" aria-expanded={unitsOpen} onClick={toggleUnits}
                        title={unitsOpen ? "Hide the drivers" : "Show the drivers of this system"}>
                  <span className="insp-head-dots" aria-hidden>
                    {UNIT_IDS.map(u => <span key={u} className="insp-unit-dot" style={{ background: UNIT_COLOR[u] }} />)}
                  </span>
                  <span className="insp-head-name">{profile.name}</span>
                  <ChevronDown size={14} strokeWidth={1.75} className="insp-head-chev" aria-hidden />
                </button>
                <IconButton size="sm" icon={mode === "one" ? ChevronsUpDown : ChevronsDownUp}
                            label={mode === "one" ? "Open all steps" : "One step at a time"}
                            hint={mode === "one" ? "Keep every step open, as one long column." : "Opening a step folds the others."}
                            onClick={switchMode} />
                {collapse && (
                  <IconButton size="sm" icon={PanelLeftClose} label="Fold the inspector to a rail"
                              hint="The steps stay one click away; the view gets the room." onClick={collapse} />
                )}
              </div>
              {unitsOpen && (
                <ul className="insp-units">
                  {UNIT_IDS.map(u => (
                    <li key={u} title={`${profile.units[u].role}: ${profile.units[u].label}`}>
                      <span className="insp-unit-dot" style={{ background: UNIT_COLOR[u] }} />
                      <span className="insp-unit-role">{profile.units[u].role}</span>
                      <span className="insp-unit-label">{profile.units[u].label}</span>
                    </li>
                  ))}
                  {profile.notes && <li className="insp-units-notes">{profile.notes}</li>}
                </ul>
              )}
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
        </>
      )}
    </aside>
  );
}
