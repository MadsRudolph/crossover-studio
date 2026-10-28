// Example listening test for screenshots, the tests and a first look (`?ltdemo=1`): three variants (the
// design, the design with the tweeter one basket step quieter, and the flat reference), six listeners,
// two repetitions, ratings drawn around fixed true means with a per-listener scale offset. Deterministic.

import type { Design, Profile } from "../types";
import { stockNeighbours } from "../engine/assess";
import { defaultProtocol, SCALE_MAX, SCALE_MIN, type ListenTestDoc, type Rating } from "./model";
import { rng } from "./random";

/** True mean per variant (design, quieter tweeter, flat) and attribute. */
const TRUTH: Record<string, [number, number, number]> = {
  "bass-ext": [4.6, 4.6, 4.2], "bass-tight": [4.4, 4.5, 4.6], clarity: [4.4, 5.3, 5.0],
  harsh: [5.1, 3.6, 4.0], image: [4.5, 4.8, 4.6], pref: [4.0, 5.3, 4.6],
};

export function demoDoc(profile: Profile, design: Design, seed = 20261028): ListenTestDoc {
  const p = defaultProtocol(seed);
  const quieter = structuredClone(design) as Design;
  const rs = design.tw.pad?.Rs;
  const up = rs ? stockNeighbours(profile.components.R, rs).filter(x => x > rs)[0] : profile.components.R[0];
  quieter.tw.pad = { ...quieter.tw.pad, Rs: up ?? rs };
  p.variants = [
    { id: "v-design", name: "Design (current)", kind: "design", design: structuredClone(design) as Design, origin: "current design", ours: true },
    { id: "v-quiet", name: "Tweeter Rs one step up", kind: "design", design: quieter, origin: "snapshot" },
    { id: "v-flat", name: "Flat reference", kind: "flat" },
  ];
  p.items = p.items.slice(0, 3).map((it, i) => (i === 1 ? { ...it, name: "Norah Jones, Don't Know Why" } : i === 2 ? { ...it, name: "Ray Brown, Blues for Junior" } : it));
  const rand = rng(seed);
  const ratings: Rating[] = [];
  for (let l = 0; l < p.listeners; l++) {
    const offset = (rand() - 0.5) * 1.2;                     // each listener uses the scale a little differently
    for (let r = 0; r < p.reps; r++) for (const it of p.items) p.variants.forEach((v, k) => {
      for (const a of p.attributes) {
        const noise = (rand() + rand() + rand() - 1.5) * 1.1;
        const value = Math.round(Math.min(SCALE_MAX, Math.max(SCALE_MIN, TRUTH[a.id][k] + offset + noise)));
        ratings.push({ listener: l, rep: r, item: it.id, variant: v.id, attr: a.id, value });
      }
    });
  }
  return { version: 1, profileId: profile.id, protocol: p, ratings };
}
