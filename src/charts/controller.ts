// Imperative core of <Plot>: owns the two canvases, the view (with animated transitions), pointer,
// wheel and keyboard interaction, the readout card and crosshair sync. React only feeds it props, so a
// mouse move never re-renders React; all painting happens on requestAnimationFrame when something is dirty.

import { computeFrame, drawBase, drawOverlay, type BaseInput, type Frame, type HoverState } from "./render";
import {
  clampView,
  easeOut,
  extentIn,
  formatHz,
  formatNumber,
  lerpView,
  nearestIndex,
  niceDomain,
  panBy,
  sameRange,
  zoomAt,
  type Range,
} from "./scale";
import { dropMargin, publishSync, reportMargin, subscribeSync, type SyncEvent } from "./sync";
import { cssColor, prefersReducedMotion, readTheme, type ChartTheme } from "./theme";
import type { PlotProps, PlotSeries, PlotView } from "./types";

export interface ControllerElements {
  host: HTMLElement;
  base: HTMLCanvasElement;
  overlay: HTMLCanvasElement;
  card: HTMLElement;
  live: HTMLElement;
}

export interface ControllerCallbacks {
  /** The user zoomed away from (or back to) the home view: React shows or hides the reset button. */
  onZoomedChange(zoomed: boolean): void;
}

const ANIM_MS = 260;
const CLICK_SLOP_PX = 4;
const PROBE_GRAB_PX = 6;
/** Narrowest x window, in decades (about 1/6 octave) and narrowest y span relative to home. */
const MIN_X_SPAN_DEC = 0.05;
const MIN_Y_SPAN_FRAC = 0.02;

type Drag =
  | { mode: "pan"; startX: number; startY: number; view: PlotView; moved: boolean; pointerId: number }
  | { mode: "box"; startX: number; startY: number; x: number; y: number; pointerId: number }
  | { mode: "probe"; pointerId: number };

export class PlotController {
  private props!: PlotProps;
  private hidden: ReadonlySet<string> = new Set();
  private theme: ChartTheme | null = null;
  private frame: Frame | null = null;

  private W = 0;
  private H = 0;
  private dpr = 1;

  private home: PlotView = { x: [20, 20000], y: [-40, 10] };
  private view: PlotView = { x: [20, 20000], y: [-40, 10] };
  private anim: { from: PlotView; to: PlotView; t0: number } | null = null;
  private userZoomedX = false;
  private userZoomedY = false;
  private lastPropX: Range | null = null;
  private lastPropY: Range | undefined = undefined;

  private pointer: { x: number; y: number } | null = null;
  private syncedX: number | null = null;
  private keyboardHover = false;
  private drag: Drag | null = null;

  private baseDirty = true;
  private overlayDirty = true;
  private raf = 0;
  private readonly syncToken = Symbol("plot");
  private unsubscribeSync: (() => void) | null = null;
  private syncId: string | undefined;
  private ro: ResizeObserver;
  private readonly cleanups: (() => void)[] = [];
  private zoomedReported = false;

  constructor(private readonly el: ControllerElements, private readonly cb: ControllerCallbacks) {
    this.ro = new ResizeObserver(() => this.measure());
    this.ro.observe(el.host);
    this.listen(el.host, "pointerdown", this.onPointerDown as EventListener);
    this.listen(el.host, "pointermove", this.onPointerMove as EventListener);
    this.listen(el.host, "pointerup", this.onPointerUp as EventListener);
    this.listen(el.host, "pointercancel", this.onPointerUp as EventListener);
    this.listen(el.host, "pointerleave", this.onPointerLeave as EventListener);
    this.listen(el.host, "dblclick", this.onDoubleClick as EventListener);
    this.listen(el.host, "keydown", this.onKeyDown as EventListener);
    this.listen(el.host, "blur", this.onBlur);
    // Wheel must be non-passive to stop the page from scrolling while zooming.
    el.host.addEventListener("wheel", this.onWheel, { passive: false });
    this.cleanups.push(() => el.host.removeEventListener("wheel", this.onWheel));
    // Moving the window to a monitor with another scale factor changes devicePixelRatio.
    const onWinResize = () => this.measure();
    window.addEventListener("resize", onWinResize);
    this.cleanups.push(() => window.removeEventListener("resize", onWinResize));
  }

