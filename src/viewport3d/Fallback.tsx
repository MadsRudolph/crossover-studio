// Shown when WebGL 2 is unavailable or the GPU context is lost: a clean front elevation of the same loudspeaker
// (drawn from the same layout), with each driver's glow, so the view still says something useful.

import { MonitorX, RotateCcw } from "lucide-react";
import { UNIT_IDS } from "../types";
import type { SceneLayout } from "./layout";
import { glowFromShare, type ProbeState } from "./physics";

export function FrontElevation({ layout, probe }: { layout: SceneLayout; probe: ProbeState | null }) {
  const { woofer, top, drivers, vents, bounds } = layout;
  const pad = 0.04;
  const minX = bounds.center[0] - bounds.size[0] / 2 - pad, maxX = bounds.center[0] + bounds.size[0] / 2 + pad;
  const H = bounds.size[1] + pad;
  const box = (c: [number, number, number], s: [number, number, number]) => ({
    x: c[0] - s[0] / 2, y: H - (c[1] + s[1] / 2), width: s[0], height: s[1],
  });
  return (
    <svg className="v3d-elevation" viewBox={`${minX} ${-pad / 2} ${maxX - minX} ${H + pad}`} role="img"
      aria-label="Front view of the loudspeaker">
      <line x1={minX} x2={maxX} y1={H} y2={H} className="v3d-el-floor" />
      <rect {...box(woofer.center, woofer.size)} rx={0.007} className="v3d-el-cab" />
      <rect {...box(top.center, top.size)} rx={0.007} className="v3d-el-cab is-top" />
      {vents.map(v => (
        <circle key={v.id} cx={v.pos[0]} cy={H - v.pos[1]} r={v.radius} className={`v3d-el-vent${v.open ? "" : " is-plugged"}`} />
      ))}
      {UNIT_IDS.map(u => {
        const d = drivers[u], share = probe?.units[u].share ?? 0;
        return (
          <g key={u} style={{ ["--c" as string]: `var(--${u})` }}>
            <circle cx={d.pos[0]} cy={H - d.pos[1]} r={d.frameR + 0.004} className="v3d-el-glow" style={{ opacity: glowFromShare(share) }} />
            <circle cx={d.pos[0]} cy={H - d.pos[1]} r={d.frameR} className="v3d-el-frame" />
            <circle cx={d.pos[0]} cy={H - d.pos[1]} r={d.coneR * 0.92} className="v3d-el-cone" />
          </g>
        );
      })}
    </svg>
  );
}

export function Fallback({ layout, probe, reason, onRetry }: {
  layout: SceneLayout | null; probe: ProbeState | null; reason: "no-webgl2" | "lost" | "error"; onRetry?(): void;
}) {
  const text = {
    "no-webgl2": ["3D view unavailable", "This computer's graphics driver does not offer WebGL 2, so the model is drawn flat. Every plot, the checks and the export work as usual."],
    lost: ["The graphics driver reset", "The 3D view lost its GPU context (often after sleep or a driver update)."],
    error: ["3D view stopped", "Something went wrong while drawing the model. The design itself is safe."],
  }[reason];
  return (
    <div className="v3d-fallback" role="status">
      {layout && <FrontElevation layout={layout} probe={probe} />}
      <div className="v3d-fallback-card">
        <MonitorX size={18} strokeWidth={1.75} aria-hidden />
        <div>
          <div className="v3d-fallback-title">{text[0]}</div>
          <div className="v3d-fallback-text">{text[1]}</div>
        </div>
        {onRetry && (
          <button type="button" className="v3d-tb-btn" onClick={onRetry}>
            <RotateCcw size={14} strokeWidth={1.75} /><span>Retry</span>
          </button>
        )}
      </div>
    </div>
  );
}
