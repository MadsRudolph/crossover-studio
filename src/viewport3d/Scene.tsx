// Everything inside the WebGL canvas: studio lighting (built locally, no HDR files), floor, camera rig,
// the loudspeaker, wavefronts, callouts and the bloom pass.

import { useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, type ComponentRef, type Ref } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { ContactShadows, Environment, Grid, Lightformer, OrbitControls, PerformanceMonitor } from "@react-three/drei";
import { Bloom, EffectComposer } from "@react-three/postprocessing";
import * as THREE from "three";
import type { UnitId } from "../types";
import { frameDistance, orbitPoint, PRESET_DIRECTIONS, type CameraPreset, type SceneLayout } from "./layout";
import { damp, type Motion } from "./motion";
import type { ProbeState } from "./physics";
import { LabelLeaders, type LabelNodes } from "./Labels";
import { Speaker } from "./Speaker";
import type { SceneColors } from "./theme";
import { Waves } from "./Waves";

export const FOV_DEG = 30;
/** Objects on this layer are drawn but cast no contact shadow. */
export const OVERLAY_LAYER = 1;

export interface CameraApi {
  goTo(preset: CameraPreset, instant?: boolean): void;
  /** Orbit by (azimuth, polar) radians and scale the distance; used by the keyboard. */
  nudge(dAzimuth: number, dPolar: number, zoom?: number): void;
}

export type Quality = "high" | "low";
export interface FrameStats { fps: number; calls: number; triangles: number }

export interface SceneProps {
  layout: SceneLayout;
  /** Camera pose when a loudspeaker is first framed. */
  initialPreset: CameraPreset;
  /** Changes only when a different loudspeaker is loaded: the camera re-frames then, not on every design edit. */
  frameKey: string;
  colors: SceneColors;
  motion: Motion;
  probe: ProbeState | null;
  xray: boolean;
  waves: boolean;
  animating: boolean;
  reducedMotion: boolean;
  quality: Quality;
  hovered: UnitId | null;
  focused: UnitId | null;
  cameraRef: Ref<CameraApi>;
  labelNodes: LabelNodes;
  onHover(u: UnitId | null): void;
  onSelect(u: UnitId): void;
  onQuality(q: Quality): void;
  onFps?(stats: FrameStats): void;
}

// ---------------------------------------------------------------- camera
const POLAR_MIN = 0.05, POLAR_MAX = Math.PI / 2 - 0.03;

function CameraRig({ layout, frameKey, cameraRef, reducedMotion, initialPreset }: Pick<SceneProps, "layout" | "frameKey" | "cameraRef" | "reducedMotion" | "initialPreset">) {
  const controls = useRef<ComponentRef<typeof OrbitControls>>(null);
  const camera = useThree(s => s.camera);
  const size = useThree(s => s.size);
  const invalidate = useThree(s => s.invalidate);
  const goal = useRef<{ pos: THREE.Vector3; target: THREE.Vector3 } | null>(null);

  // Layer 1 holds overlays (wavefronts, leaders): visible to this camera, invisible to the contact-shadow camera.
  useEffect(() => { camera.layers.enable(OVERLAY_LAYER); }, [camera]);

  // Aim a little below the bounding-box centre: the floor and shadow then sit in frame, like a product shot.
  const center = useMemo(() => {
    const [x, y, z] = layout.bounds.center;
    return new THREE.Vector3(x, y * 0.92, z);
  }, [layout.bounds.center]);
  const distance = frameDistance(layout.bounds.radius, FOV_DEG, size.width / Math.max(1, size.height));

  const presetPose = (preset: CameraPreset) => {
    const dir = PRESET_DIRECTIONS[preset];
    const k = preset === "top" ? 1.05 : preset === "side" ? 0.95 : 1;
    return { pos: new THREE.Vector3(...orbitPoint([center.x, center.y, center.z], distance * k, dir.azimuth, dir.polar)), target: center.clone() };
  };

  const apply = (pose: { pos: THREE.Vector3; target: THREE.Vector3 }, instant: boolean) => {
    const c = controls.current;
    if (instant || reducedMotion || !c) {
      goal.current = null;
      camera.position.copy(pose.pos);
      c?.target.copy(pose.target);
      c?.update();
    } else {
      goal.current = pose;
    }
    invalidate();
  };

  // Frame the model once per loudspeaker (and when the panel first gets a real size).
  const framedFor = useRef("");
  useLayoutEffect(() => {
    if (size.width < 2 || size.height < 2) return;
    const key = `${frameKey}`;
    if (framedFor.current === key) return;
    framedFor.current = key;
    apply(presetPose(initialPreset), true);
  });

  useImperativeHandle(cameraRef, () => ({
    goTo: (preset, instant = false) => apply(presetPose(preset), instant),
    nudge: (dAz, dPolar, zoom = 1) => {
      const c = controls.current;
      if (!c) return;
      const target = (goal.current?.target ?? c.target).clone();
      const from = (goal.current?.pos ?? camera.position).clone().sub(target);
      const sph = new THREE.Spherical().setFromVector3(from);
      sph.theta += dAz;
      sph.phi = Math.min(POLAR_MAX, Math.max(POLAR_MIN, sph.phi + dPolar));
      sph.radius = Math.min(distance * 2.6, Math.max(distance * 0.35, sph.radius * zoom));
      apply({ pos: new THREE.Vector3().setFromSpherical(sph).add(target), target }, false);
    },
  }));

  useFrame((_, dt) => {
    const g = goal.current, c = controls.current;
    if (!g || !c) return;
    const k = damp(Math.min(dt, 0.05), 0.11);
    camera.position.lerp(g.pos, k);
    c.target.lerp(g.target, k);
    c.update();
    if (camera.position.distanceTo(g.pos) < 1e-4 && c.target.distanceTo(g.target) < 1e-4) goal.current = null;
    invalidate();
  });

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enableDamping
      dampingFactor={0.085}
      rotateSpeed={0.65}
      zoomSpeed={0.8}
      panSpeed={0.6}
      screenSpacePanning
      minDistance={distance * 0.35}
      maxDistance={distance * 2.6}
      minPolarAngle={POLAR_MIN}
      maxPolarAngle={POLAR_MAX}
      onStart={() => { goal.current = null; }}
    />
  );
}