  private listen(target: EventTarget, type: string, fn: EventListener) {
    target.addEventListener(type, fn);
    this.cleanups.push(() => target.removeEventListener(type, fn));
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    this.unsubscribeSync?.();
    if (this.syncId) dropMargin(this.syncId, this.syncToken);
    for (const c of this.cleanups) c();
  }

  // ---------------------------------------------------------------- props

  update(props: PlotProps, hidden: ReadonlySet<string>, themeChanged: boolean): void {
    const first = !this.props;
    this.props = props;
    this.hidden = hidden;
    if (themeChanged || !this.theme) this.theme = readTheme(this.el.host);

    if (props.syncId !== this.syncId) {
      this.unsubscribeSync?.();
      if (this.syncId) dropMargin(this.syncId, this.syncToken);
      this.syncId = props.syncId;
      this.unsubscribeSync = props.syncId ? subscribeSync(props.syncId, this.onSync) : null;
    }

    const propX: Range = [props.xRange[0], props.xRange[1]];
    const xChanged = !sameRange(propX, this.lastPropX ?? undefined);
    const yChanged = !sameRange(props.yRange, this.lastPropY);
    this.lastPropX = propX;
    this.lastPropY = props.yRange ? [props.yRange[0], props.yRange[1]] : undefined;
    // An explicit new range from the app wins over the user's zoom.
    if (xChanged) this.userZoomedX = false;
    if (yChanged) this.userZoomedY = false;

    const homeY = props.yRange ? this.lastPropY! : this.autoY(propX);
    const newHome: PlotView = { x: propX, y: homeY };
    // While a transition runs, the user's view is where it is heading, not the in-between frame.
    const userView = this.currentTarget();
    const target: PlotView = {
      x: this.userZoomedX ? userView.x : newHome.x,
      y: this.userZoomedY ? userView.y : newHome.y,
    };
    this.home = newHome;

    if (first) {
      this.view = target;
    } else if (!sameRange(target.x, this.currentTarget().x) || !sameRange(target.y, this.currentTarget().y)) {
      this.animateTo(target);
    }
    this.reportZoomed();
    this.baseDirty = true;
    this.overlayDirty = true;
    if (first) this.measure();
    this.schedule();
  }

  themeChanged(): void {
    this.theme = readTheme(this.el.host);
    this.baseDirty = this.overlayDirty = true;
    this.schedule();
  }

  private autoY(x: Range): Range {
    let lo = Infinity;
    let hi = -Infinity;
    for (const s of this.props.series) {
      if (this.hidden.has(s.id)) continue;
      const e = extentIn(s.x, s.y, x[0], x[1]);
      if (!e) continue;
      lo = Math.min(lo, e[0]);
      hi = Math.max(hi, e[1]);
    }
    for (const b of this.props.bands ?? []) {
      const a = extentIn(b.x, b.lower, x[0], x[1]);
      const c = extentIn(b.x, b.upper, x[0], x[1]);
      if (a) lo = Math.min(lo, a[0]);
      if (c) hi = Math.max(hi, c[1]);
    }
    if (!(lo <= hi)) return this.home?.y ?? [0, 1];
    const pad = (hi - lo) * 0.06 || 1;
    // Padding must not invent a sign the data never has (|Z| or delay dipping below zero).
    const a = lo >= 0 ? Math.max(0, lo - pad) : lo - pad;
    const b = hi <= 0 ? Math.min(0, hi + pad) : hi + pad;
    return niceDomain(a, b, 6);
  }

  // ---------------------------------------------------------------- view

  private currentTarget(): PlotView {
    return this.anim ? this.anim.to : this.view;
  }

  private animateTo(to: PlotView) {
    if (prefersReducedMotion()) {
      this.view = to;
      this.anim = null;
    } else {
      this.anim = { from: { x: [...this.view.x], y: [...this.view.y] }, to, t0: performance.now() };
    }
    this.baseDirty = this.overlayDirty = true;
    this.schedule();
  }

