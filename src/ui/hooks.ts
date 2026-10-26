// Small hooks shared by the primitives.
import { useEffect, useRef, useState, type RefObject } from "react";

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

export function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(el => el.offsetParent !== null || el === document.activeElement);
}

/**
 * Traps Tab inside `ref` while active, focuses the first focusable (or `initial`) on open,
 * and gives focus back to whatever had it before when the trap ends.
 */
export function useFocusTrap(ref: RefObject<HTMLElement | null>, active: boolean, initial?: RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!active) return;
    const before = document.activeElement as HTMLElement | null;
    const root = ref.current;
    if (!root) return;
    // without an explicit target the container itself takes focus: no ring jumps onto the Close button,
    // and the first Tab still lands on the first control
    const first = initial?.current ?? root;
    // wait a frame so an opening transition does not swallow the focus
    const raf = requestAnimationFrame(() => first.focus({ preventScroll: true }));
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const list = focusables(root);
      if (!list.length) { e.preventDefault(); return; }
      const i = list.indexOf(document.activeElement as HTMLElement);
      if (e.shiftKey && (i <= 0)) { e.preventDefault(); list[list.length - 1].focus(); }
      else if (!e.shiftKey && i === list.length - 1) { e.preventDefault(); list[0].focus(); }
    };
    root.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(raf);
      root.removeEventListener("keydown", onKey);
      if (before && before.isConnected) before.focus({ preventScroll: true });
    };
  }, [active, ref, initial]);
}

/** Calls `onOutside` for a pointer press outside every given element. */
export function useOutsidePress(refs: RefObject<HTMLElement | null>[], active: boolean, onOutside: () => void) {
  const cb = useRef(onOutside);
  cb.current = onOutside;
  useEffect(() => {
    if (!active) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (refs.some(r => r.current?.contains(t))) return;
      cb.current();
    };
    // capture, so a click that also starts something else still closes the popover first
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [active, ...refs]);
}

/** Escape closes the topmost layer only: layers register in order and the last one wins. */
const escapeStack: { id: number; cb: () => void }[] = [];
let escapeId = 0;
let escapeListening = false;

function onEscape(e: KeyboardEvent) {
  if (e.key !== "Escape" || !escapeStack.length) return;
  e.preventDefault();
  e.stopPropagation();
  escapeStack[escapeStack.length - 1].cb();
}

export function useEscape(active: boolean, cb: () => void) {
  const ref = useRef(cb);
  ref.current = cb;
  useEffect(() => {
    if (!active) return;
    const id = ++escapeId;
    escapeStack.push({ id, cb: () => ref.current() });
    if (!escapeListening) { window.addEventListener("keydown", onEscape, true); escapeListening = true; }
    return () => {
      const i = escapeStack.findIndex(x => x.id === id);
      if (i >= 0) escapeStack.splice(i, 1);
    };
  }, [active]);
}

/** True while any Escape-closable layer (dialog, popover, menu) is open; global shortcuts stand down. */
export const layerOpen = () => escapeStack.length > 0;

/** Keeps a component mounted for `ms` after `open` turns false, so it can play its exit animation. */
export function usePresence(open: boolean, ms = 180): { mounted: boolean; state: "open" | "closed" } {
  const [mounted, setMounted] = useState(open);
  const [state, setState] = useState<"open" | "closed">(open ? "open" : "closed");
  useEffect(() => {
    if (open) {
      setMounted(true);
      const raf = requestAnimationFrame(() => requestAnimationFrame(() => setState("open")));
      return () => cancelAnimationFrame(raf);
    }
    setState("closed");
    const t = setTimeout(() => setMounted(false), ms);
    return () => clearTimeout(t);
  }, [open, ms]);
  return { mounted, state };
}

export const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
