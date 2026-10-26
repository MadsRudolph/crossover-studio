// Theme resolution. The store keeps the person's choice ("dark" | "light" | "system"); this module turns it
// into the concrete theme written to <html data-theme>, following the OS while the choice is "system".
// A `?theme=light|dark` URL parameter overrides it without saving (used for screenshots).
import { useEffect, useState } from "react";
import { useStore, type Theme } from "../state/store";

const media = () => (typeof window !== "undefined" && window.matchMedia ? window.matchMedia("(prefers-color-scheme: light)") : null);

export function urlThemeOverride(): "dark" | "light" | null {
  try {
    const t = new URLSearchParams(window.location.search).get("theme");
    return t === "light" || t === "dark" ? t : null;
  } catch { return null; }
}

export function resolveTheme(choice: Theme): "dark" | "light" {
  const o = urlThemeOverride();
  if (o) return o;
  if (choice === "system") return media()?.matches ? "light" : "dark";
  return choice;
}

/** The concrete theme in use, re-rendering when the choice or the OS setting changes. */
export function useResolvedTheme(): "dark" | "light" {
  const choice = useStore(s => s.theme);
  const [os, setOs] = useState(() => media()?.matches ?? false);
  useEffect(() => {
    const m = media();
    if (!m) return;
    const on = () => setOs(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  void os;
  return resolveTheme(choice);
}

/** Writes the resolved theme to <html>, suppressing transitions for the frame of the switch. */
export function useApplyTheme() {
  const theme = useResolvedTheme();
  useEffect(() => {
    const root = document.documentElement;
    if (root.dataset.theme === theme) return;
    root.classList.add("theme-switching");
    root.dataset.theme = theme;
    const raf = requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove("theme-switching")));
    return () => cancelAnimationFrame(raf);
  }, [theme]);
  return theme;
}

/** Current value of a CSS custom property (for canvas and WebGL, which cannot use var()). */
export function cssVar(name: string, el: Element = document.documentElement): string {
  return getComputedStyle(el).getPropertyValue(name.startsWith("--") ? name : `--${name}`).trim();
}
