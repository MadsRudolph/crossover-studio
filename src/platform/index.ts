// Bridge to the Rust backend. Every file-system action of the app goes through here.
// In a plain browser (`npm run dev` / `vite preview`, used for screenshots and UI work) the Tauri calls are
// unavailable: the functions then reject with a clear message, and the bundled profile still works.

import type { FileInfo, Profile, ProfileEntry, ReadSpec, Series } from "../types";

export const isTauri = (): boolean => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri()) throw new Error(`"${cmd}" needs the desktop app (running in a browser)`);
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

// ---------------------------------------------------------------- Rust commands (src-tauri/src/lib.rs)
/** Inspect a measurement file: format, and for .mat every variable with class, size and complexity. */
export const inspectFile = (path: string) => invoke<FileInfo>("inspect_file", { path });
/** Read one frequency/complex pair. For .mat give freqVar, dataVar and optionally column; text files need only the path. */
export const readSeries = (spec: ReadSpec) => invoke<Series>("read_series", { spec });
/** Profiles saved by the user (in the app data folder) plus any opened recently. */
export const listProfiles = () => invoke<ProfileEntry[]>("list_profiles");
export const loadProfile = (path: string) => invoke<Profile>("load_profile", { path });
/** Writes <app data>/profiles/<profile.id>/profile.json and copies the source files next to it. Returns the folder. */
export const saveProfile = (profile: Profile, sourceFiles: string[]) => invoke<string>("save_profile", { profile, sourceFiles });
export const writeTextFile = (path: string, contents: string) => invoke<void>("write_text_file", { path, contents });
export const writeBinaryFile = (path: string, bytes: number[]) => invoke<void>("write_binary_file", { path, bytes });

// ---------------------------------------------------------------- dialogs
export async function pickMeasurementFiles(): Promise<string[]> {
  if (!isTauri()) throw new Error("Opening files needs the desktop app");
  const { open } = await import("@tauri-apps/plugin-dialog");
  const r = await open({ multiple: true, filters: [{ name: "Measurements", extensions: ["mat", "txt", "csv"] }] });
  return r === null ? [] : Array.isArray(r) ? r : [r];
}

export async function pickProfileFile(): Promise<string | null> {
  if (!isTauri()) throw new Error("Opening files needs the desktop app");
  const { open } = await import("@tauri-apps/plugin-dialog");
  const r = await open({ multiple: false, filters: [{ name: "Crossover Studio profile", extensions: ["json"] }] });
  return typeof r === "string" ? r : null;
}

/** Save dialog then write. Returns the path, or null if cancelled. In a browser, falls back to a download. */
export async function saveText(defaultName: string, contents: string, ext: string): Promise<string | null> {
  if (!isTauri()) { download(defaultName, new Blob([contents], { type: "text/plain" })); return defaultName; }
  const { save } = await import("@tauri-apps/plugin-dialog");
  const path = await save({ defaultPath: defaultName, filters: [{ name: ext.toUpperCase(), extensions: [ext] }] });
  if (!path) return null;
  await writeTextFile(path, contents);
  return path;
}

export async function saveBinary(defaultName: string, bytes: Uint8Array, ext: string): Promise<string | null> {
  if (!isTauri()) { download(defaultName, new Blob([bytes as BlobPart])); return defaultName; }
  const { save } = await import("@tauri-apps/plugin-dialog");
  const path = await save({ defaultPath: defaultName, filters: [{ name: ext.toUpperCase(), extensions: [ext] }] });
  if (!path) return null;
  await writeBinaryFile(path, Array.from(bytes));
  return path;
}

function download(name: string, blob: Blob) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** Files dropped on the window (Tauri gives paths). Returns an unsubscribe function. */
export async function onFileDrop(cb: (paths: string[]) => void): Promise<() => void> {
  if (!isTauri()) return () => {};
  const { getCurrentWebview } = await import("@tauri-apps/api/webview");
  return getCurrentWebview().onDragDropEvent(e => { if (e.payload.type === "drop") cb(e.payload.paths); });
}
