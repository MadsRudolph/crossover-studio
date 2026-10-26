// Report pack, part 3: a small SVG plotter for the Markdown report and the preview. Log frequency axis,
// stacked panels sharing it, line series in the print palette on a white page. No dependencies, and the
// output is deterministic (fixed rounding), so two exports of one design are byte-identical.

import { PALETTE, yRange, type FigPanel, type FigSeries, type Figure } from "./figures";

const W = 720, ML = 66, MR = 18, PH = 168, GAP = 26, MB = 44;
const FONT = "Helvetica, Arial, sans-serif";
const INK = "#222222", GRID = "#e3e3e3", GRID_MAJOR = "#c9c9c9";

export function xmlEscape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const r1 = (v: number) => (Math.round(v * 10) / 10).toFixed(1).replace(/\.0$/, "");

/** "100", "1k", "10k". */
export function freqTick(f: number): string {
  return f >= 1000 ? `${Number((f / 1000).toPrecision(3))}k` : String(Number(f.toPrecision(3)));
}

/** Legend entries: one per distinct (legend, colour, dash), in order of appearance. */
function legendItems(fig: Figure): FigSeries[] {
  const seen = new Set<string>(), out: FigSeries[] = [];
  for (const p of fig.panels) for (const s of p.series) {
    const k = `${s.legend}|${s.color}|${s.dash ? 1 : 0}`;
    if (!seen.has(k)) { seen.add(k); out.push(s); }
  }
  return out;
}

/** Lay out legend entries in rows; returns the rows and the height they need. */
function legendRows(items: FigSeries[]): { rows: { s: FigSeries; x: number }[][]; height: number } {
  const rows: { s: FigSeries; x: number }[][] = [[]];
  let x = ML;
  for (const s of items) {
    const w = 30 + s.legend.length * 6.1 + 14;
    if (x + w > W - MR && rows[rows.length - 1].length) { rows.push([]); x = ML; }
    rows[rows.length - 1].push({ s, x });
    x += w;
  }
  return { rows, height: rows.length * 18 + 8 };
}

/** One series as path data, broken at NaN and clipped by the panel's clip path. */
function pathData(xs: number[], y: ArrayLike<number>, ty: (v: number) => number): string {
  let d = "", pen = false;
  for (let i = 0; i < xs.length; i++) {
    const v = y[i];
    if (!Number.isFinite(v) || !Number.isFinite(xs[i])) { pen = false; continue; }
    d += `${pen ? "L" : "M"}${r1(xs[i])} ${r1(ty(v))}`;
    pen = true;
  }
  return d;
}

/** The figure as a standalone SVG string (white background, print palette). */
export function figureSvg(fig: Figure): string {
  const leg = legendRows(legendItems(fig));
  const top = leg.height + 6;
  const H = top + fig.panels.length * PH + (fig.panels.length - 1) * GAP + MB;
  const [f0, f1] = fig.xrange, lx0 = Math.log10(f0), lx1 = Math.log10(f1);
  const tx = (f: number) => ML + (Math.log10(f) - lx0) / (lx1 - lx0) * (W - ML - MR);
  const xs = Array.from(fig.x, f => (f >= f0 && f <= f1 ? tx(f) : NaN));
  const out: string[] = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="${FONT}" font-size="11" role="img" aria-label="${xmlEscape(fig.caption)}">`);
  out.push(`<rect width="${W}" height="${H}" fill="#ffffff"/>`);

  // legend
  leg.rows.forEach((row, ri) => row.forEach(({ s, x }) => {
    const y = 12 + ri * 18;
    out.push(`<line x1="${r1(x)}" y1="${y}" x2="${r1(x + 24)}" y2="${y}" stroke="${PALETTE[s.color]}" stroke-width="2"${s.dash ? ' stroke-dasharray="6 3"' : ""}/>`);
    out.push(`<text x="${r1(x + 30)}" y="${y + 4}" fill="${INK}">${xmlEscape(s.legend)}</text>`);
  }));

  // decades and their 2..9 subdivisions
  const majors: number[] = [], minors: number[] = [];
  for (let e = Math.floor(lx0); e <= Math.ceil(lx1); e++)
    for (let m = 1; m <= 9; m++) {
      const f = m * 10 ** e;
      if (f < f0 * 0.9999 || f > f1 * 1.0001) continue;
      (m === 1 ? majors : minors).push(f);
    }

  fig.panels.forEach((panel: FigPanel, pi) => {
    const y0 = top + pi * (PH + GAP), y1 = y0 + PH;
    const { min, max, step } = yRange(panel);
    const ty = (v: number) => y1 - (v - min) / (max - min) * PH;
    const clip = `xs-${fig.id}-p${pi}`;
    out.push(`<clipPath id="${clip}"><rect x="${ML}" y="${y0}" width="${W - ML - MR}" height="${PH}"/></clipPath>`);
    for (const f of minors) out.push(`<line x1="${r1(tx(f))}" y1="${y0}" x2="${r1(tx(f))}" y2="${y1}" stroke="${GRID}" stroke-width="0.6"/>`);
    for (const f of majors) out.push(`<line x1="${r1(tx(f))}" y1="${y0}" x2="${r1(tx(f))}" y2="${y1}" stroke="${GRID_MAJOR}" stroke-width="0.8"/>`);
    for (let k = 0, v = min; v <= max + step * 1e-6; k++, v = min + k * step) {
      out.push(`<line x1="${ML}" y1="${r1(ty(v))}" x2="${W - MR}" y2="${r1(ty(v))}" stroke="${GRID_MAJOR}" stroke-width="0.6"/>`);
      out.push(`<text x="${ML - 6}" y="${r1(ty(v) + 4)}" text-anchor="end" fill="${INK}">${xmlEscape(String(Number(v.toPrecision(6))))}</text>`);
    }
    if (panel.band) {
      const bx0 = tx(Math.max(panel.band.x[0], f0)), bx1 = tx(Math.min(panel.band.x[1], f1));
      const by0 = ty(panel.band.y[1]), by1 = ty(panel.band.y[0]);
      out.push(`<rect x="${r1(bx0)}" y="${r1(by0)}" width="${r1(bx1 - bx0)}" height="${r1(by1 - by0)}" fill="#000000" fill-opacity="0.08" clip-path="url(#${clip})"/>`);
    }
    for (const s of panel.series) {
      const d = pathData(xs, s.y, ty);
      if (d) out.push(`<path d="${d}" fill="none" stroke="${PALETTE[s.color]}" stroke-width="${s.color === "sum" ? 1.8 : 1.4}" stroke-linejoin="round"${s.dash ? ' stroke-dasharray="6 3"' : ""} clip-path="url(#${clip})"/>`);
    }
    out.push(`<rect x="${ML}" y="${y0}" width="${W - ML - MR}" height="${PH}" fill="none" stroke="${INK}" stroke-width="0.8"/>`);
    for (const f of majors) out.push(`<text x="${r1(tx(f))}" y="${y1 + 14}" text-anchor="middle" fill="${INK}">${freqTick(f)}</text>`);
    const cy = (y0 + y1) / 2;
    out.push(`<text x="14" y="${r1(cy)}" text-anchor="middle" transform="rotate(-90 14 ${r1(cy)})" fill="${INK}">${xmlEscape(panel.ylabel)}</text>`);
  });
  out.push(`<text x="${r1((ML + W - MR) / 2)}" y="${H - 10}" text-anchor="middle" fill="${INK}">${xmlEscape(fig.xlabel)}</text>`);
  out.push("</svg>");
  return out.join("");
}
