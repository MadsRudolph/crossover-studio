// Small pieces shared by the wizard steps.
import { useMemo, type ReactNode, type SelectHTMLAttributes } from "react";
import { ChevronDown } from "lucide-react";
import { Plot } from "../../charts";
import type { Series, UnitId } from "../../types";
import type { Tone } from "../../ui";
import { magnitude, magnitudeDb } from "../build";

export const unitTone = (u?: UnitId): Tone => (u ?? "neutral") as Tone;
export const unitColor = (u?: UnitId) => u ?? "sum";

/** Native select styled like the design system's inputs: dependable keyboard and screen-reader behaviour. */
export function Select({ children, className, ...rest }: SelectHTMLAttributes<HTMLSelectElement> & { children: ReactNode }) {
  return (
    <span className={`wz-select${className ? " " + className : ""}`}>
      <select {...rest}>{children}</select>
      <ChevronDown size={13} strokeWidth={1.75} aria-hidden />
    </span>
  );
}

/** Magnitude preview of one series: |Z| in ohm for impedances, dB re 1 Pa/V for responses. */
export function MiniPlot({ series, quantity, unit, height = 96, label }: {
  series: Series; quantity: "tf" | "z" | "nf"; unit?: UnitId; height?: number; label: string;
}) {
  const data = useMemo(() => {
    const x = Float64Array.from(series.f);
    const y = quantity === "z" ? magnitude(series) : magnitudeDb(series);
    // the 1 Hz bins below the first useful frequency make the axis needlessly wide
    const lo = Math.max(x.find(v => v > 0) ?? 1, quantity === "tf" ? 20 : 1);
    return { x, y, range: [lo, Math.max(lo * 2, Math.min(x[x.length - 1], 40000))] as [number, number] };
  }, [series, quantity]);
  return (
    <Plot height={height} legend={false} xRange={data.range} yUnit={quantity === "z" ? "Ω" : "dB"} ariaLabel={label}
          series={[{ id: "s", label, x: data.x, y: data.y, color: unitColor(unit), width: 1.4 }]} />
  );
}

/** Values in SI shown and edited in a display unit (mm, ms, ...). */
export const toDisplay = (v: number | undefined, scale: number) => (v === undefined || !Number.isFinite(v) ? null : v * scale);
