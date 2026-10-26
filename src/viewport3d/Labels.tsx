// Driver callouts: a hairline leader from the driver rim to a label with the unit's level at the probe.
// The leaders live in the scene; the labels are plain DOM in an overlay above the canvas, moved every frame by
// projecting their 3D anchors. DOM keeps them crisp at any DPI and lets them use the theme tokens directly.

import { useEffect, useRef, type MutableRefObject } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Line } from "@react-three/drei";
import * as THREE from "three";
import { UNIT_IDS, type UnitId } from "../types";
import type { SceneLayout, Vec3 } from "./layout";
import type { ProbeState } from "./physics";
import { fmtFixed } from "../ui/format";

const NAMES: Record<UnitId, string> = { woof: "Woofer", mid: "Midrange", tw: "Tweeter" };

export interface LabelGeometry { rim: Vec3; knee: Vec3; anchor: Vec3; side: 1 | -1 }

/** DOM nodes of the labels, filled by the overlay and positioned by the projector inside the canvas. */
export type LabelNodes = MutableRefObject<Partial<Record<UnitId, HTMLDivElement | null>>>;

/** Where each callout sits: mid and tweeter on the free side above the woofer box, the woofer on the other. */
export function labelGeometry(layout: SceneLayout): Record<UnitId, LabelGeometry> {
  const out = {} as Record<UnitId, LabelGeometry>;
  const half = layout.woofer.size[0] / 2;
  for (const u of UNIT_IDS) {
    const d = layout.drivers[u];
    const side: 1 | -1 = u === "woof" ? (-layout.freeSide as 1 | -1) : layout.freeSide;
    const lift = u === "tw" ? 0.05 : u === "mid" ? -0.01 : d.frameR * 0.75;
    const z = layout.frontZ + 0.012;
    const x = side * (half + 0.07);
    const anchor: Vec3 = [x, d.pos[1] + lift, z];
    const ang = Math.atan2(anchor[1] - d.pos[1], anchor[0] - d.pos[0]);
    const rim: Vec3 = [d.pos[0] + Math.cos(ang) * (d.frameR + 0.008), d.pos[1] + Math.sin(ang) * (d.frameR + 0.008), z];
    const knee: Vec3 = [x - side * 0.035, anchor[1], z];
    out[u] = { rim, knee, anchor, side };
  }
  return out;
}

/** In-scene part: leader lines, rim dots, and the per-frame projection of the DOM labels. */
export function LabelLeaders({ layout, probe, colors, hovered, focused, nodes }: {
  layout: SceneLayout; probe: ProbeState | null; colors: Record<UnitId, string>;
  hovered: UnitId | null; focused: UnitId | null; nodes: LabelNodes;
}) {
  const geo = labelGeometry(layout);
  const camera = useThree(s => s.camera);
  const size = useThree(s => s.size);
  const v = useRef(new THREE.Vector3()).current;
  const group = useRef<THREE.Group>(null);
  // Overlay layer (see Scene): leaders cast no contact shadow. drei's Line rebuilds its object, so re-apply.
  useEffect(() => { group.current?.traverse(o => o.layers.set(1)); });

  useFrame(() => {
    for (const u of UNIT_IDS) {
      const el = nodes.current[u];
      if (!el) continue;
      v.set(...geo[u].anchor).project(camera);
      const behind = v.z > 1;
      el.style.visibility = behind ? "hidden" : "visible";
      el.style.transform = `translate3d(${((v.x + 1) / 2) * size.width}px, ${((1 - v.y) / 2) * size.height}px, 0)`;
    }
  });

  return (
    <group ref={group}>
      {UNIT_IDS.map(u => {
        const g = geo[u], p = probe?.units[u];
        const active = hovered === u || focused === u;
        const quiet = !p || p.relDb < -30;
        return (
          <group key={u}>
            <Line points={[g.rim, g.knee, g.anchor]} color={colors[u]} lineWidth={active ? 1.6 : 1.1}
              transparent opacity={quiet ? 0.35 : active ? 0.95 : 0.7} depthWrite={false} />
            <mesh position={g.rim}>
              <circleGeometry args={[0.0035, 20]} />
              <meshBasicMaterial color={colors[u]} toneMapped={false} />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}

/** Level re the system level (as the probe card); far below it reads as "off" rather than a meaningless -150 dB. */
const fmtDb = (x: number) => (x < -60 ? "< −60" : fmtFixed(x, 1, true));

/** DOM part, rendered over the canvas. */
export function LabelOverlay({ layout, probe, hovered, focused, nodes, onHover, onSelect }: {
  layout: SceneLayout; probe: ProbeState | null; hovered: UnitId | null; focused: UnitId | null; nodes: LabelNodes;
  onHover(u: UnitId | null): void; onSelect(u: UnitId): void;
}) {
  const geo = labelGeometry(layout);
  return (
    <div className="v3d-labels">
      {UNIT_IDS.map(u => {
        const p = probe?.units[u], unit = layout.drivers[u].unit;
        const active = hovered === u || focused === u;
        const quiet = !p || p.relDb < -30;
        return (
          <div key={u} className="v3d-label-pin" ref={el => { nodes.current[u] = el; }}>
            <div className={`v3d-callout ${geo[u].side < 0 ? "is-left" : "is-right"}`}>
              <button
                type="button"
                className={`v3d-label${active ? " is-active" : ""}${quiet ? " is-quiet" : ""}`}
                style={{ ["--c" as string]: `var(--${u})` }}
                onPointerEnter={() => onHover(u)} onPointerLeave={() => onHover(null)}
                onFocus={() => onHover(u)} onBlur={() => onHover(null)}
                onClick={() => onSelect(u)}
                aria-label={`${NAMES[u]}, ${unit.label}${p ? `, ${fmtDb(p.relDb)} dB relative to the system level` : ""}. Open in the inspector`}
              >
                <span className="v3d-label-dot" aria-hidden />
                <span className="v3d-label-name">{NAMES[u]}</span>
                <span className="v3d-label-val">{p ? fmtDb(p.relDb) : "—"}<small>dB</small></span>
              </button>
              {hovered === u && (
                <div className="v3d-tip" role="tooltip">
                  <div className="v3d-tip-title">{unit.label}</div>
                  <div className="v3d-tip-row">
                    <span>{unit.role}</span>
                    <span>Ø {(unit.diameter_m * 1000).toFixed(0)} mm</span>
                  </div>
                  {p && (
                    <div className="v3d-tip-row">
                      <span>{fmtDb(p.relDb)} dB re system</span>
                      <span>{(p.share * 100).toFixed(0)} % of output</span>
                      <span>{fmtFixed((p.phase * 180) / Math.PI, 0)}°</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
