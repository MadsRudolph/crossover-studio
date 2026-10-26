// Procedural geometry and textures for the loudspeaker. No asset files: everything is built from the profile's
// dimensions at run time, so any group's cabinet and drivers appear at their real size.
//
// Local frames: a driver is built around +z (the baffle surface at z = 0, the listener at +z); a cabinet's
// geometry is centred on its own centre.

import * as THREE from "three";

// ---------------------------------------------------------------- helpers
/** Revolve an (r, z) profile around the z axis. */
export function lathe(points: [number, number][], segments = 72): THREE.BufferGeometry {
  const g = new THREE.LatheGeometry(points.map(([r, z]) => new THREE.Vector2(Math.max(r, 1e-5), z)), segments);
  g.rotateX(Math.PI / 2); // lathe axis y -> z
  return g;
}

function arc(cx: number, cz: number, rx: number, rz: number, a0: number, a1: number, n: number): [number, number][] {
  const out: [number, number][] = [];
  for (let k = 0; k <= n; k++) {
    const a = a0 + ((a1 - a0) * k) / n;
    out.push([cx + rx * Math.cos(a), cz + rz * Math.sin(a)]);
  }
  return out;
}

function roundedRect(path: THREE.Path | THREE.Shape, w: number, h: number, r: number) {
  const x = -w / 2, y = -h / 2;
  r = Math.min(r, w / 2, h / 2);
  path.moveTo(x + r, y);
  path.lineTo(x + w - r, y);
  path.absarc(x + w - r, y + r, r, -Math.PI / 2, 0, false);
  path.lineTo(x + w, y + h - r);
  path.absarc(x + w - r, y + h - r, r, 0, Math.PI / 2, false);
  path.lineTo(x + r, y + h);
  path.absarc(x + r, y + h - r, r, Math.PI / 2, Math.PI, false);
  path.lineTo(x, y + r);
  path.absarc(x + r, y + r, r, Math.PI, Math.PI * 1.5, false);
}

// ---------------------------------------------------------------- cabinet
export interface CabinetHole {
  /** Centre relative to the cabinet centre (x right, y up). */
  x: number; y: number; r: number;
}

export interface CabinetGeometry {
  baffle: THREE.BufferGeometry;
  shell: THREE.BufferGeometry;
  back: THREE.BufferGeometry;
  /** Solid outline for x-ray edges and contact shadows. */
  outline: THREE.BufferGeometry;
}

/**
 * A hollow cabinet: front baffle with real cut-outs, a side shell and a back panel, each with softened edges.
 * Real cut-outs (instead of a solid box) let the cones sit behind the baffle surface as in a real loudspeaker.
 */
export function cabinetGeometry(size: [number, number, number], wall: number, holes: CabinetHole[], cornerR = 0.007): CabinetGeometry {
  const [w, h, d] = size;
  const bevel = Math.min(0.0035, wall / 4);
  const panel = (holesIn: CabinetHole[]) => {
    const s = new THREE.Shape();
    roundedRect(s, w - 2 * bevel, h - 2 * bevel, Math.max(0.001, cornerR - bevel));
    for (const hole of holesIn) {
      const p = new THREE.Path();
      p.absarc(hole.x, hole.y, hole.r + bevel, 0, Math.PI * 2, true);
      s.holes.push(p);
    }
    const g = new THREE.ExtrudeGeometry(s, {
      depth: Math.max(0.001, wall - 2 * bevel), bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel,
      bevelSegments: 3, curveSegments: 40,
    });
    return g;
  };

  const baffle = panel(holes);
  baffle.translate(0, 0, d / 2 - wall + bevel);
  const back = panel([]);
  back.translate(0, 0, -d / 2 + bevel);

  const ring = new THREE.Shape();
  roundedRect(ring, w, h, cornerR);
  const inner = new THREE.Path();
  roundedRect(inner, w - 2 * wall, h - 2 * wall, 0.0005);
  ring.holes.push(inner);
  const shell = new THREE.ExtrudeGeometry(ring, { depth: d - 2 * wall, bevelEnabled: false, curveSegments: 10 });
  shell.translate(0, 0, -d / 2 + wall);

  const outline = new THREE.BoxGeometry(w, h, d);
  return { baffle, shell, back, outline };
}

// ---------------------------------------------------------------- drivers
export interface DriverGeometry {
  /** Static parts on the baffle. */
  frame: THREE.BufferGeometry;
  surround: THREE.BufferGeometry;
  /** Moving parts: cone (or dome) and dust cap. */
  cone: THREE.BufferGeometry;
  cap: THREE.BufferGeometry | null;
  /** Tweeter only: the shallow horn around the dome. */
  waveguide: THREE.BufferGeometry | null;
  /** Behind the baffle, shown in x-ray: basket and magnet. */
  basket: THREE.BufferGeometry;
  magnet: THREE.BufferGeometry;
  screw: THREE.BufferGeometry;
  screwPositions: [number, number][];
  /** Ring at the frame edge that glows with the unit's share. */
  glow: THREE.BufferGeometry;
  /** Flat disc for hover/click picking. */
  hit: THREE.BufferGeometry;
  /** Cut-out radius in the baffle. */
  holeR: number;
  /** Depth of the cone behind the baffle surface. */
  depth: number;
}

