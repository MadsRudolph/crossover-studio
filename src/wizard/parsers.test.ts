// The TypeScript text reader must read every fixture exactly like the Rust one (src-tauri/src/text.rs).
// The CSVs store f with six significant digits (1044.125 -> 1044.12), hence 1e-5 on frequency.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ParseError, decodeText, looksLikeLtspice, parseCsv, parseLtspice, parseText, textToSeries, validateSeries } from "./parsers";

const read = (rel: string) => readFileSync(new URL(`../../fixtures/${rel}`, import.meta.url), "utf8");
const rel = (a: number, b: number) => Math.abs(a - b) / Math.max(Math.abs(b), 1e-300);

describe("Matlab2LTspice text", () => {
  it("inverts the admittance table back to the measured impedance", () => {
    const { format, table: z } = parseText(read("text/Zi_mid.txt"));
    expect(format).toBe("ltspice");
    const c = parseCsv(read("csv/Z_midrange.csv"));
    expect(z.f.length).toBe(c.f.length);
    for (let k = 0; k < z.f.length; k++) {
      const m = Math.hypot(c.re[k], c.im[k]);
      expect(rel(z.f[k], c.f[k])).toBeLessThan(1e-5);
      expect(Math.abs(z.re[k] - c.re[k])).toBeLessThan(1e-6 * m);
      expect(Math.abs(z.im[k] - c.im[k])).toBeLessThan(1e-6 * m);
    }
    expect(z.notes.join(" ")).toContain("Admittance");
    expect(validateSeries(z.f, z.re, z.im)).toBeNull();
  });

  it("reads the tweeter impedance too", () => {
    const z = parseLtspice(read("text/Zi_tw.txt")), c = parseCsv(read("csv/Z_tweeter.csv"));
    expect(z.f.length).toBe(c.f.length);
    for (let k = 0; k < z.f.length; k++) expect(rel(Math.hypot(z.re[k], z.im[k]), Math.hypot(c.re[k], c.im[k]))).toBeLessThan(1e-6);
  });

  it.each([
    ["text/TF_mid.txt", "csv/TF_on_midrange.csv"], ["text/TF_tw.txt", "csv/TF_on_tweeter.csv"], ["text/TF_woof.txt", "csv/TF_on_woofer.csv"],
    ["text/TF30_mid.txt", "csv/TF_off30_midrange.csv"], ["text/TF30_tw.txt", "csv/TF_off30_tweeter.csv"], ["text/TF30_woof.txt", "csv/TF_off30_woofer.csv"],
  ])("%s has the magnitude of %s", (txt, csv) => {
    const t = parseLtspice(read(txt)), c = parseCsv(read(csv));
    expect(t.f.length).toBe(c.f.length);
    for (let k = 0; k < t.f.length; k++) expect(rel(Math.hypot(t.re[k], t.im[k]), Math.hypot(c.re[k], c.im[k]))).toBeLessThan(1e-6);
    expect(t.notes.join(" ")).toContain("distance compensation");
  });

  it("keeps comment lines as notes and reads every pair mode", () => {
    const b = parseLtspice(read("text/Box_woof.txt"));
    expect(b.header.startsWith("BvBox_woof")).toBe(true);
    expect(b.notes[0].startsWith("Task 1 box tuning")).toBe(true);
    const ri = parseLtspice("BvX a 0 V=V(b,0) R_I FREQ=(1,2,3)\n+(2,4,-5)\n");
    expect([ri.f, ri.re, ri.im]).toEqual([[1, 2], [2, 4], [3, -5]]);
    const mag = parseLtspice("BiY a 0 I=V(a,0) MAG FREQ=\n+(10, 0.5, 90)\n");
    // Y = 0.5j -> Z = -2j
    expect(Math.abs(mag.re[0])).toBeLessThan(1e-12);
    expect(Math.abs(mag.im[0] + 2)).toBeLessThan(1e-12);
    const g = parseLtspice("G1 a 0 a 0 R_I FREQ= (1,0.5,0) (2,0.25,0)\n");
    expect(g.re).toEqual([2, 4]);
  });

  it("rejects malformed tables with the line number", () => {
    expect(() => parseLtspice("BvX a 0 V=V(b,0) DB FREQ=\n+(1,2)\n")).toThrow(/line 2/);
    expect(() => parseLtspice("BvX a 0 V=V(b,0) DB FREQ=\n+(1,2,x)\n")).toThrow(/not a number/);
    expect(() => parseLtspice("BvX a 0 V=V(b,0) DB FREQ=\n+(1,2,3\n")).toThrow(/unclosed/);
    expect(() => parseLtspice("BvX a 0 V=V(b,0) DB\n")).toThrow(/FREQ/);
    expect(() => parseLtspice("")).toThrow(ParseError);
  });
});

