// The loudspeaker: two cabinets with real cut-outs, procedural drivers and vents, all moving with the probe.

import { useEffect, useMemo, useRef } from "react";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import type { UnitId } from "../types";
import type { DriverLayout, SceneLayout, VentLayout } from "./layout";
import {
  cabinetGeometry, coneDriverGeometry, domeDriverGeometry, fibreTexture, grainTexture, ventGeometry,
  type CabinetHole, type DriverGeometry,
} from "./meshes";
import { damp, oscillation, type Motion } from "./motion";
import { glowFromShare } from "./physics";
import type { SceneColors } from "./theme";

/** Largest visual cone travel, m: about a sixth of the cone radius reads as "moving a lot" without clipping. */
const maxTravel = (d: DriverLayout) => Math.max(0.0025, Math.min(0.016, d.coneR * 0.16));

function useDisposable<T extends { dispose(): void }>(make: () => T, deps: unknown[]): T {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const value = useMemo(make, deps);
  useEffect(() => () => value.dispose(), [value]);
  return value;
}

// ---------------------------------------------------------------- materials
interface Materials {
  satin: THREE.MeshPhysicalMaterial;
  lacquer: THREE.MeshPhysicalMaterial;
  satinX: THREE.MeshPhysicalMaterial;
  lacquerX: THREE.MeshPhysicalMaterial;
  metal: THREE.MeshStandardMaterial;
  rubber: THREE.MeshStandardMaterial;
  wooferCone: THREE.MeshStandardMaterial;
  midCone: THREE.MeshStandardMaterial;
  dustCap: THREE.MeshPhysicalMaterial;
  dome: THREE.MeshPhysicalMaterial;
  plate: THREE.MeshPhysicalMaterial;
  screw: THREE.MeshStandardMaterial;
  ventPlastic: THREE.MeshStandardMaterial;
  foam: THREE.MeshStandardMaterial;
  internals: THREE.MeshStandardMaterial;
  dispose(): void;
}

function makeMaterials(): Materials {
  const grain = grainTexture();
  grain.repeat.set(5, 5);
  const fibre = fibreTexture();
  fibre.repeat.set(3, 3);
  const all: THREE.Material[] = [];
  const keep = <M extends THREE.Material>(m: M) => { all.push(m); return m; };

  // Satin black MDF: low clearcoat over a grain-modulated roughness, so reflections break up like a real finish.
  const satinParams: THREE.MeshPhysicalMaterialParameters = {
    color: "#1b1c1f", roughness: 0.6, roughnessMap: grain, metalness: 0, clearcoat: 0.3, clearcoatRoughness: 0.45,
    sheen: 0.12, sheenColor: new THREE.Color("#3a3f48"), sheenRoughness: 0.6,
  };
  // Premium white lacquer: bright base, glossy clearcoat.
  const lacquerParams: THREE.MeshPhysicalMaterialParameters = {
    color: "#eeece7", roughness: 0.34, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.1,
  };
  const xray = (p: THREE.MeshPhysicalMaterialParameters, opacity: number) => ({
    ...p, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide, clearcoat: 0.4,
  });

  const m: Omit<Materials, "dispose"> = {
    satin: keep(new THREE.MeshPhysicalMaterial(satinParams)),
    lacquer: keep(new THREE.MeshPhysicalMaterial(lacquerParams)),
    satinX: keep(new THREE.MeshPhysicalMaterial(xray(satinParams, 0.12))),
    lacquerX: keep(new THREE.MeshPhysicalMaterial(xray(lacquerParams, 0.07))),
    metal: keep(new THREE.MeshStandardMaterial({ color: "#1e1f22", metalness: 0.75, roughness: 0.34, side: THREE.DoubleSide })),
    rubber: keep(new THREE.MeshStandardMaterial({ color: "#0f1011", roughness: 0.6, side: THREE.DoubleSide })),
    wooferCone: keep(new THREE.MeshStandardMaterial({ color: "#1b1c1e", map: fibre, roughness: 0.78, side: THREE.DoubleSide })),
    // DALI's signature wood-fibre cone.
    midCone: keep(new THREE.MeshStandardMaterial({ color: "#7a4e33", map: fibre, roughness: 0.82, side: THREE.DoubleSide })),
    dustCap: keep(new THREE.MeshPhysicalMaterial({ color: "#121315", roughness: 0.3, clearcoat: 0.6, side: THREE.DoubleSide })),
    dome: keep(new THREE.MeshPhysicalMaterial({
      color: "#1c1c1f", roughness: 0.85, sheen: 1, sheenColor: new THREE.Color("#6b6f78"), sheenRoughness: 0.45, side: THREE.DoubleSide,
    })),
    plate: keep(new THREE.MeshPhysicalMaterial({ color: "#141517", roughness: 0.28, metalness: 0.2, clearcoat: 0.8, side: THREE.DoubleSide })),
    screw: keep(new THREE.MeshStandardMaterial({ color: "#55585e", metalness: 0.95, roughness: 0.28 })),
    ventPlastic: keep(new THREE.MeshStandardMaterial({ color: "#121315", roughness: 0.45, side: THREE.DoubleSide })),
    // light grey open-cell foam: a plugged vent must read as plugged next to an open (black) one
    foam: keep(new THREE.MeshStandardMaterial({ color: "#8d9096", map: fibre, roughness: 1 })),
    internals: keep(new THREE.MeshStandardMaterial({ color: "#3a3d42", metalness: 0.6, roughness: 0.45 })),
  };
  return { ...m, dispose() { all.forEach(x => x.dispose()); grain.dispose(); fibre.dispose(); } };
}

