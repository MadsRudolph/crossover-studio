import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import { fmtSig, parseNumber, UNIT_SPACE } from "./format";

export interface SliderProps {
  value: number;
  min: number;
  max: number;
  /** Logarithmic travel (frequencies). min must be > 0. */
  log?: boolean;
  /** Snap to multiples of this (in value units). */
  step?: number;
  /** Fires continuously while dragging or typing arrows: preview, no undo step. */
  onInput(value: number): void;
  /** Fires once when the gesture ends (pointer up, key up, Enter): commit one undo step. */
  onCommit(value: number): void;
  /** Double-click the track to return here. */
  defaultValue?: number;
  /** Display unit shown after the readout, e.g. "Hz", "dB", "mm". */
  unit?: string;
  /** Display value = value × scale (e.g. 1000 to show metres as mm). */
  scale?: number;
  /** Decimals of the readout when no `format` is given. */
  digits?: number;
  /** Full readout text, overriding unit/scale/digits (e.g. fmtFreq). */
  format?(value: number): string;
  /** Parses what the person typed into the readout back into a value. */
  parse?(text: string): number | null;
  /** A recommended range shown as a soft band on the rail. */
  band?: [number, number];
  /** Tick marks under the rail. */
  marks?: number[];
  /** Fill starts here instead of at min (e.g. 0 dB for a gain). */
  origin?: number;
  /** Colour of the fill and thumb, a CSS colour (token). Defaults to the accent. */
  color?: string;
  label: string;
  disabled?: boolean;
  /** Hide the numeric readout (e.g. when the caller shows its own). */
  hideReadout?: boolean;
  className?: string;
  id?: string;
}

const clamp01 = (t: number) => Math.min(1, Math.max(0, t));

/**
 * The workhorse control: drag for coarse, hold Shift for fine (1/10 speed), double-click to reset,
 * arrows step (Shift = fine, PageUp/Down = coarse), click the readout to type a value.
 */
export function Slider(props: SliderProps) {
  const { value, min, max, log, step, onInput, onCommit, defaultValue, unit, scale = 1, digits, format, parse,
          band, marks, origin, color, label, disabled, hideReadout, className, id } = props;

  const toT = (v: number) => clamp01(log ? Math.log(v / min) / Math.log(max / min) : (v - min) / (max - min));
  const fromT = (t: number) => {
    let v = log ? min * (max / min) ** clamp01(t) : min + clamp01(t) * (max - min);
    if (step) v = Math.round(v / step) * step;
    // round away float noise so 0.1 + 0.2 does not show as 0.30000000000000004
    v = Number(v.toPrecision(10));
    return Math.min(max, Math.max(min, v));
  };

  const track = useRef<HTMLDivElement>(null);
  const drag = useRef<{ t: number; x: number; id: number; moved: boolean } | null>(null);
  const live = useRef(value);
  const [dragging, setDragging] = useState(false);
  live.current = value;

  const emit = (v: number) => { if (v !== live.current) { live.current = v; onInput(v); } };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (disabled || e.button !== 0) return;
    const el = track.current!;
    const r = el.getBoundingClientRect();
    const onThumb = (e.target as HTMLElement).classList.contains("cs-slider-thumb");
    const t = onThumb ? toT(value) : clamp01((e.clientX - r.left) / r.width);
    drag.current = { t, x: e.clientX, id: e.pointerId, moved: false };
    el.setPointerCapture(e.pointerId);
    el.querySelector<HTMLElement>(".cs-slider-thumb")?.focus({ preventScroll: true });
    setDragging(true);
    if (!onThumb) emit(fromT(t));
    e.preventDefault();
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const w = track.current!.getBoundingClientRect().width || 1;
    // accumulate deltas so pressing Shift mid-drag continues smoothly from where the thumb is
    d.t = clamp01(d.t + ((e.clientX - d.x) / w) * (e.shiftKey ? 0.1 : 1));
    d.x = e.clientX;
    d.moved = true;
    emit(fromT(d.t));
  };
  const endDrag = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    setDragging(false);
    onCommit(live.current);
  };

  const keyStep = (e: KeyboardEvent) => {
    const fine = e.shiftKey ? 0.001 : 0.01;
    const minStepT = step ? Math.abs(toT(Math.min(max, min + step)) - toT(min)) || fine : fine;
    const dt = Math.max(minStepT, fine);
    switch (e.key) {
      case "ArrowRight": case "ArrowUp": return dt;
      case "ArrowLeft": case "ArrowDown": return -dt;
      case "PageUp": return 0.1;
      case "PageDown": return -0.1;
      case "Home": return -1;
      case "End": return 1;
    }
    return 0;
  };
  // the readout is not a tab stop of its own: Enter on the thumb types a value (one stop per slider)
  const [editTick, setEditTick] = useState(0);
  const thumb = useRef<HTMLDivElement>(null);
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    if (e.key === "Enter" && !hideReadout) { e.preventDefault(); setEditTick(n => n + 1); return; }
    const dt = keyStep(e);
    if (!dt) return;
    e.preventDefault();
    let v = fromT(toT(live.current) + dt);
    // with a coarse step the rounding can land back on the same value: force at least one step
    if (v === live.current && step) v = Math.min(max, Math.max(min, live.current + Math.sign(dt) * step));
    emit(v);
  };
  const onKeyUp = (e: KeyboardEvent<HTMLDivElement>) => { if (keyStep(e)) onCommit(live.current); };

  const reset = () => {
    if (disabled || defaultValue === undefined) return;
    live.current = NaN;
    emit(defaultValue);
    onCommit(defaultValue);
  };

  const text = format ? format(value) : fmtNum(value * scale, digits) + (unit ? UNIT_SPACE + unit : "");
  const t = toT(value);
  const t0 = origin !== undefined ? toT(origin) : 0;
  const style = { "--slider-color": color ?? "var(--accent)" } as CSSProperties;

  return (
    <div className={`cs-slider${dragging ? " is-dragging" : ""}${disabled ? " is-disabled" : ""}${className ? " " + className : ""}`} style={style}>
      <div
        ref={track}
        className="cs-slider-track"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onDoubleClick={reset}
      >
        <div className="cs-slider-rail">
          {band && (
            <div className="cs-slider-band" style={{ left: `${toT(band[0]) * 100}%`, width: `${(toT(band[1]) - toT(band[0])) * 100}%` }} />
          )}
          <div className="cs-slider-fill" style={{ left: `${Math.min(t, t0) * 100}%`, width: `${Math.abs(t - t0) * 100}%` }} />
        </div>
        {marks?.map(m => <span key={m} className="cs-slider-mark" style={{ left: `${toT(m) * 100}%` }} />)}
        <div
          id={id}
          ref={thumb}
          className="cs-slider-thumb"
          role="slider"
          tabIndex={disabled ? -1 : 0}
          aria-label={label}
          aria-keyshortcuts={hideReadout ? undefined : "Enter"}
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuenow={value}
          aria-valuetext={text}
          aria-disabled={disabled || undefined}
          style={{ left: `${t * 100}%` }}
          onKeyDown={onKeyDown}
          onKeyUp={onKeyUp}
        />
      </div>
      {!hideReadout && (
        <Readout
          text={text}
          disabled={disabled}
          label={label}
          editTick={editTick}
          onDone={() => thumb.current?.focus()}
          editValue={format ? stripUnit(text) : fmtNum(value * scale, digits)}
          onSubmit={s => {
            const v = parse ? parse(s) : (() => { const n = parseNumber(s, unit); return n === null ? null : n / scale; })();
            if (v === null || !Number.isFinite(v)) return false;
            const c = Math.min(max, Math.max(min, step ? Math.round(v / step) * step : v));
            live.current = NaN;
            emit(c);
            onCommit(c);
            return true;
          }}
        />
      )}
    </div>
  );
}

