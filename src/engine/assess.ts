// The design verdict: what makes this crossover good or bad, in plain language.
//
// assess() turns one computed design into a 0-100 score built from weighted criteria. Each criterion
// says what it measures and why it matters for the sound (static text), what this design does (with
// the frequencies where it happens), and what to change. suggest() then tries small, concrete edits
// (one part one stock value up or down, a polarity flip, the woofer gain, the crossover frequency,
// the vent length) and reports the ones that raise the score, so every advice is tested, not guessed.
//
// The thresholds are engineering rules of thumb from the course (Lecture 9 and the project guide)
// and common loudspeaker practice; the listening test (project Task 4) remains the real verdict.

import type { AngleResult, CheckState, Design, Results, UnitId } from "../types";
import { UNIT_IDS } from "../types";
import { cabsAt, dbArray, nearestIndex } from "./complex";
import { ladderNodes, passiveParts, type LadderPart } from "./passive";
import { boxModelCurves, compute, crossoverWindows, digitalResponse, offAxisAngle, smooth, type Prepared } from "./system";

export type CriterionGroup = "tone" | "blend" | "space" | "safety" | "build";

export const GROUPS: { id: CriterionGroup; title: string; blurb: string }[] = [
  { id: "tone", title: "Tonal balance", blurb: "Does it play every part of the music at the same loudness?" },
  { id: "blend", title: "Crossover blend", blurb: "Do the drivers hand over to each other without a seam?" },
  { id: "space", title: "Off axis", blurb: "Does it sound the same when you are not in the sweet spot?" },
  { id: "safety", title: "Safety", blurb: "Will the drivers, the amplifier and the parts survive loud music?" },
  { id: "build", title: "Build", blurb: "Can you build it from the course parts basket?" },
];

export interface Criterion {
  id: string;
  group: CriterionGroup;
  title: string;
  /** The measured value, formatted ("3.9 dB"). */
  value: string;
  /** The target, formatted ("≤ 4 dB"). */
  target: string;
  state: CheckState;
  /** 0 (fails completely) .. 1 (meets the target). */
  score: number;
  /** Share of the overall score; 0 = shown for information only. */
  weight: number;
  /** One line for compact lists. */
  summary: string;
  /** What this measures and why it matters for the sound. */
  why: string;
  /** What this design does, with the frequencies involved. */
  finding: string;
  /** What to change (empty when nothing needs changing). */
  fix: string;
  /** Inspector control that changes this most directly. */
  focus?: string;
  /** Frequency of interest (Hz) for the probe, and the region the plot should highlight. */
  at?: number;
  band?: [number, number];
}

export type Rating = "Excellent" | "Good" | "Fair" | "Needs work" | "Poor";

export interface Assessment {
  /** 0-100, weighted mean of the criteria scores. */
  score: number;
  rating: Rating;
  /** One sentence: the state of the design and its main issue. */
  headline: string;
  criteria: Criterion[];
  /** Ids of the criteria that cost the most points, worst first (only those below target). */
  issues: string[];
  /** Ids of the criteria that are fully met, by weight. */
  strengths: string[];
}

/** Assumed power rating of the crossover resistors (W). The basket's rating is not in the guide: check it. */
export const RESISTOR_RATING_W = 5;
/** Amplifier power the safety checks use (W into 8 ohm, sine). */
export const TEST_POWER_W = 10;
const V_TEST = Math.sqrt(TEST_POWER_W * 8);

// ---------------------------------------------------------------- small helpers
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
/** 1 at or better than `good`, 0 at or worse than `bad`, linear between (works both directions). */
const ramp = (x: number, good: number, bad: number) => clamp01((x - bad) / (good - bad));
const stateOf = (s: number, warnBelow = 0.999, badBelow = 0.5): CheckState => (s >= warnBelow ? "good" : s >= badBelow ? "warn" : "bad");
const fmtHz = (x: number) => (x >= 1000 ? `${(x / 1000).toFixed(x >= 10000 ? 1 : 2)} kHz` : `${x.toFixed(0)} Hz`);
const sdb = (x: number, d = 1) => `${x > 0 ? "+" : x < 0 ? "−" : ""}${Math.abs(x).toFixed(d)} dB`;
const NAME: Record<UnitId, string> = { woof: "woofer", mid: "midrange", tw: "tweeter" };
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
const C_AIR = 345;

/** Relative phase a/b at index i, degrees in (-180, 180]. */
function phaseDiff(a: AngleResult[UnitId], b: AngleResult[UnitId], i: number): number {
  const re = a.re[i] * b.re[i] + a.im[i] * b.im[i], im = a.im[i] * b.re[i] - a.re[i] * b.im[i];
  return Math.atan2(im, re) * 180 / Math.PI;
}

/** The unit with the largest output at index i. */
function dominant(out: AngleResult, i: number): UnitId {
  return UNIT_IDS.reduce((best, u) => (cabsAt(out[u], i) > cabsAt(out[best], i) ? u : best), "woof" as UnitId);
}

function indicesIn(f: Float64Array, lo: number, hi: number): number[] {
  const k: number[] = [];
  for (let i = 0; i < f.length; i++) if (f[i] >= lo && f[i] <= hi) k.push(i);
  return k;
}

