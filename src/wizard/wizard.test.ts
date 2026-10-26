// End to end: a profile built only from the fixture CSV and Matlab2LTspice files, through the wizard's
// own role assignment and profile building, must give the engine the same system as the bundled profile.
import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { compute, fitBox, prepare } from "../engine";
import { BUNDLED_PROFILES, defaultDesign } from "../state/store";
import type { FileInfo, MatVariable, Series } from "../types";
import { buildProfile, draftFromProfile, estimatePhaseRef, estimateResonance, gridMismatch, isValidId, seriesWarnings, slugify,
         systemProblems } from "./build";
import { parseText, textToSeries } from "./parsers";
import { angleFrom, autoAssign, classifyFile, dataItems, unitFrom, ventLengthFrom, normalise, type WizardFile } from "./roles";

const dir = (sub: string) => new URL(`../../fixtures/${sub}/`, import.meta.url);
const textFiles: { file: WizardFile; text: string }[] = ["csv", "text"].flatMap(sub =>
  readdirSync(dir(sub)).sort().map(name => {
    const text = readFileSync(new URL(name, dir(sub)), "utf8");
    const { format, table } = parseText(text);
    return { file: { id: `${sub}/${name}`, name, format, status: "ready" as const, table }, text };
  }));
const bundled = BUNDLED_PROFILES[0];

describe("name reading", () => {
  it("finds units, angles and vent lengths", () => {
    expect(unitFrom(normalise("TF_off30_midrange.csv"))).toBe("mid");
    expect(unitFrom(normalise("Zi_tw.txt"))).toBe("tw");
    expect(unitFrom(normalise("labE_system_0.mat"))).toBeNull();
    expect(angleFrom(normalise("labE_system_30.mat"))).toBe("30");
    expect(angleFrom(normalise("TF30_woof.txt"))).toBe("30");
    expect(angleFrom(normalise("TF_on_tweeter.csv"))).toBe("0");
    expect(angleFrom(normalise("TF_woof.txt"))).toBeNull();
    expect(ventLengthFrom(normalise("labD_vent_L160.mat"))).toBe(160);
    expect(ventLengthFrom(normalise("vented, 1 open, L = 200 mm"))).toBe(200);
    expect(ventLengthFrom(normalise("Z_woofer_free"))).toBeNull();
  });

  it("skips Matlab2LTspice model curves", () => {
    expect(classifyFile(textFiles.find(t => t.file.name === "Box_woof.txt")!.file)).toEqual([]);
  });
});