  private setView(v: PlotView, opts: { user: boolean; animate?: boolean; publish?: boolean }) {
    const xLog = this.props.xLog ?? true;
    const minX = xLog ? MIN_X_SPAN_DEC : (this.home.x[1] - this.home.x[0]) * 0.01;
    const x = clampView(v.x, this.home.x, minX, xLog);
    const homeSpanY = Math.abs(this.home.y[1] - this.home.y[0]) || 1;
    let y = v.y;
    if (y[1] - y[0] < homeSpanY * MIN_Y_SPAN_FRAC) {
      const c = (y[0] + y[1]) / 2;
      y = [c - (homeSpanY * MIN_Y_SPAN_FRAC) / 2, c + (homeSpanY * MIN_Y_SPAN_FRAC) / 2];
    }
    // Never zoom y out beyond ten times home: the curves would collapse to a line.
    if (y[1] - y[0] > homeSpanY * 10) y = this.home.y;
    const next: PlotView = { x, y };
    if (opts.user) {
      this.userZoomedX = !sameRange(x, this.home.x, 1e-6);
      this.userZoomedY = !sameRange(y, this.home.y, 1e-6);
    }
    if (opts.animate) this.animateTo(next);
    else {
      this.anim = null;
      this.view = next;
      this.baseDirty = this.overlayDirty = true;
      this.schedule();
    }
    this.reportZoomed();
    if (opts.publish && this.syncId) {
      publishSync(this.syncId, { source: this.syncToken, kind: "view", view: x, animate: !!opts.animate });
    }
    if (opts.user) this.props.onViewChange?.(next);
  }

  private reportZoomed() {
    const z = this.userZoomedX || this.userZoomedY;
    if (z !== this.zoomedReported) {
      this.zoomedReported = z;
      this.cb.onZoomedChange(z);
    }
  }

  resetView(): void {
    this.setView({ x: this.home.x, y: this.home.y }, { user: true, animate: true, publish: true });
  }

  getView(): PlotView {
    return { x: [...this.currentTarget().x], y: [...this.currentTarget().y] };
  }

  private onSync = (e: SyncEvent) => {
    if (e.source === this.syncToken) return;
    if (e.kind === "margin") {
      this.baseDirty = this.overlayDirty = true;
      this.schedule();
    } else if (e.kind === "hover") {
      this.syncedX = e.x ?? null;
      this.overlayDirty = true;
      this.schedule();
      this.renderCard();
    } else if (e.kind === "view" && e.view) {
      this.setView({ x: e.view, y: this.currentTarget().y }, { user: true, animate: e.animate, publish: false });
      if (!this.userZoomedY && sameRange(e.view, this.home.x, 1e-6)) this.userZoomedX = false;
      this.reportZoomed();
    }
  };

  // ---------------------------------------------------------------- size + paint loop

  private measure() {
    const r = this.el.host.getBoundingClientRect();
    const W = Math.max(1, Math.round(r.width));
    const H = Math.max(1, Math.round(r.height));
    const dpr = window.devicePixelRatio || 1;
    if (W === this.W && H === this.H && dpr === this.dpr) return;
    this.W = W;
    this.H = H;
    this.dpr = dpr;
    for (const c of [this.el.base, this.el.overlay]) {
      c.width = Math.round(W * dpr);
      c.height = Math.round(H * dpr);
      c.style.width = `${W}px`;
      c.style.height = `${H}px`;
    }
    this.baseDirty = this.overlayDirty = true;
    this.schedule();
  }

  private schedule() {
    if (this.raf) return;
    this.raf = requestAnimationFrame(this.tick);
  }

  private tick = (now: number) => {
    this.raf = 0;
    if (!this.props || !this.theme || this.W < 2) return;
    if (this.anim) {
      const t = Math.min(1, (now - this.anim.t0) / ANIM_MS);
      const e = easeOut(t);
      const xLog = this.props.xLog ?? true;
      this.view = {
        x: lerpView(this.anim.from.x, this.anim.to.x, e, xLog),
        y: lerpView(this.anim.from.y, this.anim.to.y, e, false),
      };
      if (t >= 1) {
        this.view = this.anim.to;
        this.anim = null;
      }
      this.baseDirty = this.overlayDirty = true;
    }
    if (this.baseDirty) this.paintBase();
    if (this.overlayDirty) this.paintOverlay();
    if (this.anim) this.schedule();
  };

