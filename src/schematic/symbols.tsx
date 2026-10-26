// IEC-style schematic symbols, drawn in local coordinates along +x from 0 to `len` with the
// conductor on y = 0. Callers place them with a transform (rotate(90) for shunt parts), so one
// drawing serves both orientations. Strokes use CSS classes, colours come from the theme tokens.
import type { PartKind } from "./edits";

/** Inductor: three or four half-turn arcs (the IEC/ANSI coil), bulging to −y (up when horizontal). */
function Coil({ len }: { len: number }) {
  // short coils (shunt parts in the compact chain) keep readable humps with one turn fewer
  const turns = len < 26 ? 3 : 4, lead = len * 0.08, r = (len - 2 * lead) / (2 * turns);
  const arcs = Array.from({ length: turns }, () => `a${r},${r} 0 0 1 ${2 * r},0`).join(" ");
  return <path className="sc-sym" d={`M0,0 h${lead} ${arcs} h${lead}`} />;
}

/** Capacitor: two plates across the conductor. */
function Plates({ len }: { len: number }) {
  const mid = len / 2, gap = Math.max(2.5, len * 0.075), h = Math.min(11, Math.max(7, len * 0.24));
  return (
    <>
      <path className="sc-lead" d={`M0,0 H${mid - gap} M${mid + gap},0 H${len}`} />
      <path className="sc-sym sc-plate" d={`M${mid - gap},${-h} V${h} M${mid + gap},${-h} V${h}`} />
    </>
  );
}

/** Resistor: the IEC rectangle. */
function Box({ len }: { len: number }) {
  const body = len * 0.62, x0 = (len - body) / 2, h = Math.min(5.5, Math.max(4, len * 0.12));
  return (
    <>
      <path className="sc-lead" d={`M0,0 H${x0} M${x0 + body},0 H${len}`} />
      <rect className="sc-sym sc-body" x={x0} y={-h} width={body} height={2 * h} rx={1} />
    </>
  );
}

export function PartSymbol({ kind, len }: { kind: PartKind; len: number }) {
  return kind === "L" ? <Coil len={len} /> : kind === "C" ? <Plates len={len} /> : <Box len={len} />;
}

/** Signal ground: three bars, the top one at (x, y). */
export function Ground({ x, y, scale = 1 }: { x: number; y: number; scale?: number }) {
  const k = scale;
  return <path className="sc-ground" d={`M${x - 7 * k},${y} H${x + 7 * k} M${x - 4.5 * k},${y + 3.5 * k} H${x + 4.5 * k} M${x - 2 * k},${y + 7 * k} H${x + 2 * k}`} />;
}

/** Amplifier: a triangle pointing right, input at (x, y), output at (x + w, y). */
export function Amp({ x, y, w }: { x: number; y: number; w: number }) {
  const h = w * 0.9;
  return <path className="sc-amp" d={`M${x},${y - h / 2} L${x + w},${y} L${x},${y + h / 2} Z`} />;
}

/** Loudspeaker: magnet block and cone, input terminal at (x, y). */
export function Speaker({ x, y, size = 1 }: { x: number; y: number; size?: number }) {
  const m = 8 * size, c = 18 * size, d = 15 * size;
  return (
    <>
      <rect className="sc-spk sc-spk-magnet" x={x} y={y - m} width={m} height={2 * m} rx={1} />
      <path className="sc-spk sc-spk-cone" d={`M${x + m},${y - m} L${x + m + d},${y - c} V${y + c} L${x + m},${y + m} Z`} />
    </>
  );
}

/** Signal source: a circle with one sine period. */
export function Source({ x, y }: { x: number; y: number }) {
  return (
    <>
      <circle className="sc-src" cx={x} cy={y} r={9} />
      <path className="sc-src-wave" d={`M${x - 5.5},${y} q2.75,-6 5.5,0 t5.5,0`} />
    </>
  );
}

/** Tiny response curve inside the MiniDSP block: a low-pass falls on the right, a high-pass rises from the left. */
export function FilterGlyph({ x, y, kind, small }: { x: number; y: number; kind: "LP" | "HP"; small?: boolean }) {
  const k = small ? 0.72 : 1;
  const d = kind === "LP" ? `M${x},${y - 3 * k} H${x + 9 * k} Q${x + 14 * k},${y - 3 * k} ${x + 20 * k},${y + 6 * k}`
                          : `M${x},${y + 6 * k} Q${x + 6 * k},${y - 3 * k} ${x + 11 * k},${y - 3 * k} H${x + 20 * k}`;
  return (
    <>
      <rect className="sc-glyph-well" x={x - 3 * k} y={y - 8 * k} width={26 * k} height={18 * k} rx={3} />
      <path className="sc-glyph" d={d} />
    </>
  );
}