describe("CSV", () => {
  it("reads the fixture CSVs", () => {
    const c = parseCsv(read("csv/Z_midrange.csv"));
    expect(c.header).toBe("f,re,im");
    expect(c.re[0]).toBeCloseTo(4.668385487, 12);
    expect(c.notes).toEqual([]);
  });

  it("handles delimiters, units in headers, decimal commas and polar data", () => {
    const semi = parseCsv("# exported\nFrequency (Hz);Magnitude [dB];Phase [deg]\n100;0;90\n200;6,0206;0\n");
    expect(Math.abs(semi.re[0])).toBeLessThan(1e-12);
    expect(semi.im[0]).toBeCloseTo(1, 12);
    expect(semi.re[1]).toBeCloseTo(2, 4);
    const tab = parseCsv("freq\tmag\tphase_rad\n1\t2\t0\n2\t2\t3.141592653589793\n");
    expect(tab.re[1]).toBeCloseTo(-2, 12);
    const rew = parseCsv("* REW export\nFreq(Hz) SPL(dB) Phase(degrees)\n20 0 0\n30 0 0\n");
    expect(rew.f).toEqual([20, 30]);
    const bom = parseCsv("﻿f,re,im\n1,2,3\n");
    expect(bom.f).toEqual([1]);
    expect(looksLikeLtspice("freq,re,im\n1,2,3\n")).toBe(false);
  });

  it("explains its assumptions", () => {
    // three unnamed columns are refused rather than guessed as re/im
    expect(() => parseCsv("1,2,3\n2,3,4\n")).toThrow(/re\/im or dB\/phase/);
    // REW writes its column names as a comment line
    const rew = parseCsv("* Measurement: UMIK-1\n* Freq(Hz), SPL(dB), Phase(degrees)\n100, 0, 90\n200, 6.0206, 0\n");
    expect(rew.notes.join(" ")).toContain("comment line");
    expect(rew.re[0]).toBeCloseTo(0, 12);
    expect(rew.im[0]).toBeCloseTo(1, 12);
    expect(rew.re[1]).toBeCloseTo(2, 4);
    // a DC bin is dropped with a note, not passed to the engine
    const dc = parseCsv("f,re,im\n0,1,0\n1,2,3\n2,3,4\n");
    expect(dc.f).toEqual([1, 2]);
    expect(dc.notes.join(" ")).toContain("0 Hz");
    expect(parseCsv("1,2\n2,3\n").notes.join(" ")).toContain("real value");
    expect(parseCsv("f,mag\n1,2\n").notes.join(" ")).toContain("No phase");
    expect(parseCsv("f,re\n1,2\n").notes.join(" ")).toContain("No imaginary");
  });

  it("rejects what it cannot read", () => {
    expect(() => parseCsv("a,b,c\n1,2,3\n")).toThrow(/frequency column/);
    expect(() => parseCsv("f,re,im\n1,2\n")).toThrow(/at least 3 columns/);
    expect(() => parseCsv("f,foo\n1,2\n")).toThrow(/no data columns/);
    expect(() => parseCsv("1,2,3,4\n")).toThrow(/4 columns/);
    expect(() => parseCsv("")).toThrow(ParseError);
    expect(() => parseCsv("f,re,im\n")).toThrow(/no data rows/);
    expect(() => parseCsv("f,re,im\n1,0x10,2\n")).toThrow(/not a number/);
  });
});