  private baseInput(): BaseInput {
    const p = this.props;
    return {
      view: this.view,
      xLog: p.xLog ?? true,
      series: p.series,
      hidden: this.hidden,
      bands: p.bands ?? [],
      hBands: p.hBands ?? [],
      vLines: p.vLines ?? [],
      markers: p.markers ?? [],
      probeHz: p.probeHz ?? null,
      yLabel: p.yLabel,
      yUnit: p.yUnit,
      xTickLabels: p.xTickLabels ?? true,
      theme: this.theme!,
    };
  }

  private paintBase() {
    this.baseDirty = false;
    const ctx = this.el.base.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const input = this.baseInput();
    let frame = computeFrame(ctx, this.W, this.H, input);
    if (this.syncId) {
      const shared = reportMargin(this.syncId, this.syncToken, frame.x0);
      if (shared > frame.x0) frame = computeFrame(ctx, this.W, this.H, input, 0, shared);
    }
    this.frame = frame;
    drawBase(ctx, frame, input);
  }

  private hoverState(): HoverState | null {
    if (this.drag?.mode === "pan" && this.drag.moved) return null;
    if (this.pointer && this.frame && this.inPlot(this.pointer.x, this.pointer.y)) {
      return { xHz: this.snap(this.frame.sx.fromPx(this.pointer.x)), pointerY: this.pointer.y };
    }
    if (this.keyboardHover && this.props.probeHz != null) return { xHz: this.props.probeHz, pointerY: null };
    if (this.syncedX != null) return { xHz: this.snap(this.syncedX), pointerY: null };
    return null;
  }

  private paintOverlay() {
    this.overlayDirty = false;
    const ctx = this.el.overlay.getContext("2d");
    if (!ctx || !this.frame) return;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const box =
      this.drag?.mode === "box"
        ? { xa: this.drag.startX, xb: this.drag.x, ya: this.drag.startY, yb: this.drag.y }
        : null;
    drawOverlay(ctx, this.frame, {
      series: this.props.series,
      hidden: this.hidden,
      theme: this.theme!,
      hover: this.hoverState(),
      xLog: this.props.xLog ?? true,
      xTickLabels: this.props.xTickLabels ?? true,
      yDecimals: this.frame.yDecimals,
      box,
    });
    this.renderCard();
  }

  // ---------------------------------------------------------------- readout card

  private visibleListed(): PlotSeries[] {
    return this.props.series.filter((s) => !this.hidden.has(s.id) && !s.quiet && s.label);
  }

  /** Snap a frequency to the nearest sample of the first visible series (the reference grid). */
  private snap(fHz: number): number {
    const ref = this.props.series.find((s) => !this.hidden.has(s.id) && s.x.length > 0);
    if (!ref) return fHz;
    const i = nearestIndex(ref.x, fHz, this.props.xLog ?? true);
    return ref.x[i];
  }

  private formatValue(s: PlotSeries, v: number, xHz: number): string {
    if (this.props.tooltipFormat) return this.props.tooltipFormat(v, s, xHz);
    const unit = s.unit ?? this.props.yUnit ?? "";
    const dec = Math.min(3, (this.frame?.yDecimals ?? 0) + 1);
    return unit ? `${formatNumber(v, dec)} ${unit}` : formatNumber(v, dec);
  }

