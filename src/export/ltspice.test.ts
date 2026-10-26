/// <reference types="node" />
// LTspice export: format details, and the full export of the bundled profile written to disk so that
// scripts/verify_ltspice.py can run it in LTspice and compare V(Psum) with the engine (expected.json).
import { describe, expect, it } from "vitest";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { compute, fitBox, prepare } from "../engine";
import { BUNDLED_PROFILES, defaultDesign } from "../state/store";
import { angleTag, buildLtspice, fmtE, partValue, C_PHASE } from "./ltspice";
import { bom, bomCsv, branchParts } from "./parts";
import type { Design } from "../types";

const OUT = process.env.XS_LTSPICE_DIR ?? join(tmpdir(), "xs-ltspice");
// Optional cross-check against the course project files (skipped when not set or missing).
const PROJECT_DATA = process.env.XS_PROJECT_DATA ?? "";

const profile = BUNDLED_PROFILES[0];
const p = prepare(profile, fitBox(profile));
const design = defaultDesign();

/** Parse a Matlab2LTspice table back to [f, dB, deg][]. */
const rows = (txt: string) => txt.split("\n").filter(l => l.startsWith("+(")).map(l => l.slice(2, -1).split(",").map(Number));

describe("number formats", () => {
  it("fmtE matches Python %.10E", () => {
    expect(fmtE(50)).toBe("5.0000000000E+01");
    expect(fmtE(-19.973815578)).toBe("-1.9973815578E+01");
    expect(fmtE(0.00123)).toBe("1.2300000000E-03");
    expect(fmtE(1.5e123)).toBe("1.5000000000E+123");
  });
  it("part values read like the course files", () => {
    expect(partValue("L", 0.00082)).toBe("0.82m");
    expect(partValue("C", 6.8e-6)).toBe("6.8u");
    expect(partValue("R", 4.7)).toBe("4.7");
  });
  it("angle tags", () => {
    expect(angleTag("0")).toBe("");
    expect(angleTag("30")).toBe("30");
    expect(angleTag("-15")).toBe("m15");
  });
});