/** Where a frequency sits: "at the woofer/midrange crossover" or "where the tweeter plays alone". */
function place(f: number, m: Results["metrics"], out: AngleResult, i: number): string {
  const near = (x: number | null) => x !== null && Math.abs(Math.log2(f / x)) <= 1 / 3;
  if (near(m.x_wm)) return "at the woofer/midrange crossover";
  if (near(m.x_mt)) return "at the midrange/tweeter crossover";
  return `in the ${NAME[dominant(out, i)]}'s band`;
}

// ---------------------------------------------------------------- the criteria
export function assess(p: Prepared, design: Design, r: Results): Assessment {
  const f = p.f, m = r.metrics, on = r.angles["0"], prof = p.profile, L = prof.limits;
  const level = m.on.level;
  const ys = smooth(p, dbArray(on.sum));
  const K = indicesIn(f, 150, 15000);
  const out: Criterion[] = [];

  // ---- tone: flat on axis
  {
    let imax = K[0], imin = K[0];
    for (const i of K) { if (ys[i] > ys[imax]) imax = i; if (ys[i] < ys[imin]) imin = i; }
    const peak = ys[imax] - level, dip = ys[imin] - level;
    const s = ramp(m.on.spread, 4, 10);
    const worstIsDip = -dip >= peak, iw = worstIsDip ? imin : imax;
    const where = place(f[iw], m, on, iw);
    let fix = "";
    if (s < 1) {
      if (where.startsWith("at the")) fix = `The worst error is ${where}: see Crossover blend below, the fix is there.`;
      else {
        const u = dominant(on, iw);
        fix = u === "woof" ? "It is in the woofer's band: adjust the woofer gain, or the box tuning if it is below 100 Hz."
          : u === "tw" ? "It is in the tweeter's band: change the L-pad (Rs/Rp) to move the whole band, or the high-pass to move its lower end."
          : "It is in the midrange's band: a level error here means the other two bands are off. Move the woofer gain and the tweeter pad to meet the midrange.";
      }
    }
    out.push({
      id: "flat", group: "tone", title: "Flat on axis", weight: 3, score: s, state: stateOf(s, 0.999, 0.666),  // bad above 6 dB, as the Check panel
      value: `${m.on.spread.toFixed(1)} dB`, target: "≤ 4 dB (±2 dB)",
      summary: `150 Hz–15 kHz within ${m.on.spread.toFixed(1)} dB`,
      why: "Straight in front of the speaker you hear the direct sound first, and your ear judges the tone from it. Broad errors, an octave or more wide, are heard far more easily than narrow ones; that is why the curve is smoothed to 1/6 octave before judging it. ±2 dB from 150 Hz to 15 kHz is the usual mark of a neutral speaker.",
      finding: `Highest point ${sdb(peak)} at ${fmtHz(f[imax])} (${place(f[imax], m, on, imax)}); lowest ${sdb(dip)} at ${fmtHz(f[imin])} (${place(f[imin], m, on, imin)}).`,
      fix, focus: "digital.gain", at: f[iw], band: [150, 15000],
    });
  }

  // ---- tone: balance between the three bands
  {
    const x1 = m.x_wm ?? Math.sqrt(L.wm[0] * L.wm[1]), x2 = m.x_mt ?? Math.sqrt(L.mt[0] * L.mt[1]);
    const bands: Record<UnitId, [number, number]> = {
      woof: [150, x1 / Math.SQRT2], mid: [x1 * Math.SQRT2, x2 / Math.SQRT2], tw: [x2 * Math.SQRT2, 15000],
    };
    const off: Record<UnitId, number> = { woof: 0, mid: 0, tw: 0 };
    for (const u of UNIT_IDS) {
      const k = indicesIn(f, ...bands[u]);
      off[u] = k.length ? k.reduce((a, i) => a + ys[i], 0) / k.length - level : 0;
    }
    const worst = UNIT_IDS.reduce((b, u) => (Math.abs(off[u]) > Math.abs(off[b]) ? u : b), "woof" as UnitId);
    const s = ramp(Math.abs(off[worst]), 1, 4);
    const word = { woof: ["boomy, thick", "thin, lacking body"], mid: ["forward, shouty", "hollow, distant"], tw: ["bright, sharp", "dull, veiled"] };
    let fix = "";
    if (s < 1) {
      const o = off[worst];
      fix = worst === "woof" ? `Change the woofer gain by about ${sdb(-o)} (it is a digital gain, so this is exact).`
        : worst === "tw" ? (o > 0 ? "Attenuate the tweeter more: raise the series resistor Rs (or add an L-pad if there is none)." : "Attenuate the tweeter less: lower Rs or raise Rp.")
        : (o > 0 ? `The midrange cannot be turned down without a pad: add a midrange L-pad, or raise the woofer gain and tweeter level by about ${sdb(o)}.`
                 : `Lower the woofer gain and attenuate the tweeter by about ${sdb(-o)} so they meet the midrange.`);
    }
    out.push({
      id: "balance", group: "tone", title: "Bands in balance", weight: 2, score: s, state: stateOf(s, 0.999, 0.5),
      value: `W ${sdb(off.woof)} · M ${sdb(off.mid)} · T ${sdb(off.tw)}`, target: "each within ±1 dB",
      summary: `${cap(NAME[worst])} band ${sdb(off[worst])} from the system level`,
      why: "Each driver carries one part of the music: the woofer the bass and the warmth of voices, the midrange the voice itself, the tweeter the detail and air. If one band sits 2–3 dB above the rest the speaker sounds coloured even when every crossover blends well. You set the balance with the woofer gain in the MiniDSP and with the L-pads.",
      finding: Math.abs(off[worst]) < 1
        ? "All three bands sit within 1 dB of the system level."
        : `The ${NAME[worst]} band (${fmtHz(bands[worst][0])}–${fmtHz(bands[worst][1])}) is ${sdb(off[worst])} from the system level: it will sound ${word[worst][off[worst] > 0 ? 0 : 1]}.`,
      fix, focus: worst === "woof" ? "digital.gain" : worst === "tw" ? "tw.pad.Rs" : "mid.pad.Rs", band: bands[worst],
    });
  }

  // ---- tone: bass
  {
    const { f3, ripple } = r.box;
    const s = ramp(ripple, 1.5, 4);
    out.push({
      id: "bass", group: "tone", title: "Smooth bass", weight: 1.5, score: s, state: stateOf(s, 0.999, 0.4),
      value: `f3 ${f3.toFixed(0)} Hz · ${sdb(ripple)}`, target: "ripple ≤ +1.5 dB",
      summary: `Reaches ${f3.toFixed(0)} Hz, ${ripple > 0.2 ? `peaks ${sdb(ripple)} before rolling off` : "no bass hump"}`,
      why: "The box decides how deep the speaker plays (f3) and how controlled the bass is. A hump just above f3 makes every bass note boom at the same pitch; a smooth roll-off sounds tight. In a room the bass gains a few dB anyway, so a slightly over-damped box is the safer choice.",
      finding: `${r.box.label}: tuned to ${r.box.fB ? fmtHz(r.box.fB) : "no vent"}, −3 dB at ${f3.toFixed(1)} Hz, ${ripple > 0.2 ? `with a ${sdb(ripple)} hump above it` : "with no hump"}.`,
      fix: s >= 1 ? "" : r.box.MAP
        ? "Lengthen the vent (lower tuning, less hump) or add filling; with the vent plugged the closed box has no hump at all but less deep bass."
        : "The closed box is under-damped (Q too high): add filling, which lowers its Q and the hump.",
      focus: "box.L", band: [20, 200],
    });
  }

  // ---- blend: phase at each crossover
  const blend = (id: string, title: string, x: number | null, a: UnitId, b: UnitId, win: [number, number], focus: string) => {
    if (x === null) {
      out.push({ id, group: "blend", title, weight: 2, score: 0, state: "bad", value: "no crossing", target: "|Δφ| ≤ 30°",
        summary: `The ${NAME[a]} and ${NAME[b]} never cross`,
        why: BLEND_WHY, finding: `Between ${fmtHz(win[0])} and ${fmtHz(win[1])} one driver is louder everywhere, so there is no hand-over: either a hole or one driver covering a band it is not good at.`,
        fix: "Bring the filter frequencies of the two branches closer, or check the levels (gain, pads).", focus, band: win });
      return;
    }
    const i = nearestIndex(f, x);
    const dphi = phaseDiff(on[a], on[b], i);
    // the hand-over region: ±1/2 octave, weighted by how much both drivers play there
    let wsum = 0, psum = 0;
    for (const k of indicesIn(f, x / Math.SQRT2, x * Math.SQRT2)) {
      const w = Math.min(cabsAt(on[a], k), cabsAt(on[b], k)) ** 2;
      wsum += w; psum += w * Math.abs(phaseDiff(on[a], on[b], k));
    }
    const avg = wsum ? psum / wsum : Math.abs(dphi);
    const A = cabsAt(on[a], i), B = cabsAt(on[b], i);
    const gain = 20 * Math.log10(Math.hypot(on[a].re[i] + on[b].re[i], on[a].im[i] + on[b].im[i]) / Math.max(A, B));
    const nullDb = 20 * Math.log10(Math.hypot(on[a].re[i] + on[b].re[i], on[a].im[i] + on[b].im[i]) /
                                   Math.max(1e-12, Math.hypot(on[a].re[i] - on[b].re[i], on[a].im[i] - on[b].im[i])));
    const s = ramp(Math.max(Math.abs(dphi), avg), 30, 100);
    const flip = Math.abs(dphi) > 120;
    // invert the unit that is not the midrange: the woofer (a digital switch) or the tweeter, so the
    // midrange's other crossover is left as it is
    const flipUnit = a === "mid" ? b : a;
    out.push({
      id, group: "blend", title, weight: 2, score: s, state: stateOf(s, 0.999, 0.45),
      value: `Δφ ${Math.abs(dphi).toFixed(0)}° at ${fmtHz(x)}`, target: "|Δφ| ≤ 30° over the overlap",
      summary: `${cap(NAME[a])} and ${NAME[b]} ${Math.abs(dphi).toFixed(0)}° apart at ${fmtHz(x)}`,
      why: BLEND_WHY,
      finding: `At ${fmtHz(x)} the two are ${Math.abs(dphi).toFixed(0)}° apart (on average ${avg.toFixed(0)}° over the half octave either side), so together they give ${sdb(gain)} over one alone (+6.0 dB is perfect, −∞ is a total cancellation). `
        + (nullDb > 0 ? `Flipping one would leave a ${nullDb.toFixed(0)} dB notch: ${nullDb >= 15 ? "a deep reverse null, the classic sign of a good blend." : "a shallow reverse null, so the blend is only partial."}`
                      : "Flipping one would actually add better: they are closer to opposite than to in phase."),
      fix: s >= 1 ? "" : flip ? `They are nearly opposite: try inverting the ${NAME[flipUnit]}'s polarity${flipUnit === "woof" ? " (in the MiniDSP)" : ""}, which leaves the midrange's other crossover as it is.`
        : "Shift the phase of one side: move its filter frequency, change its filter order, or change the other side's. The “Try this” list tests the options on your data.",
      focus, at: x, band: [x / 2, x * 2],
    });
  };
  const W = crossoverWindows(prof);
  blend("blend_wm", "Woofer/midrange blend", m.x_wm, "woof", "mid", W.wm, "digital.fc");
  blend("blend_mt", "Midrange/tweeter blend", m.x_mt, "mid", "tw", W.mt, "tw.C1");

  // ---- blend: cancellation anywhere
  {
    let worst = 0, iw = K[0];
    for (const i of K) {
      const pw = 10 * Math.log10(UNIT_IDS.reduce((a, u) => a + on[u].re[i] ** 2 + on[u].im[i] ** 2, 0));
      const d = 20 * Math.log10(cabsAt(on.sum, i)) - pw;
      if (d < worst) { worst = d; iw = i; }
    }
    const s = ramp(-worst, 1, 6);
    out.push({
      id: "canc", group: "blend", title: "No cancellation", weight: 1, score: s, state: stateOf(s, 0.999, 0.6),  // bad below -3 dB
      value: `${sdb(worst)} worst`, target: "≥ −1 dB",
      summary: worst > -1 ? "The drivers never fight each other" : `Drivers partly cancel at ${fmtHz(f[iw])}`,
      why: "The power sum is what the drivers would give if their phases were random. Where the real sum falls well below it, two drivers are cancelling: the hole is deep only at one listening position and moves as you move your head, so it sounds like a phasey, unstable image rather than a simple dip.",
      finding: worst > -1 ? "Nowhere between 150 Hz and 15 kHz does the sum fall more than 1 dB below the power sum."
        : `At ${fmtHz(f[iw])} (${place(f[iw], m, on, iw)}) the sum is ${sdb(worst)} below the power sum.`,
      fix: s < 1 ? "See the blend of the crossover named above; a polarity flip or a different filter order usually fixes it." : "",
      // the polarity that acts at the worst point: the woofer's (in the MiniDSP) at the lower crossover
      focus: m.x_wm !== null && m.x_mt !== null && Math.abs(Math.log(f[iw] / m.x_wm)) < Math.abs(Math.log(f[iw] / m.x_mt)) ? "digital.pol" : "tw.pol",
      at: f[iw], band: [f[iw] / 1.5, f[iw] * 1.5],
    });
  }

  // ---- blend: crossover frequencies
  {
    const dW = prof.units.woof.diameter_m, dM = prof.units.mid.diameter_m;
    const beamW = C_AIR / (Math.PI * dW), beamM = C_AIR / (Math.PI * dM);
    const octOut = (x: number | null, [lo, hi]: [number, number]) => x === null ? 2 : x < lo ? Math.log2(lo / x) : x > hi ? Math.log2(x / hi) : 0;
    const e1 = octOut(m.x_wm, L.wm), e2 = octOut(m.x_mt, L.mt);
    const s = ramp(Math.max(e1, e2), 0, 1);
    out.push({
      id: "xover", group: "blend", title: "Crossover frequencies", weight: 1, score: s, state: stateOf(s, 0.999, 0.5),
      value: `${m.x_wm ? fmtHz(m.x_wm) : "—"} · ${m.x_mt ? fmtHz(m.x_mt) : "—"}`,
      target: `${L.wm[0]}–${L.wm[1]} Hz · ${L.mt[0] / 1000}–${L.mt[1] / 1000} kHz`,
      summary: s >= 1 ? "Both hand-overs where the drivers are comfortable" : "A hand-over outside its comfortable range",
      why: `Every driver has a range it does well. A cone starts to beam, sending the treble forward only, once it is about as wide as the wavelength: the ${dW * 1000 | 0} mm woofer from about ${fmtHz(beamW)} (c/πd), the ${dM * 1000 | 0} mm midrange from about ${fmtHz(beamM)}. A dome tweeter must be kept well above its resonance (${fmtHz(L.tw_fs_hz)}), at least about 1.5–2× higher. The project's ranges put each hand-over where both drivers still behave.`,
      finding: `Woofer/midrange cross at ${m.x_wm ? fmtHz(m.x_wm) : "no frequency"} (aim ${L.wm[0]}–${L.wm[1]} Hz), midrange/tweeter at ${m.x_mt ? fmtHz(m.x_mt) : "no frequency"} (aim ${L.mt[0] / 1000}–${L.mt[1] / 1000} kHz, ${m.x_mt ? (m.x_mt / L.tw_fs_hz).toFixed(1) + "× the tweeter resonance" : ""}).`,
      fix: s >= 1 ? "" : e1 >= e2 ? "Move the digital crossover frequency (the acoustic crossover follows it, shifted by the drivers' own roll-offs)." : "Change the passive parts: bigger L in the midrange low-pass lowers it, smaller C in the tweeter high-pass raises it.",
      focus: e1 >= e2 ? "digital.fc" : "tw.C1",
    });
  }

  // ---- space: off axis
  const offA = offAxisAngle(Object.keys(r.angles));
  if (offA && m.off30) {
    const o = r.angles[offA], yo = smooth(p, dbArray(o.sum)), lv = m.off30.level, K10 = indicesIn(f, 150, 10000);
    let imin = K10[0], imax = K10[0];
    for (const i of K10) { if (yo[i] < yo[imin]) imin = i; if (yo[i] > yo[imax]) imax = i; }
    const spread = yo[imax] - yo[imin];
    const s = ramp(spread, 6, 12);
    out.push({
      id: "off", group: "space", title: `Even at ${offA}°`, weight: 1.5, score: s, state: stateOf(s, 0.999, 0.5),
      value: `${spread.toFixed(1)} dB`, target: "≤ 6 dB to 10 kHz",
      summary: `${offA}° within ${spread.toFixed(1)} dB up to 10 kHz`,
      why: `In a room most of what reaches you left the speaker off axis and bounced off the walls. If the ${offA}° curve has the same shape as on axis (only rolling off at the very top), the reflections sound like the direct sound and the speaker sounds natural from more seats. Two drivers at different positions interfere off axis near their crossover; the closer they sit and the steeper the filters, the narrower that region. Above 10 kHz every tweeter beams, so the judging stops there.`,
      finding: `The deepest dip at ${offA}° is ${sdb(yo[imin] - lv)} at ${fmtHz(f[imin])} (${place(f[imin], m, o, imin)}).`,
      fix: s < 1 ? "A steeper filter at that crossover shrinks the overlap where the drivers interfere; moving the crossover away from where the drivers are far apart in wavelengths also helps." : "",
      focus: "tw.topo", at: f[imin], band: [150, 10000],
    });
  }

  // ---- safety: tweeter resonance
  {
    const iFs = p._e.iFs, tw = 20 * Math.log10(cabsAt(on.tw, iFs)) - level;
    const s = ramp(tw, -12, -4);
    out.push({
      id: "twfs", group: "safety", title: "Tweeter protected", weight: 2, score: s, state: stateOf(s, 0.999, 0.5),
      value: `${sdb(tw)} at ${fmtHz(L.tw_fs_hz)}`, target: "≤ −12 dB",
      summary: `Tweeter ${sdb(tw)} at its resonance`,
      why: `A dome tweeter has its resonance at about ${fmtHz(L.tw_fs_hz)} (from the Lab D impedance). Driven hard there its tiny coil overheats and its suspension hits its limits, and distortion rises long before it breaks. The high-pass should have it at least 12 dB down at that frequency.`,
      finding: `At ${fmtHz(L.tw_fs_hz)} the tweeter plays ${sdb(tw)} relative to the system level.`,
      fix: s < 1 ? "Raise the tweeter's high-pass (smaller series C), use a steeper topology, or cross higher." : "",
      focus: "tw.C1", at: L.tw_fs_hz,
    });
  }

  // ---- safety: amplifier load
  {
    let imin = 0, zmin = Infinity;
    for (let i = 0; i < f.length; i++) if (f[i] > 200 && f[i] < 15000) { const z = cabsAt(on.Zamp2, i); if (z < zmin) { zmin = z; imin = i; } }
    const s = ramp(zmin, 4, 2.5);
    out.push({
      id: "load", group: "safety", title: "Safe amplifier load", weight: 1.5, score: s, state: stateOf(s, 0.999, 0.333),  // bad below 3 ohm
      value: `${zmin.toFixed(2)} Ω min`, target: "≥ 4 Ω",
      summary: `Channel 2 never below ${zmin.toFixed(1)} Ω`,
      why: "Amplifier channel 2 drives the midrange and tweeter branches in parallel. Where their impedances overlap the load can fall well below either one. Below about 4 Ω a small amplifier runs hot, clips earlier or trips its protection.",
      finding: `The lowest load is ${zmin.toFixed(2)} Ω at ${fmtHz(f[imin])}.`,
      fix: s < 1 ? "Raise the impedance at that frequency: a series resistor (L-pad Rs) on the branch that dominates there, or a larger Rp." : "",
      focus: "tw.pad.Rp", at: f[imin],
    });
  }

  // ---- safety: vent air speed
  if (design.box.mode !== "plugged" && r.box.MAP) {
    const bc = boxModelCurves(p, design);
    let vmax = 0, iv = 0;
    for (let i = 0; i < bc.f.length; i++) if (bc.f[i] >= 20 && bc.ventSpeed_ms[i] > vmax) { vmax = bc.ventSpeed_ms[i]; iv = i; }
    // the woofer channel gets the digital gain before the amplifier
    const v = vmax * V_TEST / 2.83 * 10 ** (design.digital.g_woof_dB / 20);
    const s = ramp(v, 10, 20);
    out.push({
      id: "vent", group: "safety", title: "Quiet vent", weight: 1, score: s, state: stateOf(s, 0.999, 0.5),
      value: `${v.toFixed(1)} m/s peak`, target: "≤ 10 m/s",
      summary: `Vent air ${v.toFixed(0)} m/s at ${TEST_POWER_W} W`,
      why: `Near the tuning frequency the vent, not the cone, makes the bass, and the air in it moves fast. Above roughly 10 m/s (about 3 % of the speed of sound) it starts to chuff and whistle on loud bass notes. The value is the fastest air in the vent from 20 Hz up, for a ${TEST_POWER_W} W sine at the amplifier (with the woofer gain).`,
      finding: `Peak air speed ${v.toFixed(1)} m/s at ${fmtHz(bc.f[iv])}.`,
      fix: s < 1 ? "A wider vent (two vents) or a lower woofer level at the tuning frequency lowers the air speed." : "",
      focus: "box.L", at: bc.f[iv],
    });
  }

  // ---- safety + build: resistors and parts
  const parts = [...passiveParts(design.mid, "mid"), ...passiveParts(design.tw, "tw")];
  {
    const res = resistorPower(p, design);
    if (res.length) {
      const worst = res.reduce((x, y) => (y.pinkPerW > x.pinkPerW ? y : x));
      const P = worst.pinkPerW * TEST_POWER_W, name = (id: string) => id.replace(/^tw\./, "Tweeter ").replace(/^mid\./, "Midrange ").replace("pad.", "");
      const s = ramp(P, RESISTOR_RATING_W / 2, RESISTOR_RATING_W);
      out.push({
        id: "resistors", group: "safety", title: "Resistors keep cool", weight: 0.75, score: s, state: stateOf(s, 0.999, 0.5),
        value: `${P.toFixed(1)} W in ${name(worst.id)}`, target: `≤ ${(RESISTOR_RATING_W / 2).toFixed(1)} W`,
        summary: `${name(worst.id)} warms by ${P.toFixed(1)} W at ${TEST_POWER_W} W of music`,
        why: `An L-pad turns the power it takes from the tweeter into heat. The test signal is ${TEST_POWER_W} W of pink noise, equal power in every octave like long-term music and loud in a room. Each resistor should stay at half its rating or less. ${RESISTOR_RATING_W} W resistors are assumed: check the rating of the basket's resistors, a ¼ W one would burn.`,
        finding: res.map(x => `${name(x.id)}: ${(x.pinkPerW * TEST_POWER_W).toFixed(2)} W`).join(", ")
          + `. A single loud sine at ${fmtHz(worst.f)} would put ${(worst.wPerW * TEST_POWER_W).toFixed(1)} W into ${name(worst.id)} at ${TEST_POWER_W} W.`,
        fix: s < 1 ? "Split the attenuation differently (a larger Rs with a larger Rp, or no Rp) or use a higher-rated resistor." : "",
        focus: worst.id, at: worst.f,
      });
    }
  }
  {
    const lists = prof.components, bad: string[] = [];
    for (const pt of parts) {
      const vals = pt.kind === "RC" ? [["R", pt.value[0]], ["C", pt.value[1]]] as const : [[pt.kind, pt.value]] as const;
      for (const [k, v] of vals) if (!lists[k].some(x => Math.abs(x / v - 1) < 0.005)) bad.push(`${pt.id} ${fmtPart(k, v)}`);
    }
    const s = bad.length ? 0 : 1;
    out.push({
      id: "stock", group: "build", title: "Stock values only", weight: 1, score: s, state: bad.length ? "bad" : "good",
      value: bad.length ? `${bad.length} not in stock` : "all in stock", target: "Appendix 1 values",
      summary: bad.length ? `${bad.join(", ")} not in the basket` : "Every part is in the course basket",
      why: "The project allows only the values in Appendix 1 of the guide, one component per position. Combining parts to reach an odd value adds their tolerances and empties the basket for the other groups.",
      finding: bad.length ? `Not in the list: ${bad.join(", ")}.` : `All ${parts.length} parts are standard values.`,
      fix: bad.length ? "Pick the nearest value in the list with the part's arrows." : "",
      focus: bad.length ? bad[0].split(" ")[0] : undefined,
    });
    const n = parts.reduce((a, pt) => a + (pt.kind === "RC" ? 2 : 1), 0);
    const s2 = ramp(n, 6, 12);
    out.push({
      id: "parts", group: "build", title: "Simple board", weight: 0.5, score: s2, state: stateOf(s2, 0.999, 0.5),
      value: `${n} parts`, target: "≤ 6",
      summary: `${n} parts on the passive board`,
      why: "Every extra part adds loss, tolerance and a chance of a wiring mistake on the board, and its benefit must be audible to be worth it. Fewer parts that do the job is the better design.",
      finding: `Midrange branch ${countParts(passiveParts(design.mid))}, tweeter branch ${countParts(passiveParts(design.tw))} parts.`,
      fix: "", focus: "mid",
    });
  }

  // ---- overall
  const wsum = out.reduce((a, c) => a + c.weight, 0);
  const score = Math.round(100 * out.reduce((a, c) => a + c.weight * c.score, 0) / wsum);
  // a weighted mean can hide one serious failure, so any failed criterion that counts caps the rating
  const capped = out.some(c => c.state === "bad" && c.weight >= 1);
  const rating: Rating = score >= 90 && !capped ? "Excellent" : score >= 75 && !capped ? "Good" : score >= 60 ? "Fair" : score >= 40 ? "Needs work" : "Poor";
  const issues = out.filter(c => c.score < 0.999 && c.weight > 0).sort((a, b) => b.weight * (1 - b.score) - a.weight * (1 - a.score)).map(c => c.id);
  const strengths = out.filter(c => c.score >= 0.999 && c.weight > 0).sort((a, b) => b.weight - a.weight).map(c => c.id);
  const first = out.find(c => c.id === issues[0]);
  const opener = rating === "Excellent" ? "An excellent design" : rating === "Good" ? "A good design" : rating === "Fair" ? "Close, with work left" : "Not there yet";
  const headline = !first ? "Every criterion is met. Time for the listening test."
    : `${opener}. Most to gain from “${first.title}”: ${first.summary.charAt(0).toLowerCase() + first.summary.slice(1)}.`;
  return { score, rating, headline, criteria: out, issues, strengths };
}

