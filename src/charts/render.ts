// Canvas painting for <Plot>. Two layers: the base (grid, data, probe) is repainted only when data,
// view, size or theme change; the overlay (crosshair, hover dots, box-zoom) is cheap and follows the
// pointer. Everything is drawn in CSS pixels on a context pre-scaled by the device pixel ratio.

import type { ChartTheme } from "./theme";
import type { PlotBand, PlotHBand, PlotMarker, PlotSeries, PlotVLine, PlotView } from "./types";
import {
  axisTicks,
  decimalsForStep,
  decimate,
  formatHz,
  formatNumber,
  logTicks,
  makeScale,
  nearestIndex,
  niceTicks,
  visibleSlice,
  type Scale,
} from "./scale";

export interface Frame {
  W: number;
  H: number;
  /** Plot area in CSS px. */
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  sx: Scale;
  sy: Scale;
  yTicks: number[];
  yDecimals: number;
}

export interface BaseInput {
  view: PlotView;
  xLog: boolean;
  series: PlotSeries[];
  hidden: ReadonlySet<string>;
  bands: PlotBand[];
  hBands: PlotHBand[];
  vLines: PlotVLine[];
  markers: PlotMarker[];
  probeHz: number | null;
  yLabel?: string;
  yUnit?: string;
  xTickLabels: boolean;
  theme: ChartTheme;
  /** Export only: paint the panel background and an in-canvas legend. */
  exportChrome?: { title?: string };
}

const TICK_FONT_PX = 10.5;

/** Phase axes get 15/30/45/90 degree steps. */
export function isAngleUnit(unit: string | undefined): boolean {
  return unit === "°" || unit === "deg" || unit === "degrees";
}
const AXIS_GAP = 7;

export function monoFont(theme: ChartTheme, px = TICK_FONT_PX, weight = 400): string {
  return `${weight} ${px}px ${theme.fontMono}`;
}
function condFont(theme: ChartTheme, px = 10.5, weight = 600): string {
  return `${weight} ${px}px ${theme.fontCond}`;
}

/** Work out the plot rectangle and scales; the left margin fits the widest y tick label. */
export function computeFrame(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  input: Pick<BaseInput, "view" | "xLog" | "yLabel" | "yUnit" | "xTickLabels" | "theme">,
  topInset = 0,
  /** Lower bound for the left edge, so plots stacked under one another share one x axis. */
  minX0 = 0,
): Frame {
  const y0 = 10 + topInset;
  const y1 = Math.max(y0 + 10, H - (input.xTickLabels ? 24 : 9));
  const yTicks = axisTicks(input.view.y[0], input.view.y[1], y1 - y0, isAngleUnit(input.yUnit));
  const step = yTicks.length > 1 ? yTicks[1] - yTicks[0] : 1;
  const yDecimals = decimalsForStep(step);
  ctx.font = monoFont(input.theme);
  let labelW = 0;
  for (const t of yTicks) labelW = Math.max(labelW, ctx.measureText(formatNumber(t, yDecimals)).width);
  const x0 = Math.max(minX0, Math.round((input.yLabel ? 18 : 4) + Math.max(labelW, 18) + AXIS_GAP + 2));
  const x1 = Math.max(x0 + 10, W - 12);
  return {
    W, H, x0, x1, y0, y1,
    sx: makeScale(input.view.x, [x0, x1], input.xLog),
    sy: makeScale(input.view.y, [y1, y0], false),
    yTicks,
    yDecimals,
  };
}

const crisp = (v: number) => Math.round(v) + 0.5;

function dashFor(style: PlotVLine["style"]): number[] {
  if (style === "solid" || style === "probe") return [];
  if (style === "dotted") return [1.5, 3];
  return [4, 4];
}