describe("Lab D/E .mat files (variables as the Rust inspector lists them)", () => {
  const v = (name: string, dims: number[], complex = false, cls = "double", text?: string): MatVariable => ({ name, class: cls, dims, complex, ...(text !== undefined ? { text } : {}) });
  const labD = (file: string, tag: string, note: string, data = "Z", n = 550): WizardFile => ({
    id: file, name: file, path: `/lab/${file}`, format: "mat", status: "ready",
    info: { path: `/lab/${file}`, name: file, format: "mat", variables: [
      v("tag", [1, tag.length], false, "char", tag), v("note", [1, note.length], false, "char", note), v("time", [1, 1], false, "datetime"),
      v("R", [1, 1]), v("fn", [n, 1]), v("specn", [n, 2], true), v("rms", [1, 2]), v(data, [n, 1], true),
    ] } as FileInfo,
  });
  const labE = (file: string, tag: string): WizardFile => ({
    id: file, name: file, path: `/lab/${file}`, format: "mat", status: "ready",
    info: { path: `/lab/${file}`, name: file, format: "mat", variables: [
      v("tag", [1, tag.length], false, "char", tag), v("note", [1, 12], false, "char", "vent plugged"), v("units", [1, 3], false, "cell"),
      v("fn", [412, 1]), v("specn", [412, 2, 3], true), v("f", [48000, 1]), v("spec", [48000, 2, 3], true), v("H", [412, 3], true), v("peak", [2, 3]),
    ] } as FileInfo,
  });
  const files = [
    labE("labE_system_0.mat", "system_0"), labE("labE_system_30.mat", "system_30"),
    labD("labD_midrange.mat", "midrange", "", "Z", 479), labD("labD_tweeter.mat", "tweeter", "", "Z", 381),
    labD("labD_woofer_free.mat", "woofer_free", "free air, cover off, no filling"),
    labD("labD_woofer_closed.mat", "woofer_closed", "closed box, vents plugged, no filling"),
    labD("labD_vent_L160.mat", "vent_L160", "vented, 1 open, L = 160 mm"),
    labD("labD_nf_cone_L160.mat", "nf_cone_L160", "near field at cone, L = 160 mm", "H"),
    labD("labD_nf_vent_L160.mat", "nf_vent_L160", "near field at vent, L = 160 mm", "H"),
  ];

  it("lists only plausible series and pairs them with fn, not the 48000-point FFT axis", () => {
    const items = dataItems(files[0]);
    expect(items.map(i => i.label)).toEqual(["H(:,1)", "H(:,2)", "H(:,3)"]);
    expect(items.every(i => i.freqVar === "fn")).toBe(true);
  });

  it("pairs each struct element's data with its own frequency axis", () => {
    const struct: WizardFile = {
      id: "runs.mat", name: "runs.mat", path: "/lab/runs.mat", format: "mat", status: "ready",
      info: { path: "/lab/runs.mat", name: "runs.mat", format: "mat", variables: [
        v("meas(1).fn", [300, 1]), v("meas(1).H", [300, 3], true), v("meas(2).fn", [300, 1]), v("meas(2).H", [300, 3], true),
      ] } as FileInfo,
    };
    const items = dataItems(struct);
    expect(items.filter(i => i.dataVar === "meas(2).H").every(i => i.freqVar === "meas(2).fn")).toBe(true);
    expect(items.filter(i => i.dataVar === "meas(1).H").every(i => i.freqVar === "meas(1).fn")).toBe(true);
  });

  it("assigns every role like the bundled profile", () => {
    const { assignments, vents, angles } = autoAssign(files);
    const got = Object.fromEntries(Object.entries(assignments).map(([k, a]) => [k, `${a.choice.fileId}:${a.choice.dataVar}:${a.choice.column ?? ""}`]));
    expect(got).toEqual({
      "tf:0:woof": "labE_system_0.mat:H:0", "tf:0:mid": "labE_system_0.mat:H:1", "tf:0:tw": "labE_system_0.mat:H:2",
      "tf:30:woof": "labE_system_30.mat:H:0", "tf:30:mid": "labE_system_30.mat:H:1", "tf:30:tw": "labE_system_30.mat:H:2",
      "zi:mid": "labD_midrange.mat:Z:", "zi:tw": "labD_tweeter.mat:Z:",
      "woofer:free": "labD_woofer_free.mat:Z:", "woofer:closed": "labD_woofer_closed.mat:Z:",
      "vent:A160:z": "labD_vent_L160.mat:Z:", "vent:A160:nf_cone": "labD_nf_cone_L160.mat:H:", "vent:A160:nf_vent": "labD_nf_vent_L160.mat:H:",
    });
    expect(vents).toEqual([{ key: "A160", vents: [{ id: "A", length_m: 0.16 }] }]);
    expect(angles).toEqual(["30"]);
  });

  it("leaves a hand-made choice alone", () => {
    const manual = { role: "zi:mid", choice: { fileId: "labD_tweeter.mat", freqVar: "fn", dataVar: "Z" }, confidence: 1, reason: "by hand", auto: false };
    const { assignments } = autoAssign(files, { "zi:mid": manual });
    expect(assignments["zi:mid"]).toBe(manual);
    expect(assignments["zi:tw"]).toBeUndefined();   // its only candidate is taken
  });
});

