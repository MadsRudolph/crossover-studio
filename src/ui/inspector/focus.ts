// store.ui.focus -> scroll to and pulse the matching inspector control.
// Focus ids are "<step>.<control>" ("mid.L1", "tw.pad.Rs", "digital.fc", "box.L"); an id that names no
// control falls back to its longest matching prefix, ending at the step section itself.
import { useEffect, type RefObject } from "react";
import { useStore } from "../../state/store";

/** Check id -> the control that fixes it (clicking a check jumps there). */
export const CHECK_FOCUS: Record<string, string> = {
  flat: "digital.gain",
  off: "tw.topo",
  xwm: "digital.fc",
  xmt: "tw.C1",
  twfs: "tw.C1",
  canc: "tw.pol",
  load: "tw.pad.Rp",
  bass: "box.L",
};

/** Which checks roll up into each workflow step's status dot. */
export const STEP_CHECKS: Record<string, string[]> = {
  box: ["bass"],
  digital: ["xwm", "flat"],
  mid: ["xmt"],
  tw: ["twfs", "load", "canc", "off"],
};

const PULSE_MS = 1600;

export function useInspectorFocus(root: RefObject<HTMLElement | null>, openStep: (step: string) => void) {
  const focus = useStore(s => s.ui.focus);
  useEffect(() => {
    if (!focus || !root.current) return;
    const step = focus.split(".")[0];
    openStep(step);
    let el: HTMLElement | null = null;
    const parts = focus.split(".");
    for (let n = parts.length; n > 0 && !el; n--) {
      el = root.current.querySelector<HTMLElement>(`[data-focus-id="${parts.slice(0, n).join(".")}"]`);
    }
    if (!el) return;
    const target = el;
    // let a collapsed section start opening before measuring where to scroll
    const t1 = window.setTimeout(() => {
      target.scrollIntoView({ behavior: "smooth", block: target.classList.contains("cs-section") ? "start" : "center" });
      target.classList.remove("is-pulse");
      void target.offsetWidth; // restart the animation when the same control is focused twice
      target.classList.add("is-pulse");
      if (!target.classList.contains("cs-section")) {
        // querySelector takes document order, not selector order: try the selectors by priority
        const ctl = ['[role="slider"]', ".cs-vp-value", '[role="radio"][aria-checked="true"]', '[role="switch"]', "input", "button:not([tabindex='-1'])"]
          .map(sel => target.querySelector<HTMLElement>(sel)).find(Boolean);
        ctl?.focus({ preventScroll: true });
      }
    }, 60);
    const t2 = window.setTimeout(() => target.classList.remove("is-pulse"), PULSE_MS + 120);
    return () => { window.clearTimeout(t1); window.clearTimeout(t2); target.classList.remove("is-pulse"); };
  }, [focus]); // eslint-disable-line react-hooks/exhaustive-deps
}
