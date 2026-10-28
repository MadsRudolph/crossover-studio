// Listening-test kit, part 4: level matching of the variants played in the app. Louder almost always
// sounds "better" (IEC 60268-13 asks for matched levels; Bech & Zacharov list level as the first bias to
// remove), so every variant is scaled to the same pink-noise power over the judged band.
//
// Pink noise has equal power per octave, so its power through a filter is the mean of |H|^2 on a
// logarithmic frequency grid. Over 150 Hz-15 kHz that is what a C-weighted level meter would read
// from pink noise at the listening position, the in-room procedure the protocol prints.

import { JUDGE_BAND } from "../views/data";
import { IR_FS, irMagnitude } from "../listen/ir";

export const MATCH_BAND: [number, number] = JUDGE_BAND;

/** Pink-noise level of an IR over `band` (dB, relative to a flat 0 dB filter). */
export function pinkLevelDb(ir: ArrayLike<number>, fs = IR_FS, band: [number, number] = MATCH_BAND): number {
  const m = irMagnitude(ir, fs, band[0], band[1], 240);
  let p = 0;
  for (let i = 0; i < m.db.length; i++) if (Number.isFinite(m.db[i])) p += 10 ** (m.db[i] / 10);   // a null bin adds nothing
  return 10 * Math.log10(p / m.db.length);
}

/** Gains (dB) that bring every IR to the level of the first one (the first gets 0 dB). */
export function matchGains(irs: ArrayLike<number>[], fs = IR_FS, band: [number, number] = MATCH_BAND): number[] {
  const lv = irs.map(x => pinkLevelDb(x, fs, band));
  return lv.map(l => (Number.isFinite(l) && Number.isFinite(lv[0]) ? lv[0] - l : 0));
}

/** A scaled copy of an IR, ready for the player. */
export function withGain(ir: ArrayLike<number>, gainDb: number): Float32Array {
  const g = 10 ** (gainDb / 20), out = new Float32Array(ir.length);
  for (let i = 0; i < ir.length; i++) out[i] = ir[i] * g;
  return out;
}