describe("LTspice export of the bundled profile", () => {
  const ex = buildLtspice(p, design, "Reference design");
  const file = (n: string) => ex.files.find(f => f.name === n)?.contents ?? "";

  it("has the schematic, plot settings and every data file", () => {
    const names = ex.files.map(f => f.name);
    for (const n of ["System_system-d-group10.asc", "System_system-d-group10.plt", "README.txt", "Box_woof.txt", "Zi_mid.txt", "Zi_tw.txt",
                     "TF_woof.txt", "TF_mid.txt", "TF_tw.txt", "TF30_woof.txt", "TF30_mid.txt", "TF30_tw.txt"])
      expect(names).toContain(n);
    expect(ex.sums.map(s => s.node)).toEqual(["V(Psum)", "V(Psum30)"]);
  });

  it("includes every data file and draws every part", () => {
    const asc = file(ex.schematic);
    for (const f of ex.files.filter(f => f.name.endsWith(".txt") && f.name !== "README.txt")) expect(asc).toContain(`!.inc ${f.name}`);
    for (const part of [...branchParts(design, "mid"), ...branchParts(design, "tw")]) expect(asc).toContain(`SYMATTR InstName ${part.ref}`);
    expect(asc).toContain("p_woof=1 p_mid=1 p_tw=1");
    expect(asc.startsWith("Version 4\nSHEET 1 ")).toBe(true);
  });

  it("writes the Zi file as an admittance", () => {
    const r = rows(file("Zi_mid.txt"));
    const z = profile.measurements.zi.mid!;
    expect(r.length).toBe(z.f.length);
    expect(r[0][1]).toBeCloseTo(-20 * Math.log10(Math.hypot(z.re[0], z.im[0])), 8);
    expect(file("Zi_mid.txt")).toContain("BiZin_mid Vspkr_mid 0  I=V(Vspkr_mid,0) DB FREQ=");
  });

  it("reproduces the course's Matlab2LTspice files (when the project folder is present)", () => {
    if (!existsSync(PROJECT_DATA)) return;
    for (const n of ["TF_mid.txt", "TF30_tw.txt", "Zi_tw.txt", "TF_woof.txt"]) {
      const want = rows(readFileSync(join(PROJECT_DATA, n), "utf8")), got = rows(file(n));
      expect(got.length).toBe(want.length);
      let dDb = 0, dPh = 0;
      for (let i = 0; i < got.length; i++) {
        dDb = Math.max(dDb, Math.abs(got[i][1] - want[i][1]));
        // the reference unwrapped from another starting branch: compare modulo 360
        const d = ((got[i][2] - want[i][2]) % 360 + 540) % 360 - 180;
        dPh = Math.max(dPh, Math.abs(d));
      }
      expect(dDb, n).toBeLessThan(1e-3);
      expect(dPh, n).toBeLessThan(0.05);
    }
  });

  it("writes the folder and the expected V(Psum) for scripts/verify_ltspice.py", () => {
    writeExport(OUT, design, "Reference design");
    expect(existsSync(join(OUT, ex.schematic))).toBe(true);
  });

  it("draws every part kind: 3rd order, L-pad, Zobel, coil resistance, polarity, two vents", () => {
    const alt: Design = {
      ...design,
      box: { ...design.box, mode: "two", L: 0.2, L2: 0.12, a2: 0.025, fill: 1.15 },
      digital: { fc: 400, align: "BW2", g_woof_dB: -3 },
      mid: { topo: "LP3", vals: { L1: 0.001, C1: 1e-5, L2: 0.00033 }, pad: { Rs: 1, Rp: 22 }, zobel: { R: 5.6, C: 1.2e-5 } },
      tw: { topo: "HP3", vals: { C1: 6.8e-6, L1: 0.00033, C2: 1.2e-5 }, pad: { Rs: 3.3, Rp: 4.7 }, zobel: null },
      pol: { woof: 1, mid: -1, tw: 1 },
      Rdcr: 0.3,
    };
    const e2 = writeExport(OUT + "-alt", alt, "Stress test");
    const asc = e2.files[0].contents;
    for (const ref of ["L1_mid", "C1_mid", "L2_mid", "Rs_mid", "Rp_mid", "Rz_mid", "Cz_mid", "C1_tw", "L1_tw", "C2_tw", "Rs_tw", "Rp_tw"])
      expect(asc).toContain(`SYMATTR InstName ${ref}`);
    expect(asc).toContain("SYMATTR SpiceLine Rser=0.3");        // 1 mH x 0.3 ohm/mH
    expect(asc).toContain("p_mid=-1");
    expect(asc).toContain("E_LP2");
  });
});

/** Write an export plus the engine's expected sums (with the TF files' distance factor) for verify_ltspice.py. */
function writeExport(dir: string, des: Design, name: string) {
  const e = buildLtspice(p, des, name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  for (const f of e.files) writeFileSync(join(dir, f.name), f.contents);
  const R = compute(p, des), d = profile.conditions.phase_ref_distance_m;
  const sums: Record<string, { node: string; re: number[]; im: number[] }> = {};
  for (const s of e.sums) {
    const z = R.angles[s.angle].sum, re: number[] = [], im: number[] = [];
    // LTspice sees every TF times exp(j 2 pi f d / c), so its sum carries the same factor
    for (let i = 0; i < p.f.length; i++) {
      const k = 2 * Math.PI * p.f[i] * d / C_PHASE, c = Math.cos(k), sn = Math.sin(k);
      re.push(z.re[i] * c - z.im[i] * sn); im.push(z.re[i] * sn + z.im[i] * c);
    }
    sums[s.angle] = { node: s.node, re, im };
  }
  writeFileSync(join(dir, "expected.json"), JSON.stringify({ schematic: e.schematic, design: name, f: Array.from(p.f), sums }));
  return e;
}

describe("parts list", () => {
  it("marks basket parts and lists both boards", () => {
    const rowsB = bom(profile, design);
    expect(rowsB.map(r => r.ref)).toEqual(["L1_mid", "C1_mid", "C1_tw", "L1_tw", "Rs_tw", "Rp_tw"]);
    expect(rowsB.every(r => r.source === "basket")).toBe(true);
    const odd = bom(profile, { ...design, mid: { ...design.mid, vals: { L1: 0.00083, C1: 6.8e-6 } } });
    expect(odd[0].source).toBe("other");
    expect(bomCsv(rowsB, design).split("\r\n")[1]).toBe("L1_mid,Midrange (low-pass),Series L,Inductor,0.82 mH,0.00082,course basket (Appendix 1)");
  });
});