export function coneDriverGeometry(frameR: number, coneR: number, maxDepth: number): DriverGeometry {
  const sw = Math.max(0.006, coneR * 0.12);          // surround width (S_D counts half of it)
  const bodyR = coneR - sw / 2;                        // where cone meets surround
  const holeR = Math.min(frameR - 0.006, coneR + sw / 2 + 0.003);
  const depth = Math.min(maxDepth * 0.5, coneR * 0.36);
  const flangeT = Math.max(0.003, frameR * 0.035);

  // Frame flange: flat ring on the baffle with a soft outer edge and a step down into the surround.
  const frame = lathe([
    [coneR + sw / 2, -0.002],
    [coneR + sw / 2, flangeT * 0.55],
    [coneR + sw / 2 + 0.002, flangeT],
    ...arc(frameR - flangeT * 0.6, 0, flangeT * 0.6, flangeT, Math.PI / 2, 0, 5),
  ], 96);

  // Half-roll rubber surround.
  const surround = lathe(arc(coneR, flangeT * 0.45, sw / 2, sw * 0.42, Math.PI, 0, 14), 96);

  // Cone: slightly curved (exponential) flare from the voice coil to the surround.
  const coilR = coneR * 0.3;
  const conePts: [number, number][] = [];
  for (let k = 0; k <= 16; k++) {
    const t = k / 16;
    const r = coilR + (bodyR - coilR) * t;
    conePts.push([r, flangeT * 0.45 - depth * (1 - t) ** 1.25]);
  }
  const cone = lathe(conePts, 96);

  // Dust cap: a shallow dome over the voice coil.
  const capR = coilR * 1.12;
  const cap = lathe(arc(0, flangeT * 0.45 - depth - capR * 0.05, capR, capR * 0.42, 0, Math.PI / 2, 12).reverse(), 64);

  // Basket and magnet behind the baffle (x-ray only).
  const magR = coneR * 0.42, magT = Math.min(coneR * 0.28, maxDepth * 0.28);
  const basket = lathe([
    [holeR - 0.002, -0.004], [coneR * 0.95, -0.012], [coilR * 1.25, -depth - 0.01], [coilR * 1.1, -depth - 0.016],
  ], 12);
  const magnet = new THREE.CylinderGeometry(magR, magR, magT, 48);
  magnet.rotateX(Math.PI / 2);
  magnet.translate(0, 0, -depth - 0.016 - magT / 2);

  const nScrews = frameR > 0.1 ? 6 : 4;
  const screwRing = (coneR + sw / 2 + frameR) / 2 + 0.002;
  const screwPositions: [number, number][] = Array.from({ length: nScrews }, (_, k) => {
    const a = Math.PI / 4 + (2 * Math.PI * k) / nScrews;
    return [screwRing * Math.cos(a), screwRing * Math.sin(a)];
  });
  const screwR = Math.min(0.0042, frameR * 0.045);
  const screw = lathe([[0, flangeT + screwR * 0.55], ...arc(0, flangeT, screwR, screwR * 0.55, Math.PI / 2, 0, 6), [screwR, flangeT - 0.001]], 20);

  const glow = new THREE.TorusGeometry(frameR + 0.004, Math.max(0.0012, frameR * 0.012), 8, 128);
  const hit = new THREE.CircleGeometry(frameR, 48);
  hit.translate(0, 0, flangeT + 0.002);
  return { frame, surround, cone, cap, waveguide: null, basket, magnet, screw, screwPositions, glow, hit, holeR, depth };
}

export function domeDriverGeometry(frameR: number, domeR: number, maxDepth: number): DriverGeometry {
  const sw = Math.max(0.0025, domeR * 0.16);
  const holeR = Math.min(frameR - 0.004, domeR + sw + 0.006);
  const plateT = 0.004;

  // Faceplate with a rounded rim.
  const frame = lathe([
    [holeR, -0.002], [holeR, plateT * 0.5],
    ...arc(frameR - plateT * 0.7, 0, plateT * 0.7, plateT, Math.PI / 2, 0, 6),
  ], 96);
  // Shallow waveguide from the surround out to ~70 % of the plate.
  const wgOuter = Math.max(domeR + sw + 0.004, frameR * 0.72);
  const waveguide = lathe(Array.from({ length: 10 }, (_, k): [number, number] => {
    const t = k / 9;
    return [domeR + sw + (wgOuter - domeR - sw) * t, plateT * (0.15 + 0.85 * Math.sin((t * Math.PI) / 2) ** 1.6)];
  }), 96);
  const surround = lathe(arc(domeR + sw / 2, plateT * 0.12, sw / 2, sw * 0.5, Math.PI, 0, 10), 72);
  const cone = lathe(arc(0, plateT * 0.12, domeR, domeR * 0.62, 0, Math.PI / 2, 18).reverse(), 72);
  const magR = frameR * 0.55, magT = Math.min(0.02, maxDepth * 0.25);
  const basket = lathe([[holeR - 0.001, -0.003], [holeR, -0.008]], 32);
  const magnet = new THREE.CylinderGeometry(magR, magR, magT, 40);
  magnet.rotateX(Math.PI / 2);
  magnet.translate(0, 0, -0.008 - magT / 2);
  const screwR = 0.0022;
  const screw = lathe([[0, plateT + screwR * 0.5], ...arc(0, plateT, screwR, screwR * 0.5, Math.PI / 2, 0, 5), [screwR, plateT - 0.001]], 16);
  const ringR = (wgOuter + frameR) / 2;
  const screwPositions: [number, number][] = [0, 1, 2].map(k => {
    const a = Math.PI / 2 + (2 * Math.PI * k) / 3;
    return [ringR * Math.cos(a), ringR * Math.sin(a)];
  });
  const glow = new THREE.TorusGeometry(frameR + 0.003, 0.0011, 8, 96);
  const hit = new THREE.CircleGeometry(frameR, 40);
  hit.translate(0, 0, plateT + 0.002);
  return { frame, surround, cone, cap: null, waveguide, basket, magnet, screw, screwPositions, glow, hit, holeR, depth: domeR * 0.6 };
}

