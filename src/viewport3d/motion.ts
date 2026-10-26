// Shared, mutable animation state. React owns the slow-changing inputs (probe sample, toggles); every mesh reads
// this object inside useFrame, so a frame never waits for a React render.

import type { ProbeState } from "./physics";
import type { UnitId } from "../types";

/** The probe frequency is shown slowed down to this rate so phase relationships are visible. */
export const VISUAL_HZ = 0.9;
/** Time used for the still pose (reduced motion / animation off): every cone is visibly displaced. */
export const STILL_T = 0.18;

export interface Motion {
  /** Visual clock, s. Advances only while animating. */
  t: number;
  probe: ProbeState | null;
  waves: boolean;
  hovered: UnitId | null;
  focused: UnitId | null;
}

export function createMotion(): Motion {
  return { t: STILL_T, probe: null, waves: true, hovered: null, focused: null };
}

/** Displacement of a sinusoid with the given phase at visual time t, in -1..1. */
export function oscillation(t: number, phase: number): number {
  return Math.sin(2 * Math.PI * VISUAL_HZ * t + phase);
}

/** Exponential smoothing factor for a frame of length dt (s) and time constant tau (s). */
export function damp(dt: number, tau: number): number {
  return 1 - Math.exp(-dt / Math.max(1e-4, tau));
}