  private renderCard() {
    const card = this.el.card;
    const hv = this.frame ? this.hoverState() : null;
    const rows = hv ? this.visibleListed() : [];
    if (!hv || !this.frame || rows.length === 0) {
      card.dataset.open = "false";
      return;
    }
    const X = this.frame.sx.toPx(hv.xHz);
    if (X < this.frame.x0 - 1 || X > this.frame.x1 + 1) {
      card.dataset.open = "false";
      return;
    }
    const xLog = this.props.xLog ?? true;
    const frag = document.createDocumentFragment();
    const head = document.createElement("div");
    head.className = "chart-card__head";
    const fEl = document.createElement("span");
    fEl.className = "chart-card__freq";
    fEl.textContent = xLog ? formatHz(hv.xHz) : formatNumber(hv.xHz, 2);
    head.append(fEl);
    if (this.props.onProbe && this.pointer && !this.keyboardHover) {
      const hint = document.createElement("span");
      hint.className = "chart-card__hint";
      hint.textContent = "click to probe";
      head.append(hint);
    }
    frag.append(head);
    // In the plot under the pointer, the curve nearest the pointer gets the emphasised row.
    let activeId: string | null = null;
    if (hv.pointerY != null) {
      let best = 14; // px: farther than this from every curve means none is active
      for (const s of rows) {
        const i = nearestIndex(s.x, hv.xHz, xLog);
        const v = i >= 0 ? s.y[i] : NaN;
        if (!Number.isFinite(v)) continue;
        const dist = Math.abs(this.frame.sy.toPx(v) - hv.pointerY);
        if (dist < best) {
          best = dist;
          activeId = s.id;
        }
      }
    }
    for (const s of rows) {
      const i = nearestIndex(s.x, hv.xHz, xLog);
      const v = i >= 0 ? s.y[i] : NaN;
      const row = document.createElement("div");
      row.className = "chart-card__row";
      if (s.id === activeId) row.dataset.active = "true";
      const sw = document.createElement("i");
      sw.style.setProperty("--swatch", cssColor(s.color));
      if (s.dash?.length) sw.dataset.dashed = "true";
      const name = document.createElement("span");
      name.textContent = s.label!;
      const val = document.createElement("b");
      val.textContent = Number.isFinite(v) ? this.formatValue(s, v, hv.xHz) : "—";
      row.append(sw, name, val);
      frag.append(row);
    }
    card.replaceChildren(frag);
    card.dataset.open = "true";
    // Place beside the crosshair, flipping to the left near the right edge.
    const cw = card.offsetWidth || 160;
    const ch = card.offsetHeight || 60;
    const left = X + 14 + cw > this.W - 4 ? X - 14 - cw : X + 14;
    let top = this.frame.y0 + 26;
    if (hv.pointerY != null && hv.pointerY < top + ch + 8 && hv.pointerY > top - 8) {
      top = Math.min(this.frame.y1 - ch - 4, hv.pointerY + 16);
    }
    card.style.transform = `translate(${Math.round(Math.max(2, left))}px, ${Math.round(Math.max(2, top))}px)`;
  }

  // ---------------------------------------------------------------- pointer

  private local(e: PointerEvent | WheelEvent | MouseEvent) {
    const r = this.el.host.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private inPlot(x: number, y: number): boolean {
    const f = this.frame;
    return !!f && x >= f.x0 && x <= f.x1 && y >= f.y0 && y <= f.y1;
  }

  private nearProbe(x: number): boolean {
    const p = this.props.probeHz;
    if (p == null || !this.frame || !this.props.onProbe) return false;
    return Math.abs(this.frame.sx.toPx(p) - x) <= PROBE_GRAB_PX;
  }

  private publishHover(x: number | null) {
    if (this.syncId) publishSync(this.syncId, { source: this.syncToken, kind: "hover", x });
  }

  private setCursor(c: string) {
    if (this.el.host.style.cursor !== c) this.el.host.style.cursor = c;
  }

  private onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    const p = this.local(e);
    if (!this.inPlot(p.x, p.y)) return;
    this.el.host.setPointerCapture(e.pointerId);
    if (e.shiftKey) {
      this.drag = { mode: "box", startX: p.x, startY: p.y, x: p.x, y: p.y, pointerId: e.pointerId };
    } else if (this.nearProbe(p.x)) {
      this.drag = { mode: "probe", pointerId: e.pointerId };
      this.setCursor("ew-resize");
    } else {
      this.drag = {
        mode: "pan",
        startX: p.x,
        startY: p.y,
        view: { x: [...this.currentTarget().x], y: [...this.currentTarget().y] },
        moved: false,
        pointerId: e.pointerId,
      };
    }
    e.preventDefault();
    // preventDefault above also stops the native focus-on-click; focus by hand, without the
    // keyboard focus ring (focusVisible is ignored where unsupported).
    this.el.host.focus({ preventScroll: true, focusVisible: false } as FocusOptions);
  };