// ---------------------------------------------------------------- cabinet
function Cabinet({ size, center, wall, holes, material, xray, edgeColor, inner }: {
  size: [number, number, number]; center: [number, number, number]; wall: number; holes: CabinetHole[];
  material: THREE.Material; xray: boolean; edgeColor: string; inner?: boolean;
}) {
  const holeKey = holes.map(h => `${h.x.toFixed(4)},${h.y.toFixed(4)},${h.r.toFixed(4)}`).join(";");
  const geo = useMemo(() => cabinetGeometry(size, wall, holes), [size[0], size[1], size[2], wall, holeKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const edges = useMemo(() => new THREE.EdgesGeometry(geo.outline), [geo]);
  useEffect(() => () => { geo.baffle.dispose(); geo.shell.dispose(); geo.back.dispose(); geo.outline.dispose(); edges.dispose(); }, [geo, edges]);
  return (
    <group position={center}>
      <mesh geometry={geo.baffle} material={material} renderOrder={xray ? 2 : 0} />
      <mesh geometry={geo.shell} material={material} renderOrder={xray ? 2 : 0} />
      <mesh geometry={geo.back} material={material} renderOrder={xray ? 2 : 0} />
      {xray && (
        <lineSegments geometry={edges} renderOrder={3}>
          <lineBasicMaterial color={edgeColor} transparent opacity={inner ? 0.35 : 0.55} depthWrite={false} />
        </lineSegments>
      )}
    </group>
  );
}

// ---------------------------------------------------------------- drivers
function Driver({ d, geo, mats, motion, color, xray, onHover, onSelect }: {
  d: DriverLayout; geo: DriverGeometry; mats: Materials; motion: Motion; color: string; xray: boolean;
  onHover(id: UnitId | null): void; onSelect(id: UnitId): void;
}) {
  const moving = useRef<THREE.Group>(null);
  const surround = useRef<THREE.Group>(null);
  const glow = useRef<THREE.MeshBasicMaterial>(null);
  const base = useMemo(() => new THREE.Color(color), [color]);
  const glowLevel = useRef(0);
  const travel = maxTravel(d);
  const dome = d.unit.kind === "dome";

  useFrame((_, dt) => {
    const u = motion.probe?.units[d.id];
    const x = u ? u.excursion * travel * oscillation(motion.t, u.conePhase) : 0;
    if (moving.current) moving.current.position.z = x;
    if (surround.current) surround.current.position.z = x * 0.45;
    if (glow.current) {
      const active = motion.hovered === d.id || motion.focused === d.id;
      const target = u ? glowFromShare(u.share) * (active ? 1.25 : 1) : 0.1;
      glowLevel.current += (target - glowLevel.current) * damp(Math.min(dt, 0.1), 0.12);
      // Values above 1 feed the bloom pass; tone mapping is off for this material.
      glow.current.color.copy(base).multiplyScalar(0.15 + 2.8 * glowLevel.current ** 1.5);
      glow.current.opacity = Math.min(1, 0.25 + glowLevel.current);
    }
  });

  const over = (e: ThreeEvent<PointerEvent>) => { e.stopPropagation(); onHover(d.id); };
  const out = () => onHover(null);
  const click = (e: ThreeEvent<MouseEvent>) => { e.stopPropagation(); onSelect(d.id); };

  return (
    <group position={d.pos}>
      <mesh geometry={geo.frame} material={dome ? mats.plate : mats.metal} />
      {geo.waveguide && <mesh geometry={geo.waveguide} material={mats.plate} />}
      {geo.screwPositions.map(([sx, sy], k) => (
        <mesh key={k} geometry={geo.screw} material={mats.screw} position={[sx, sy, 0]} />
      ))}
      <group ref={surround}><mesh geometry={geo.surround} material={mats.rubber} /></group>
      <group ref={moving}>
        <mesh geometry={geo.cone} material={dome ? mats.dome : d.id === "mid" ? mats.midCone : mats.wooferCone} />
        {geo.cap && <mesh geometry={geo.cap} material={mats.dustCap} />}
      </group>
      <mesh geometry={geo.glow} renderOrder={4} position={[0, 0, 0.0015]}>
        <meshBasicMaterial ref={glow} transparent toneMapped={false} depthWrite={false} />
      </mesh>
      {xray && (
        <group>
          <mesh geometry={geo.basket} material={mats.internals} />
          <mesh geometry={geo.magnet} material={mats.internals} />
        </group>
      )}
      <mesh geometry={geo.hit} onPointerOver={over} onPointerOut={out} onClick={click}>
        <meshBasicMaterial transparent opacity={0} depthWrite={false} colorWrite={false} />
      </mesh>
    </group>
  );
}

// ---------------------------------------------------------------- vents
function Vent({ v, wall, mats, motion, color, xray }: {
  v: VentLayout; wall: number; mats: Materials; motion: Motion; color: string; xray: boolean;
}) {
  const geo = useMemo(() => ventGeometry(v.radius, v.length, wall), [v.radius, v.length, wall]);
  useEffect(() => () => { geo.flare.dispose(); geo.tube.dispose(); geo.slug.dispose(); geo.foam.dispose(); }, [geo]);
  const slug = useRef<THREE.Mesh>(null);
  const tint = useMemo(() => new THREE.Color(color), [color]);
  const slugLen = Math.min(0.06, v.length * 0.38);
  const centre = -v.length / 2;
  const reach = Math.max(0, (v.length - slugLen) / 2 - 0.002);

  useFrame(() => {
    if (!slug.current) return;
    const s = motion.probe?.vents.find(x => x.id === v.id);
    const travel = Math.min(reach, 0.05);
    slug.current.position.z = centre + (s ? s.excursion * travel * oscillation(motion.t, s.phase) : 0);
  });

  return (
    <group position={v.pos}>
      <mesh geometry={geo.flare} material={mats.ventPlastic} />
      {v.open ? (
        <>
          <mesh geometry={geo.tube} renderOrder={xray ? 1 : 0}>
            <meshStandardMaterial
              color={xray ? tint : "#101113"} roughness={0.5} side={THREE.DoubleSide}
              transparent={xray} opacity={xray ? 0.32 : 1} depthWrite={!xray}
              emissive={tint} emissiveIntensity={xray ? 0.25 : 0}
            />
          </mesh>
          {xray && (
            <mesh ref={slug} geometry={geo.slug} renderOrder={1}>
              <meshStandardMaterial color={tint} emissive={tint} emissiveIntensity={1.4} transparent opacity={0.7} toneMapped={false} />
            </mesh>
          )}
        </>
      ) : (
        <mesh geometry={geo.foam} material={mats.foam} />
      )}
    </group>
  );
}

// ---------------------------------------------------------------- assembly
export function Speaker({ layout, colors, motion, xray, onHover, onSelect }: {
  layout: SceneLayout; colors: SceneColors; motion: Motion; xray: boolean;
  onHover(id: UnitId | null): void; onSelect(id: UnitId): void;
}) {
  const mats = useDisposable(makeMaterials, []);
  const { woofer, top, drivers, vents } = layout;

  const room = (d: DriverLayout) => (d.cabinet === "woofer" ? woofer.inner[2] : top.size[2] - 2 * woofer.wall);
  // Rebuild driver meshes only when a driver's size changes, not on every box edit (the layout object is new then).
  const driverKey = (Object.keys(drivers) as UnitId[])
    .map(u => `${drivers[u].unit.kind}:${drivers[u].frameR}:${drivers[u].coneR}:${room(drivers[u])}`).join("|");
  const driverGeo = useMemo(() => {
    const make = (d: DriverLayout) =>
      d.unit.kind === "dome" ? domeDriverGeometry(d.frameR, d.coneR, room(d)) : coneDriverGeometry(d.frameR, d.coneR, room(d));
    return { woof: make(drivers.woof), mid: make(drivers.mid), tw: make(drivers.tw) } as Record<UnitId, DriverGeometry>;
  }, [driverKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => {
    for (const g of Object.values(driverGeo)) {
      for (const k of ["frame", "surround", "cone", "cap", "waveguide", "basket", "magnet", "screw", "glow", "hit"] as const) g[k]?.dispose();
    }
  }, [driverGeo]);

  const rel = (p: [number, number, number], c: [number, number, number]) => [p[0] - c[0], p[1] - c[1]] as const;
  const wooferHoles: CabinetHole[] = [
    { ...xy(rel(drivers.woof.pos, woofer.center)), r: driverGeo.woof.holeR },
    ...vents.map(v => ({ ...xy(rel(v.pos, woofer.center)), r: v.radius + 0.0015 })),
  ];
  const topHoles: CabinetHole[] = (["mid", "tw"] as const).map(u => ({ ...xy(rel(drivers[u].pos, top.center)), r: driverGeo[u].holeR }));

  return (
    <group>
      <Cabinet size={woofer.size} center={woofer.center} wall={woofer.wall} holes={wooferHoles}
        material={xray ? mats.satinX : mats.satin} xray={xray} edgeColor={colors.text3} />
      <Cabinet size={top.size} center={top.center} wall={Math.min(woofer.wall, 0.015)} holes={topHoles}
        material={xray ? mats.lacquerX : mats.lacquer} xray={xray} edgeColor={colors.text3} inner />
      {(Object.keys(drivers) as UnitId[]).map(u => (
        <Driver key={u} d={drivers[u]} geo={driverGeo[u]} mats={mats} motion={motion} color={colors[u]} xray={xray}
          onHover={onHover} onSelect={onSelect} />
      ))}
      {vents.map(v => (
        <Vent key={`${v.id}:${v.open}`} v={v} wall={woofer.wall} mats={mats} motion={motion} color={colors.woof} xray={xray} />
      ))}
    </group>
  );
}

function xy([x, y]: readonly [number, number]) { return { x, y }; }