function fmtNum(x: number, digits?: number): string {
  if (digits !== undefined) return x.toFixed(digits).replace(/^-/, "−");
  return fmtSig(x, 3);
}

/** "1.45 kHz" -> "1.45 kHz" is fine to edit as is; only plain spacing is normalised. */
function stripUnit(s: string) {
  return s.replace(/ /g, " ");
}

/** The number at the end of a slider row. Click (or Enter) to type a value; Esc cancels. */
function Readout({ text, editValue, onSubmit, disabled, label, editTick, onDone }:
  { text: string; editValue: string; onSubmit(s: string): boolean; disabled?: boolean; label: string;
    /** Increments when the thumb asks for typing (Enter). */ editTick: number; /** Typing ended from the keyboard. */ onDone(): void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [bad, setBad] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  // Enter/Escape end the edit before the input unmounts; the blur that follows must not submit again
  const closed = useRef(false);
  useEffect(() => { if (editing) { closed.current = false; input.current?.select(); } }, [editing]);
  useEffect(() => { if (editTick > 0 && !disabled) { setDraft(editValue); setEditing(true); } }, [editTick]); // eslint-disable-line react-hooks/exhaustive-deps

  if (editing) {
    const done = (save: boolean) => {
      if (closed.current) return;
      if (save && !onSubmit(draft)) { setBad(true); input.current?.select(); return; }
      closed.current = true;
      setEditing(false);
      setBad(false);
    };
    return (
      <input
        ref={input}
        className={"cs-slider-input mono" + (bad ? " is-bad" : "")}
        value={draft}
        aria-label={`${label} value`}
        onChange={e => { setDraft(e.target.value); setBad(false); }}
        onKeyDown={e => {
          if (e.key === "Enter") { e.preventDefault(); done(true); if (closed.current) onDone(); }
          if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); done(false); onDone(); }
        }}
        onBlur={() => {
          // leaving the field keeps a valid draft and silently drops an invalid one
          if (closed.current) return;
          onSubmit(draft);
          closed.current = true;
          setEditing(false);
          setBad(false);
        }}
      />
    );
  }
  return (
    <button
      type="button"
      className="cs-slider-readout mono"
      disabled={disabled}
      tabIndex={-1}
      aria-label={`${label}: ${text}. Click, or press Enter on the slider, to type a value`}
      onClick={() => { setDraft(editValue); setEditing(true); }}
    >
      {text}
    </button>
  );
}
