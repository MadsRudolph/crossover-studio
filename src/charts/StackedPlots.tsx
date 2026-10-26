// Plots stacked on one shared frequency axis (magnitude over phase, response over impedance):
// one crosshair, one x zoom, aligned left gutters, x tick labels only under the bottom plot.

import { useId, useImperativeHandle, useRef, type CSSProperties, type Ref } from "react";
import { Plot } from "./Plot";
import type { PlotHandle, PlotProps, Range } from "./types";

export type StackedPlotSpec = Omit<PlotProps, "xRange" | "xLog" | "probeHz" | "onProbe" | "syncId" | "xTickLabels" | "ref"> & {
  /** React key; defaults to the index. */
  key?: string;
};

export interface StackedPlotsHandle {
  /** Handles of the individual plots, top to bottom. */
  plots(): (PlotHandle | null)[];
  resetView(): void;
}

export interface StackedPlotsProps {
  xRange: Range;
  xLog?: boolean;
  probeHz?: number | null;
  onProbe?: (fHz: number) => void;
  plots: StackedPlotSpec[];
  /** Share the crosshair with plots outside this stack too. */
  syncId?: string;
  gap?: number;
  className?: string;
  style?: CSSProperties;
  ref?: Ref<StackedPlotsHandle>;
}

export function StackedPlots({ xRange, xLog, probeHz, onProbe, plots, syncId, gap, className, style, ref }: StackedPlotsProps) {
  const ownId = useId();
  const id = syncId ?? `stack${ownId}`;
  const handles = useRef<(PlotHandle | null)[]>([]);

  useImperativeHandle(ref, () => ({
    plots: () => handles.current.slice(0, plots.length),
    // Resetting one resets all: the x view is shared over the sync channel.
    resetView: () => handles.current.forEach((h) => h?.resetView()),
  }), [plots.length]);

  return (
    <div className={`chart-stack${className ? " " + className : ""}`} style={{ gap, ...style }}>
      {plots.map(({ key, ...spec }, i) => (
        <Plot
          key={key ?? i}
          {...spec}
          ref={(h) => {
            handles.current[i] = h;
          }}
          xRange={xRange}
          xLog={xLog}
          probeHz={probeHz}
          onProbe={onProbe}
          syncId={id}
          xTickLabels={i === plots.length - 1}
        />
      ))}
    </div>
  );
}
