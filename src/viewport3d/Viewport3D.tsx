// The System view's 3D model: the group's loudspeaker at real size, moving at the probe frequency.
// Reads everything from the store; owns only view-local state (hover, camera, render quality).

import { Component, useCallback, useEffect, useMemo, useRef, useState, type ErrorInfo, type KeyboardEvent, type ReactNode } from "react";
import { Canvas } from "@react-three/fiber";
import { Box } from "lucide-react";
import { UNIT_IDS, type UnitId } from "../types";
import { useStore } from "../state/store";
import { fmtFreq } from "../ui/format";
import * as engine from "../engine";
import { sceneLayout, type CameraPreset } from "./layout";
import { createMotion, VISUAL_HZ } from "./motion";
import { excursionCeilingDb, nearestIndex, sampleC, sampleProbe, type ProbeState } from "./physics";
import { Scene, FOV_DEG, type CameraApi, type FrameStats, type Quality } from "./Scene";
import { Toolbar } from "./Toolbar";
import { Fallback } from "./Fallback";
import { LabelOverlay, type LabelNodes } from "./Labels";
import { useReducedMotion, useSceneColors } from "./theme";
import "./viewport3d.css";

function hasWebGL2(): boolean {
  try {
    const c = document.createElement("canvas");
    const gl = c.getContext("webgl2");
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
    return !!gl;
  } catch {
    return false;
  }
}

class CanvasBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: unknown, info: ErrorInfo) { console.error("3D view:", error, info.componentStack); }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}


/** Woofer box volume velocities at the sampled frequency (cone U_D, vent U_P into the box). */
type ProbeBox = { UD: { re: number; im: number }; UP: { re: number; im: number } } | null;

function useProbeState(layout: ReturnType<typeof sceneLayout> | null): ProbeState | null {
  const results = useStore(s => s.results);
  const prep = useStore(s => s.prep);
  const design = useStore(s => s.design);
  const probe = useStore(s => s.probe);

  const areas = useMemo(() => {
    if (!layout) return null;
    const a = {} as Record<UnitId, number>;
    for (const u of UNIT_IDS) a[u] = Math.PI * (layout.drivers[u].unit.diameter_m / 2) ** 2;
    return a;
  }, [layout]);

  const ceiling = useMemo(() => {
    const on = results?.angles["0"];
    return on && areas ? excursionCeilingDb(on, results.f, areas) : 0;
  }, [results, areas]);

  return useMemo(() => {
    const on = results?.angles["0"];
    if (!results || !on || !areas || !layout) return null;
    const i = Math.max(0, nearestIndex(results.f, probe));
    let box: ProbeBox = null;
    if (prep && design.box.mode !== "plugged") {
      try {
        const r = engine.boxResponse(prep, design, [results.f[i]]);
        box = { UD: sampleC(r.UD), UP: sampleC(r.UP) };
      } catch { box = null; }
    }
    return sampleProbe({
      f: results.f, on, probeHz: probe, areas, ceilingDb: ceiling, box, vents: layout.vents,
      phaseAt: prep ? (z, k) => engine.displayPhase(prep, z, k) : undefined,
      refDb: results.metrics.on.level,
    });
  }, [results, prep, design, probe, areas, ceiling, layout]);
}

export interface Viewport3DProps {
  /** Camera pose when a loudspeaker is first shown (default three-quarter). */
  initialPreset?: CameraPreset;
}