// ---------------------------------------------------------------- lighting
function Studio({ light }: { light: boolean }) {
  // A local studio: a large overhead softbox, two tall strip lights and a warm low fill, rendered once into a
  // cube map. Metal frames and the lacquer pick up these shapes as clean highlights.
  return (
    <Environment resolution={256} frames={1} environmentIntensity={light ? 1.1 : 1.15}>
      <color attach="background" args={["#0b0c0e"]} />
      <Lightformer form="rect" intensity={3.2} color="#ffffff" scale={[4, 2.2, 1]} position={[0, 4, 1.2]} target={[0, 0, 0]} />
      <Lightformer form="rect" intensity={2.4} color="#f3f5ff" scale={[0.6, 3.4, 1]} position={[3, 1.4, 2.2]} target={[0, 0.5, 0]} />
      <Lightformer form="rect" intensity={1.5} color="#f6f7fb" scale={[0.6, 3.4, 1]} position={[-3.2, 1.2, 1.4]} target={[0, 0.5, 0]} />
      <Lightformer form="rect" intensity={0.9} color="#dfe8ff" scale={[5, 1.2, 1]} position={[0, 1, -4]} target={[0, 0.6, 0]} />
      <Lightformer form="ring" intensity={1.6} color="#ffffff" scale={0.9} position={[1.6, 2.4, 3.2]} target={[0, 0.5, 0]} />
      <Lightformer form="rect" intensity={0.25} color="#e9edf5" scale={[6, 1, 1]} position={[0, -1.2, 2]} target={[0, 0.4, 0]} />
    </Environment>
  );
}

// ---------------------------------------------------------------- backdrop
/**
 * The page gradient (same recipe as .v3d in viewport3d.css), painted into the scene background. Rendering it
 * inside WebGL keeps the canvas opaque, which the post-processing chain needs for correct blending of the
 * translucent grid and wavefronts.
 */
function Backdrop({ colors }: { colors: SceneColors }) {
  const scene = useThree(s => s.scene);
  useEffect(() => {
    const c = document.createElement("canvas");
    c.width = 512; c.height = 512;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = colors.bg;
    ctx.fillRect(0, 0, 512, 512);
    const glow = (cx: number, cy: number, rx: number, ry: number, color: string, alpha: number, stop: number) => {
      ctx.save();
      ctx.translate(cx * 512, cy * 512);
      ctx.scale(rx, ry);
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 512);
      g.addColorStop(0, hexA(color, alpha));
      g.addColorStop(stop, hexA(color, 0));
      ctx.fillStyle = g;
      ctx.fillRect(-1024, -1024, 2048, 2048);
      ctx.restore();
    };
    // a slightly stronger centre glow on dark, so the black cabinet has something to stand against
    glow(0.5, 0.38, 1.2, 0.9, colors.surface2, colors.light ? 0.7 : 0.95, 0.62);
    glow(0.5, 1.0, 0.8, 0.6, colors.surface1, 0.9, 0.7);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const prev = scene.background;
    scene.background = tex;
    return () => { scene.background = prev; tex.dispose(); };
  }, [scene, colors.bg, colors.surface1, colors.surface2]);
  return null;
}

