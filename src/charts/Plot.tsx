// <Plot>: high-DPI canvas plot for acoustic data (log frequency axis, dB/phase/ohm y axes).
// React renders the chrome (legend row, toolbar, empty state); PlotController does all drawing and
// interaction imperatively so hover and pan never re-render React.

import { useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Copy, RotateCcw } from "lucide-react";
import { PlotController } from "./controller";
import { cssColor, onThemeChange } from "./theme";
import type { PlotHandle, PlotProps, PlotSeries } from "./types";
import "./charts.css";

const HEADER_PX = 28;

/** Copy PNG bytes to the system clipboard. */
export async function copyPngToClipboard(png: Uint8Array): Promise<void> {
  if (!navigator.clipboard || typeof ClipboardItem === "undefined") {
    throw new Error("The clipboard is not available here");
  }
  const blob = new Blob([png as BlobPart], { type: "image/png" });
  await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
}

function hasData(series: PlotSeries[]): boolean {
  return series.some((s) => Math.min(s.x.length, s.y.length) > 0);
}

export function Plot(props: PlotProps) {
  const { height, series, legend, title, headerExtra, ref } = props;
  const hostRef = useRef<HTMLDivElement>(null);
  const baseRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const liveRef = useRef<HTMLDivElement>(null);
  const ctrlRef = useRef<PlotController | null>(null);
  const [zoomed, setZoomed] = useState(false);
  const [copyState, setCopyState] = useState<"idle" | "done" | "failed">("idle");

  // Legend visibility: starts from each series' `hidden`, then the user's toggles win until the
  // app flips that series' `hidden` prop itself.
  const [hidden, setHidden] = useState<Set<string>>(() => new Set(series.filter((s) => s.hidden).map((s) => s.id)));
  const hiddenPropKey = series.map((s) => (s.hidden ? "1" : "0") + s.id).join("|");
  const lastHiddenProps = useRef(new Map(series.map((s) => [s.id, !!s.hidden])));
  useEffect(() => {
    const prev = lastHiddenProps.current;
    let changed = false;
    const next = new Set(hidden);
    for (const s of series) {
      const h = !!s.hidden;
      if (prev.get(s.id) !== h) {
        if (h) next.add(s.id);
        else next.delete(s.id);
        changed = true;
      }
    }
    lastHiddenProps.current = new Map(series.map((s) => [s.id, !!s.hidden]));
    if (changed) setHidden(next);
    // Only the hidden flags matter here; `series` identity changes on every data update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hiddenPropKey]);

  const listed = useMemo(() => series.filter((s) => s.label && !s.quiet), [series]);
  const showLegend = (legend ?? listed.length > 0) && listed.length > 0;
  const showHeader = showLegend || title != null || headerExtra != null;
  const empty = !hasData(series);

  useLayoutEffect(() => {
    const ctrl = new PlotController(
      {
        host: hostRef.current!,
        base: baseRef.current!,
        overlay: overlayRef.current!,
        card: cardRef.current!,
        live: liveRef.current!,
      },
      { onZoomedChange: setZoomed },
    );
    ctrlRef.current = ctrl;
    const off = onThemeChange(() => ctrl.themeChanged());
    return () => {
      off();
      ctrl.destroy();
      ctrlRef.current = null;
    };
  }, []);

  // Every render hands the latest props to the controller; it decides what needs repainting.
  useLayoutEffect(() => {
    ctrlRef.current?.update(props, hidden, false);
  });

  const titleText = typeof title === "string" ? title : props.yLabel;
  useImperativeHandle(
    ref,
    (): PlotHandle => ({
      exportPNG: (scale = 2) => ctrlRef.current!.exportPNG(scale, titleText),
      copyToClipboard: async (scale = 2) => copyPngToClipboard(await ctrlRef.current!.exportPNG(scale, titleText)),
      resetView: () => ctrlRef.current?.resetView(),
      getView: () => ctrlRef.current!.getView(),
      focus: () => hostRef.current?.focus(),
    }),
    [titleText],
  );

  const toggle = (id: string, solo: boolean) => {
    let next: Set<string>;
    if (solo) {
      // Alt/Option-click: show only this one; again on the solo entry shows all.
      const alreadySolo = listed.every((s) => (s.id === id ? !hidden.has(s.id) : hidden.has(s.id)));
      next = alreadySolo ? new Set() : new Set(listed.filter((s) => s.id !== id).map((s) => s.id));
    } else {
      next = new Set(hidden);
      if (next.has(id)) next.delete(id);
      else next.add(id);
    }
    setHidden(next);
    for (const s of listed) {
      const was = hidden.has(s.id);
      const is = next.has(s.id);
      if (was !== is) props.onSeriesToggle?.(s.id, !is);
    }
  };

  const copy = async () => {
    try {
      await copyPngToClipboard(await ctrlRef.current!.exportPNG(2, titleText));
      setCopyState("done");
    } catch {
      setCopyState("failed");
    }
    window.setTimeout(() => setCopyState("idle"), 1600);
  };

  const tools = (
    <div className="chart-tools">
      {zoomed && (
        <button type="button" className="chart-tool" onClick={() => ctrlRef.current?.resetView()} title="Reset view (double-click, 0)">
          <RotateCcw size={13} strokeWidth={2} aria-hidden />
          <span className="chart-sr">Reset view</span>
        </button>
      )}
      <button
        type="button"
        className="chart-tool"
        data-state={copyState}
        onClick={copy}
        title={copyState === "done" ? "Copied" : copyState === "failed" ? "Clipboard unavailable" : "Copy as image"}
      >
        <Copy size={13} strokeWidth={2} aria-hidden />
        <span className="chart-sr">Copy plot as image</span>
      </button>
    </div>
  );

  const ariaLabel = props.ariaLabel ?? (props.yLabel ? `${props.yLabel} against frequency` : "Frequency plot");
  const bodyHeight = Math.max(40, height - (showHeader ? HEADER_PX : 0));

  return (
    <div className={`chart-plot${props.className ? " " + props.className : ""}`} style={{ height, ...props.style }}>
      {showHeader && (
        <div className="chart-head" style={{ height: HEADER_PX }}>
          {title != null && <div className="chart-title">{title}</div>}
          {showLegend && (
            <div className="chart-legend" role="group" aria-label="Series">
              {listed.map((s) => {
                const on = !hidden.has(s.id);
                return (
                  <button
                    key={s.id}
                    type="button"
                    className="chart-legend__item"
                    aria-pressed={on}
                    onClick={(e) => toggle(s.id, e.altKey)}
                    title={`${on ? "Hide" : "Show"} ${s.label} (Alt-click: solo)`}
                    style={{ ["--swatch" as string]: cssColor(s.color) }}
                  >
                    <svg width="16" height="8" aria-hidden>
                      <line
                        x1="1" y1="4" x2="15" y2="4"
                        strokeWidth={Math.min(3, Math.max(1.5, s.width ?? 2))}
                        strokeDasharray={s.dash?.length ? s.dash.map((d) => Math.max(1.5, d * 0.7)).join(" ") : undefined}
                        strokeLinecap="round"
                      />
                    </svg>
                    {s.label}
                  </button>
                );
              })}
            </div>
          )}
          <div className="chart-head__end">
            {headerExtra}
            {tools}
          </div>
        </div>
      )}
      <div
        ref={hostRef}
        className="chart-body"
        style={{ height: bodyHeight }}
        tabIndex={0}
        role="application"
        aria-roledescription="frequency plot"
        aria-label={ariaLabel}
        aria-keyshortcuts="ArrowLeft ArrowRight Shift+ArrowLeft Shift+ArrowRight Home End + - 0"
        data-empty={empty || undefined}
      >
        <canvas ref={baseRef} className="chart-canvas" aria-hidden />
        <canvas ref={overlayRef} className="chart-canvas" aria-hidden />
        <div ref={cardRef} className="chart-card" data-open="false" aria-hidden />
        {!showHeader && <div className="chart-tools-float">{tools}</div>}
        {empty && (
          <div className="chart-empty">
            {props.emptyState ?? (
              <>
                <strong>No data to plot</strong>
                <span>Import measurements to see curves here.</span>
              </>
            )}
          </div>
        )}
      </div>
      <div ref={liveRef} className="chart-sr" aria-live="polite" />
    </div>
  );
}
