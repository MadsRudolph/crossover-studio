// Limits: the building blocks against hand calculations, and the bundled System D design end to end
// (every mechanism consistent with its own definition, the chain-gain calibration, the overrides).
import { describe, expect, it } from "vitest";
import { compute, fitBox, prepare, resistorPower } from ".";
import {
  chainGainDb, excursionFromPressure, limits, limitSettings, loadsAt, pinkShareAbove, pinkWeights, radiationAngle,
  CREST_IEC_DB, DEFAULT_AMP_VRMS,
} from "./limits";
import { hDigital } from "./digital";
import { logspace } from "./complex";
import { BUNDLED_PROFILES, defaultDesign } from "../state/store";
import type { Profile } from "../types";

const profile = BUNDLED_PROFILES[0];
const p = prepare(profile, fitBox(profile));
const design = defaultDesign();
const results = compute(p, design);
const S = limitSettings(profile);
const L = limits(p, design, results, S);

describe("limits building blocks", () => {
  it("weights a pink noise by its share of octaves", () => {
    const f = logspace(20, 20000, 300), w = pinkWeights(f);
    expect(w.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
    // ln(20000/2000) / ln(1000) = 1/3 of the power lies above 2 kHz
    expect(pinkShareAbove(2000)).toBeCloseTo(1 / 3, 9);
    expect(pinkShareAbove(10)).toBe(1);
  });

  it("radiates into full space below the baffle step and half space above", () => {
    expect(radiationAngle(10, 0.2) / Math.PI).toBeCloseTo(4, 2);
    expect(radiationAngle(1e5, 0.2) / Math.PI).toBeCloseTo(2, 2);
    expect(radiationAngle(115 / 0.2, 0.2) / Math.PI).toBeCloseTo(3, 9);   // halfway at f_bs = 115 / width
  });

  it("gets the piston excursion from the far-field pressure", () => {
    // p = rho w^2 S x / (Omega r): 1 Pa at 1 m, 100 Hz, S = 0.01 m^2, half space, rho = 1.2
    // x = 2 pi / (1.2 * 0.01 * (2 pi 100)^2) = 1.3263 mm amplitude per V rms -> times sqrt 2 for the peak
    const x = excursionFromPressure(1, 100, 1, 1.2, 0.01, 2 * Math.PI);
    expect(x).toBeCloseTo(Math.SQRT2 * 2 * Math.PI / (1.2 * 0.01 * (2 * Math.PI * 100) ** 2), 12);
    expect(x * 1e3).toBeCloseTo(1.8757, 3);
  });
});

describe("limits of the bundled design", () => {
  it("names the first part to give up and its level", () => {
    console.log(`max ${L.maxSpl1m.toFixed(1)} dB at 1 m (${L.maxSplListen.toFixed(1)} dB at ${S.listenM} m), set by ${L.limiting.id} at ${L.maxV.toFixed(2)} V; chain gain ${L.chainGainDb.toFixed(1)} dB`);
    for (const m of L.mechanisms) console.log(`  ${m.id.padEnd(16)} ${m.progSpl.toFixed(1)} dB  (${m.limit.toFixed(2)} ${m.quantityUnit}${m.estimated ? ", est." : ""})`);
    expect(L.mechanisms.length).toBeGreaterThanOrEqual(9);
    expect(L.limiting.progV).toBe(Math.min(...L.mechanisms.map(m => m.progV)));
    expect(L.maxSpl1m).toBeGreaterThan(80); expect(L.maxSpl1m).toBeLessThan(120);
    expect(L.maxSplListen).toBeCloseTo(L.maxSpl1m - 20 * Math.log10(S.listenM), 9);
  });

  it("puts the limiting part at exactly 100 % at the headline level, every other part below", () => {
    const at = loadsAt(L, L.maxSpl1m);
    expect(at.V).toBeCloseTo(L.maxV, 6);
    for (const l of at.loads) {
      if (l.id === L.limiting.id) expect(l.fraction).toBeCloseTo(1, 6);
      else expect(l.fraction).toBeLessThanOrEqual(1 + 1e-9);
    }
    // 6 dB less: peak quantities at half, powers at a quarter
    const down = loadsAt(L, L.maxSpl1m - 20 * Math.log10(2));
    for (const l of down.loads) {
      const m = L.mechanisms.find(x => x.id === l.id)!, full = m.perV * L.maxV ** m.exp;
      expect(l.value / full).toBeCloseTo(m.exp === 1 ? 0.5 : 0.25, 6);
    }
  });

  it("clips channel 2 where a hand sum over the high-pass says", () => {
    // pink noise of V rms through the LR4 high-pass: rms on channel 2 = V sqrt(sum w |H_H|^2), the peak
    // is 12 dB (3.98x) above it, and clipping starts at sqrt 2 x 20 V
    const f = logspace(20, 20000, 360), w = pinkWeights(f), H = hDigital(f, design.digital.fc, "HPF", design.digital.align);
    let ms = 0;
    for (let i = 0; i < f.length; i++) ms += w[i] * (H.re[i] ** 2 + H.im[i] ** 2);
    const V = DEFAULT_AMP_VRMS * Math.SQRT2 / (10 ** (12 / 20) * Math.sqrt(ms));
    expect(L.mechanisms.find(m => m.id === "amp.ch2")!.progV).toBeCloseTo(V, 6);
    // and roughly the share of octaves above f_c
    expect(ms).toBeGreaterThan(pinkShareAbove(design.digital.fc) * 0.85);
    expect(ms).toBeLessThan(pinkShareAbove(design.digital.fc) * 1.05);
  });

  it("agrees with the verdict's resistor powers", () => {
    // resistorPower is W per W of pink noise into 8 ohm (V^2 = 8 W): divide by 8 for W per V^2
    for (const r of resistorPower(p, design)) {
      const m = L.mechanisms.find(x => x.id === `res:${r.id}`)!;
      expect(m.perV / (r.pinkPerW / 8)).toBeGreaterThan(0.9);
      expect(m.perV / (r.pinkPerW / 8)).toBeLessThan(1.1);
    }
  });

  it("removes the measurement chain's gain, so the levels do not depend on the Lab E volume setting", () => {
    expect(L.chainGainDb).toBeGreaterThan(20); expect(L.chainGainDb).toBeLessThan(40);   // a power amplifier's gain
    // the same profile measured 20 dB louder (every TF x 10): same limits
    const loud = structuredClone(profile) as Profile;
    for (const set of Object.values(loud.measurements.tf)) for (const s of Object.values(set)) if (s) { s.re = s.re.map(x => x * 10); s.im = s.im.map(x => x * 10); }
    const q = prepare(loud, fitBox(loud)), r2 = limits(q, design, compute(q, design), limitSettings(loud));
    expect(chainGainDb(q)).toBeCloseTo(L.chainGainDb + 20, 6);
    expect(r2.maxSpl1m).toBeCloseTo(L.maxSpl1m, 6);
    for (const m of r2.mechanisms) expect(m.progV).toBeCloseTo(L.mechanisms.find(x => x.id === m.id)!.progV, 6);
  });

  it("uses the woofer's data sheet, estimates for the DALI units, and the user's values over both", () => {
    expect(S.units.woof).toMatchObject({ xmax_mm: 6, p_rated_w: 80, z_nom_ohm: 8, src: { xmax: "profile", p: "profile" } });
    expect(S.units.mid.src.xmax).toBe("estimate");
    expect(S.units.mid.z_nom_ohm).toBe(Math.round(4.6 / 0.8));
    expect(L.estimatedUnits).toEqual(["mid", "tw"]);
    const user = limitSettings(profile, { units: { woof: { xmax_mm: 3 }, tw: { p_rated_w: 100, p_rated_hp_hz: 4000 } }, amp_vrms: 40 });
    expect(user.units.woof).toMatchObject({ xmax_mm: 3, src: { xmax: "user", p: "profile" } });
    expect(user.units.tw.p_rated_hp_hz).toBe(4000);
    expect(user.amp).toEqual({ max_vrms: 40, src: "user" });
    // half the stroke: the woofer reaches it at half the drive (6 dB lower)
    const r2 = limits(p, design, results, user), x = (r: typeof L) => r.mechanisms.find(m => m.id === "woof.xmax")!;
    expect(x(r2).progSpl).toBeCloseTo(x(L).progSpl - 20 * Math.log10(2), 6);
    // the tweeter's rating counts for the pink-noise share above its 4 kHz test high-pass
    expect(r2.mechanisms.find(m => m.id === "tw.thermal")!.limit).toBeCloseTo(100 * pinkShareAbove(4000), 9);
  });

  it("lets a lower crest factor play louder before peaks limit, and leaves heat alone", () => {
    const iec = limits(p, design, results, limitSettings(profile, {}, CREST_IEC_DB));
    for (const m of iec.mechanisms) {
      const a = L.mechanisms.find(x => x.id === m.id)!;
      expect(m.progSpl - a.progSpl).toBeCloseTo(m.exp === 1 ? 6 : 0, 6);
    }
  });

  it("draws a sine limit curve for every mechanism and an envelope at their minimum", () => {
    for (let i = 0; i < L.f.length; i += 37) {
      const lows = L.mechanisms.map(m => m.sineSpl[i]).filter(Number.isFinite);
      expect(L.envelope[i]).toBeCloseTo(Math.min(...lows), 9);
    }
    // the woofer's stroke curve: at 20 Hz a sine reaches 6 mm peak; check it against its own definition
    const w = L.mechanisms.find(m => m.id === "woof.xmax")!;
    expect(w.sineV[0]).toBeGreaterThan(0);
    expect(w.worstF).toBeLessThan(60);
  });
});
