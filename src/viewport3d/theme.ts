// Reads the design tokens (CSS custom properties) into three.js colours and keeps them in sync with the theme.
// Tokens may be written in any CSS colour syntax (hex, rgb, hsl, oklch...), so each is resolved by painting one
// pixel with the browser's own parser instead of trusting three's string parser.

import { useEffect, useState } from "react";
import { useStore } from "../state/store";

export interface SceneColors {
  woof: string; mid: string; tw: string;
  text: string; text2: string; text3: string;
  line: string; grid: string; gridStrong: string;
  bg: string; surface1: string; surface2: string; accent: string;
  /** Light theme: the scene lifts its exposure and uses lighter shadows. */
  light: boolean;
}

/** Fallbacks matching the dark theme of docs/DESIGN.md, used only if a token is missing. */
const FALLBACK: Omit<SceneColors, "light"> = {
  woof: "#5b9dff", mid: "#f2a24a", tw: "#4fd08a",
  text: "#e9ecef", text2: "#aab1b9", text3: "#6f7780",
  line: "#2a2f35", grid: "#2a2f35", gridStrong: "#3a4048",
  bg: "#0c0f12", surface1: "#13171b", surface2: "#1a1f24", accent: "#f25c88",
};

const TOKENS: Record<keyof typeof FALLBACK, string> = {
  woof: "--woof", mid: "--mid", tw: "--tw", text: "--text", text2: "--text-2", text3: "--text-3",
  line: "--line", grid: "--grid", gridStrong: "--grid-strong", bg: "--bg",
  surface1: "--surface-1", surface2: "--surface-2", accent: "--accent",
};

let probeCtx: CanvasRenderingContext2D | null | undefined;

/** Resolve any CSS colour to "#rrggbb". Translucent colours (the grid tokens) are composited over `backdrop`. */
export function resolveCssColor(value: string, fallback: string, backdrop?: string): string {
  const v = value.trim();
  if (!v) return fallback;
  if (/^#[0-9a-f]{6}$/i.test(v)) return v.toLowerCase();
  if (probeCtx === undefined) {
    try { probeCtx = document.createElement("canvas").getContext("2d", { willReadFrequently: true }); }
    catch { probeCtx = null; }
  }
  if (!probeCtx) return fallback;
  probeCtx.clearRect(0, 0, 1, 1);
  if (backdrop) { probeCtx.fillStyle = backdrop; probeCtx.fillRect(0, 0, 1, 1); }
  probeCtx.fillStyle = fallback;
  probeCtx.fillStyle = v;           // ignored by the browser if it cannot parse v, so the fallback stays
  probeCtx.fillRect(0, 0, 1, 1);
  const [r, g, b] = probeCtx.getImageData(0, 0, 1, 1).data;
  return "#" + [r, g, b].map(x => x.toString(16).padStart(2, "0")).join("");
}

export function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const lin = (c: number) => { const s = c / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
}

export function readSceneColors(el: Element = document.documentElement): SceneColors {
  const cs = getComputedStyle(el);
  const out = {} as SceneColors;
  const bg = resolveCssColor(cs.getPropertyValue(TOKENS.bg), FALLBACK.bg);
  for (const k of Object.keys(TOKENS) as (keyof typeof FALLBACK)[]) out[k] = resolveCssColor(cs.getPropertyValue(TOKENS[k]), FALLBACK[k], bg);
  out.light = luminance(out.bg) > 0.4;
  return out;
}

/** Scene colours, re-read whenever the theme can have changed (store theme, data-theme/class/style, OS scheme). */
export function useSceneColors(): SceneColors {
  const theme = useStore(s => s.theme);
  const [colors, setColors] = useState<SceneColors>(() => readSceneColors());
  useEffect(() => {
    const update = () => setColors(prev => {
      const next = readSceneColors();
      return (Object.keys(next) as (keyof SceneColors)[]).some(k => next[k] !== prev[k]) ? next : prev;
    });
    update();
    // The shell may apply the theme a frame after the store changes.
    const raf = requestAnimationFrame(update);
    const mo = new MutationObserver(update);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "class", "style"] });
    if (document.body) mo.observe(document.body, { attributes: true, attributeFilter: ["data-theme", "class", "style"] });
    const mq = matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", update);
    return () => { cancelAnimationFrame(raf); mo.disconnect(); mq.removeEventListener("change", update); };
  }, [theme]);
  return colors;
}

/** prefers-reduced-motion, live. */
export function useReducedMotion(): boolean {
  const query = "(prefers-reduced-motion: reduce)";
  const [reduced, setReduced] = useState(() => typeof matchMedia !== "undefined" && matchMedia(query).matches);
  useEffect(() => {
    const mq = matchMedia(query);
    const on = () => setReduced(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return reduced;
}
