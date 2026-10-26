// Public types of the chart library. Colours accept a design token name ('woof', 'mid', 'tw', 'sum',
// 'ref', 'accent', 'good', 'warn', 'bad', 'text-3', ...), a custom property ('--x') or any CSS colour.

import type { CSSProperties, ReactNode, Ref } from "react";
import type { Range } from "./scale";

export type { Range } from "./scale";

export interface PlotSeries {
  /** Stable id: legend toggles and hover state are keyed by it. */
  id: string;
  /** Legend and readout name. Series without a label are drawn but not listed. */
  label?: string;
  /** Frequencies in Hz, ascending. */
  x: ArrayLike<number>;
  y: ArrayLike<number>;
  color?: string;
  /** Line width in CSS px (default 1.5). */
  width?: number;
  /** Canvas dash pattern in CSS px, e.g. [5, 4] for references. */
  dash?: number[];
  opacity?: number;
  /** Phase in degrees: break the line where it jumps by more than 180 degrees instead of drawing the wrap. */
  wrapPhase?: boolean;
  /** Start hidden (legend entry shown switched off). */
  hidden?: boolean;
  /** Leave out of the legend and the readout (e.g. a decorative guide curve). */
  quiet?: boolean;
  /** Unit for this series' readout if it differs from the plot's yUnit. */
  unit?: string;
}

export interface PlotBand {
  id?: string;
  x: ArrayLike<number>;
  lower: ArrayLike<number>;
  upper: ArrayLike<number>;
  color?: string;
  /** Fill opacity (default 0.14; a band coloured with the 'band' token is drawn as is). */
  opacity?: number;
}

/** Horizontal band across the whole plot, e.g. a ±3 dB tolerance window or a minimum-load region. */
export interface PlotHBand {
  from: number;
  to: number;
  color?: string;
  opacity?: number;
  label?: string;
}

export interface PlotVLine {
  x: number;
  label?: string;
  color?: string;
  /** 'probe' draws the accent probe style; default 'dashed'. */
  style?: "solid" | "dashed" | "dotted" | "probe";
  width?: number;
}

export interface PlotMarker {
  x: number;
  y: number;
  color?: string;
  label?: string;
  shape?: "circle" | "diamond" | "square" | "triangle";
  /** Radius in CSS px (default 4). */
  size?: number;
}

export interface PlotView {
  x: Range;
  y: Range;
}

export interface PlotHandle {
  /** Render the plot (with legend and background) to PNG bytes at `scale` x the CSS size. */
  exportPNG(scale?: number): Promise<Uint8Array>;
  /** Put the PNG on the system clipboard. Rejects if the clipboard is unavailable. */
  copyToClipboard(scale?: number): Promise<void>;
  /** Animate back to the props' x/y ranges. */
  resetView(): void;
  getView(): PlotView;
  /** Focus the plot so the arrow keys move the probe. */
  focus(): void;
}

export interface PlotProps {
  /** Total height in CSS px, including the legend row. */
  height: number;
  /** Home x window in Hz. */
  xRange: Range;
  /** Log frequency axis (default true). */
  xLog?: boolean;
  /** Home y window; omitted = auto from the visible series. */
  yRange?: Range;
  yLabel?: string;
  /** Unit shown on the axis and in the readout, e.g. "dB", "°", "Ω". */
  yUnit?: string;
  series: PlotSeries[];
  bands?: PlotBand[];
  hBands?: PlotHBand[];
  vLines?: PlotVLine[];
  markers?: PlotMarker[];
  /** Global probe frequency (Hz): drawn as the accent line. */
  probeHz?: number | null;
  /** Click or arrow keys set the probe. Without it the plot is read-only for the probe. */
  onProbe?: (fHz: number) => void;
  /** Show the toggleable legend row (default true when any series has a label). */
  legend?: boolean;
  /** Called when a legend entry is toggled; the plot also tracks it itself. */
  onSeriesToggle?: (id: string, visible: boolean) => void;
  /** Plots with the same id share the crosshair and the x zoom. */
  syncId?: string;
  /** Readout value text; default: value with the plot's unit, decimals from the y tick step. */
  tooltipFormat?: (y: number, series: PlotSeries, xHz: number) => string;
  /** Title at the left of the legend row. */
  title?: ReactNode;
  /** Extra content at the right end of the legend row (view toggles, badges). */
  headerExtra?: ReactNode;
  /** Draw x tick labels (StackedPlots turns them off on all but the bottom plot). */
  xTickLabels?: boolean;
  /** Shown centred when there is nothing to draw. */
  emptyState?: ReactNode;
  /** Fired after the user pans or zooms (not on prop-driven changes). */
  onViewChange?: (view: PlotView) => void;
  /** Accessible name; defaults to the y label. */
  ariaLabel?: string;
  className?: string;
  style?: CSSProperties;
  ref?: Ref<PlotHandle>;
}
