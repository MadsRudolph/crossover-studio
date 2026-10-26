// File and clipboard helpers of the export sheet. All disk access goes through src/platform.

import { isTauri, saveText, writeTextFile } from "../platform";
import { toast } from "../ui";
import type { ExportFile } from "./ltspice";

/** Copy text; reports the outcome as a toast. */
export async function copyText(text: string, what: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    toast({ tone: "good", title: `${what} copied`, duration: 2200 });
    return true;
  } catch {
    toast({ tone: "bad", title: "Could not copy", description: "The clipboard is not available here. Use Save instead." });
    return false;
  }
}

/** Save dialog for one text file; a toast tells where it went. Cancel is silent. */
export async function saveTextFile(name: string, text: string, ext: string, what: string): Promise<string | null> {
  try {
    const path = await saveText(name, text, ext);
    if (path) toast({ tone: "good", title: `${what} saved`, description: isTauri() ? path : `Downloaded ${name}` });
    return path;
  } catch (e) {
    toast({ tone: "bad", title: `Could not save ${what.toLowerCase()}`, description: String((e as Error)?.message ?? e) });
    return null;
  }
}

/** Join a folder chosen in the native dialog with a file name, keeping the platform's separator. */
export function joinPath(dir: string, name: string): string {
  const sep = dir.includes("\\") && !dir.includes("/") ? "\\" : "/";
  return dir.endsWith(sep) ? dir + name : dir + sep + name;
}

/** Ask for a folder (desktop app only). Returns null on cancel. */
export async function pickFolder(title: string): Promise<string | null> {
  const { open } = await import("@tauri-apps/plugin-dialog");
  const r = await open({ directory: true, multiple: false, title });
  return typeof r === "string" ? r : null;
}

/** Write a set of files into a folder. In a browser each file is downloaded instead. */
export async function writeFolder(dir: string | null, files: ExportFile[], onFile?: (i: number) => void): Promise<void> {
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    if (dir) await writeTextFile(joinPath(dir, f.name), f.contents);
    else await saveText(f.name, f.contents, f.name.split(".").pop() ?? "txt");
    onFile?.(i + 1);
  }
}

/** Read a file the user picks through a file input (works in the desktop webview and in a browser). */
export function pickTextFile(accept: string): Promise<{ name: string; text: string } | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.style.display = "none";
    let settled = false;
    const done = (v: { name: string; text: string } | null, err?: unknown) => {
      if (settled) return;
      settled = true;
      input.remove();
      if (err) reject(err); else resolve(v);
    };
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (!file) { done(null); return; }
      file.text().then(text => done({ name: file.name, text }), e => done(null, e));
    });
    input.addEventListener("cancel", () => done(null));
    document.body.appendChild(input);
    input.click();
  });
}

export function bytesLabel(n: number): string {
  return n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} kB` : `${(n / 1048576).toFixed(1)} MB`;
}
