// Listening-test kit, part 5: its own small store (Zustand), separate from the design store. One document
// (protocol + ratings) per profile id, remembered in localStorage and moved between machines as a JSON
// file. Storage can be missing, full or throwing (private windows, tests): every access is guarded and
// the kit works without it.

import { create } from "zustand";
import { produce } from "immer";
import { emptyDoc, readDoc, type ListenTestDoc, type Protocol, type Rating } from "./model";

export const STORAGE_PREFIX = "crossover-studio:listentest:";
export const storageKey = (profileId: string) => STORAGE_PREFIX + profileId;
export const FILE_KIND = "crossover-studio-listening-test";

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function defaultStorage(): StorageLike | null {
  try { return typeof localStorage !== "undefined" ? localStorage : null; } catch { return null; }
}

/** The stored document of a profile, or null when there is none (or it is unreadable). */
export function loadDoc(profileId: string, storage: StorageLike | null = defaultStorage()): ListenTestDoc | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(storageKey(profileId));
    return raw ? readDoc(JSON.parse(raw), profileId) : null;
  } catch { return null; }
}

export function saveDoc(doc: ListenTestDoc, storage: StorageLike | null = defaultStorage()): boolean {
  if (!storage) return false;
  try { storage.setItem(storageKey(doc.profileId), JSON.stringify(doc)); return true; } catch { return false; }
}

/** The JSON file export/import moves: the document plus a kind tag, pretty-printed for a diff. */
export function docToFile(doc: ListenTestDoc): string {
  return JSON.stringify({ kind: FILE_KIND, ...doc }, null, 2) + "\n";
}

/** Parse an exported file. Throws a plain-language error when it is not one. */
export function docFromFile(text: string, profileId: string): ListenTestDoc {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { throw new Error("The file is not JSON."); }
  if (!raw || typeof raw !== "object" || (raw as { kind?: unknown }).kind !== FILE_KIND)
    throw new Error("The file is not a Crossover Studio listening test.");
  const doc = readDoc(raw, profileId);
  if (!doc) throw new Error("The file holds no protocol.");
  return { ...doc, profileId };
}

// ---------------------------------------------------------------- the store
export interface ListenTestState {
  /** The open document (null until a profile is opened). */
  doc: ListenTestDoc | null;
  /** Demo data (screenshots, ?ltdemo=1) is never written to storage. */
  ephemeral: boolean;
  open(profileId: string): void;
  editProtocol(mut: (p: Protocol) => void): void;
  /** Set (or with value null, clear) one rating. */
  rate(r: Omit<Rating, "value">, value: number | null): void;
  clearRatings(listener?: number): void;
  replace(doc: ListenTestDoc, ephemeral?: boolean): void;
  reset(): void;
}

const sameKey = (a: Omit<Rating, "value">, b: Omit<Rating, "value">) =>
  a.listener === b.listener && a.rep === b.rep && a.item === b.item && a.variant === b.variant && a.attr === b.attr;

export const useListenTest = create<ListenTestState>()((set, get) => {
  const commit = (doc: ListenTestDoc) => { set({ doc }); if (!get().ephemeral) saveDoc(doc); };
  return {
    doc: null,
    ephemeral: false,
    open(profileId) {
      const cur = get().doc;
      if (cur?.profileId === profileId) return;
      set({ doc: loadDoc(profileId) ?? emptyDoc(profileId), ephemeral: false });
    },
    editProtocol(mut) {
      const d = get().doc; if (!d) return;
      const next = produce(d, x => {
        mut(x.protocol);
        // ratings of removed variants, items, attributes or listeners no longer mean anything
        const p = x.protocol;
        const v = new Set(p.variants.map(i => i.id)), it = new Set(p.items.map(i => i.id)), at = new Set(p.attributes.map(i => i.id));
        x.ratings = x.ratings.filter(r => v.has(r.variant) && it.has(r.item) && at.has(r.attr) && r.listener < p.listeners && r.rep < p.reps);
      });
      commit(next);
    },
    rate(key, value) {
      const d = get().doc; if (!d) return;
      const ratings = d.ratings.filter(r => !sameKey(r, key));
      if (value !== null) ratings.push({ ...key, value });
      commit({ ...d, ratings });
    },
    clearRatings(listener) {
      const d = get().doc; if (!d) return;
      commit({ ...d, ratings: listener === undefined ? [] : d.ratings.filter(r => r.listener !== listener) });
    },
    replace(doc, ephemeral = false) {
      set({ ephemeral });
      commit(doc);
    },
    reset() {
      const d = get().doc; if (!d) return;
      commit(emptyDoc(d.profileId));
    },
  };
});

/** Cached read of a profile's document for the insight provider (cheap: no parse once cached). */
const peekCache = new Map<string, { raw: string | null; doc: ListenTestDoc | null }>();
export function peekDoc(profileId: string): ListenTestDoc | null {
  const open = useListenTest.getState().doc;
  if (open?.profileId === profileId) return open;
  const s = defaultStorage();
  let raw: string | null = null;
  try { raw = s?.getItem(storageKey(profileId)) ?? null; } catch { raw = null; }
  const hit = peekCache.get(profileId);
  if (hit && hit.raw === raw) return hit.doc;
  let doc: ListenTestDoc | null = null;
  try { doc = raw ? readDoc(JSON.parse(raw), profileId) : null; } catch { doc = null; }
  peekCache.set(profileId, { raw, doc });
  return doc;
}
