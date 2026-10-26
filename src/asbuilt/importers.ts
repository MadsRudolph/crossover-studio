// Getting a measurement into the As built view. Thin wrappers around the import wizard's readers, so a
// file reads exactly as it would in the wizard:
//  - text files (LTspice FREQ= tables, CSV): the file input plus textToSeries, browser and desktop alike;
//  - in the desktop app, the native dialog takes .mat files too: inspectFile lists the variables, the
//    wizard's dataItems() offers the complex series in it (default: the first one, as the wizard would),
//    and readSeries reads the chosen one. A text file picked there goes through the Rust reader, which
//    follows the same rules as textToSeries.

import type { FileInfo, Series } from "../types";
import { inspectFile, isTauri, pickMeasurementFiles, readSeries } from "../platform";
import { pickTextFile } from "../export/io";
import { textToSeries } from "../wizard/parsers";
import { dataItems, type DataItem, type WizardFile } from "../wizard/roles";

export const TEXT_ACCEPT = ".txt,.csv,.tsv,.dat,.TXT,.CSV";

/** The outcome of a pick: nothing (cancelled), a series, or a .mat file whose variable is still to choose. */
export type Picked =
  | null
  | { kind: "series"; series: Series }
  | { kind: "mat"; path: string; name: string; items: DataItem[] };

/** Ask for a measurement file and read it. Throws with a plain message when the file cannot be read. */
export async function pickMeasurement(): Promise<Picked> {
  if (!isTauri()) {
    const file = await pickTextFile(TEXT_ACCEPT);
    return file ? { kind: "series", series: textToSeries(file.name, file.text) } : null;
  }
  const [path] = await pickMeasurementFiles();
  if (!path) return null;
  const info = await inspectFile(path);
  if (info.error) throw new Error(info.error);
  if (info.format === "mat") {
    const items = matItems(info);
    if (!items.length) throw new Error(`${info.name} holds no complex series with a matching frequency vector`);
    return { kind: "mat", path, name: info.name, items };
  }
  if (info.format === "unknown") throw new Error(`${info.name} is not a MATLAB .mat, LTspice .txt or CSV file`);
  return { kind: "series", series: withSource(await readSeries({ path }), info.name, info.format) };
}

/** The series a .mat file offers, complex ones first (the wizard's own heuristics). */
export function matItems(info: FileInfo): DataItem[] {
  const file: WizardFile = { id: info.path, name: info.name, path: info.path, format: info.format, status: "ready", info };
  return dataItems(file);
}

/** Read one data item of a .mat file picked earlier. */
export async function readMatItem(path: string, name: string, item: DataItem): Promise<Series> {
  const s = await readSeries({ path, freqVar: item.freqVar, dataVar: item.dataVar, column: item.column });
  return withSource(s, name, "mat", item);
}

function withSource(s: Series, name: string, format: "mat" | "ltspice" | "csv", item?: DataItem): Series {
  if (s.source) return s;
  return { ...s, source: { file: name, format, ...(item ? { freqVar: item.freqVar, dataVar: item.dataVar, column: item.column } : {}) } };
}

/** The chip text of an imported series: points and frequency range. */
export function describeSeries(s: Series): { name: string; points: number; lo: number; hi: number } {
  const f = s.f.filter(x => x > 0);
  return { name: s.source?.file ?? "measurement", points: s.f.length, lo: f.length ? Math.min(...f) : NaN, hi: f.length ? Math.max(...f) : NaN };
}
