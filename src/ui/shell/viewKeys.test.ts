import { describe, expect, it } from "vitest";
import { viewKey, viewKeyIndex } from "./viewKeys";

describe("view number keys", () => {
  it("maps 1-9 to the first nine views and 0 to the tenth", () => {
    expect(viewKey(0)).toBe("1");
    expect(viewKey(8)).toBe("9");
    expect(viewKey(9)).toBe("0");
    expect(viewKey(10)).toBeUndefined();
  });
  it("is the inverse of viewKeyIndex", () => {
    for (let i = 0; i < 10; i++) expect(viewKeyIndex(viewKey(i)!)).toBe(i);
  });
});
