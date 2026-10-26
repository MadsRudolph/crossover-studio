// Expanding wavefront shells, one family per driver. Each shell leaves its driver when the cone reaches its
// forward peak, so units in phase launch coinciding shells and units out of phase alternate: the crossover phase
// relationship is visible at a glance. Rim-lit (Fresnel) hemispheres, additive, so they never hide the model.

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { UNIT_IDS, type UnitId } from "../types";
import type { SceneLayout } from "./layout";
import { VISUAL_HZ, type Motion } from "./motion";

/** Shells alive per driver and their spacing (m): together they set how far the waves travel. */
const SHELLS = 3;
const SPACING = 0.2;

const vertex = /* glsl */ `
  varying vec3 vNormalW;
  varying vec3 vViewW;
  varying float vFront;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vNormalW = normalize(mat3(modelMatrix) * normal);
    vViewW = normalize(cameraPosition - wp.xyz);
    vFront = position.z;            // 0 at the baffle plane, 1 on the axis of the unit hemisphere
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const fragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  varying vec3 vNormalW;
  varying vec3 vViewW;
  varying float vFront;
  void main() {
    float facing = abs(dot(normalize(vNormalW), normalize(vViewW)));
    float rim = pow(1.0 - facing, 5.0);
    float base = smoothstep(0.0, 0.3, vFront);    // fade into the baffle instead of a hard edge
    float a = uOpacity * (0.03 + 0.97 * rim) * rim * base;
    gl_FragColor = vec4(uColor, a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

interface Shell { unit: UnitId; k: number; mesh: THREE.Mesh; mat: THREE.ShaderMaterial }

export function Waves({ layout, colors, motion, visible, lightTheme }: {
  layout: SceneLayout; colors: Record<UnitId, string>; motion: Motion; visible: boolean; lightTheme: boolean;
}) {
  const group = useRef<THREE.Group>(null);
  const geometry = useMemo(() => {
    const g = new THREE.SphereGeometry(1, 56, 18, 0, Math.PI * 2, 0, Math.PI / 2);
    g.rotateX(Math.PI / 2); // pole to +z, the driver's axis
    return g;
  }, []);

  const shells = useMemo<Shell[]>(() => UNIT_IDS.flatMap(unit => Array.from({ length: SHELLS }, (_, k) => {
    const mat = new THREE.ShaderMaterial({
      vertexShader: vertex, fragmentShader: fragment,
      uniforms: { uColor: { value: new THREE.Color() }, uOpacity: { value: 0 } },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geometry, mat);
    mesh.renderOrder = 5;
    mesh.layers.set(1); // overlay layer: no contact shadow
    mesh.frustumCulled = false;
    return { unit, k, mesh, mat };
  })), [geometry]);

  useEffect(() => {
    const g = group.current;
    if (!g) return;
    for (const s of shells) g.add(s.mesh);
    return () => { for (const s of shells) { g.remove(s.mesh); s.mat.dispose(); } };
  }, [shells]);
  useEffect(() => () => geometry.dispose(), [geometry]);

  useEffect(() => {
    for (const s of shells) {
      (s.mat.uniforms.uColor.value as THREE.Color).set(colors[s.unit]);
      // Additive light glows on a dark ground but washes out on a light one: there the shells are painted.
      s.mat.blending = lightTheme ? THREE.NormalBlending : THREE.AdditiveBlending;
      s.mat.needsUpdate = true;
    }
  }, [shells, colors, lightTheme]);

  useFrame(() => {
    const probe = motion.probe;
    for (const s of shells) {
      const u = probe?.units[s.unit];
      if (!visible || !u || u.share < 0.002) { s.mesh.visible = false; continue; }
      const d = layout.drivers[s.unit];
      // Cycles since this shell's launch; the cone peaks (sin = 1) when VISUAL_HZ t + phase/2pi = 1/4.
      const cycles = VISUAL_HZ * motion.t + u.conePhase / (2 * Math.PI) - 0.25;
      const age = (((cycles + s.k) % SHELLS) + SHELLS) % SHELLS;
      const r = d.coneR * 0.8 + SPACING * age;
      const life = age / SHELLS;
      const fadeIn = Math.min(1, age / 0.18);
      s.mesh.visible = true;
      s.mesh.position.set(d.pos[0], d.pos[1], d.pos[2] + 0.004);
      s.mesh.scale.setScalar(r);
      s.mat.uniforms.uOpacity.value = (lightTheme ? 0.75 : 0.6) * Math.sqrt(u.share) * fadeIn * (1 - life) ** 1.7;
    }
  });

  return <group ref={group} />;
}
