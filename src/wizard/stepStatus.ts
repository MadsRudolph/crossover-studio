// Whether each wizard step is complete, why not, and its one-line summary for the step rail.
import { choiceKey, REQUIRED_ROLES, roleDef } from "./roles";
import { systemProblems } from "./build";
import { profileId, STEP_TITLES, useWizard } from "./draft";
import { isValidId } from "./build";

export interface StepStatus {
  ok: boolean;
  /** Why the step cannot be left yet (shown next to Next). */
  blocker?: string;
  /** One line for the step rail. */
  summary: string;
}

type W = ReturnType<typeof useWizard.getState>;

export function stepStatus(s: W, step: number): StepStatus {
  switch (step) {
    case 0: {
      const ready = s.files.filter(f => f.status === "ready").length;
      const reading = s.files.some(f => f.status === "reading");
      if (reading) return { ok: false, blocker: "Reading the files…", summary: "Reading…" };
      if (!ready) return { ok: false, blocker: s.files.length ? "None of these files could be read." : "Add your measurement files to begin.", summary: "No files yet" };
      return { ok: true, summary: `${ready} file${ready === 1 ? "" : "s"}` };
    }
    case 1: {
      const missing = REQUIRED_ROLES.filter(r => {
        const a = s.assignments[r.key];
        return !a || s.series[choiceKey(a.choice)]?.status !== "ready";
      });
      const loading = Object.values(s.assignments).some(a => s.series[choiceKey(a.choice)]?.status === "loading");
      const extra = Object.keys(s.assignments).filter(k => !REQUIRED_ROLES.some(r => r.key === k)).length;
      const have = REQUIRED_ROLES.length - missing.length;
      const summary = `${have}/${REQUIRED_ROLES.length} required${extra ? ` · ${extra} more` : ""}`;
      if (loading) return { ok: false, blocker: "Reading the data…", summary };
      if (missing.length) {
        const names = missing.map(r => roleDef(r.key, s.vents)?.title.toLowerCase() ?? r.key);
        return { ok: false, blocker: `Still needed: ${names.slice(0, 3).join(", ")}${names.length > 3 ? ` and ${names.length - 3} more` : ""}.`, summary };
      }
      return { ok: true, summary };
    }
    case 2: {
      const p = systemProblems(s.system);
      const summary = s.system.units.woof.label ? `${s.system.units.woof.label.split(/\s+/)[0]} + ${s.system.units.mid.label.split(/\s+/)[0]}…` : "Describe the system";
      return p.length ? { ok: false, blocker: p[0], summary } : { ok: true, summary };
    }
    case 3: {
      if (s.phase.busy) return { ok: false, blocker: "Estimating the phase reference…", summary: "Estimating…" };
      const ok = Number.isFinite(s.phase.value) && Math.abs(s.phase.value) <= 50;
      return ok ? { ok, summary: `d = ${s.phase.value.toFixed(3).replace("-", "−")} m${s.phase.manual ? " (manual)" : ""}` }
                : { ok, blocker: "Give a compensation distance between −50 and 50 m.", summary: "Not set" };
    }
    default: {
      if (!s.system.name.trim()) return { ok: false, blocker: "Name the profile.", summary: "Name it" };
      if (!isValidId(profileId(s))) return { ok: false, blocker: "The profile id may only use letters, digits, '.', '_' and '-'.", summary: "Fix the id" };
      if (s.fit.status === "busy") return { ok: false, blocker: "Fitting the woofer box…", summary: "Fitting…" };
      if (s.fit.status === "error") return { ok: false, blocker: "The fit failed: see the message above.", summary: "Fit failed" };
      if (s.fit.status !== "ready") return { ok: false, blocker: "Fitting the woofer box…", summary: "Not fitted" };
      return { ok: true, summary: "Ready to save" };
    }
  }
}

/** The furthest step the user may jump to: every step before it is complete. */
export function reachableStep(s: W): number {
  for (let i = 0; i < STEP_TITLES.length - 1; i++) if (!stepStatus(s, i).ok) return i;
  return STEP_TITLES.length - 1;
}
