// Adding a whole folder: the backend expands it, unreadable files from the folder are left out (and
// named), files the user picked one by one stay listed with their error.
import { describe, expect, it, vi } from "vitest";
import type { FileInfo } from "../types";

const infos: FileInfo[] = JSON.parse((await import("node:fs")).readFileSync(new URL("./fixtures/lab_inspect.json", import.meta.url), "utf8"));
vi.mock("../platform", () => ({
  isTauri: () => true,
  expandFolders: async (paths: string[]) =>
    paths.flatMap(p => p === "/lab" ? ["/lab/labD_tweeter.mat", "/lab/labE_system_0.mat", "/lab/README.txt"] : [p]),
  inspectFile: async (path: string): Promise<FileInfo> => {
    const name = path.slice(path.lastIndexOf("/") + 1);
    const info = infos.find(i => i.name === name);
    return info ? { ...info, path } : { path, name, format: "csv", variables: [], error: "the file has no data rows" };
  },
}));
const { useWizard } = await import("./draft");

describe("adding a folder", () => {
  it("adds the measurements in it and leaves out the rest", async () => {
    useWizard.getState().reset();
    const { skipped } = await useWizard.getState().addPaths(["/lab"]);
    expect(skipped).toEqual(["README.txt"]);
    expect(useWizard.getState().files.map(f => f.name)).toEqual(["labD_tweeter.mat", "labE_system_0.mat"]);
    expect(useWizard.getState().assignments["zi:tw"]?.choice.fileId).toBe("/lab/labD_tweeter.mat");
    expect(useWizard.getState().assignments["tf:0:mid"]?.choice.column).toBe(1);
    // a file chosen on its own keeps its error row, so the user sees why it did not load
    const again = await useWizard.getState().addPaths(["/elsewhere/notes.txt", "/lab"]);
    expect(again.skipped).toEqual(["README.txt"]);
    expect(useWizard.getState().files.find(f => f.name === "notes.txt")?.status).toBe("error");
  });
});