export function Viewport3D({ initialPreset = "threeQuarter" }: Viewport3DProps = {}) {
  const profile = useStore(s => s.profile);
  const box = useStore(s => s.design.box);
  const ui = useStore(s => s.ui);
  const setUi = useStore(s => s.setUi);
  const colors = useSceneColors();
  const reducedMotion = useReducedMotion();

  const layout = useMemo(() => (profile ? sceneLayout(profile, box) : null), [profile, box]);
  const probe = useProbeState(layout);
  const probeHz = useStore(s => s.probe);

  const motion = useRef(createMotion()).current;
  const camera = useRef<CameraApi>(null);
  const labelNodes: LabelNodes = useRef({});
  const [hovered, setHovered] = useState<UnitId | null>(null);
  // ?quality=low (dev) starts without post-processing, for comparing and for profiling weak GPUs.
  const [quality, setQuality] = useState<Quality>(() =>
    import.meta.env.DEV && typeof location !== "undefined" && new URLSearchParams(location.search).get("quality") === "low" ? "low" : "high");
  const [webgl2] = useState(hasWebGL2);
  const [canvasKey, setCanvasKey] = useState(0);
  const [lost, setLost] = useState(false);
  const [fps, setFps] = useState<FrameStats | null>(null);
  const showFps = import.meta.env.DEV && typeof location !== "undefined" && new URLSearchParams(location.search).has("fps");

  const focusPrefix = ui.focus?.split(".")[0];
  const focused = (UNIT_IDS as string[]).includes(focusPrefix ?? "") ? (focusPrefix as UnitId) : null;
  const animating = ui.animate && !reducedMotion;

  motion.probe = probe;
  motion.waves = ui.waves;
  motion.hovered = hovered;
  motion.focused = focused;

  const onHover = useCallback((u: UnitId | null) => setHovered(u), []);
  const onSelect = useCallback((u: UnitId) => setUi({ focus: u }), [setUi]);
  const goTo = useCallback((p: CameraPreset) => camera.current?.goTo(p), []);

  // Keyboard orbit while the view has focus (global shortcuts such as X belong to the shell).
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    const step = e.shiftKey ? 0.4 : 0.15;
    const map: Record<string, () => void> = {
      ArrowLeft: () => camera.current?.nudge(-step, 0),
      ArrowRight: () => camera.current?.nudge(step, 0),
      ArrowUp: () => camera.current?.nudge(0, -step),
      ArrowDown: () => camera.current?.nudge(0, step),
      "+": () => camera.current?.nudge(0, 0, 0.88),
      "=": () => camera.current?.nudge(0, 0, 0.88),
      "-": () => camera.current?.nudge(0, 0, 1.14),
      Home: () => goTo("threeQuarter"),
    };
    const act = map[e.key];
    if (act) { e.preventDefault(); act(); }
  };

  useEffect(() => {
    if (!hovered) return;
    document.body.style.cursor = "pointer";
    return () => { document.body.style.cursor = ""; };
  }, [hovered]);

  if (!profile || !layout) {
    return (
      <div className="v3d v3d-empty">
        <Box size={28} strokeWidth={1.25} aria-hidden />
        <div className="v3d-empty-title">No loudspeaker loaded</div>
        <div className="v3d-empty-text">Open a profile or import your Lab D/E measurements to see your system here.</div>
      </div>
    );
  }

  // The 3D canvas is up (not the flat fallback): only then do the camera and display controls mean anything.
  const live = webgl2 && !lost;
  const fallback = (reason: "no-webgl2" | "lost" | "error") => (
    <Fallback layout={layout} probe={probe} reason={reason}
      onRetry={reason === "no-webgl2" ? undefined : () => { setLost(false); setCanvasKey(k => k + 1); }} />
  );

  return (
    <div className={`v3d${colors.light ? " is-light" : ""}`} tabIndex={0} onKeyDown={onKeyDown}
      aria-label={`3D model of ${profile.name}. Drag to orbit, scroll to zoom, arrow keys to turn.`}
      onDoubleClick={e => { if ((e.target as HTMLElement).tagName === "CANVAS") goTo("threeQuarter"); }}>
      <div className="v3d-stage">
        {!webgl2 ? fallback("no-webgl2") : lost ? fallback("lost") : (
          <CanvasBoundary key={canvasKey} fallback={fallback("error")}>
            <Canvas
              frameloop={animating ? "always" : "demand"}
              dpr={quality === "high" ? [1, 2] : 1}
              camera={{ fov: FOV_DEG, near: 0.02, far: 40, position: [1.4, 1, 2] }}
              gl={{ alpha: false, antialias: quality === "low", powerPreference: "high-performance" }}
              onCreated={({ gl }) => {
                gl.domElement.addEventListener("webglcontextlost", e => { e.preventDefault(); setLost(true); }, { once: true });
              }}
              onPointerMissed={() => setHovered(null)}
            >
              <Scene
                layout={layout} frameKey={profile.id} initialPreset={initialPreset} colors={colors} motion={motion} probe={probe}
                xray={ui.xray} waves={ui.waves} animating={animating} reducedMotion={reducedMotion} quality={quality}
                hovered={hovered} focused={focused} cameraRef={camera} labelNodes={labelNodes}
                onHover={onHover} onSelect={onSelect} onQuality={setQuality} onFps={showFps ? setFps : undefined}
              />
            </Canvas>
            <LabelOverlay layout={layout} probe={probe} hovered={hovered} focused={focused} nodes={labelNodes}
              onHover={onHover} onSelect={onSelect} />
          </CanvasBoundary>
        )}
      </div>

      {live && <Toolbar onPreset={goTo} onReset={() => goTo("threeQuarter")} reducedMotion={reducedMotion} canAnimate={!reducedMotion} />}

      <div className="v3d-hud" aria-live="polite">
        {probe && (
          <span className="v3d-hud-probe">
            <span className="v3d-hud-k">Probe</span>
            {/* the store's probe, as every other readout shows it (probe.f is the nearest measured point) */}
            <span className="v3d-hud-v">{fmtFreq(probeHz)}</span>
            {animating && <span className="v3d-hud-k v3d-hud-note">animation slowed to {VISUAL_HZ} Hz</span>}
          </span>
        )}
        {ui.xray && layout.vents.some(v => v.open) && (
          <span className="v3d-hud-chip">Vent air moves with the box model</span>
        )}
        {layout && layout.vents.some(v => !v.open) && (
          <span className="v3d-hud-chip" title="A foam plug closes this vent in the current box setting">
            {layout.vents.filter(v => !v.open).map(v => `Vent ${v.id}`).join(" and ")} plugged
          </span>
        )}
        {fps !== null && (
          <span className="v3d-hud-chip is-mono">
            {fps.fps.toFixed(0)} fps · {fps.calls} calls · {(fps.triangles / 1000).toFixed(0)}k tris · {quality}
          </span>
        )}
      </div>
      {live && <div className="v3d-hint" aria-hidden>Drag to orbit · Scroll to zoom · Right-drag to pan</div>}
    </div>
  );
}
