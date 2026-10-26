// Round dial for a phase angle (radians), e.g. a driver's phase at the probe frequency or the phase
// difference between two drivers at their crossover. 0 points up, positive angles turn clockwise.
// The needle always takes the short way round, so a phase wrapping from +179° to -179° does not spin.

import { useRef } from "react";
import { cssColor } from "./theme";
import { formatNumber, wrapRad } from "./scale";
import "./charts.css";

export interface PhaseDialProps {
  /** Phase in radians; NaN/null shows an idle dial. */
  radians: number | null;
  /** A second, thinner needle (e.g. the other driver), radians. */
  reference?: number | null;
  size?: number;
  color?: string;
  referenceColor?: string;
  /** Shade ±tolerance (radians) around `target` in the good colour, e.g. ±30° for "in phase". */
  tolerance?: number;
  target?: number;
  label?: string;
  /** Show the value in degrees under the dial (default true). */
  showValue?: boolean;
  className?: string;
}

/** Point on the dial for an angle (0 = up, clockwise positive). */
function polar(cx: number, cy: number, r: number, rad: number) {
  return { x: cx + r * Math.sin(rad), y: cy - r * Math.cos(rad) };
}

function arcPath(cx: number, cy: number, r: number, a0: number, a1: number) {
  const p0 = polar(cx, cy, r, a0);
  const p1 = polar(cx, cy, r, a1);
  const large = Math.abs(a1 - a0) > Math.PI ? 1 : 0;
  const sweep = a1 > a0 ? 1 : 0;
  return `M${p0.x.toFixed(2)} ${p0.y.toFixed(2)}A${r} ${r} 0 ${large} ${sweep} ${p1.x.toFixed(2)} ${p1.y.toFixed(2)}`;
}

/** Keeps an unwrapped angle across renders so CSS rotation animates along the shortest path. */
function useContinuousAngle(rad: number | null): number {
  const last = useRef(0);
  if (rad == null || !Number.isFinite(rad)) return last.current;
  const step = wrapRad(rad - last.current);
  last.current += step;
  return last.current;
}

export function PhaseDial({
  radians, reference, size = 56, color = "accent", referenceColor = "ref", tolerance, target = 0, label,
  showValue = true, className,
}: PhaseDialProps) {
  const idle = radians == null || !Number.isFinite(radians);
  const angle = useContinuousAngle(radians);
  const refAngle = useContinuousAngle(reference ?? null);
  const hasRef = reference != null && Number.isFinite(reference);
  const r = size / 2 - 3;
  const c = size / 2;
  const deg = idle ? NaN : (wrapRad(radians!) * 180) / Math.PI;
  const valueText = idle ? "—" : `${deg > 0 ? "+" : ""}${formatNumber(deg, 0)}°`;
  const stroke = cssColor(color, "accent");

  const ticks = [];
  for (let k = 0; k < 12; k++) {
    const a = (k * Math.PI) / 6;
    const major = k % 3 === 0;
    const p0 = polar(c, c, r, a);
    const p1 = polar(c, c, r - (major ? 5 : 3), a);
    ticks.push(
      <line
        key={k}
        x1={p0.x} y1={p0.y} x2={p1.x} y2={p1.y}
        stroke={major ? "var(--text-3)" : "var(--line-strong)"}
        strokeWidth={major ? 1.25 : 1}
      />,
    );
  }

  return (
    <div
      className={`chart-dial${className ? " " + className : ""}`}
      role="img"
      aria-label={`${label ? label + ": " : ""}phase ${idle ? "unknown" : `${Math.round(deg)} degrees`}`}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
        <circle cx={c} cy={c} r={r} fill="var(--surface-3)" stroke="var(--line-strong)" strokeWidth={1} />
        {tolerance != null && tolerance > 0 && (
          <path
            d={arcPath(c, c, r - 1.5, target - tolerance, target + tolerance)}
            fill="none"
            stroke="var(--good)"
            strokeOpacity={0.55}
            strokeWidth={3}
          />
        )}
        {ticks}
        {/* Sweep from 0 to the value, so the sign reads at a glance. */}
        {!idle && Math.abs(wrapRad(radians!)) > 0.02 && (
          <path
            d={arcPath(c, c, r * 0.62, 0, wrapRad(radians!))}
            fill="none"
            stroke={stroke}
            strokeOpacity={0.35}
            strokeWidth={r * 0.2}
          />
        )}
        {hasRef && (
          <g className="chart-dial__needle" style={{ transform: `rotate(${(refAngle * 180) / Math.PI}deg)`, transformOrigin: `${c}px ${c}px` }}>
            <line x1={c} y1={c} x2={c} y2={c - r + 6} stroke={cssColor(referenceColor, "ref")} strokeWidth={1.25} strokeDasharray="2 2" strokeLinecap="round" />
          </g>
        )}
        {!idle && (
          <g className="chart-dial__needle" style={{ transform: `rotate(${(angle * 180) / Math.PI}deg)`, transformOrigin: `${c}px ${c}px` }}>
            <line x1={c} y1={c + 3} x2={c} y2={c - r + 4} stroke={stroke} strokeWidth={2} strokeLinecap="round" />
          </g>
        )}
        <circle cx={c} cy={c} r={2.5} fill={idle ? "var(--line-strong)" : stroke} stroke="var(--surface-1)" strokeWidth={1} />
      </svg>
      {showValue && <span className="chart-dial__value">{valueText}</span>}
      {label && <span className="chart-dial__label">{label}</span>}
    </div>
  );
}