describe("profile from CSV and Matlab2LTspice files only", () => {
  const { assignments, vents, angles } = autoAssign(textFiles.map(t => t.file));
  const series: Record<string, Series> = {};
  for (const [role, a] of Object.entries(assignments)) {
    const t = textFiles.find(x => x.file.id === a.choice.fileId)!;
    series[role] = textToSeries(t.file.name, t.text);
  }

  it("prefers the CSVs where text files duplicate them and finds all vent lengths", () => {
    expect(assignments["tf:0:woof"].choice.fileId).toBe("csv/TF_on_woofer.csv");
    expect(assignments["tf:30:mid"].choice.fileId).toBe("csv/TF_off30_midrange.csv");
    expect(assignments["zi:mid"].choice.fileId).toBe("csv/Z_midrange.csv");
    expect(assignments["woofer:free"].choice.fileId).toBe("csv/Z_woofer_free.csv");
    expect(assignments["woofer:closed"].choice.fileId).toBe("csv/Z_woofer_closed.csv");
    expect(vents.map(v => v.key)).toEqual(["A160", "A200", "A240"]);
    for (const k of ["A160", "A200", "A240"]) for (const r of ["z", "nf_cone", "nf_vent"]) expect(assignments[`vent:${k}:${r}`]).toBeDefined();
    expect(angles).toEqual(["30"]);
  });

  it("passes the sanity checks", () => {
    for (const [role, s] of Object.entries(series)) {
      const q = role.startsWith("tf:") ? "tf" : role.endsWith("nf_cone") || role.endsWith("nf_vent") ? "nf" : "z";
      expect(seriesWarnings(q, s, role.includes("woof") || role.startsWith("vent") ? "woof" : undefined).filter(w => w.level === "bad"), role).toEqual([]);
    }
    expect(gridMismatch({ woof: series["tf:0:woof"], mid: series["tf:0:mid"], tw: series["tf:0:tw"] })).toBeNull();
    expect(gridMismatch({ woof: series["tf:0:woof"], mid: series["zi:mid"] })).toMatch(/different frequency grids/);
    expect(seriesWarnings("z", { f: [1, 2, 3], re: [0.01, 0.01, 0.01], im: [0, 0, 0] })[0].level).toBe("bad");
    expect(seriesWarnings("tf", { f: [100, 200, 300], re: [80, 85, 90], im: [0, 0, 0] })[0].text).toMatch(/dB/);
  });

  it("estimates the tweeter resonance and the Lab E phase distance", () => {
    expect(estimateResonance(series["zi:tw"])!).toBeGreaterThan(1400);
    expect(estimateResonance(series["zi:tw"])!).toBeLessThan(1500);
    const est = estimatePhaseRef({ woof: series["tf:0:woof"], mid: series["tf:0:mid"], tw: series["tf:0:tw"] })!;
    // plot_labE.m found -1.15 m with c = 343.2 m/s; the display convention uses 345 m/s
    expect(Math.abs(est.d - -1.15 * 345 / 343.2)).toBeLessThan(0.01);
  });

  it("builds a profile the engine computes like the bundled one", () => {
    const system = draftFromProfile(bundled);
    system.name = "System D · Group 10 (from CSV)";
    expect(systemProblems(system)).toEqual([]);
    const id = slugify(system.name);
    expect(id).toBe("system-d-group-10-from-csv");
    expect(isValidId(id)).toBe(true);
    const profile = buildProfile({ system, id, assignments, series, vents });
    expect(Object.keys(profile.measurements.tf)).toEqual(["0", "30"]);
    expect(profile.measurements.woofer.vented.map(m => m.vents[0].length_m)).toEqual([0.16, 0.2, 0.24]);
    expect(profile.measurements.woofer.vented[0].nf_vent).toBeDefined();
    expect(profile.measurements.zi.tw?.source?.file).toBe("Z_tweeter.csv");

    const fit = fitBox(profile), ref = fitBox(bundled);
    expect(Math.abs(fit.ts.fs - ref.ts.fs) / ref.ts.fs).toBeLessThan(1e-3);
    expect(Math.abs(fit.ts.Vas_L - ref.ts.Vas_L) / ref.ts.Vas_L).toBeLessThan(1e-2);
    const design = defaultDesign();
    const R = compute(prepare(profile, fit), design), R0 = compute(prepare(bundled, ref), design);
    expect(Object.keys(R.angles)).toEqual(["0", "30"]);
    const s = R.angles["0"].sum, s0 = R0.angles["0"].sum;
    let worst = 0;
    for (let i = 0; i < s.re.length; i++) worst = Math.max(worst, Math.hypot(s.re[i] - s0.re[i], s.im[i] - s0.im[i]) / Math.hypot(s0.re[i], s0.im[i]));
    expect(worst).toBeLessThan(1e-3);
    expect(R.metrics.x_wm).toBe(R0.metrics.x_wm);
    expect(R.metrics.x_mt).toBe(R0.metrics.x_mt);
  });

  it("names what is missing", () => {
    const system = draftFromProfile(bundled);
    const partial = { ...assignments };
    delete partial["zi:tw"]; delete partial["tf:0:mid"];
    expect(() => buildProfile({ system, id: "x", assignments: partial, series, vents })).toThrow(/midrange response at 0°.*tweeter impedance/);
  });
});
