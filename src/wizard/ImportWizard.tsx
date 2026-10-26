// The measurement import wizard: a full-window sheet with a numbered step rail. Every step must be valid
// before the next one opens; the draft lives in useWizard, so closing and reopening resumes the import.
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, ArrowRight, Check, FileUp, RotateCcw, Save, X } from "lucide-react";
import { useStore } from "../state/store";
import { isTauri } from "../platform";
import { Button, IconButton, toast, useEscape, useFocusTrap, usePresence } from "../ui";
import { STEP_TITLES, useWizard, type SaveConflict } from "./draft";
import { reachableStep, stepStatus } from "./stepStatus";
import { FilesStep } from "./steps/FilesStep";
import { RolesStep } from "./steps/RolesStep";
import { SystemStep } from "./steps/SystemStep";
import { PhaseStep } from "./steps/PhaseStep";
import { ReviewStep } from "./steps/ReviewStep";
import "./wizard.css";

const STEP_HINTS = [
  "Drop or choose your Lab D and Lab E files",
  "Check which measurement is which",
  "Drivers, boxes and design rules",
  "One delay for all three units",
  "Fit the woofer box and save",
];

export function ImportWizard() {
  const open = useStore(s => s.ui.wizard);
  const close = () => useStore.getState().setUi({ wizard: false });
  const { mounted, state } = usePresence(open, 260);
  const frame = useRef<HTMLDivElement>(null);
  const main = useRef<HTMLDivElement>(null);
  useFocusTrap(frame, open && mounted);
  useEscape(open, close);

  const w = useWizard();
  const step = w.step;
  const status = stepStatus(w, step);
  const reach = reachableStep(w);
  const last = step === STEP_TITLES.length - 1;
  const [confirmReset, setConfirmReset] = useState(false);
  const [conflict, setConflict] = useState<SaveConflict | null>(null);

  // a fresh step starts at the top
  useEffect(() => { main.current?.scrollTo({ top: 0 }); }, [step]);
  useEffect(() => {
    if (!confirmReset) return;
    const t = window.setTimeout(() => setConfirmReset(false), 3000);
    return () => window.clearTimeout(t);
  }, [confirmReset]);

  if (!mounted) return null;

  const go = (to: number) => { if (to <= reach) w.setStep(to); };
  const next = () => { if (status.ok) w.setStep(step + 1); };
  const save = async (opts?: { replace?: boolean }) => {
    setConflict(null);
    if (!isTauri()) {
      const r = w.openWithoutSaving();
      if (r.ok) toast({ tone: "good", title: "Profile opened", description: "Not saved: the browser preview cannot write files. Download the profile to keep it." });
      else toast({ tone: "bad", title: "Could not open the profile", description: r.error });
      return;
    }
    const r = await w.save(opts);
    if (r.conflict) { setConflict(r.conflict); return; }
    if (r.ok) toast({ tone: "good", title: "Profile saved and opened", description: r.folder });
    else toast({ tone: "bad", title: r.folder ? "Saved, but could not open it" : "Could not save the profile", description: r.error });
  };
  const reset = () => {
    if (!confirmReset && w.files.length) { setConfirmReset(true); return; }
    setConfirmReset(false);
    w.reset();
  };

  return createPortal(
    <div className="wz-layer" data-state={state}>
      <div className="wz-backdrop" aria-hidden />
      <div ref={frame} className="wz-frame" role="dialog" aria-modal="true" aria-labelledby="wz-title" tabIndex={-1}
           onKeyDown={e => {
             // Ctrl/Cmd+Enter advances from anywhere in the step, like submitting a form
             if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && !last) { e.preventDefault(); next(); }
           }}>
        <header className="wz-head">
          <span className="wz-head-icon" aria-hidden><FileUp size={18} strokeWidth={1.75} /></span>
          <div className="wz-head-titles">
            <h2 id="wz-title">Import measurements</h2>
            <p>Build a profile for your group's loudspeaker from your Lab D and Lab E files.</p>
          </div>
          <div className="wz-head-actions">
            <Button variant="ghost" size="sm" icon={RotateCcw} onClick={reset} disabled={!w.files.length && step === 0}
                    className={confirmReset ? "wz-confirm" : undefined}>
              {confirmReset ? "Click again to discard" : "Start over"}
            </Button>
            <IconButton icon={X} label="Close" hint="The import is kept until you start over" shortcut="Escape" onClick={close} />
          </div>
        </header>

        <nav className="wz-rail" aria-label="Import steps">
          <ol>
            {STEP_TITLES.map((title, i) => {
              const st = stepStatus(w, i);
              const current = i === step;
              const done = !current && i <= w.maxVisited && i < reach && st.ok;
              const can = i <= reach;
              return (
                <li key={title}>
                  <button type="button" className={`wz-rail-step${current ? " is-current" : ""}${done ? " is-done" : ""}`}
                          disabled={!can} aria-current={current ? "step" : undefined} onClick={() => go(i)}>
                    <span className="wz-rail-num" aria-hidden>{done ? <Check size={12} strokeWidth={2.5} /> : i + 1}</span>
                    <span className="wz-rail-text">
                      <span className="wz-rail-title">{title}</span>
                      <span className="wz-rail-sub">{i <= w.maxVisited ? st.summary : STEP_HINTS[i]}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
          <p className="wz-rail-foot">
            Your files stay where they are. Saving copies the ones you used into the profile folder, so the profile can move to
            another computer with its data.
          </p>
        </nav>

        <main ref={main} className="wz-main">
          <div className="wz-step" key={step}>
            <div className="wz-step-head">
              <span className="label-caps">Step {step + 1} of {STEP_TITLES.length}</span>
              <h3>{STEP_TITLES[step]}</h3>
            </div>
            {step === 0 && <FilesStep />}
            {step === 1 && <RolesStep />}
            {step === 2 && <SystemStep />}
            {step === 3 && <PhaseStep />}
            {step === 4 && <ReviewStep />}
          </div>
        </main>

        <footer className="wz-foot">
          {/* nothing to go back to on the first step: hidden, but it keeps its place so the footer does not shift */}
          <Button variant="subtle" icon={ArrowLeft} onClick={() => w.setStep(step - 1)} disabled={step === 0}
                  aria-hidden={step === 0 || undefined} tabIndex={step === 0 ? -1 : undefined}
                  style={step === 0 ? { visibility: "hidden" } : undefined}>Back</Button>
          {last && conflict ? (
            <div className="wz-foot-msg wz-conflict" role="alert">
              <span>A profile called “{conflict.name}” is already saved as <span className="mono">{conflict.id}</span>.</span>
              <Button size="sm" variant="subtle" onClick={() => void save({ replace: true })}>Replace it</Button>
              <Button size="sm" variant="ghost" onClick={() => { w.setId(conflict.freeId); setConflict(null); }}>
                Use <span className="mono">{conflict.freeId}</span>
              </Button>
            </div>
          ) : (
            <p className={`wz-foot-msg${status.ok ? " is-ok" : ""}`} role="status">
              {status.ok ? (last ? "Everything checks out." : "This step is complete.") : status.blocker}
            </p>
          )}
          {last ? (
            <Button variant="primary" icon={Save} onClick={() => void save()} disabled={!status.ok || w.saving} loading={w.saving}>
              {isTauri() ? "Save profile" : "Open profile"}
            </Button>
          ) : (
            <Button variant="primary" iconRight={ArrowRight} onClick={next} disabled={!status.ok}>
              Next: {STEP_TITLES[step + 1]}
            </Button>
          )}
        </footer>
      </div>
    </div>,
    document.body,
  );
}
