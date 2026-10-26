// Crosshair and x-view synchronisation between plots that share a syncId (stacked magnitude/phase,
// response/impedance). A plain in-memory bus: plots publish where the pointer is and what x window they
// show; the others follow without re-rendering React.

import type { Range } from "./scale";

export interface SyncEvent {
  /** Plot that published the event; listeners ignore their own. */
  source: symbol;
  kind: "hover" | "view" | "margin";
  /** hover: frequency under the pointer, or null when it left. */
  x?: number | null;
  /** view: the publisher's x window (and whether it animates there). */
  view?: Range;
  animate?: boolean;
}

type Listener = (e: SyncEvent) => void;

const channels = new Map<string, Set<Listener>>();

export function subscribeSync(id: string, listener: Listener): () => void {
  let set = channels.get(id);
  if (!set) channels.set(id, (set = new Set()));
  set.add(listener);
  return () => {
    set.delete(listener);
    if (set.size === 0) channels.delete(id);
  };
}

export function publishSync(id: string, event: SyncEvent): void {
  const set = channels.get(id);
  if (!set) return;
  for (const l of set) l(event);
}

// Left gutters: every plot on a channel uses the widest one so their x axes line up exactly.
const margins = new Map<string, Map<symbol, number>>();

/** Record this plot's natural left gutter; returns the channel's widest. Tells the others if it grew or shrank. */
export function reportMargin(id: string, source: symbol, px: number): number {
  let m = margins.get(id);
  if (!m) margins.set(id, (m = new Map()));
  const before = maxOf(m);
  if (m.get(source) !== px) {
    m.set(source, px);
    if (maxOf(m) !== before) publishSync(id, { source, kind: "margin" });
  }
  return maxOf(m);
}

export function dropMargin(id: string, source: symbol): void {
  const m = margins.get(id);
  if (!m) return;
  const before = maxOf(m);
  m.delete(source);
  if (m.size === 0) margins.delete(id);
  else if (maxOf(m) !== before) publishSync(id, { source, kind: "margin" });
}

function maxOf(m: Map<symbol, number>): number {
  let v = 0;
  for (const x of m.values()) v = Math.max(v, x);
  return v;
}