// ---------------------------------------------------------------- vents
export interface VentGeometry {
  /** Flared mouth on the baffle. */
  flare: THREE.BufferGeometry;
  /** Tube from the baffle into the box (open at both ends). */
  tube: THREE.BufferGeometry;
  /** Plug of air (x-ray) and the foam plug (plugged vents). */
  slug: THREE.BufferGeometry;
  foam: THREE.BufferGeometry;
  holeR: number;
}

export function ventGeometry(radius: number, length: number, wall: number): VentGeometry {
  const flareW = Math.max(0.008, radius * 0.28);
  const t = 0.0025;
  // Rounded lip: from inside the tube, round over the edge, onto the baffle.
  const flare = lathe([
    [radius, -wall + 0.002],
    [radius, -flareW * 0.4],
    ...arc(radius + flareW * 0.55, -flareW * 0.4, flareW * 0.55, flareW * 0.4 + t, Math.PI, Math.PI / 2, 10),
    [radius + flareW, t],
    [radius + flareW + 0.004, 0],
  ], 72);
  const tube = new THREE.CylinderGeometry(radius + 0.0015, radius + 0.0015, length, 48, 1, true);
  tube.rotateX(Math.PI / 2);
  tube.translate(0, 0, -length / 2);
  const slugL = Math.min(0.06, length * 0.38);
  const slug = new THREE.CylinderGeometry(radius * 0.94, radius * 0.94, slugL, 40);
  slug.rotateX(Math.PI / 2);
  const foam = new THREE.CylinderGeometry(radius * 0.995, radius * 0.995, 0.02, 40);
  foam.rotateX(Math.PI / 2);
  foam.translate(0, 0, -0.014); // front face sits just inside the lip
  return { flare, tube, slug, foam, holeR: radius + 0.0015 };
}

// ---------------------------------------------------------------- textures
function canvasTexture(w: number, h: number, paint: (ctx: CanvasRenderingContext2D) => void, srgb: boolean): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const ctx = c.getContext("2d")!;
  paint(ctx);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Deterministic PRNG so the grain looks the same every launch. */
function rng(seed: number) {
  return () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
}

/** Fine horizontal fibre grain for the satin MDF finish (roughness map: brighter = rougher). */
export function grainTexture(): THREE.CanvasTexture {
  return canvasTexture(512, 512, ctx => {
    const r = rng(7);
    ctx.fillStyle = "rgb(150,150,150)";
    ctx.fillRect(0, 0, 512, 512);
    for (let k = 0; k < 1400; k++) {
      const y = r() * 512, len = 40 + r() * 260, x = r() * 512, v = 120 + r() * 70;
      ctx.strokeStyle = `rgba(${v},${v},${v},${0.25 + r() * 0.35})`;
      ctx.lineWidth = 0.6 + r() * 1.6;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.bezierCurveTo(x + len / 3, y + (r() - 0.5) * 3, x + (2 * len) / 3, y + (r() - 0.5) * 3, x + len, y + (r() - 0.5) * 2);
      ctx.stroke();
    }
    const img = ctx.getImageData(0, 0, 512, 512);
    for (let i = 0; i < img.data.length; i += 4) {
      const n = (r() - 0.5) * 22;
      img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n;
    }
    ctx.putImageData(img, 0, 0);
  }, false);
}

/** Paper / wood-fibre speckle for cones (colour map multiplied with the cone colour). */
export function fibreTexture(): THREE.CanvasTexture {
  return canvasTexture(256, 256, ctx => {
    const r = rng(11);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, 256, 256);
    for (let k = 0; k < 2600; k++) {
      const v = 190 + r() * 65;
      ctx.fillStyle = `rgba(${v},${v * 0.97},${v * 0.93},0.5)`;
      const x = r() * 256, y = r() * 256, a = r() * Math.PI, l = 1 + r() * 5;
      ctx.save(); ctx.translate(x, y); ctx.rotate(a); ctx.fillRect(-l / 2, -0.4, l, 0.8); ctx.restore();
    }
  }, true);
}