  private onPointerMove = (e: PointerEvent) => {
    const p = this.local(e);
    this.pointer = p;
    this.keyboardHover = false;
    const d = this.drag;
    if (d?.mode === "pan") {
      const dx = p.x - d.startX;
      const dy = p.y - d.startY;
      if (!d.moved && Math.hypot(dx, dy) > CLICK_SLOP_PX) d.moved = true;
      if (d.moved && this.frame) {
        this.setCursor("grabbing");
        const f = this.frame;
        const xLog = this.props.xLog ?? true;
        const x = panBy(d.view.x, dx, f.x1 - f.x0, xLog);
        // Dragging up moves content up: y is inverted on screen.
        const y = panBy(d.view.y, -dy, f.y1 - f.y0, false);
        this.setView({ x, y }, { user: true, publish: true });
      }
    } else if (d?.mode === "box") {
      if (this.frame) {
        d.x = Math.min(Math.max(p.x, this.frame.x0), this.frame.x1);
        d.y = Math.min(Math.max(p.y, this.frame.y0), this.frame.y1);
      }
    } else if (d?.mode === "probe") {
      if (this.frame) {
        const x = Math.min(Math.max(p.x, this.frame.x0), this.frame.x1);
        this.props.onProbe?.(this.snap(this.frame.sx.fromPx(x)));
      }
    } else {
      this.setCursor(this.inPlot(p.x, p.y) ? (this.nearProbe(p.x) ? "ew-resize" : "crosshair") : "default");
    }
    if (this.frame) {
      const inside = this.inPlot(p.x, p.y);
      this.publishHover(inside ? this.snap(this.frame.sx.fromPx(p.x)) : null);
    }
    this.overlayDirty = true;
    this.schedule();
  };

  private onPointerUp = (e: PointerEvent) => {
    const d = this.drag;
    this.drag = null;
    if (this.el.host.hasPointerCapture(e.pointerId)) this.el.host.releasePointerCapture(e.pointerId);
    if (!d || !this.frame || e.type === "pointercancel") {
      this.overlayDirty = true;
      this.schedule();
      return;
    }
    const f = this.frame;
    if (d.mode === "pan" && !d.moved && this.props.onProbe) {
      const p = this.local(e);
      this.props.onProbe(this.snap(f.sx.fromPx(p.x)));
    } else if (d.mode === "box") {
      const w = Math.abs(d.x - d.startX);
      const h = Math.abs(d.y - d.startY);
      if (w > 6) {
        const xs = [f.sx.fromPx(Math.min(d.startX, d.x)), f.sx.fromPx(Math.max(d.startX, d.x))] as Range;
        // A flat drag zooms x only; a tall one zooms y too.
        const ys: Range =
          h > 6 ? [f.sy.fromPx(Math.max(d.startY, d.y)), f.sy.fromPx(Math.min(d.startY, d.y))] : this.currentTarget().y;
        this.setView({ x: xs, y: ys }, { user: true, animate: true, publish: true });
      }
    }
    this.setCursor("crosshair");
    this.overlayDirty = true;
    this.schedule();
  };

  private onPointerLeave = () => {
    if (this.drag) return;
    this.pointer = null;
    this.publishHover(null);
    this.overlayDirty = true;
    this.schedule();
  };

  private onDoubleClick = (e: MouseEvent) => {
    const p = this.local(e);
    if (!this.inPlot(p.x, p.y)) return;
    this.resetView();
  };

