// Live 2D front view of the system as described in step 3: woofer box with driver and vents, top box with
// midrange and tweeter. Drawn to scale in SVG with the driver colours, so a wrong number shows at once.
import type { UnitId } from "../../types";
import type { DraftSystem } from "../build";

export function LayoutSketch({ system }: { system: DraftSystem }) {
  const wb = system.woofer_box, tb = system.top_box;
  const W = wb.inner_m[0] + 2 * wb.wall_m, H = wb.inner_m[1] + 2 * wb.wall_m;
  const tw = tb.outer_m[0], th = tb.outer_m[1], tx = tb.offset_x_m;
  const ok = [W, H, tw, th].every(v => Number.isFinite(v) && v > 0);
  if (!ok) return <div className="wz-sketch is-empty">Enter the box sizes to see the layout.</div>;

  // world: metres, x right, y up from the floor; padding for labels
  const left = Math.min(-W / 2, tx - tw / 2), right = Math.max(W / 2, tx + tw / 2);
  const top = H + th, pad = 0.04 * Math.max(right - left, top);
  const vb = [left - pad, -top - pad, right - left + 2 * pad, top + 2 * pad + 0.05].map(v => +v.toFixed(4));
  const Y = (y: number) => -y;   // SVG y grows downward
  const driver = (u: UnitId, x: number, y: number) => {
    const d = system.units[u].diameter_m, f = system.units[u].frame_diameter_m;
    return (
      <g key={u} className={`wz-sk-driver is-${u}`}>
        {f > 0 && <circle cx={x} cy={Y(y)} r={f / 2} className="wz-sk-frame" />}
        {d > 0 && <circle cx={x} cy={Y(y)} r={d / 2} className="wz-sk-cone" strokeWidth={0.002} />}
        {system.units[u].kind === "dome" && d > 0 && <circle cx={x} cy={Y(y)} r={d / 4} className="wz-sk-cap" />}
      </g>
    );
  };
  const mm = (v: number) => `${Math.round(v * 1000)}`;
  const stroke = Math.max(right - left, top) / 260;

  return (
    <svg className="wz-sketch" viewBox={vb.join(" ")} role="img" style={{ ["--sk-stroke" as string]: `${stroke}px` }}
         aria-label={`Front view: woofer box ${mm(W)} by ${mm(H)} mm, top box ${mm(tw)} by ${mm(th)} mm offset ${mm(tx)} mm`}>
      <line x1={vb[0]} x2={vb[0] + vb[2]} y1={0} y2={0} className="wz-sk-floor" />
      <rect x={-W / 2} y={Y(H)} width={W} height={H} rx={0.006} className="wz-sk-box" />
      <rect x={tx - tw / 2} y={Y(H + th)} width={tw} height={th} rx={0.006} className="wz-sk-box is-top" />
      {wb.vents.map((v, i) => {
        const p = wb.vent_pos_m[i];
        return p ? <circle key={v.id} cx={p[0]} cy={Y(p[1])} r={v.diameter_m / 2} className={`wz-sk-vent${v.estimated ? " is-estimated" : ""}`} /> : null;
      })}
      {driver("woof", wb.driver_pos_m[0], wb.driver_pos_m[1])}
      {driver("mid", tx + tb.mid_pos_m[0], H + tb.mid_pos_m[1])}
      {driver("tw", tx + tb.tw_pos_m[0], H + tb.tw_pos_m[1])}
      <text x={0} y={0.035} className="wz-sk-dim" textAnchor="middle" fontSize={0.026}>{mm(W)} × {mm(H)} mm</text>
    </svg>
  );
}
