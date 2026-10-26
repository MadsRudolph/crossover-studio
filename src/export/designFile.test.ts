import { describe, expect, it } from "vitest";
import { defaultDesign } from "../state/store";
import { designFileText, parseDesignFile } from "./designFile";

describe(".xstudio design files", () => {
  const design = defaultDesign();
  const text = designFileText({ profileId: "system-d-group10", profileName: "System D", name: "Final", design,
                                snapshots: [{ id: "a", name: "First try", color: "#7aa2ff", design }] });

  it("round-trips a design with its snapshots", () => {
    const f = parseDesignFile(text);
    expect(f.profileId).toBe("system-d-group10");
    expect(f.name).toBe("Final");
    expect(f.design).toEqual(design);
    expect(f.snapshots).toHaveLength(1);
    expect(f.snapshots[0].design.digital.fc).toBe(design.digital.fc);
  });

  it("explains what is wrong with a bad file", () => {
    expect(() => parseDesignFile("{")).toThrow(/not a Crossover Studio design file/);
    expect(() => parseDesignFile(JSON.stringify({ format: "crossover-studio/design", version: 2 }))).toThrow(/update Crossover Studio/);
    const broken = JSON.parse(text);
    broken.design.digital.align = "LR8";
    expect(() => parseDesignFile(JSON.stringify(broken))).toThrow(/digital needs/);
  });

  it("fills fields older files lack", () => {
    const old = JSON.parse(text);
    delete old.design.Rdcr; delete old.design.box.L2; delete old.design.tw.pad;
    const f = parseDesignFile(JSON.stringify(old));
    expect(f.design.Rdcr).toBe(0);
    expect(f.design.box.L2).toBe(design.box.L);
    expect(f.design.tw.pad).toEqual({});
  });
});