  private onWheel = (e: WheelEvent) => {
    const p = this.local(e);
    if (!this.frame || !this.inPlot(p.x, p.y)) return;
    e.preventDefault();
    const f = this.frame;
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
    const xLog = this.props.xLog ?? true;
    const cur = this.currentTarget();
    // A horizontal trackpad swipe pans; vertical wheel zooms.
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY) && !e.ctrlKey) {
      this.setView({ x: panBy(cur.x, -e.deltaX * unit, f.x1 - f.x0, xLog), y: cur.y }, { user: true, publish: true });
      return;
    }
    const factor = Math.exp(Math.max(-1, Math.min(1, e.deltaY * unit * 0.0016)));
    if (e.ctrlKey || e.metaKey) {
      const c = f.sy.fromPx(p.y);
      this.setView({ x: cur.x, y: zoomAt(cur.y, c, factor, false) }, { user: true });
    } else {
      const c = f.sx.fromPx(p.x);
      this.setView({ x: zoomAt(cur.x, c, factor, xLog), y: cur.y }, { user: true, publish: true });
    }
  };

  // ---------------------------------------------------------------- keyboard

  private onKeyDown = (e: KeyboardEvent) => {
    const xLog = this.props.xLog ?? true;
    const cur = this.currentTarget();
    const ref = this.props.series.find((s) => !this.hidden.has(s.id) && s.x.length > 0);
    const center = xLog ? Math.sqrt(cur.x[0] * cur.x[1]) : (cur.x[0] + cur.x[1]) / 2;
    const probe = this.props.probeHz ?? center;
    let next: number | null = null;
    switch (e.key) {
      case "ArrowLeft":
      case "ArrowRight": {
        const dir = e.key === "ArrowRight" ? 1 : -1;
        if (e.shiftKey || !ref) {
          // Third-octave steps (or 2 % on a linear axis).
          next = xLog ? probe * 2 ** (dir / 3) : probe + dir * (cur.x[1] - cur.x[0]) * 0.02;
        } else {
          const i = nearestIndex(ref.x, probe, xLog);
          next = ref.x[Math.min(ref.x.length - 1, Math.max(0, i + dir))];
        }
        break;
      }
      case "Home":
        next = cur.x[0];
        break;
      case "End":
        next = cur.x[1];
        break;
      case "+":
      case "=":
        this.setView({ x: zoomAt(cur.x, probe, 0.7, xLog), y: cur.y }, { user: true, animate: true, publish: true });
        break;
      case "-":
      case "_":
        this.setView({ x: zoomAt(cur.x, probe, 1 / 0.7, xLog), y: cur.y }, { user: true, animate: true, publish: true });
        break;
      case "0":
      case "Escape":
        if (this.userZoomedX || this.userZoomedY) this.resetView();
        else return;
        break;
      default:
        return;
    }
    // A read-only plot leaves the arrow keys to the page.
    if (next != null && !this.props.onProbe) return;
    e.preventDefault();
    if (next != null && this.props.onProbe) {
      const clamped = Math.min(this.home.x[1], Math.max(this.home.x[0], next));
      const snapped = e.shiftKey || !ref ? clamped : this.snap(clamped);
      this.props.onProbe(snapped);
      this.keyboardHover = true;
      this.pointer = null;
      // Keep the probe in view: slide the window if it walked off the edge.
      if (snapped < cur.x[0] || snapped > cur.x[1]) {
        const span = xLog ? cur.x[1] / cur.x[0] : cur.x[1] - cur.x[0];
        const x: Range = xLog
          ? snapped < cur.x[0] ? [snapped, snapped * span] : [snapped / span, snapped]
          : snapped < cur.x[0] ? [snapped, snapped + span] : [snapped - span, snapped];
        this.setView({ x, y: cur.y }, { user: true, animate: true, publish: true });
      }
      this.announce(snapped);
      this.overlayDirty = true;
      this.schedule();
    }
  };

  private onBlur = () => {
    this.keyboardHover = false;
    this.overlayDirty = true;
    this.schedule();
  };

  private announce(xHz: number) {
    const xLog = this.props.xLog ?? true;
    const parts = this.visibleListed().map((s) => {
      const i = nearestIndex(s.x, xHz, xLog);
      return `${s.label} ${i >= 0 && Number.isFinite(s.y[i]) ? this.formatValue(s, s.y[i], xHz) : "no data"}`;
    });
    this.el.live.textContent = `Probe ${formatHz(xHz)}${parts.length ? ": " + parts.join(", ") : ""}`;
  }

  // ---------------------------------------------------------------- export

  async exportPNG(scale = 2, title?: string): Promise<Uint8Array> {
    const canvas = document.createElement("canvas");
    const W = this.W;
    const H = this.H + 18; // room for the in-image legend
    canvas.width = Math.round(W * scale);
    canvas.height = Math.round(H * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D is not available");
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    const input: BaseInput = { ...this.baseInput(), view: this.currentTarget(), exportChrome: { title } };
    const frame = computeFrame(ctx, W, H, input, 18);
    drawBase(ctx, frame, input);
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/png"));
    if (!blob) throw new Error("PNG encoding failed");
    return new Uint8Array(await blob.arrayBuffer());
  }
}
