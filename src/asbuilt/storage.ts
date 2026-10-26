// The imported as-built measurements, remembered per profile in localStorage so they survive a restart.
// Storage can be missing, full or throwing (private windows, tests): every access is guarded and the
// view works without it.

import type { Series, UnitId } from "../types";
import { emptyData, type AsBuiltData } from "./analyse";

export const STORAGE_PREFIX = "crossover-studio:asbuilt:";
export const storageKey = (profileId: string) => STORAGE_PREFIX + profileId;

/** What is stored: the data plus the "vents were open" choice. */
export interface Stored { data: AsBuiltData; ventsOpen: boolean }

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function defaultStorage(): StorageLike | null {
  try { return typeof localStorage !== "undefined" ? localStorage : null; } catch { return null; }
}

const numArray = (v: unknown): v is number[] => Array.isArray(v) && v.every(x => typeof x === "number");

/** A stored series, or null when it is not one (an older or hand-edited entry). */
function readSeries(v: unknown): Series | null {
  if (!v || typeof v !== "object") return null;
  const s = v as Record<string, unknown>;
  if (!numArray(s.f) || !numArray(s.re) || !numArray(s.im)) return null;
  if (s.f.length < 2 || s.f.length !== s.re.length || s.f.length !== s.im.length) return null;
  const src = s.source && typeof s.source === "object" ? s.source as Series["source"] : undefined;
  return { f: s.f, re: s.re, im: s.im, ...(src && typeof src.file === "string" ? { source: src } : {}) };
}

/** Plain arrays only (Float64Arrays would turn into objects in JSON). */
const plain = (s: Series): Series => ({ f: Array.from(s.f), re: Array.from(s.re), im: Array.from(s.im), ...(s.source ? { source: s.source } : {}) });

export function saveAsBuilt(profileId: string, value: Stored, storage: StorageLike | null = defaultStorage()): boolean {
  if (!storage) return false;
  try {
    const empty = !Object.keys(value.data.sum).length && !Object.keys(value.data.units).length;
    if (empty && !value.ventsOpen) { storage.removeItem(storageKey(profileId)); return true; }
    const sum: Record<string, Series> = {}, units: Partial<Record<UnitId, Series>> = {};
    for (const [a, s] of Object.entries(value.data.sum)) sum[a] = plain(s);
    for (const [u, s] of Object.entries(value.data.units)) if (s) units[u as UnitId] = plain(s);
    storage.setItem(storageKey(profileId), JSON.stringify({ version: 1, sum, units, ventsOpen: value.ventsOpen }));
    return true;
  } catch { return false; }
}

export function loadAsBuilt(profileId: string, storage: StorageLike | null = defaultStorage()): Stored {
  const none: Stored = { data: emptyData(), ventsOpen: false };
  if (!storage) return none;
  try {
    const raw = storage.getItem(storageKey(profileId));
    if (!raw) return none;
    const o = JSON.parse(raw) as Record<string, unknown>;
    const data = emptyData();
    if (o.sum && typeof o.sum === "object")
      for (const [a, v] of Object.entries(o.sum as Record<string, unknown>)) { const s = readSeries(v); if (s && /^\d{1,3}$/.test(a)) data.sum[a] = s; }
    if (o.units && typeof o.units === "object")
      for (const u of ["woof", "mid", "tw"] as const) { const s = readSeries((o.units as Record<string, unknown>)[u]); if (s) data.units[u] = s; }
    return { data, ventsOpen: o.ventsOpen === true };
  } catch { return none; }
}
