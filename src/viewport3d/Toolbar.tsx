// Overlay controls for the 3D view: display toggles (bound to the store) and camera presets.

import { Pause, Play, RotateCcw, ScanEye, Waves } from "lucide-react";
import type { ReactNode } from "react";
import { useStore } from "../state/store";
import type { CameraPreset } from "./layout";

const PRESETS: { id: CameraPreset; label: string; title: string }[] = [
  { id: "front", label: "Front", title: "Front view" },
  { id: "threeQuarter", label: "¾", title: "Three-quarter view" },
  { id: "side", label: "Side", title: "Side view" },
  { id: "top", label: "Top", title: "Top view" },
];

function Toggle({ on, onClick, title, children, disabled }: {
  on: boolean; onClick(): void; title: string; children: ReactNode; disabled?: boolean;
}) {
  return (
    <button type="button" className="v3d-tb-btn" aria-pressed={on} title={title} aria-label={title}
      onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}

export function Toolbar({ onPreset, onReset, reducedMotion, canAnimate }: {
  onPreset(p: CameraPreset): void; onReset(): void; reducedMotion: boolean; canAnimate: boolean;
}) {
  const ui = useStore(s => s.ui);
  const setUi = useStore(s => s.setUi);
  const animTitle = reducedMotion
    ? "Animation paused: your system asks for reduced motion"
    : ui.animate ? "Pause animation" : "Animate at the probe frequency";
  return (
    <div className="v3d-toolbar" role="toolbar" aria-label="3D view">
      <div className="v3d-tb-group">
        <Toggle on={ui.xray} onClick={() => setUi({ xray: !ui.xray })} title={ui.xray ? "Hide the inside (X)" : "X-ray: see the vents and drivers inside (X)"}>
          <ScanEye size={15} strokeWidth={1.75} /><span>X-ray</span>
        </Toggle>
        <Toggle on={ui.waves} onClick={() => setUi({ waves: !ui.waves })} title={ui.waves ? "Hide sound waves" : "Show sound waves"}>
          <Waves size={15} strokeWidth={1.75} /><span>Waves</span>
        </Toggle>
        <Toggle on={ui.animate && canAnimate} onClick={() => setUi({ animate: !ui.animate })} title={animTitle} disabled={reducedMotion}>
          {ui.animate && canAnimate ? <Pause size={15} strokeWidth={1.75} /> : <Play size={15} strokeWidth={1.75} />}
          <span>{ui.animate && canAnimate ? "Pause" : "Animate"}</span>
        </Toggle>
      </div>
      <div className="v3d-tb-group" role="group" aria-label="Camera">
        {PRESETS.map(p => (
          <button key={p.id} type="button" className="v3d-tb-btn is-text" title={p.title} aria-label={p.title} onClick={() => onPreset(p.id)}>
            {p.label}
          </button>
        ))}
        <button type="button" className="v3d-tb-btn is-icon" title="Reset camera (double-click the view)" aria-label="Reset camera" onClick={onReset}>
          <RotateCcw size={14} strokeWidth={1.75} />
        </button>
      </div>
    </div>
  );
}
