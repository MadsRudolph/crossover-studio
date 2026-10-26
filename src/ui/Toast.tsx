import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { create } from "zustand";
import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from "lucide-react";

export type ToastTone = "info" | "good" | "warn" | "bad";

export interface ToastInput {
  title: ReactNode;
  description?: ReactNode;
  tone?: ToastTone;
  /** One action button, e.g. { label: "Undo", onClick: undo }. */
  action?: { label: string; onClick(): void };
  /** ms before it leaves on its own; 0 keeps it until dismissed. Default 4.5 s (errors 8 s). */
  duration?: number;
  /** Replaces an existing toast with the same id instead of stacking a second one. */
  id?: string;
}

interface ToastItem extends ToastInput { id: string; created: number; leaving?: boolean }

const useToasts = create<{ items: ToastItem[] }>(() => ({ items: [] }));
let seq = 0;

/** Show a toast from anywhere (also outside React). Returns its id. */
export function toast(t: ToastInput): string {
  const id = t.id ?? `t${++seq}`;
  const item: ToastItem = { ...t, id, created: Date.now() };
  useToasts.setState(s => {
    const rest = s.items.filter(x => x.id !== id);
    return { items: [...rest, item].slice(-4) };
  });
  return id;
}

export function dismissToast(id: string) {
  useToasts.setState(s => ({ items: s.items.map(x => x.id === id ? { ...x, leaving: true } : x) }));
  setTimeout(() => useToasts.setState(s => ({ items: s.items.filter(x => x.id !== id) })), 200);
}

/** Hook form for components: const { toast, dismiss } = useToast(). */
export function useToast() {
  return { toast, dismiss: dismissToast };
}

const ICONS = { info: Info, good: CircleCheck, warn: TriangleAlert, bad: CircleAlert };

function ToastCard({ item }: { item: ToastItem }) {
  const tone = item.tone ?? "info";
  const Icon = ICONS[tone];
  const [hover, setHover] = useState(false);
  const duration = item.duration ?? (tone === "bad" ? 8000 : 4500);
  const left = useRef(duration);
  useEffect(() => {
    if (!duration || hover || item.leaving) return;
    const start = Date.now();
    const t = setTimeout(() => dismissToast(item.id), left.current);
    return () => { clearTimeout(t); left.current -= Date.now() - start; };
  }, [hover, duration, item.id, item.leaving, item.created]);
  // a replaced toast (same id) restarts its timer
  useEffect(() => { left.current = duration; }, [item.created, duration]);

  return (
    <div
      className={`cs-toast cs-toast-${tone}`}
      data-state={item.leaving ? "closed" : "open"}
      role={tone === "bad" ? "alert" : "status"}
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
    >
      <Icon className="cs-toast-icon" size={16} strokeWidth={1.9} aria-hidden />
      <div className="cs-toast-text">
        <div className="cs-toast-title">{item.title}</div>
        {item.description && <div className="cs-toast-desc">{item.description}</div>}
      </div>
      {item.action && (
        <button type="button" className="cs-toast-action" onClick={() => { item.action!.onClick(); dismissToast(item.id); }}>
          {item.action.label}
        </button>
      )}
      <button type="button" className="cs-toast-close" aria-label="Dismiss" onClick={() => dismissToast(item.id)}>
        <X size={13} strokeWidth={2} />
      </button>
    </div>
  );
}

/** Render once near the root. Toasts stack at the bottom right, above the status bar. */
export function Toaster() {
  const items = useToasts(s => s.items);
  return createPortal(
    <div className="cs-toaster" aria-live="polite">
      {items.map(t => <ToastCard key={t.id} item={t} />)}
    </div>,
    document.body,
  );
}