const BLEND_WHY = "Around a crossover both drivers play the same frequencies at about the same level, and their sounds add like two arrows: pointing the same way (in phase) they reinforce, pointing opposite ways they cancel. The filters and the drivers both turn the phase, so it has to be checked on the measured result, not assumed from the filter type. Designers test it with the reverse null: invert one driver and a good blend shows a deep notch at the crossover.";

function countParts(ps: LadderPart[]): number {
  return ps.reduce((a, pt) => a + (pt.kind === "RC" ? 2 : 1), 0);
}

function fmtPart(kind: "L" | "C" | "R", v: number): string {
  return kind === "L" ? `${+(v * 1e3).toPrecision(3)} mH` : kind === "C" ? `${+(v * 1e6).toPrecision(3)} µF` : `${+v.toPrecision(3)} Ω`;
}

export interface ResistorLoad {
  id: string;
  /** Worst case: W in the resistor per W of sine (into 8 ohm) at the amplifier, at frequency f. */
  wPerW: number;
  f: number;
  /** W in the resistor per W of pink noise (20 Hz-20 kHz, equal power per octave) at the amplifier. */
  pinkPerW: number;
}

/** Power in each resistor of the passive branches, per watt of amplifier output. */
export function resistorPower(p: Prepared, design: Design): ResistorLoad[] {
  const HH = digitalResponse(p, design.digital.fc, "HPF", design.digital.align);
  const out = new Map<string, ResistorLoad>();
  const step = Math.max(1, Math.floor(p.f.length / 160));
  const idx: number[] = [];
  for (let i = 0; i < p.f.length; i += step) if (p.f[i] >= 20 && p.f[i] <= 20000) idx.push(i);
  const lnSpan = Math.log(1000);
  for (const unit of ["mid", "tw"] as const) {
    const parts = passiveParts(design[unit], unit);
    if (!parts.some(pt => pt.kind === "R" || pt.kind === "RC")) continue;
    idx.forEach((i, n) => {
      const fi = p.f[i];
      // share of the pink-noise power this sample stands for: its width in ln f over ln(20k/20)
      const lo = n ? Math.sqrt(p.f[idx[n - 1]] * fi) : fi, hi = n < idx.length - 1 ? Math.sqrt(fi * p.f[idx[n + 1]]) : fi;
      const share = Math.log(hi / lo) / lnSpan;
      const g2 = cabsAt(HH, i) ** 2 * 8; // V^2 per watt into 8 ohm, through the digital high-pass
      const nodes = ladderNodes(fi, parts, [p.zi[unit].re[i], p.zi[unit].im[i]], design.Rdcr || 0);
      let k = 0, cur = nodes[0].v;
      const w = 2 * Math.PI * fi;
      const put = (id: string, pw: number) => {
        const e = out.get(id) ?? { id, wPerW: 0, f: fi, pinkPerW: 0 };
        if (pw > e.wPerW) { e.wPerW = pw; e.f = fi; }
        e.pinkPerW += pw * share;
        out.set(id, e);
      };
      for (const pt of parts) {
        if (pt.kind === "RC") {
          const last = nodes[nodes.length - 1].v, [R, C] = pt.value;
          const zi = -1 / (w * C), i2 = (last[0] ** 2 + last[1] ** 2) / (R * R + zi * zi);
          put(pt.id, g2 * i2 * R);
        } else if (pt.pos === "series") {
          const next = nodes[++k].v;
          if (pt.kind === "R") put(pt.id, g2 * ((cur[0] - next[0]) ** 2 + (cur[1] - next[1]) ** 2) / pt.value);
          cur = next;
        } else if (pt.kind === "R") {
          put(pt.id, g2 * (cur[0] ** 2 + cur[1] ** 2) / pt.value);
        }
      }
    });
  }
  return [...out.values()];
}

