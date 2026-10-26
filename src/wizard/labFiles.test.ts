// The whole Lab D + Lab E data folder of a real group (52 .mat files: repeats "_r1", the rejected
// "system_30_bad", the baffle runs), as the Rust inspector lists it (fixtures/lab_inspect.json, written by
// src-tauri/tests/lab_files.rs). A group that drops its whole folder on the wizard must get the same roles
// as the bundled profile, whatever order the file dialog returns the files in; the series those roles read
// are then the fixture CSVs (the Rust tests prove .mat and CSV agree to 1e-9), and the engine must compute
// the bundled system from them.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { compute, fitBox, prepare } from "../engine";
import { BUNDLED_PROFILES, defaultDesign } from "../state/store";
import type { FileInfo, Series } from "../types";
import { buildProfile, draftFromProfile } from "./build";
import { textToSeries } from "./parsers";
import { autoAssign, type WizardFile } from "./roles";

const infos: FileInfo[] = JSON.parse(readFileSync(new URL("./fixtures/lab_inspect.json", import.meta.url), "utf8"));
const asFile = (info: FileInfo): WizardFile => ({ id: info.name, name: info.name, path: info.path, format: info.format, status: "ready", info });
const csv = (name: string): Series =>
  textToSeries(name, readFileSync(new URL(`../../fixtures/csv/${name}`, import.meta.url), "utf8"));

/** The CSV export of each (file, variable, column) a role can read. */
const UNITS = ["woofer", "midrange", "tweeter"];
function csvFor(fileId: string, column?: number): Series {
  const m = /^labE_system_(0|30)\.mat$/.exec(fileId);
  if (m) return csv(`TF_${m[1] === "0" ? "on" : "off30"}_${UNITS[column!]}.csv`);
  const d = /^labD_(.+)\.mat$/.exec(fileId)!;
  const tag = d[1].replace(/^nf_(cone|vent)/, (_, w: string) => `NF_${w}`);
  return csv(tag.startsWith("NF_") ? `${tag}.csv` : `Z_${tag}.csv`);
}

const EXPECTED = {
  "tf:0:woof": "labE_system_0.mat:H:0", "tf:0:mid": "labE_system_0.mat:H:1", "tf:0:tw": "labE_system_0.mat:H:2",
  "tf:30:woof": "labE_system_30.mat:H:0", "tf:30:mid": "labE_system_30.mat:H:1", "tf:30:tw": "labE_system_30.mat:H:2",
  "zi:mid": "labD_midrange.mat:Z:", "zi:tw": "labD_tweeter.mat:Z:",
  "woofer:free": "labD_woofer_free.mat:Z:", "woofer:closed": "labD_woofer_closed.mat:Z:",
  ...Object.fromEntries([160, 200, 240].flatMap(l => [
    [`vent:A${l}:z`, `labD_vent_L${l}.mat:Z:`], [`vent:A${l}:nf_cone`, `labD_nf_cone_L${l}.mat:H:`], [`vent:A${l}:nf_vent`, `labD_nf_vent_L${l}.mat:H:`],
  ])),
};

describe("a whole real lab folder dropped on the wizard", () => {
  it("lists every file without an error", () => {
    expect(infos.length).toBeGreaterThanOrEqual(50);
    expect(infos.filter(i => i.error)).toEqual([]);
  });

  for (const [label, order] of [["sorted", infos], ["reversed", [...infos].reverse()]] as const) {
    it(`assigns the final runs, not the repeats or the rejected run (${label} order)`, () => {
      const { assignments, vents, angles } = autoAssign(order.map(asFile));
      const got = Object.fromEntries(Object.entries(assignments).map(([k, a]) => [k, `${a.choice.fileId}:${a.choice.dataVar}:${a.choice.column ?? ""}`]));
      expect(got).toEqual(EXPECTED);
      expect(vents.map(v => v.key)).toEqual(["A160", "A200", "A240"]);
      expect(angles).toEqual(["30"]);
    });
  }

  it("builds a profile the engine computes like the bundled one", () => {
    const bundled = BUNDLED_PROFILES[0];
    const { assignments, vents } = autoAssign(infos.map(asFile));
    const series = Object.fromEntries(Object.entries(assignments).map(([role, a]) => [role, csvFor(a.choice.fileId, a.choice.column)]));
    const system = draftFromProfile(bundled);
    const profile = buildProfile({ system, id: "lab-folder", assignments, series, vents });
    const fit = fitBox(profile), ref = fitBox(bundled);
    expect(Math.abs(fit.ts.fs - ref.ts.fs) / ref.ts.fs).toBeLessThan(1e-3);
    const design = defaultDesign();
    const R = compute(prepare(profile, fit), design), R0 = compute(prepare(bundled, ref), design);
    const s = R.angles["0"].sum, s0 = R0.angles["0"].sum;
    let worst = 0;
    for (let i = 0; i < s.re.length; i++) worst = Math.max(worst, Math.hypot(s.re[i] - s0.re[i], s.im[i] - s0.im[i]) / Math.hypot(s0.re[i], s0.im[i]));
    expect(worst).toBeLessThan(1e-3);
    expect(R.angles["30"]).toBeDefined();
  });
});

describe("column names from the file's unit list", () => {
  it("follows units{k} when a group recorded the drivers in another order", () => {
    const sys0 = infos.find(i => i.name === "labE_system_0.mat")!;
    expect(sys0.variables.filter(v => /^units\{/.test(v.name)).map(v => v.text)).toEqual(["woofer", "midrange", "tweeter"]);
    // the same file, but the lab script logged the tweeter first
    const order = ["tweeter", "woofer", "midrange"];
    const swapped: FileInfo = { ...sys0, variables: sys0.variables.map(v => {
      const m = /^units\{(\d)\}$/.exec(v.name);
      return m ? { ...v, text: order[+m[1] - 1] } : v;
    }) };
    const { assignments } = autoAssign([asFile(swapped)]);
    expect(assignments["tf:0:tw"].choice.column).toBe(0);
    expect(assignments["tf:0:woof"].choice.column).toBe(1);
    expect(assignments["tf:0:mid"].choice.column).toBe(2);
    expect(assignments["tf:0:tw"].reason).toMatch(/"tweeter" in the file's unit list/);
  });
});