describe("series", () => {
  it("validates like the Rust side", () => {
    expect(validateSeries([1, 2], [0, 0], [0, 0])).toBeNull();
    expect(validateSeries([2, 1], [0, 0], [0, 0])).toMatch(/rise/);
    expect(validateSeries([1, 2], [0, NaN], [0, 0])).toMatch(/finite/);
    expect(validateSeries([1, 2], [0], [0])).toMatch(/points/);
    expect(validateSeries([1], [0], [0])).toMatch(/two points/);
    expect(validateSeries([-1, 2], [0, 0], [0, 0])).toMatch(/negative/);
    expect(validateSeries([0, 2], [0, 0], [0, 0])).toMatch(/0 Hz/);
  });

  it("carries the provenance", () => {
    const s = textToSeries("Zi_mid.txt", read("text/Zi_mid.txt"));
    expect(s.source).toMatchObject({ file: "Zi_mid.txt", format: "ltspice" });
    expect(s.source?.note).toContain("Admittance");
    const c = textToSeries("Z_midrange.csv", read("csv/Z_midrange.csv"));
    expect(c.source).toEqual({ file: "Z_midrange.csv", format: "csv" });
    expect(() => textToSeries("bad.csv", "f,re,im\n2,0,0\n1,0,0\n")).toThrow(/rise/);
  });

  it("never throws anything but a ParseError on truncated files", () => {
    for (const relPath of ["text/Zi_mid.txt", "csv/Z_midrange.csv", "text/Box_woof.txt"]) {
      const s = read(relPath);
      for (let cut = 0; cut < s.length; cut += cut < 800 ? 1 : 53) {
        try { parseText(s.slice(0, cut)); } catch (e) { expect(e).toBeInstanceOf(ParseError); }
      }
    }
  });
});

describe("text encodings from Windows tools", () => {
  const zi = readFileSync(new URL("../../fixtures/text/Zi_mid.txt", import.meta.url), "utf8");
  const enc = (s: string) => new TextEncoder().encode(s);
  it("keeps an admittance table an admittance behind a UTF-8 BOM", () => {
    const plain = parseText(zi).table, bom = parseText(decodeText(new Uint8Array([0xef, 0xbb, 0xbf, ...enc(zi)]))).table;
    expect(bom.re[0]).toBe(plain.re[0]);
    expect(parseText("﻿" + zi).table.notes.join(" ")).toMatch(/Admittance/);
  });
  it("reads UTF-16 and Windows-1252 files", () => {
    const csv = "Frequency [Hz]\tMagnitude [dB]\tPhase [°]\r\n100\t0\t90\r\n200\t6,0206\t0\r\n";
    const units = [...csv].map(c => c.charCodeAt(0));
    const le = new Uint8Array([0xff, 0xfe, ...units.flatMap(u => [u & 255, u >> 8])]);
    const be = new Uint8Array([0xfe, 0xff, ...units.flatMap(u => [u >> 8, u & 255])]);
    for (const b of [le, be]) {
      const t = parseCsv(decodeText(b));
      expect(t.im[0]).toBeCloseTo(1, 12);
      expect(t.re[1]).toBeCloseTo(2, 4);
    }
    const cp = new Uint8Array([...enc("f;dB;Phase ["), 0xb0, ...enc("]\n100;0;90\n200;0;0\n")]);
    expect(decodeText(cp)).toContain("[°]");
    expect(parseCsv(decodeText(cp)).im[0]).toBeCloseTo(1, 12);
  });
});

describe("CSV units row", () => {
  it("skips a row of units under the header, like the Rust reader", () => {
    const t = parseCsv("Frequency,Re,Im\nHz,Ohm,Ohm\n100,6,1\n200,7,2\n");
    expect(t.f).toEqual([100, 200]);
    expect(t.notes.join(" ")).toMatch(/units/);
  });
});