// ---------------------------------------------------------------- tested suggestions
export interface Suggestion {
  /** What to change, in words: "Tweeter Rs 4.7 → 3.3 Ω". */
  label: string;
  /** Score after the change, and the gain. */
  score: number;
  gain: number;
  /** Criteria that change by at least a few points: title and before → after state. */
  effects: { id: string; title: string; delta: number }[];
  focus?: string;
  design: Design;
}

/** The stock values next to v in a component list: one step down and up for a stock value, the two
 *  either side for an off-list one, only the nearest end when v lies outside the list. */
export function stockNeighbours(list: number[], v: number): number[] {
  const s = [...list].sort((a, b) => a - b), i = s.findIndex(x => Math.abs(x / v - 1) < 0.005);
  if (i < 0) { const j = s.findIndex(x => x > v); return j < 0 ? s.slice(-1) : j === 0 ? s.slice(0, 1) : [s[j - 1], s[j]]; }
  return [s[i - 1], s[i + 1]].filter((x): x is number => x !== undefined);
}

/** Try small, buildable changes one at a time and return those that raise the score, best first. */
export function suggest(p: Prepared, design: Design, base: Assessment, max = 5): Suggestion[] {
  const cands: { label: string; focus?: string; knob: string; mut: (d: Design) => void }[] = [];
  const C = p.profile.components, neighbours = stockNeighbours;
  const U = { woof: "Woofer", mid: "Midrange", tw: "Tweeter" } as const;

  for (const u of UNIT_IDS)
    cands.push({ label: `Invert the ${NAME[u]}`, knob: `pol.${u}`, focus: u === "woof" ? "digital.pol" : `${u}.pol`, mut: d => { d.pol[u] = (d.pol[u] === 1 ? -1 : 1); } });
  for (const dg of [-2, -1, 1, 2]) {
    const g = Math.round((design.digital.g_woof_dB + dg) * 10) / 10;
    cands.push({ label: `Woofer gain ${sdb(design.digital.g_woof_dB)} → ${sdb(g)}`, knob: "gain", focus: "digital.gain", mut: d => { d.digital.g_woof_dB = g; } });
  }
  for (const k of [-1 / 3, -1 / 6, 1 / 6, 1 / 3]) {
    const fc = Math.round(design.digital.fc * 2 ** k / 5) * 5;
    if (fc >= 100 && fc <= 1000) cands.push({ label: `Digital crossover ${fmtHz(design.digital.fc)} → ${fmtHz(fc)}`, knob: "fc", focus: "digital.fc", mut: d => { d.digital.fc = fc; } });
  }
  for (const al of ["BW2", "LR2", "LR4", "BW4"] as const)
    if (al !== design.digital.align) cands.push({ label: `Digital alignment ${design.digital.align} → ${al}`, knob: "align", focus: "digital.align", mut: d => { d.digital.align = al; } });
  for (const u of ["mid", "tw"] as const) {
    const b = design[u];
    for (const [name, v] of Object.entries(b.vals)) {
      const kind = name[0] as "L" | "C";
      for (const nv of neighbours(C[kind], v))
        cands.push({ label: `${U[u]} ${name} ${fmtPart(kind, v)} → ${fmtPart(kind, nv)}`, knob: `${u}.${name}`, focus: `${u}.${name}`, mut: d => { d[u].vals[name] = nv; } });
    }
    const pad = b.pad ?? {};
    if (pad.Rs) {
      for (const nv of neighbours(C.R, pad.Rs)) cands.push({ label: `${U[u]} Rs ${fmtPart("R", pad.Rs)} → ${fmtPart("R", nv)}`, knob: `${u}.Rs`, focus: `${u}.pad.Rs`, mut: d => { d[u].pad = { ...d[u].pad, Rs: nv }; } });
      cands.push({ label: `Remove the ${NAME[u]} Rs`, knob: `${u}.Rs`, focus: `${u}.pad.Rs`, mut: d => { d[u].pad = { ...d[u].pad, Rs: undefined }; } });
    } else if (u === "tw") {
      for (const nv of C.R.filter(x => x <= 6.8)) cands.push({ label: `Add a ${fmtPart("R", nv)} series resistor to the tweeter`, knob: `${u}.Rs`, focus: `${u}.pad.Rs`, mut: d => { d[u].pad = { ...d[u].pad, Rs: nv }; } });
    }
    if (pad.Rp) {
      for (const nv of neighbours(C.R, pad.Rp)) cands.push({ label: `${U[u]} Rp ${fmtPart("R", pad.Rp)} → ${fmtPart("R", nv)}`, knob: `${u}.Rp`, focus: `${u}.pad.Rp`, mut: d => { d[u].pad = { ...d[u].pad, Rp: nv }; } });
      cands.push({ label: `Remove the ${NAME[u]} Rp`, knob: `${u}.Rp`, focus: `${u}.pad.Rp`, mut: d => { d[u].pad = { ...d[u].pad, Rp: null }; } });
    }
  }
  const range = p.profile.woofer_box.vents[0]?.length_range_m;
  if (design.box.mode !== "plugged" && range) for (const dl of [-0.02, 0.02, 0.04]) {
    const L = Math.round((design.box.L + dl) * 1000) / 1000;
    if (L >= range[0] && L <= range[1]) cands.push({ label: `Vent length ${(design.box.L * 1000).toFixed(0)} → ${(L * 1000).toFixed(0)} mm`, knob: "box.L", focus: "box.L", mut: d => { d.box.L = L; } });
  }

  const before = new Map(base.criteria.map(c => [c.id, c]));
  const best = new Map<string, Suggestion>();
  for (const c of cands) {
    const d = structuredClone(design) as Design;
    c.mut(d);
    let a: Assessment;
    try { a = assess(p, d, compute(p, d)); } catch { continue; }
    const gain = a.score - base.score;
    if (gain < 1) continue;
    const effects = a.criteria
      .map(x => ({ id: x.id, title: x.title, delta: Math.round(100 * (x.score - (before.get(x.id)?.score ?? x.score))) }))
      .filter(x => Math.abs(x.delta) >= 5).sort((x, y) => y.delta - x.delta);
    const s: Suggestion = { label: c.label, score: a.score, gain, effects, focus: c.focus, design: d };
    const prev = best.get(c.knob);
    if (!prev || s.gain > prev.gain) best.set(c.knob, s);
  }
  return [...best.values()].sort((a, b) => b.gain - a.gain).slice(0, max);
}
