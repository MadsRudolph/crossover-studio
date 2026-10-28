// Listening-test kit, part 2: the blind, balanced and reproducible presentation order.
//
// - A seeded generator (mulberry32), so the same protocol seed always gives the same sessions: the
//   printed sheets, the in-app run and the analysis agree, and a reviewer can regenerate the plan.
// - Williams balanced Latin squares for the order of the variants within a trial (each variant in each
//   position equally often, and each variant directly after every other equally often: first-order
//   carry-over balanced; Bech & Zacharov ch. 5). Even n needs n rows, odd n needs 2n.
// - Blind labels: each listener gets a random letter for each variant (A, B, C...), so neither the
//   letter nor the position tells which variant is playing.

import { BLIND_LETTERS, type Protocol } from "./model";

/** mulberry32: a small, fast 32-bit generator with good statistics. Returns numbers in [0, 1). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher-Yates shuffle of a copy, driven by `rand`. */
export function shuffle<T>(xs: readonly T[], rand: () => number): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Williams design for n treatments: rows of 0..n-1. First row 0, 1, n-1, 2, n-2, ...; row i adds i
 * (mod n). For odd n the mirrored rows are appended, since one square cannot balance the carry-over.
 */
export function williams(n: number): number[][] {
  if (n <= 0) return [];
  if (n === 1) return [[0]];
  const first: number[] = [0];
  for (let k = 1, lo = 1, hi = n - 1; first.length < n; k++) first.push(k % 2 ? lo++ : hi--);
  const rows = Array.from({ length: n }, (_, i) => first.map(x => (x + i) % n));
  return n % 2 ? [...rows, ...rows.map(r => [...r].reverse())] : rows;
}

// ---------------------------------------------------------------- the session plan
export interface Trial {
  /** 1-based trial number within the listener's session. */
  n: number;
  rep: number;
  item: string;
  /** Variant ids in the order they are presented. */
  order: string[];
}

export interface Session {
  listener: number;
  /** Variant id -> blind letter for this listener. */
  labels: Record<string, string>;
  trials: Trial[];
}

/**
 * The whole plan: one session per listener. Within a repetition each listener hears every item once;
 * the item order and the variant order inside each trial both come from Williams squares, walked
 * across listeners, repetitions and items, with the treatment numbers shuffled by the seed. Pure and
 * deterministic in (variants, items, listeners, reps, seed).
 */
export function makePlan(p: Pick<Protocol, "variants" | "items" | "listeners" | "reps" | "seed">): Session[] {
  const rand = rng(p.seed);
  const vIds = shuffle(p.variants.map(v => v.id), rand);
  const iIds = shuffle(p.items.map(i => i.id), rand);
  const vSq = williams(vIds.length), iSq = williams(iIds.length);
  const out: Session[] = [];
  for (let l = 0; l < p.listeners; l++) {
    const letters = shuffle(BLIND_LETTERS.slice(0, vIds.length).split(""), rand);
    const labels: Record<string, string> = {};
    p.variants.forEach((v, k) => { labels[v.id] = letters[k]; });
    const trials: Trial[] = [];
    let n = 0;
    for (let r = 0; r < p.reps; r++) {
      const s = l * p.reps + r;                           // one square row per listener and repetition
      const items = iSq.length ? iSq[s % iSq.length].map(k => iIds[k]) : [];
      items.forEach((item, j) => {
        const row = vSq.length ? vSq[(s * Math.max(1, items.length) + j) % vSq.length] : [];
        trials.push({ n: ++n, rep: r, item, order: row.map(k => vIds[k]) });
      });
    }
    out.push({ listener: l, labels, trials });
  }
  return out;
}

/** Number of listeners that completes the variant Latin square (every row used equally often). */
export function balancedListenerCount(variants: number, items: number, reps: number): number {
  const rows = williams(variants).length;
  if (rows <= 1) return 1;
  // listeners x reps x items trials walk the rows; a multiple of the row count uses each equally
  const perListener = Math.max(1, items) * reps;
  for (let l = 1; l <= 40; l++) if ((l * perListener) % rows === 0) return l;
  return rows;
}
