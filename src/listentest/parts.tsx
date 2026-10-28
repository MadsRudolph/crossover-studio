// Small building blocks of the listening-test view: text and select inputs, the 1-7 rating control, the
// variant colours, and the mean ± 95 % CI chart (inline SVG on the theme tokens).

import type { ReactNode } from "react";
import { SCALE_MAX, SCALE_MIN, type Attribute, type Protocol } from "./model";
import type { AttributeResult } from "./stats";

/** Variant k's colour: the snapshot palette (never a driver colour, legible in both themes). */
export const variantColor = (k: number) => `var(--snap-${(k % 7) + 1})`;

export function TextInput({ value, onChange, label, placeholder, small, className }: {
  value: string; onChange(v: string): void; label: string; placeholder?: string; small?: boolean; className?: string;
}) {
  return <input type="text" className={"lt-input" + (small ? " is-small" : "") + (className ? " " + className : "")} value={value} aria-label={label}
                placeholder={placeholder} spellCheck={false} onChange={e => onChange(e.target.value)} />;
}

export function Select<T extends string>({ value, onChange, label, options, disabled }: {
  value: T; onChange(v: T): void; label: string; options: { value: T; label: string }[]; disabled?: boolean;
}) {
  return (
    <span className="lt-select">
      <select aria-label={label} value={value} disabled={disabled} onChange={e => onChange(e.target.value as T)}>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </span>
  );
}

/** Seven buttons, 1-7, as a radio group. Clicking the chosen value again clears it. */
export function ScaleInput({ value, onChange, label }: { value: number | null; onChange(v: number | null): void; label: string }) {
  const vals = Array.from({ length: SCALE_MAX - SCALE_MIN + 1 }, (_, i) => SCALE_MIN + i);
  return (
    <span className="lt-scale" role="radiogroup" aria-label={label}>
      {vals.map(v => (
        <button key={v} type="button" role="radio" aria-checked={value === v} className={"lt-scale-btn" + (value === v ? " is-on" : "")}
                onClick={() => onChange(value === v ? null : v)}>{v}</button>
      ))}
    </span>
  );
}

// ---------------------------------------------------------------- the chart
/**
 * One row per attribute, a dot (mean) and whiskers (95 % CI) per variant, on the 1-7 scale. The bad
 * half of each attribute's scale is shaded, so "harshness 5.1" reads as bad at a glance.
 */
export function RatingChart({ protocol, rows, ours }: { protocol: Protocol; rows: AttributeResult[]; ours?: string }) {
  const W = 640, ML = 150, MR = 16, MT = 8, ROW = 36, K = rows.length, H = MT + K * ROW + 26;
  const x = (v: number) => ML + (v - (SCALE_MIN - 0.3)) / (SCALE_MAX - SCALE_MIN + 0.6) * (W - ML - MR);
  const n = protocol.variants.length;
  const off = (k: number) => (k - (n - 1) / 2) * Math.min(7, 22 / Math.max(1, n));
  const bad = (a: Attribute): [number, number] => (a.better === "high" ? [SCALE_MIN - 0.3, 3.5] : [4.5, SCALE_MAX + 0.3]);
  const ticks: ReactNode[] = [];
  for (let v = SCALE_MIN; v <= SCALE_MAX; v++) ticks.push(
    <g key={v}>
      <line className={"lt-grid" + (v === 4 ? " is-mid" : "")} x1={x(v)} x2={x(v)} y1={MT} y2={MT + K * ROW} />
      <text className="lt-ax" x={x(v)} y={MT + K * ROW + 16} textAnchor="middle">{v}</text>
    </g>,
  );
  return (
    <svg className="lt-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Mean rating and 95 % confidence interval per attribute and variant">
      {rows.map((r, i) => {
        const [b0, b1] = bad(r.attr);
        return <rect key={r.attr.id} className="lt-bad-zone" x={x(b0)} width={x(b1) - x(b0)} y={MT + i * ROW + 3} height={ROW - 6} rx={3} />;
      })}
      {ticks}
      {rows.map((r, i) => {
        const cy = MT + (i + 0.5) * ROW;
        return (
          <g key={r.attr.id}>
            <text x={ML - 10} y={cy + 4} textAnchor="end">{r.attr.name}</text>
            {r.cells.map((c, k) => {
              if (!c.ci.n) return null;
              const y = cy + off(k), col = variantColor(k), isOurs = c.variant === ours;
              return (
                <g key={c.variant}>
                  {Number.isFinite(c.ci.half) && <line x1={x(Math.max(SCALE_MIN - 0.3, c.ci.lo))} x2={x(Math.min(SCALE_MAX + 0.3, c.ci.hi))} y1={y} y2={y} stroke={col} strokeWidth={2} strokeLinecap="round" />}
                  <circle cx={x(c.ci.mean)} cy={y} r={isOurs ? 5 : 4} fill={col} stroke={isOurs ? "var(--text)" : "none"} strokeWidth={1.25}>
                    <title>{`${protocol.variants[k]?.name}: ${c.ci.mean.toFixed(1)}${Number.isFinite(c.ci.half) ? ` ± ${c.ci.half.toFixed(1)}` : ""} (n = ${c.ci.n})`}</title>
                  </circle>
                </g>
              );
            })}
          </g>
        );
      })}
    </svg>
  );
}

export function Legend({ protocol, ours }: { protocol: Protocol; ours?: string }) {
  return (
    <div className="lt-legend">
      {protocol.variants.map((v, k) => (
        <span key={v.id} className={v.id === ours ? "is-ours" : undefined} style={{ ["--c" as string]: variantColor(k) }}>
          <i aria-hidden />{v.name}{v.id === ours ? " (ours)" : ""}
        </span>
      ))}
    </div>
  );
}
