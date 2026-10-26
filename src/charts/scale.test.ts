import { describe, expect, it } from "vitest";
import {
  angleTicks,
  axisTicks,
  clampView,
  decimalsForStep,
  decimate,
  easeOut,
  extentIn,
  formatHz,
  formatHzTick,
  formatNumber,
  lerpView,
  logTicks,
  makeScale,
  nearestIndex,
  niceDomain,
  niceTicks,
  panBy,
  visibleSlice,
  wrapDeg,
  zoomAt,
} from "./scale";

describe("logTicks", () => {
  it("labels 1-2-5 over the audio band", () => {
    const t = logTicks(20, 20000);
    expect(t.labelled.map((k) => k.label)).toEqual([
      "20", "50", "100", "200", "500", "1k", "2k", "5k", "10k", "20k",
    ]);
  });

  it("puts gridlines on every integer multiple and flags decades", () => {
    const t = logTicks(20, 20000);
    expect(t.grid[0]).toEqual({ value: 20, strong: false });
    expect(t.grid.filter((g) => g.strong).map((g) => g.value)).toEqual([100, 1000, 10000]);
    // 20..90 (8) + 100..900 (9) + 1k..9k (9) + 10k, 20k
    expect(t.grid).toHaveLength(28);
    expect(t.grid.map((g) => g.value)).toContain(3000);
  });

  it("ranks decades first so collision culling keeps them", () => {
    const t = logTicks(10, 100000);
    const decade = t.labelled.filter((k) => k.rank === 0).map((k) => k.value);
    expect(decade).toEqual([10, 100, 1000, 10000, 100000]);
  });

  it("labels every multiple inside about a decade", () => {
    const t = logTicks(200, 1500);
    expect(t.labelled.map((k) => k.label)).toEqual(["200", "300", "400", "500", "600", "700", "800", "900", "1k"]);
  });

  it("switches to linear ticks inside a narrow window", () => {
    const t = logTicks(900, 1200);
    expect(t.labelled.length).toBeGreaterThanOrEqual(3);
    expect(t.labelled.map((k) => k.value)).toEqual([900, 950, 1000, 1050, 1100, 1150, 1200]);
    expect(t.labelled.find((k) => k.value === 1050)?.label).toBe("1.05k");
  });

  it("returns nothing for an invalid range", () => {
    expect(logTicks(0, 100).labelled).toEqual([]);
    expect(logTicks(100, 50).grid).toEqual([]);
  });
});

describe("niceTicks / niceDomain", () => {
  it("chooses 1-2-2.5-5 steps", () => {
    expect(niceTicks(-40, 10, 5)).toEqual([-40, -30, -20, -10, 0, 10]);
    expect(niceTicks(0, 1, 4)).toEqual([0, 0.25, 0.5, 0.75, 1]);
    expect(niceTicks(-180, 180, 8)).toEqual([-150, -100, -50, 0, 50, 100, 150]);
  });

  it("covers the range without float noise and without -0", () => {
    const t = niceTicks(-0.3, 0.3, 6);
    expect(t).toEqual([-0.3, -0.2, -0.1, 0, 0.1, 0.2, 0.3]);
    expect(Object.is(t[3], -0)).toBe(false);
  });

  it("expands a domain outward to whole steps", () => {
    expect(niceDomain(-37.2, 8.1, 5)).toEqual([-40, 10]);
    const flat = niceDomain(3, 3);
    expect(flat[0]).toBeLessThan(3);
    expect(flat[1]).toBeGreaterThan(3);
  });

  it("knows how many decimals a step needs", () => {
    expect(decimalsForStep(10)).toBe(0);
    expect(decimalsForStep(0.5)).toBe(1);
    expect(decimalsForStep(0.25)).toBe(2);
  });
});

describe("angleTicks / axisTicks", () => {
  it("steps phase axes in natural angles", () => {
    expect(angleTicks(-180, 180, 4)).toEqual([-180, -90, 0, 90, 180]);
    expect(angleTicks(-180, 180, 8)).toEqual([-180, -135, -90, -45, 0, 45, 90, 135, 180]);
    expect(angleTicks(-60, 60, 4)).toEqual([-60, -30, 0, 30, 60]);
  });

  it("never returns fewer than three ticks on a short axis", () => {
    expect(axisTicks(-180, 180, 60, true).length).toBeGreaterThanOrEqual(3);
    expect(axisTicks(-180, 180, 60, false).length).toBeGreaterThanOrEqual(3);
    expect(axisTicks(-30, 9, 300, false)).toEqual([-30, -25, -20, -15, -10, -5, 0, 5]);
  });
});

describe("formatting", () => {
  it("formats frequency ticks compactly", () => {
    expect(formatHzTick(20)).toBe("20");
    expect(formatHzTick(1000)).toBe("1k");
    expect(formatHzTick(1500)).toBe("1.5k");
    expect(formatHzTick(20000)).toBe("20k");
    expect(formatHzTick(2.5)).toBe("2.5");
  });

  it("formats readout frequencies with three significant digits", () => {
    expect(formatHz(48.31)).toBe("48.3 Hz");
    expect(formatHz(250)).toBe("250 Hz");
    expect(formatHz(1250)).toBe("1.25 kHz");
    expect(formatHz(12600)).toBe("12.6 kHz");
  });

  it("uses a real minus sign and never prints -0", () => {
    expect(formatNumber(-3.14, 1)).toBe("−3.1");
    expect(formatNumber(-0.01, 1)).toBe("0.0");
    expect(formatNumber(NaN, 1)).toBe("—");
  });
});

