// .xstudio design files: one design (plus its snapshots) for one profile, as plain JSON, so a group can
// pass a design around or keep versions next to their report. Results are not stored: they are
// recomputed from the profile on open, so a file never carries stale curves.

import { passiveParts } from "../engine/passive";
import type { Design, PassiveBranch } from "../types";

export const DESIGN_FILE_EXT = "xstudio";
export const DESIGN_FILE_FORMAT = "crossover-studio/design";

export interface DesignFileSnapshot { id: string; name: string; color: string; design: Design }

export interface DesignFile {
  format: typeof DESIGN_FILE_FORMAT;
  version: 1;
  profileId: string;
  /** Profile display name, so a mismatch can be explained in words. */
  profileName?: string;
  /** The design's name as shown in the title bar. */
  name?: string;
  savedAt?: string;
  design: Design;
  snapshots: DesignFileSnapshot[];
}

export function designFileText(f: Omit<DesignFile, "format" | "version">): string {
  const out: DesignFile = { format: DESIGN_FILE_FORMAT, version: 1, ...f };
  return JSON.stringify(out, null, 2) + "\n";
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Problems with a design object, in plain words (empty = usable). */
export function designProblems(d: unknown, where = "design"): string[] {
  const out: string[] = [];
  if (!isObj(d)) return [`${where} is missing`];
  const box = d.box, dg = d.digital, pol = d.pol;
  if (!isObj(box) || !["plugged", "one", "two"].includes(box.mode as string) || !isNum(box.L) || !isNum(box.fill))
    out.push(`${where}.box is incomplete`);
  else if (!(box.L > 0) || !(box.fill > 0)) out.push(`${where}.box needs a positive vent length and filling factor`);
  if (!isObj(dg) || !isNum(dg.fc) || !isNum(dg.g_woof_dB) || !["BW2", "LR2", "LR4", "BW4"].includes(dg.align as string))
    out.push(`${where}.digital needs fc, align (BW2, LR2, LR4 or BW4) and g_woof_dB`);
  // the MiniDSP runs at 96 kHz: a crossover must sit between 0 Hz and the 48 kHz Nyquist frequency
  else if (!(dg.fc > 0 && dg.fc < 48000)) out.push(`${where}.digital.fc must lie between 0 and 48 kHz (got ${dg.fc} Hz)`);
  for (const u of ["mid", "tw"]) {
    const b = d[u];
    if (!isObj(b) || typeof b.topo !== "string" || !isObj(b.vals)) { out.push(`${where}.${u} needs a topology and part values`); continue; }
    // the engine's own check: a known topology, and every part a positive, finite value
    try { passiveParts(b as unknown as PassiveBranch, u); }
    catch (e) { out.push(`${where}: ${(e as Error).message}`); }
  }
  if (!isObj(pol) || ![pol.woof, pol.mid, pol.tw].every(v => v === 1 || v === -1)) out.push(`${where}.pol needs +1 or -1 for woof, mid and tw`);
  return out;
}

/** Fill fields older files may lack, so the store always gets a complete Design. */
function normalise(d: Design): Design {
  const box = d.box;
  return {
    ...d,
    box: { ...box, L2: isNum(box.L2) ? box.L2 : box.L, a2: isNum(box.a2) ? box.a2 : 0.025 },
    tw: { ...d.tw, pad: d.tw.pad ?? {} },
    Rdcr: isNum(d.Rdcr) ? d.Rdcr : 0,
  };
}

/** Parse and check a .xstudio file. Throws an Error with a plain-language message. */
export function parseDesignFile(text: string): DesignFile {
  let raw: unknown;
  try { raw = JSON.parse(text); }
  catch (e) { throw new Error(`This is not a Crossover Studio design file (${(e as Error).message}).`); }
  if (!isObj(raw) || raw.format !== DESIGN_FILE_FORMAT) throw new Error("This is not a Crossover Studio design file (no \"format\": \"crossover-studio/design\").");
  if (raw.version !== 1) throw new Error(`This design file has version ${String(raw.version)}; update Crossover Studio to open it.`);
  if (typeof raw.profileId !== "string") throw new Error("The design file does not say which profile it belongs to (profileId).");
  const problems = designProblems(raw.design);
  const snaps = Array.isArray(raw.snapshots) ? raw.snapshots : [];
  snaps.forEach((s, i) => { if (!isObj(s)) problems.push(`snapshot ${i + 1} is not an object`); else problems.push(...designProblems(s.design, `snapshot "${String(s.name ?? i + 1)}"`)); });
  if (problems.length) throw new Error(`The design file is damaged: ${problems.join("; ")}.`);
  const f = raw as unknown as DesignFile;
  return {
    ...f,
    design: normalise(f.design),
    snapshots: snaps.map((s, i) => {
      const o = s as Record<string, unknown>;
      return { id: typeof o.id === "string" ? o.id : `snap-${i}`, name: typeof o.name === "string" ? o.name : `Snapshot ${i + 1}`,
               color: typeof o.color === "string" ? o.color : "", design: normalise(o.design as Design) };
    }),
  };
}
