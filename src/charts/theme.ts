// Theme bridge for canvas drawing. Canvas cannot use var(--x), so colours and fonts are read from the
// computed style of the plot element and re-read whenever the theme can have changed: the
// data-theme attribute (or class/style) on <html>, the OS colour scheme, or a web font finishing loading.

import { useSyncExternalStore } from "react";

/** Colour tokens a series, band or line may name instead of a CSS colour. */
export const COLOR_TOKENS = [
  "woof", "mid", "tw", "sum", "ref", "accent", "good", "warn", "bad",
  "text", "text-2", "text-3", "grid", "grid-strong", "line", "line-strong", "band", "focus",
] as const;
export type ColorToken = (typeof COLOR_TOKENS)[number];

const TOKEN_SET = new Set<string>(COLOR_TOKENS);

/** Fallbacks used only when a token is missing (e.g. a plot rendered outside the app shell). */
const FALLBACK: Record<string, string> = {
  bg: "#0e1113", "surface-1": "#14181b", "surface-2": "#1b2024", "surface-3": "#0b0e10",
  text: "#e6e9ea", "text-2": "#a9b1b5", "text-3": "#6d777c",
  line: "#252c31", "line-strong": "#343d43", grid: "#1d2428", "grid-strong": "#2b3439",
  accent: "#f25c88", "accent-text": "#1c0c05", focus: "#f7789d",
  woof: "#5b9cf0", mid: "#f0a34a", tw: "#4fc98a", sum: "#e6e9ea", ref: "#8b939a",
  good: "#4fc98a", warn: "#e8b54a", bad: "#ef6a5e", band: "rgba(230,233,234,0.07)",
};

const FONT_FALLBACK = {
  mono: '"JetBrains Mono", ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace',
  ui: 'Barlow, "Segoe UI", system-ui, sans-serif',
  cond: '"Barlow Semi Condensed", "Arial Narrow", sans-serif',
};

export interface ChartTheme {
  /** Resolve a token name ('woof'), a custom property ('--x') or a literal CSS colour. */
  color(nameOrCss: string | undefined, fallback?: string): string;
  surface1: string;
  surface2: string;
  text: string;
  text2: string;
  text3: string;
  grid: string;
  gridStrong: string;
  line: string;
  lineStrong: string;
  accent: string;
  accentText: string;
  band: string;
  fontMono: string;
  fontUi: string;
  fontCond: string;
}

export function readTheme(el: Element): ChartTheme {
  const cs = getComputedStyle(el);
  const cache = new Map<string, string>();
  const prop = (name: string): string => {
    let v = cache.get(name);
    if (v === undefined) {
      v = cs.getPropertyValue(`--${name}`).trim() || FALLBACK[name] || "";
      cache.set(name, v);
    }
    return v;
  };
  const color = (c: string | undefined, fallback = "text"): string => {
    if (!c) return prop(fallback);
    if (c.startsWith("--")) return cs.getPropertyValue(c).trim() || prop(fallback);
    if (c.startsWith("var(")) {
      const m = /var\(\s*(--[\w-]+)/.exec(c);
      return (m && cs.getPropertyValue(m[1]).trim()) || prop(fallback);
    }
    if (TOKEN_SET.has(c)) return prop(c);
    return c;
  };
  const font = (name: string, fb: string) => cs.getPropertyValue(`--font-${name}`).trim() || fb;
  return {
    color,
    surface1: prop("surface-1"),
    surface2: prop("surface-2"),
    text: prop("text"),
    text2: prop("text-2"),
    text3: prop("text-3"),
    grid: prop("grid"),
    gridStrong: prop("grid-strong"),
    line: prop("line"),
    lineStrong: prop("line-strong"),
    accent: prop("accent"),
    accentText: prop("accent-text"),
    band: prop("band"),
    fontMono: font("mono", FONT_FALLBACK.mono),
    fontUi: font("ui", FONT_FALLBACK.ui),
    fontCond: font("label", "") || font("cond", FONT_FALLBACK.cond),
  };
}

/** CSS value for DOM elements (legend swatches, readout dots): tokens become var(--token). */
export function cssColor(c: string | undefined, fallback = "text"): string {
  if (!c) return `var(--${fallback})`;
  if (c.startsWith("--")) return `var(${c})`;
  if (TOKEN_SET.has(c)) return `var(--${c})`;
  return c;
}

// ---------------------------------------------------------------- change notification

let themeVersion = 0;
const listeners = new Set<() => void>();
let installed = false;

function bump() {
  themeVersion++;
  for (const l of listeners) l();
}

function install() {
  if (installed || typeof document === "undefined") return;
  installed = true;
  const mo = new MutationObserver(bump);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "class", "style"] });
  if (document.body) mo.observe(document.body, { attributes: true, attributeFilter: ["data-theme", "class"] });
  window.matchMedia?.("(prefers-color-scheme: dark)").addEventListener?.("change", bump);
  window.matchMedia?.("(prefers-contrast: more)").addEventListener?.("change", bump);
  // Canvas text drawn before a web font arrives uses the fallback face; redraw once it lands.
  document.fonts?.addEventListener?.("loadingdone", bump);
  document.fonts?.ready.then(bump);
  for (const spec of ['400 11px "JetBrains Mono"', '500 11px "JetBrains Mono"', '600 11px "Barlow Semi Condensed"']) {
    document.fonts?.load(spec).then(bump, () => undefined);
  }
}

/** Subscribe to theme/font changes. Returns an unsubscribe function. */
export function onThemeChange(cb: () => void): () => void {
  install();
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Force a re-read, e.g. after a theme switch that only changed a stylesheet. */
export function invalidateChartTheme(): void {
  bump();
}

/** React hook: a number that changes whenever the theme may have changed. */
export function useThemeVersion(): number {
  return useSyncExternalStore(onThemeChange, () => themeVersion, () => 0);
}

/** True when the user asked the OS for reduced motion. */
export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}
