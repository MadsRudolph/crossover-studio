// Parametric scene layout: every position and size of the 3D model, derived from the profile and the box design.
// Pure (no three.js), so it is unit-tested and shared by the WebGL scene and the 2D fallback drawing.
//
// World frame (metres): x to the right as seen from the front, y up from the floor, z out of the front baffle
// towards the listener. The woofer box stands on the floor centred on x = z = 0; its front face is z = frontZ.

import type { BoxDesign, Profile, UnitId, UnitInfo } from "../types";

export type Vec3 = [number, number, number];

export interface CabinetLayout {
  /** Outer width, height, depth. */
  size: Vec3;
  /** Centre of the cabinet. */
  center: Vec3;
}

export interface DriverLayout {
  id: UnitId;
  unit: UnitInfo;
  /** Centre of the driver on the baffle surface. */
  pos: Vec3;
  /** Outer frame radius and radiating (cone or dome) radius. */
  frameR: number;
  coneR: number;
  /** Which cabinet it is mounted in (decides how deep the basket may go). */
  cabinet: "woofer" | "top";
}

export interface VentLayout {
  id: string;
  /** Centre of the vent mouth on the baffle surface. */
  pos: Vec3;
  /** Inner radius. */
  radius: number;
  /** Tube length into the box (clamped so it never pierces the back wall). */
  length: number;
  open: boolean;
  /** Diameter is a guess in the profile: the label says so. */
  estimated: boolean;
}

export interface SceneLayout {
  woofer: CabinetLayout & { wall: number; inner: Vec3 };
  top: CabinetLayout;
  frontZ: number;
  drivers: Record<UnitId, DriverLayout>;
  vents: VentLayout[];
  /** Bounding sphere of the whole loudspeaker, for camera framing. */
  bounds: { center: Vec3; radius: number; size: Vec3 };
  /** Side (+1 right, -1 left) with free space above the woofer box: the mid/tweeter labels go there. */
  freeSide: 1 | -1;
}

/** Radiating radius of a dome or cone. A profile gives the effective piston diameter (S_D = pi D^2 / 4). */
function radii(unit: UnitInfo): { frameR: number; coneR: number } {
  const frameR = Math.max(unit.frame_diameter_m, unit.diameter_m * 1.05) / 2;
  return { frameR, coneR: Math.min(unit.diameter_m / 2, frameR * 0.97) };
}

/** Vents of the current box design: which mouths are open and how long each tube is. */
export function ventLayouts(profile: Profile, box: BoxDesign, frontZ: number, innerDepth: number): VentLayout[] {
  const wb = profile.woofer_box;
  const maxLen = Math.max(0.02, innerDepth - 0.02);
  return wb.vents.map((v, k): VentLayout | null => {
    const at = wb.vent_pos_m[k];
    if (!at) return null;
    const open = box.mode === "one" ? k === 0 : box.mode === "two" ? k <= 1 : false;
    // Vent B's diameter is a design variable (a2 = radius); vent A's is fixed by the cabinet.
    const radius = k === 1 && box.mode === "two" ? box.a2 : v.diameter_m / 2;
    const length = k === 0 ? box.L : k === 1 ? box.L2 : (v.length_range_m?.[0] ?? 0.1);
    return {
      id: v.id, pos: [at[0], at[1], frontZ], radius,
      length: Math.min(maxLen, Math.max(0.01, length)), open, estimated: !!v.estimated,
    };
  }).filter((v): v is VentLayout => v !== null);
}

