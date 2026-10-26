// Tiny inline curve for status chips (e.g. the summed response next to the "spread" metric).
// SVG so it stays crisp at any DPI; long series are reduced to one min/max pair per pixel.

import { useMemo } from "react";
import { decimate, extentIn, makeScale } from "./scale";
import { cssColor } from "./theme";
import "./charts.css";

export interface SparklineProps {
  y: ArrayLike<number>;
  /** Optional x (Hz). Without it samples are spaced evenly. */
  x?: ArrayLike<number>;
  xLog?: boolean;
  /** Fixed y window; default the data extent. */
  yRange?: [number, number];
  width?: number;
  height?: number;
  color?: string;
  /** Soft area under the curve. */
  fill?: boolean;
  /** Shaded target window, e.g. [-3, 3] dB around the mean. */
  band?: [number, number];
  /** Accent dot at this x (or index when there is no x), e.g. the probe. */
  markerX?: number | null;
  strokeWidth?: number;
  /** Accessible description; without it the sparkline is decorative. */
  label?: string;
  className?: string;
}

export function Sparkline({
  y, x, xLog = true, yRange, width = 72, height = 20, color = "sum", fill = false, band, markerX,
  strokeWidth = 1.25, label, className,
}: SparklineProps) {
  const geom = useMemo(() => {
    const n = x ? Math.min(x.length, y.length) : y.length;
    if (n < 2) return null;
    const xs: ArrayLike<number> = x ?? Float64Array.from({ length: n }, (_, i) => i);
    const log = !!x && xLog && xs[0] > 0;
    const pad = strokeWidth + 1;
    const sx = makeScale([xs[0], xs[n - 1]], [pad, width - pad], log);
    const ext = yRange ?? extentIn(xs, y, xs[0], xs[n - 1]);
    if (!ext) return null;
    const lo = ext[0];
    const hi = ext[1] > ext[0] ? ext[1] : ext[0] + 1;
    const sy = makeScale([lo, hi], [height - pad, pad], false);
    const idx = n > width * 3 ? decimate(xs, y, 0, n - 1, sx.toPx) : null;
    const count = idx ? idx.length : n;
    let d = "";
    let pen = false;
    let firstX = NaN;
    let lastX = NaN;
    for (let k = 0; k < count; k++) {
      const i = idx ? idx[k] : k;
      const v = y[i];
      if (!Number.isFinite(v)) {
        pen = false;
        continue;
      }
      const X = sx.toPx(xs[i]).toFixed(1);
      const Y = Math.min(height, Math.max(0, sy.toPx(v))).toFixed(1);
      d += `${pen ? "L" : "M"}${X} ${Y}`;
      if (!pen && Number.isNaN(firstX)) firstX = Number(X);
      lastX = Number(X);
      pen = true;
    }
    const area = fill && d ? `${d}L${lastX} ${height}L${firstX} ${height}Z` : "";
    const bandRect = band
      ? { y: sy.toPx(Math.max(band[0], band[1])), h: Math.abs(sy.toPx(band[0]) - sy.toPx(band[1])) }
      : null;
    let marker: { cx: number; cy: number } | null = null;
    if (markerX != null && Number.isFinite(markerX)) {
      let best = 0;
      for (let i = 1; i < n; i++) if (Math.abs(xs[i] - markerX) < Math.abs(xs[best] - markerX)) best = i;
      if (Number.isFinite(y[best])) marker = { cx: sx.toPx(xs[best]), cy: sy.toPx(y[best]) };
    }
    return { d, area, bandRect, marker };
  }, [y, x, xLog, yRange, width, height, fill, band, markerX, strokeWidth]);

  const stroke = cssColor(color);
  return (
    <svg
      className={`chart-spark${className ? " " + className : ""}`}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {geom?.bandRect && (
        <rect x={0} y={geom.bandRect.y} width={width} height={geom.bandRect.h} fill="var(--band)" rx={1.5} />
      )}
      {geom?.area && <path d={geom.area} fill={stroke} opacity={0.14} />}
      {geom ? (
        <path d={geom.d} fill="none" stroke={stroke} strokeWidth={strokeWidth} strokeLinejoin="round" strokeLinecap="round" />
      ) : (
        <line x1={2} x2={width - 2} y1={height / 2} y2={height / 2} stroke="var(--line-strong)" strokeDasharray="2 3" />
      )}
      {geom?.marker && (
        <circle cx={geom.marker.cx} cy={geom.marker.cy} r={2.25} fill="var(--accent)" stroke="var(--surface-1)" strokeWidth={1} />
      )}
    </svg>
  );
}