function hexA(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

// ---------------------------------------------------------------- frame loop helpers
function Clock({ motion, animating }: { motion: Motion; animating: boolean }) {
  // Negative priority: runs before the meshes read motion.t, without taking over rendering.
  useFrame((_, dt) => { if (animating) motion.t += Math.min(dt, 0.1); }, -2);
  return null;
}

/** In "demand" mode nothing renders by itself: re-render whenever something visible changed. */
function Invalidator({ deps }: { deps: unknown[] }) {
  const invalidate = useThree(s => s.invalidate);
  useEffect(() => { invalidate(); }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

function Exposure({ light }: { light: boolean }) {
  const gl = useThree(s => s.gl);
  useEffect(() => {
    // Khronos PBR Neutral keeps the lacquer white and the token colours true, unlike ACES.
    gl.toneMapping = THREE.NeutralToneMapping;
    gl.toneMappingExposure = light ? 0.95 : 1.0;
  }, [gl, light]);
  return null;
}

function FpsProbe({ onFps }: { onFps(stats: FrameStats): void }) {
  const acc = useRef({ frames: 0, t: 0 });
  const gl = useThree(s => s.gl);
  // The composer renders several passes per frame: count the whole frame, not just the last pass.
  useEffect(() => {
    gl.info.autoReset = false;
    return () => { gl.info.autoReset = true; };
  }, [gl]);
  useFrame((_, dt) => {
    const a = acc.current;
    a.frames++; a.t += dt;
    if (a.t >= 0.5) {
      onFps({ fps: a.frames / a.t, calls: gl.info.render.calls, triangles: gl.info.render.triangles });
      a.frames = 0; a.t = 0;
    }
    gl.info.reset();
  }, -3);
  return null;
}

// ---------------------------------------------------------------- scene
export function Scene(p: SceneProps) {
  const { layout, colors, motion } = p;
  const unitColors = useMemo(() => ({ woof: colors.woof, mid: colors.mid, tw: colors.tw }), [colors.woof, colors.mid, colors.tw]);
  // Contact shadows are rendered once and only re-rendered when the silhouette changes.
  const shadowKey = `${layout.woofer.size.join()}|${layout.top.size.join()}|${layout.top.center.join()}`;
  const footprint = Math.max(layout.bounds.size[0], layout.bounds.size[2]);

  return (
    <>
      <Clock motion={motion} animating={p.animating} />
      <Invalidator deps={[p.probe, p.xray, p.waves, colors, p.hovered, p.focused, p.quality]} />
      <Exposure light={colors.light} />
      <Backdrop colors={colors} />
      {p.onFps && <FpsProbe onFps={p.onFps} />}
      <PerformanceMonitor onDecline={() => p.onQuality("low")} flipflops={2} />

      <CameraRig layout={layout} frameKey={p.frameKey} cameraRef={p.cameraRef} reducedMotion={p.reducedMotion} initialPreset={p.initialPreset} />
      <Studio light={colors.light} />
      <directionalLight position={[1.8, 3.2, 2.6]} intensity={colors.light ? 1.4 : 1.3} color="#fffaf2" />
      <directionalLight position={[-2.5, 1.4, -1.5]} intensity={0.45} color="#cfdcff" />
      <directionalLight position={[-0.8, 1.2, 3.5]} intensity={colors.light ? 0.55 : 0.45} color="#ffffff" />
      {/* cool rim light from behind and above: separates the dark lacquer cabinet's top and back edges
          from the graphite backdrop in the dark theme */}
      <directionalLight position={[-1.5, 2.5, -2.5]} intensity={colors.light ? 0.35 : 0.85} color="#cfe0ff" />

      <Speaker layout={layout} colors={colors} motion={motion} xray={p.xray} onHover={p.onHover} onSelect={p.onSelect} />
      <Waves layout={layout} colors={unitColors} motion={motion} visible={p.waves} lightTheme={colors.light} />
      <LabelLeaders layout={layout} probe={p.probe} colors={unitColors} hovered={p.hovered} focused={p.focused} nodes={p.labelNodes} />

      {/* Blur is in units of 1/256 of the shadow plane: scale it with the footprint for a constant ~4 cm spread. */}
      <ContactShadows key={shadowKey} position={[layout.bounds.center[0], 0.0008, 0]} scale={footprint * 2.4}
        resolution={512} blur={(0.04 * 256) / (footprint * 2.4)} far={0.45} opacity={colors.light ? 0.5 : 0.85}
        frames={1} color="#000000" smooth />
      <Grid
        position={[layout.bounds.center[0], -0.0005, 0]} args={[8, 8]} infiniteGrid={false} followCamera={false} fadeFrom={0}
        cellSize={0.1} cellThickness={0.6} cellColor={colors.grid}
        sectionSize={0.5} sectionThickness={1} sectionColor={colors.gridStrong}
        fadeDistance={footprint * 3.4} fadeStrength={2.4}
      />

      {p.quality === "high" && (
        <EffectComposer multisampling={4} enableNormalPass={false}>
          {/* Only the glow rings (driven above 1.3) bloom; wavefronts and lacquer highlights stay below the threshold. */}
          <Bloom mipmapBlur luminanceThreshold={1.3} luminanceSmoothing={0.2} intensity={0.7} radius={0.55} />
        </EffectComposer>
      )}
    </>
  );
}