describe("makeScale", () => {
  it("maps a log axis decade-linearly", () => {
    const s = makeScale([10, 1000], [0, 200], true);
    expect(s.toPx(100)).toBeCloseTo(100);
    expect(s.fromPx(150)).toBeCloseTo(10 ** 2.5);
  });

  it("maps an inverted linear y axis", () => {
    const s = makeScale([-40, 10], [300, 0], false);
    expect(s.toPx(10)).toBeCloseTo(0);
    expect(s.toPx(-40)).toBeCloseTo(300);
    expect(s.fromPx(150)).toBeCloseTo(-15);
  });
});

describe("view manipulation", () => {
  it("zooms about a point in log space", () => {
    const v = zoomAt([10, 10000], 100, 0.5, true);
    expect(Math.log10(v[0])).toBeCloseTo(1.5);
    expect(Math.log10(v[1])).toBeCloseTo(3);
  });

  it("pans by pixels", () => {
    const v = panBy([100, 1000], 100, 100, true);
    expect(v[0]).toBeCloseTo(10);
    expect(v[1]).toBeCloseTo(100);
    const l = panBy([0, 10], -50, 100, false);
    expect(l).toEqual([5, 15]);
  });

  it("clamps inside bounds and enforces a minimum span", () => {
    expect(clampView([5, 50], [20, 20000], 0.05, true).map((v) => +v.toFixed(6))).toEqual([20, 200]);
    expect(clampView([1, 1e6], [20, 20000], 0.05, true)).toEqual([20, 20000]);
    const tiny = clampView([1000, 1001], [20, 20000], 0.1, true);
    expect(Math.log10(tiny[1] / tiny[0])).toBeCloseTo(0.1);
  });

  it("interpolates views in log space", () => {
    const mid = lerpView([10, 100], [100, 1000], 0.5, true);
    expect(mid[0]).toBeCloseTo(10 ** 1.5);
    expect(mid[1]).toBeCloseTo(10 ** 2.5);
  });

  it("eases from 0 to 1 monotonically", () => {
    expect(easeOut(0)).toBe(0);
    expect(easeOut(1)).toBe(1);
    let prev = 0;
    for (let t = 0.05; t < 1; t += 0.05) {
      const e = easeOut(t);
      expect(e).toBeGreaterThanOrEqual(prev);
      prev = e;
    }
    expect(easeOut(0.3)).toBeGreaterThan(0.6); // front-loaded, like the CSS token
  });
});

describe("nearestIndex / visibleSlice / extentIn", () => {
  const xs = Float64Array.from([10, 20, 40, 80, 160]);

  it("finds the nearest sample", () => {
    expect(nearestIndex(xs, 5)).toBe(0);
    expect(nearestIndex(xs, 1000)).toBe(4);
    expect(nearestIndex(xs, 29)).toBe(1);
    expect(nearestIndex(xs, 31)).toBe(2);
    expect(nearestIndex([], 3)).toBe(-1);
  });

  it("measures nearness in ratio on a log axis", () => {
    // 29 is closer to 20 linearly? no: 29-20=9, 40-29=11. In ratio: 29/20=1.45, 40/29=1.38 -> 40.
    expect(nearestIndex(xs, 29, true)).toBe(2);
  });

  it("returns a slice one sample wider than the window", () => {
    expect(visibleSlice(xs, 25, 90)).toEqual([1, 4]);
    expect(visibleSlice(xs, 0, 1000)).toEqual([0, 4]);
  });

  it("measures the finite extent inside a window", () => {
    const y = [5, NaN, -3, 7, 100];
    expect(extentIn(xs, y, 15, 100)).toEqual([-3, 7]);
    expect(extentIn(xs, y, 11, 19)).toBeNull();
  });
});

describe("decimate", () => {
  it("keeps the envelope of a huge series with few points", () => {
    const n = 200000;
    const x = new Float64Array(n);
    const y = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      x[i] = i;
      y[i] = Math.sin(i / 50) + (i === 123457 ? 9 : 0) - (i === 7777 ? 9 : 0);
    }
    const width = 500;
    const idx = decimate(x, y, 0, n - 1, (v) => (v / n) * width);
    expect(idx.length).toBeLessThanOrEqual(width * 4 + 4);
    const kept = Array.from(idx, (i) => y[i]);
    const maxOf = (a: ArrayLike<number>) => Array.from(a).reduce((m, v) => Math.max(m, v), -Infinity);
    const minOf = (a: ArrayLike<number>) => Array.from(a).reduce((m, v) => Math.min(m, v), Infinity);
    expect(maxOf(kept)).toBeCloseTo(maxOf(y));
    expect(minOf(kept)).toBeCloseTo(minOf(y));
    expect(idx[0]).toBe(0);
    expect(idx[idx.length - 1]).toBe(n - 1);
    for (let i = 1; i < idx.length; i++) expect(idx[i]).toBeGreaterThan(idx[i - 1]);
  });

  it("keeps line breaks", () => {
    const x = [0, 0.1, 0.2, 0.3, 0.4];
    const y = [1, 2, NaN, 3, 4];
    const idx = Array.from(decimate(x, y, 0, 4, (v) => v)); // all in pixel column 0
    expect(idx).toContain(2);
  });
});

describe("wrapDeg", () => {
  it("wraps into (-180, 180]", () => {
    expect(wrapDeg(190)).toBeCloseTo(-170);
    expect(wrapDeg(-190)).toBeCloseTo(170);
    expect(wrapDeg(-180)).toBe(180);
    expect(wrapDeg(720 + 45)).toBeCloseTo(45);
  });
});