/** Rounded pill with centred text; returns its rectangle. */
function pill(
  ctx: CanvasRenderingContext2D,
  text: string,
  cx: number,
  cy: number,
  bg: string,
  fg: string,
  bounds?: [number, number],
): { x: number; w: number } {
  const padX = 5;
  const w = Math.ceil(ctx.measureText(text).width) + padX * 2;
  const h = 16;
  let x = cx - w / 2;
  if (bounds) x = Math.min(Math.max(x, bounds[0]), bounds[1] - w);
  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.roundRect(Math.round(x), Math.round(cy - h / 2), w, h, 3);
  ctx.fill();
  ctx.fillStyle = fg;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(text, Math.round(x) + padX, Math.round(cy) + 0.5);
  return { x, w };
}

// ---------------------------------------------------------------- base layer

export function drawBase(ctx: CanvasRenderingContext2D, fr: Frame, input: BaseInput): void {
  const { theme } = input;
  const { x0, x1, y0, y1, sx, sy, W, H } = fr;
  ctx.clearRect(0, 0, W, H);
  if (input.exportChrome) {
    ctx.fillStyle = theme.surface1;
    ctx.fillRect(0, 0, W, H);
  }

  const [vx0, vx1] = input.view.x;

  // ---- horizontal bands (tolerance windows) under the grid lines
  for (const hb of input.hBands) {
    const ya = sy.toPx(Math.max(hb.from, hb.to));
    const yb = sy.toPx(Math.min(hb.from, hb.to));
    const top = Math.max(y0, ya);
    const bot = Math.min(y1, yb);
    if (bot <= top) continue;
    ctx.globalAlpha = hb.color ? (hb.opacity ?? 0.1) : 1;
    ctx.fillStyle = hb.color ? theme.color(hb.color) : theme.band;
    ctx.fillRect(x0, top, x1 - x0, bot - top);
    ctx.globalAlpha = 1;
    if (hb.label) {
      ctx.font = monoFont(theme, 10);
      ctx.fillStyle = hb.color ? theme.color(hb.color) : theme.text3;
      ctx.textAlign = "right";
      ctx.textBaseline = "top";
      ctx.fillText(hb.label, x1 - 6, top + 4);
    }
  }

  // ---- x grid
  ctx.lineWidth = 1;
  let firstLabelLeft = Infinity;
  const xTickY = y1 + 13;
  if (input.xLog) {
    const t = logTicks(vx0, vx1);
    for (const g of t.grid) {
      const X = crisp(sx.toPx(g.value));
      if (X < x0 || X > x1 + 1) continue;
      ctx.strokeStyle = g.strong ? theme.gridStrong : theme.grid;
      ctx.beginPath();
      ctx.moveTo(X, y0);
      ctx.lineTo(X, y1);
      ctx.stroke();
    }
    if (input.xTickLabels) firstLabelLeft = drawXLabels(ctx, fr, t.labelled, theme, xTickY);
  } else {
    const vals = niceTicks(vx0, vx1, Math.max(2, Math.round((x1 - x0) / 90)));
    const dec = decimalsForStep(vals.length > 1 ? vals[1] - vals[0] : 1);
    for (const v of vals) {
      const X = crisp(sx.toPx(v));
      ctx.strokeStyle = theme.grid;
      ctx.beginPath();
      ctx.moveTo(X, y0);
      ctx.lineTo(X, y1);
      ctx.stroke();
    }
    if (input.xTickLabels)
      drawXLabels(ctx, fr, vals.map((value) => ({ value, label: formatNumber(value, dec), rank: 1 })), theme, xTickY);
  }

  // ---- y grid + labels
  ctx.font = monoFont(theme);
  ctx.textBaseline = "middle";
  ctx.textAlign = "right";
  for (const v of fr.yTicks) {
    const Y = crisp(sy.toPx(v));
    if (Y < y0 - 1 || Y > y1 + 1) continue;
    ctx.strokeStyle = v === 0 ? theme.gridStrong : theme.grid;
    ctx.beginPath();
    ctx.moveTo(x0, Y);
    ctx.lineTo(x1, Y);
    ctx.stroke();
    ctx.fillStyle = theme.text3;
    ctx.fillText(formatNumber(v, fr.yDecimals), x0 - AXIS_GAP, Math.min(Math.max(Y, y0 + 5), y1 - 5));
  }

  // ---- axis titles: rotated y label with its unit, "Hz" in the bottom-left corner
  if (input.yLabel) {
    ctx.save();
    ctx.translate(9, (y0 + y1) / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textBaseline = "middle";
    const label = input.yLabel.toUpperCase();
    ctx.font = condFont(theme, 10.5, 600);
    const lw = measureSpaced(ctx, label, 1.1);
    let uw = 0;
    if (input.yUnit) {
      ctx.font = monoFont(theme, 10);
      uw = ctx.measureText(input.yUnit).width + 6;
    }
    const start = -(lw + uw) / 2;
    ctx.font = condFont(theme, 10.5, 600);
    ctx.fillStyle = theme.text2;
    fillSpaced(ctx, label, start, 0, 1.1);
    if (input.yUnit) {
      ctx.font = monoFont(theme, 10);
      ctx.fillStyle = theme.text3;
      ctx.textAlign = "left";
      ctx.fillText(input.yUnit, start + lw + 6, 0.5);
    }
    ctx.restore();
  }
  if (input.xTickLabels && input.xLog) {
    ctx.font = monoFont(theme, 10);
    ctx.fillStyle = theme.text3;
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.fillText("Hz", Math.min(x0 - AXIS_GAP, firstLabelLeft - 6), xTickY);
  }

  // ---- clipped data region
  ctx.save();
  ctx.beginPath();
  ctx.rect(x0, y0, x1 - x0, y1 - y0);
  ctx.clip();

  for (const b of input.bands) drawBand(ctx, fr, b, theme, input.view);

  for (const v of input.vLines) {
    if (v.style === "probe") continue;
    drawVLine(ctx, fr, v, theme);
  }

  for (const s of input.series) {
    if (input.hidden.has(s.id)) continue;
    drawSeries(ctx, fr, s, theme, input.view);
  }

  for (const m of input.markers) drawMarker(ctx, fr, m, theme);
  ctx.restore();

  // vLine labels: drawn after the curves on a small pill (so no trace runs through the text), outside the
  // clip so they never get cut at the top edge. A label that would overlap one already placed flips to the
  // other side of its line, else drops a row.
  {
    const placed: { l: number; r: number; t: number; b: number }[] = [];
    const overlaps = (a: { l: number; r: number; t: number; b: number }) =>
      placed.some((p) => a.l < p.r + 3 && a.r > p.l - 3 && a.t < p.b && a.b > p.t);
    const PAD_X = 3, ROW = 15, TOP = y0 + 22;
    ctx.font = monoFont(theme, 10);
    for (const v of input.vLines) {
      if (v.style === "probe" || !v.label) continue;
      const X = sx.toPx(v.x);
      if (X < x0 || X > x1) continue;
      const w = ctx.measureText(v.label).width + 2 * PAD_X;
      const fitsRight = X + 3 + w < x1, fitsLeft = X - 3 - w > x0;
      const sides = (fitsRight ? [1, -1] : [-1, 1]).filter((d) => (d > 0 ? fitsRight : fitsLeft) || !(fitsRight || fitsLeft));
      let box: { l: number; r: number; t: number; b: number } | null = null;
      for (let row = 0; row < 4 && !box; row++) {
        for (const d of sides) {
          const l = d > 0 ? X + 3 : X - 3 - w, t = TOP + row * ROW;
          const cand = { l, r: l + w, t, b: t + ROW - 2 };
          if (!overlaps(cand) && cand.b < y1) { box = cand; break; }
        }
      }
      if (!box) continue; // no room left: the line itself still shows
      placed.push(box);
      ctx.save();
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = theme.surface2;
      ctx.beginPath();
      ctx.roundRect(box.l, box.t, box.r - box.l, box.b - box.t, 3);
      ctx.fill();
      ctx.restore();
      ctx.fillStyle = theme.color(v.color, "text-3");
      ctx.textBaseline = "middle";
      ctx.textAlign = "left";
      ctx.fillText(v.label, box.l + PAD_X, (box.t + box.b) / 2 + 0.5);
    }
  }

  // ---- probe(s): accent line with a frequency flag at the top
  const probes: PlotVLine[] = input.vLines.filter((v) => v.style === "probe");
  if (input.probeHz != null && Number.isFinite(input.probeHz)) probes.push({ x: input.probeHz, style: "probe" });
  for (const p of probes) drawProbe(ctx, fr, p, theme);

  // ---- frame
  ctx.strokeStyle = theme.line;
  ctx.lineWidth = 1;
  ctx.strokeRect(crisp(x0) - 1, crisp(y0) - 1, Math.round(x1 - x0) + 1, Math.round(y1 - y0) + 1);

  if (input.exportChrome) drawExportLegend(ctx, fr, input);
}

function measureSpaced(ctx: CanvasRenderingContext2D, text: string, spacing: number): number {
  return ctx.measureText(text).width + spacing * Math.max(0, text.length - 1);
}

/** Letter-spaced text (canvas letterSpacing is not in every WebView yet). */
function fillSpaced(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, spacing: number) {
  ctx.textAlign = "left";
  let cx = x;
  for (const ch of text) {
    ctx.fillText(ch, cx, y);
    cx += ctx.measureText(ch).width + spacing;
  }
}

function drawXLabels(
  ctx: CanvasRenderingContext2D,
  fr: Frame,
  ticks: { value: number; label: string; rank: number }[],
  theme: ChartTheme,
  y: number,
): number {
  ctx.font = monoFont(theme);
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  // Place by priority (decades first) and skip anything that would collide.
  const placed: [number, number][] = [];
  const order = ticks.map((t, i) => ({ t, i })).sort((a, b) => a.t.rank - b.t.rank || a.i - b.i);
  const draw: { x: number; text: string }[] = [];
  for (const { t } of order) {
    const X = fr.sx.toPx(t.value);
    if (X < fr.x0 - 1 || X > fr.x1 + 1) continue;
    const w = ctx.measureText(t.label).width;
    let left = X - w / 2;
    left = Math.min(Math.max(left, fr.x0 - 6), fr.W - w - 2);
    const right = left + w;
    if (placed.some(([a, b]) => left < b + 8 && right > a - 8)) continue;
    placed.push([left, right]);
    draw.push({ x: left, text: t.label });
  }
  ctx.fillStyle = theme.text3;
  let minLeft = Infinity;
  for (const d of draw) {
    ctx.fillText(d.text, d.x, y);
    minLeft = Math.min(minLeft, d.x);
  }
  return minLeft;
}

function drawBand(ctx: CanvasRenderingContext2D, fr: Frame, b: PlotBand, theme: ChartTheme, view: PlotView) {
  const n = Math.min(b.x.length, b.lower.length, b.upper.length);
  if (n < 2) return;
  const [i0, i1] = visibleSlice(b.x, view.x[0], view.x[1]);
  const useBandToken = !b.color || b.color === "band";
  ctx.fillStyle = useBandToken ? theme.band : theme.color(b.color);
  ctx.globalAlpha = useBandToken ? 1 : (b.opacity ?? 0.14);
  ctx.beginPath();
  let open = false;
  let runStart = -1;
  // Fill each finite run separately so a gap in the data does not bridge the band.
  const closeRun = (end: number) => {
    for (let j = end; j >= runStart; j--) ctx.lineTo(fr.sx.toPx(b.x[j]), fr.sy.toPx(b.lower[j]));
    ctx.closePath();
  };
  for (let i = i0; i <= Math.min(i1, n - 1); i++) {
    const ok = Number.isFinite(b.upper[i]) && Number.isFinite(b.lower[i]);
    if (!ok) {
      if (open) closeRun(i - 1);
      open = false;
      continue;
    }
    const X = fr.sx.toPx(b.x[i]);
    const Y = fr.sy.toPx(b.upper[i]);
    if (!open) {
      ctx.moveTo(X, Y);
      runStart = i;
      open = true;
    } else ctx.lineTo(X, Y);
  }
  if (open) closeRun(Math.min(i1, n - 1));
  ctx.fill();
  ctx.globalAlpha = 1;
}

function drawVLine(ctx: CanvasRenderingContext2D, fr: Frame, v: PlotVLine, theme: ChartTheme) {
  const X = crisp(fr.sx.toPx(v.x));
  if (X < fr.x0 || X > fr.x1 + 1) return;
  ctx.strokeStyle = theme.color(v.color, "text-3");
  ctx.lineWidth = v.width ?? 1;
  ctx.setLineDash(dashFor(v.style));
  ctx.beginPath();
  ctx.moveTo(X, fr.y0);
  ctx.lineTo(X, fr.y1);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.lineWidth = 1;
}

function drawProbe(ctx: CanvasRenderingContext2D, fr: Frame, p: PlotVLine, theme: ChartTheme) {
  const color = theme.color(p.color, "accent");
  const X = fr.sx.toPx(p.x);
  ctx.font = monoFont(theme, 10, 500);
  if (X < fr.x0 - 0.5 || X > fr.x1 + 0.5) {
    // Off-screen probe: a chevron at the edge says where it went.
    const left = X < fr.x0;
    const ex = left ? fr.x0 + 2 : fr.x1 - 2;
    const cy = fr.y0 + 9;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(ex, cy);
    ctx.lineTo(ex + (left ? 6 : -6), cy - 5);
    ctx.lineTo(ex + (left ? 6 : -6), cy + 5);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 0.9;
    const text = p.label ?? formatHz(p.x);
    ctx.textBaseline = "middle";
    ctx.textAlign = left ? "left" : "right";
    ctx.fillText(text, ex + (left ? 10 : -10), cy + 0.5);
    ctx.globalAlpha = 1;
    return;
  }
  const Xc = crisp(X);
  ctx.strokeStyle = color;
  ctx.lineWidth = p.width ?? 1.25;
  ctx.beginPath();
  ctx.moveTo(Xc, fr.y0 + 16);
  ctx.lineTo(Xc, fr.y1);
  ctx.stroke();
  ctx.lineWidth = 1;
  // Small foot on the x axis anchors the line.
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(Xc - 4, fr.y1);
  ctx.lineTo(Xc + 4, fr.y1);
  ctx.lineTo(Xc, fr.y1 - 5);
  ctx.closePath();
  ctx.fill();
  pill(ctx, p.label ?? formatHz(p.x), Xc, fr.y0 + 8, color, theme.accentText, [fr.x0, fr.x1]);
}

function drawSeries(ctx: CanvasRenderingContext2D, fr: Frame, s: PlotSeries, theme: ChartTheme, view: PlotView) {
  const n = Math.min(s.x.length, s.y.length);
  if (n === 0) return;
  const [i0, i1] = visibleSlice(s.x, view.x[0], Math.min(view.x[1], s.x[n - 1]));
  const last = Math.min(i1, n - 1);
  const plotW = fr.x1 - fr.x0;
  // Thin out only when there are clearly more samples than pixels; phase lines keep every sample
  // so the wrap detection sees the real jumps.
  const idx = !s.wrapPhase && last - i0 > plotW * 3 ? decimate(s.x, s.y, i0, last, fr.sx.toPx) : null;
  const count = idx ? idx.length : last - i0 + 1;

  ctx.strokeStyle = theme.color(s.color, "text");
  ctx.lineWidth = s.width ?? 1.5;
  ctx.globalAlpha = s.opacity ?? 1;
  ctx.setLineDash(s.dash ?? []);
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.beginPath();
  let pen = false;
  let prev = NaN;
  let single = -1; // isolated point (between gaps) gets a dot
  for (let k = 0; k < count; k++) {
    const i = idx ? idx[k] : i0 + k;
    const v = s.y[i];
    if (!Number.isFinite(v) || !Number.isFinite(s.x[i])) {
      pen = false;
      prev = NaN;
      continue;
    }
    if (s.wrapPhase && pen && Math.abs(v - prev) > 180) pen = false;
    const X = fr.sx.toPx(s.x[i]);
    const Y = fr.sy.toPx(v);
    if (pen) ctx.lineTo(X, Y);
    else {
      ctx.moveTo(X, Y);
      single = count === 1 ? i : -1;
    }
    pen = true;
    prev = v;
  }
  ctx.stroke();
  if (single >= 0) {
    ctx.fillStyle = ctx.strokeStyle;
    ctx.beginPath();
    ctx.arc(fr.sx.toPx(s.x[single]), fr.sy.toPx(s.y[single]), 2.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;
}

export function markerPath(ctx: CanvasRenderingContext2D, shape: PlotMarker["shape"], X: number, Y: number, r: number) {
  ctx.beginPath();
  switch (shape) {
    case "diamond":
      ctx.moveTo(X, Y - r * 1.25);
      ctx.lineTo(X + r * 1.25, Y);
      ctx.lineTo(X, Y + r * 1.25);
      ctx.lineTo(X - r * 1.25, Y);
      ctx.closePath();
      break;
    case "square":
      ctx.rect(X - r, Y - r, r * 2, r * 2);
      break;
    case "triangle":
      ctx.moveTo(X, Y - r * 1.3);
      ctx.lineTo(X + r * 1.2, Y + r * 0.9);
      ctx.lineTo(X - r * 1.2, Y + r * 0.9);
      ctx.closePath();
      break;
    default:
      ctx.arc(X, Y, r, 0, Math.PI * 2);
  }
}

function drawMarker(ctx: CanvasRenderingContext2D, fr: Frame, m: PlotMarker, theme: ChartTheme) {
  if (!Number.isFinite(m.x) || !Number.isFinite(m.y)) return;
  const X = fr.sx.toPx(m.x);
  const Y = fr.sy.toPx(m.y);
  const r = m.size ?? 4;
  markerPath(ctx, m.shape, X, Y, r);
  ctx.fillStyle = theme.color(m.color, "text");
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = theme.surface1;
  ctx.stroke();
  ctx.lineWidth = 1;
  if (m.label) {
    ctx.font = monoFont(theme, 10, 500);
    ctx.textBaseline = "bottom";
    const w = ctx.measureText(m.label).width;
    const right = X + r + 4 + w < fr.x1;
    ctx.textAlign = right ? "left" : "right";
    // A halo in the panel colour keeps the label readable over grid and curves.
    ctx.lineWidth = 3;
    ctx.strokeStyle = theme.surface1;
    ctx.lineJoin = "round";
    const tx = right ? X + r + 3 : X - r - 3;
    ctx.strokeText(m.label, tx, Y - 3);
    ctx.fillStyle = theme.color(m.color, "text");
    ctx.fillText(m.label, tx, Y - 3);
    ctx.lineWidth = 1;
  }
}

function drawExportLegend(ctx: CanvasRenderingContext2D, fr: Frame, input: BaseInput) {
  const { theme } = input;
  const items = input.series.filter((s) => s.label && !s.quiet && !input.hidden.has(s.id));
  ctx.font = `500 11px ${theme.fontUi}`;
  ctx.textBaseline = "middle";
  let x = fr.x1;
  const y = 10;
  for (let k = items.length - 1; k >= 0; k--) {
    const s = items[k];
    const w = ctx.measureText(s.label!).width;
    x -= w;
    ctx.fillStyle = theme.text2;
    ctx.textAlign = "left";
    ctx.fillText(s.label!, x, y);
    x -= 20;
    ctx.strokeStyle = theme.color(s.color);
    ctx.lineWidth = 2;
    ctx.setLineDash(s.dash ?? []);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + 14, y);
    ctx.stroke();
    ctx.setLineDash([]);
    x -= 14;
  }
  if (input.exportChrome?.title) {
    ctx.font = condFont(theme, 11.5, 700);
    ctx.fillStyle = theme.text;
    fillSpaced(ctx, input.exportChrome.title.toUpperCase(), fr.x0, y, 1.2);
  }
  ctx.lineWidth = 1;
}

// ---------------------------------------------------------------- overlay layer

export interface HoverState {
  /** Snapped frequency of the crosshair. */
  xHz: number;
  /** Pointer y in CSS px when this plot is the one under the pointer (draws the horizontal line). */
  pointerY: number | null;
}

export interface OverlayInput {
  series: PlotSeries[];
  hidden: ReadonlySet<string>;
  theme: ChartTheme;
  hover: HoverState | null;
  xLog: boolean;
  xTickLabels: boolean;
  yDecimals: number;
  /** Shift-drag box zoom rectangle in CSS px. */
  box: { xa: number; xb: number; ya: number; yb: number } | null;
}

export function drawOverlay(ctx: CanvasRenderingContext2D, fr: Frame, o: OverlayInput): void {
  const { theme } = o;
  ctx.clearRect(0, 0, fr.W, fr.H);

  if (o.box) {
    const x = Math.min(o.box.xa, o.box.xb);
    const y = Math.min(o.box.ya, o.box.yb);
    const w = Math.abs(o.box.xb - o.box.xa);
    const h = Math.abs(o.box.yb - o.box.ya);
    ctx.fillStyle = theme.accent;
    ctx.globalAlpha = 0.08;
    ctx.fillRect(x, y, w, h);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = theme.accent;
    ctx.setLineDash([4, 3]);
    ctx.strokeRect(crisp(x), crisp(y), Math.round(w), Math.round(h));
    ctx.setLineDash([]);
  }

  const hv = o.hover;
  if (!hv) return;
  const X = fr.sx.toPx(hv.xHz);
  if (X < fr.x0 - 0.5 || X > fr.x1 + 0.5) return;
  const Xc = crisp(X);

  ctx.strokeStyle = theme.text2;
  ctx.globalAlpha = 0.55;
  ctx.setLineDash([2, 3]);
  ctx.beginPath();
  ctx.moveTo(Xc, fr.y0);
  ctx.lineTo(Xc, fr.y1);
  ctx.stroke();
  if (hv.pointerY != null && hv.pointerY >= fr.y0 && hv.pointerY <= fr.y1) {
    const Y = crisp(hv.pointerY);
    ctx.beginPath();
    ctx.moveTo(fr.x0, Y);
    ctx.lineTo(fr.x1, Y);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;

  // Snapped sample dots on every visible series.
  for (const s of o.series) {
    if (o.hidden.has(s.id) || s.quiet) continue;
    const i = nearestIndex(s.x, hv.xHz, o.xLog);
    if (i < 0) continue;
    const v = s.y[i];
    if (!Number.isFinite(v)) continue;
    const sxp = fr.sx.toPx(s.x[i]);
    const syp = fr.sy.toPx(v);
    if (syp < fr.y0 - 4 || syp > fr.y1 + 4 || sxp < fr.x0 - 4 || sxp > fr.x1 + 4) continue;
    ctx.beginPath();
    ctx.arc(sxp, syp, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = theme.color(s.color);
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = theme.surface1;
    ctx.stroke();
    ctx.lineWidth = 1;
  }

  // Axis tags: the y value at the pointer and the frequency on the x axis.
  ctx.font = monoFont(theme, 10, 500);
  if (hv.pointerY != null && hv.pointerY >= fr.y0 && hv.pointerY <= fr.y1) {
    const yv = fr.sy.fromPx(hv.pointerY);
    const text = formatNumber(yv, Math.min(fr.yDecimals + 1, 3));
    const w = ctx.measureText(text).width + 10;
    pill(ctx, text, fr.x0 - 4 - w / 2, hv.pointerY, theme.text, theme.surface1, [1, fr.x0 - 2]);
  }
  if (o.xTickLabels) {
    pill(ctx, formatHz(hv.xHz), Xc, fr.y1 + 13, theme.text, theme.surface1, [fr.x0 - 20, fr.W - 2]);
  }
}