export function sceneLayout(profile: Profile, box: BoxDesign): SceneLayout {
  const wb = profile.woofer_box, tb = profile.top_box;
  const inner = wb.inner_m;
  const size: Vec3 = [inner[0] + 2 * wb.wall_m, inner[1] + 2 * wb.wall_m, inner[2] + 2 * wb.wall_m];
  const frontZ = size[2] / 2;
  const woofer = { size, center: [0, size[1] / 2, 0] as Vec3, wall: wb.wall_m, inner };

  // The top box stands on the woofer box, shifted sideways, with both front faces flush.
  const topSize = tb.outer_m;
  const top: CabinetLayout = {
    size: topSize,
    center: [tb.offset_x_m, size[1] + topSize[1] / 2, frontZ - topSize[2] / 2],
  };
  const topBottom = size[1];

  const drivers = {} as Record<UnitId, DriverLayout>;
  const place = (id: UnitId, pos: Vec3, cabinet: DriverLayout["cabinet"]) => {
    const unit = profile.units[id];
    drivers[id] = { id, unit, pos, cabinet, ...radii(unit) };
  };
  place("woof", [wb.driver_pos_m[0], wb.driver_pos_m[1], frontZ], "woofer");
  place("mid", [tb.offset_x_m + tb.mid_pos_m[0], topBottom + tb.mid_pos_m[1], frontZ], "top");
  place("tw", [tb.offset_x_m + tb.tw_pos_m[0], topBottom + tb.tw_pos_m[1], frontZ], "top");

  const minX = Math.min(-size[0] / 2, top.center[0] - topSize[0] / 2);
  const maxX = Math.max(size[0] / 2, top.center[0] + topSize[0] / 2);
  const height = size[1] + topSize[1];
  const bsize: Vec3 = [maxX - minX, height, size[2]];
  const center: Vec3 = [(minX + maxX) / 2, height / 2, 0];
  const radius = Math.hypot(bsize[0], bsize[1], bsize[2]) / 2;

  return {
    woofer, top, frontZ, drivers,
    vents: ventLayouts(profile, box, frontZ, inner[2]),
    bounds: { center, radius, size: bsize },
    freeSide: tb.offset_x_m <= 0 ? 1 : -1,
  };
}

/** Camera presets, as spherical directions from the model centre (azimuth from +z towards +x, polar from +y). */
export type CameraPreset = "front" | "threeQuarter" | "side" | "top";

export const PRESET_DIRECTIONS: Record<CameraPreset, { azimuth: number; polar: number }> = {
  front: { azimuth: 0, polar: Math.PI / 2 - 0.06 },
  threeQuarter: { azimuth: 0.62, polar: 1.17 },
  side: { azimuth: Math.PI / 2, polar: Math.PI / 2 - 0.08 },
  top: { azimuth: 0.0001, polar: 0.06 },
};

/** Distance that frames a sphere of `radius` in a perspective camera of vertical fov `fovDeg` and aspect `aspect`. */
export function frameDistance(radius: number, fovDeg: number, aspect: number, margin = 1.06): number {
  const vHalf = (fovDeg * Math.PI) / 360;
  const hHalf = Math.atan(Math.tan(vHalf) * Math.max(0.2, aspect));
  return (radius * margin) / Math.sin(Math.min(vHalf, hHalf));
}

/** Point on a sphere around `center`. */
export function orbitPoint(center: Vec3, distance: number, azimuth: number, polar: number): Vec3 {
  const s = Math.sin(polar);
  return [
    center[0] + distance * s * Math.sin(azimuth),
    center[1] + distance * Math.cos(polar),
    center[2] + distance * s * Math.cos(azimuth),
  ];
}

/** Screen-space gap kept between two callouts that land on top of each other (px). */
const LABEL_GAP_Y = 30, LABEL_OVERLAP_X = 150;

/** Pushes callouts apart vertically where the camera stacks them (side and top views put the midrange
 *  and tweeter anchors almost on one point), keeping their order from top to bottom. Mutates `pins`. */
export function spreadLabels(pins: { x: number; y: number }[], maxY = Infinity): void {
  const order = [...pins].sort((a, b) => a.y - b.y);
  for (let i = 1; i < order.length; i++) {
    for (let j = 0; j < i; j++) {
      const a = order[j], b = order[i];
      if (Math.abs(a.x - b.x) < LABEL_OVERLAP_X && b.y - a.y < LABEL_GAP_Y) b.y = a.y + LABEL_GAP_Y;
    }
  }
  // a stack pushed into the bottom strip (the HUD chips live there) moves back up as a whole
  for (let i = order.length - 1, limit = maxY; i >= 0; i--) {
    if (order[i].y <= limit) break;
    order[i].y = limit;
    limit -= LABEL_GAP_Y;
  }
}
