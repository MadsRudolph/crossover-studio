import { describe, expect, it } from "vitest";
import { isValidElement, type ReactElement } from "react";
import { withUnits } from "./Unit";

/** The unit spans withUnits produced, in order. */
const units = (node: unknown): string[] => {
  if (!isValidElement(node)) return [];
  const kids = ([] as unknown[]).concat((node as ReactElement<{ children: unknown }>).props.children);
  return kids.filter(isValidElement).map(k => String((k as ReactElement<{ children: unknown }>).props.children));
};

describe("withUnits", () => {
  it("keeps units after numbers out of the caps", () => {
    expect(units(withUnits("Minimum, 200 Hz–15 kHz"))).toEqual(["Hz", "kHz"]);
    expect(units(withUnits("Far field · 2.83 V · 1 m"))).toEqual(["V", "m"]);
    expect(units(withUnits("Tuning fB"))).toEqual(["fB"]);
  });
  it("leaves words alone", () => {
    expect(withUnits("Woofer / midrange")).toBe("Woofer / midrange");
    expect(withUnits("Level")).toBe("Level");
  });
});
