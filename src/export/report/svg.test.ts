// The report's SVG plotter and the figure helpers it shares with the LaTeX writer.
import { describe, expect, it } from "vitest";
import { niceStep, onGrid, wrapBreaks, yRange, type Figure } from "./figures";
import { figureSvg, freqTick, xmlEscape } from "./svg";

const f = Array.from({ length: 50 }, (_, i) => 20 * 1000 ** (i / 49));     // 20 Hz-20 kHz
const fig: Figure = {
  id: "t", file: "fig_t.csv", caption: "Test <figure> & co", x: f, xlabel: "Frequency (Hz)", xrange: [20, 20000],
  panels: [
    { ylabel: "Level (dB re 1 Pa/V)", band: { x: [150, 15000], y: [-2, 2] },
      series: [{ col: "a_db", legend: "Woofer <A>", color: "woof", kind: "mag", y: f.map((_, i) => (i === 10 ? NaN : -i / 5)) }] },
    { ylabel: "Phase (deg)", y: [-180, 180],
      series: [{ col: "a_deg", legend: "Woofer <A>", color: "woof", kind: "phase", partner: "a_db", y: f.map((_, i) => ((i * 40) % 360) - 180) }] },
  ],
};

describe("SVG plotter", () => {
  const svg = figureSvg(fig);

  it("draws a standalone white-page SVG with escaped text", () => {
    expect(svg.startsWith("<svg xmlns=\"http://www.w3.org/2000/svg\"")).toBe(true);
    expect(svg).toContain('<rect width="720"');
    expect(svg).toContain('fill="#ffffff"');
    expect(svg).toContain("Woofer &lt;A&gt;");
    expect(svg).toContain('aria-label="Test &lt;figure&gt; &amp; co"');
    expect(svg).not.toMatch(/NaN|Infinity|undefined/);
  });

  it("uses the print palette and one legend entry per distinct series", () => {
    expect(svg).toContain('stroke="#1f5fb4"');
    expect((svg.match(/Woofer &lt;A&gt;/g) ?? []).length).toBe(1);
    expect(svg).not.toMatch(/var\(--/);
  });

  it("breaks a line at NaN instead of drawing through it", () => {
    const d = /<path d="([^"]+)"[^>]*stroke="#1f5fb4"/.exec(svg)![1];
    expect((d.match(/M/g) ?? []).length).toBe(2);
  });

  it("labels the axes by the grading rules and the log axis by decade", () => {
    expect(svg).toContain(">Frequency (Hz)<");
    expect(svg).toContain(">Phase (deg)<");
    for (const t of ["100", "1k", "10k"]) expect(svg).toContain(`>${t}</text>`);
    expect(svg).not.toMatch(/[[\]]/);
  });

  it("is deterministic", () => {
    expect(figureSvg(fig)).toBe(svg);
  });
});

describe("helpers", () => {
  it("freqTick and xmlEscape", () => {
    expect(freqTick(10)).toBe("10");
    expect(freqTick(1000)).toBe("1k");
    expect(freqTick(20000)).toBe("20k");
    expect(xmlEscape(`a<b>&"`)).toBe("a&lt;b&gt;&amp;&quot;");
  });

  it("wrapBreaks puts NaN only where the phase wraps", () => {
    const w = wrapBreaks([170, 179, -179, -170, 0]);
    expect(Number.isNaN(w[2])).toBe(true);
    expect([w[0], w[1], w[3], w[4]]).toEqual([170, 179, -170, 0]);
  });

  it("niceStep and yRange round out to whole ticks and cap level panels at 50 dB", () => {
    expect(niceStep(37)).toBe(10);
    expect(niceStep(3.6)).toBe(1);
    expect(yRange({ ylabel: "Phase (deg)", series: [], y: [-180, 180] })).toEqual({ min: -180, max: 180, step: 90 });
    const r = yRange({ ylabel: "Level (dB re 1 Pa/V)", series: [{ col: "a", legend: "", color: "sum", kind: "mag", y: [-90, 3.2, NaN] }] });
    expect(r.max).toBeGreaterThanOrEqual(3.2);
    expect(r.min).toBeGreaterThanOrEqual(-50);
    expect(r.min % r.step).toBeCloseTo(0);
  });

  it("onGrid interpolates on log f and leaves NaN outside the measured range", () => {
    const z = onGrid({ f: [10, 1000], re: [0, 2], im: [1, 1] }, [5, 10, 100, 1000, 2000]);
    expect(Number.isNaN(z.re[0]) && Number.isNaN(z.re[4])).toBe(true);
    expect(z.re[2]).toBeCloseTo(1);
    expect(z.im[1]).toBe(1);
  });
});
