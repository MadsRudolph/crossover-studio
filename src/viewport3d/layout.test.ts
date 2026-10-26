import { describe, expect, it } from "vitest";
import type { BoxDesign, Profile } from "../types";
import profileJson from "../../profiles/system-d-group10/profile.json";
import { frameDistance, orbitPoint, PRESET_DIRECTIONS, sceneLayout, spreadLabels } from "./layout";

const profile = profileJson as unknown as Profile;
const box = (patch: Partial<BoxDesign> = {}): BoxDesign => ({ mode: "one", L: 0.16, L2: 0.2, a2: 0.025, fill: 1, ...patch });

describe("sceneLayout (System D)", () => {
  const L = sceneLayout(profile, box());

  it("builds the woofer box from inner size plus two walls, standing on the floor", () => {
    expect(L.woofer.size[0]).toBeCloseTo(0.435 + 0.036, 9);
    expect(L.woofer.size[1]).toBeCloseTo(0.45 + 0.036, 9);
    expect(L.woofer.center[1]).toBeCloseTo(L.woofer.size[1] / 2, 9);
    expect(L.frontZ).toBeCloseTo(L.woofer.size[2] / 2, 9);
  });

  it("puts the top box 0.12 m to the left, on the woofer box, front faces flush", () => {
    expect(L.top.center[0]).toBeCloseTo(-0.12, 9);
    expect(L.top.center[1] - L.top.size[1] / 2).toBeCloseTo(L.woofer.size[1], 9);
    expect(L.top.center[2] + L.top.size[2] / 2).toBeCloseTo(L.frontZ, 9);
    expect(L.freeSide).toBe(1);
  });

  it("places every driver on its baffle at the profile position", () => {
    expect(L.drivers.woof.pos).toEqual([0, 0.29, L.frontZ]);
    expect(L.drivers.mid.pos[0]).toBeCloseTo(-0.12, 9);
    expect(L.drivers.mid.pos[1]).toBeCloseTo(L.woofer.size[1] + 0.094, 9);
    expect(L.drivers.tw.pos[1]).toBeCloseTo(L.woofer.size[1] + 0.211, 9);
    expect(L.drivers.tw.coneR).toBeCloseTo(0.0125, 9);
    for (const d of Object.values(L.drivers)) expect(d.coneR).toBeLessThan(d.frameR);
  });

  it("opens the vents the box mode asks for, with the design lengths and vent B radius", () => {
    expect(sceneLayout(profile, box({ mode: "plugged" })).vents.every(v => !v.open)).toBe(true);
    const one = sceneLayout(profile, box({ mode: "one", L: 0.2 })).vents;
    expect(one.map(v => v.open)).toEqual([true, false]);
    expect(one[0].length).toBeCloseTo(0.2, 9);
    expect(one[0].radius).toBeCloseTo(0.0325, 9);
    const two = sceneLayout(profile, box({ mode: "two", L2: 0.24, a2: 0.02 })).vents;
    expect(two.map(v => v.open)).toEqual([true, true]);
    expect(two[1].radius).toBeCloseTo(0.02, 9);
    expect(two[1].length).toBeCloseTo(0.24, 9);
    expect(two[1].estimated).toBe(true);
  });

  it("never lets a tube pierce the back wall", () => {
    const v = sceneLayout(profile, box({ L: 2 })).vents[0];
    expect(v.length).toBeLessThan(0.45);
  });
});

describe("camera helpers", () => {
  it("frames a larger object from further away, and narrow viewports from further still", () => {
    expect(frameDistance(1, 30, 1.5)).toBeGreaterThan(frameDistance(0.5, 30, 1.5));
    expect(frameDistance(1, 30, 0.5)).toBeGreaterThan(frameDistance(1, 30, 1.5));
  });

  it("places the front preset on +z and the side preset on +x", () => {
    const f = orbitPoint([0, 0, 0], 2, PRESET_DIRECTIONS.front.azimuth, PRESET_DIRECTIONS.front.polar);
    expect(f[2]).toBeGreaterThan(1.9);
    const s = orbitPoint([0, 0, 0], 2, PRESET_DIRECTIONS.side.azimuth, PRESET_DIRECTIONS.side.polar);
    expect(s[0]).toBeGreaterThan(1.9);
  });
});

describe("callout spreading", () => {
  it("pushes stacked callouts apart and keeps their order", () => {
    const pins = [{ x: 100, y: 205 }, { x: 110, y: 200 }, { x: 600, y: 200 }];
    spreadLabels(pins);
    expect(pins[1].y).toBe(200);
    expect(pins[0].y).toBe(230);
    expect(pins[2].y).toBe(200); // far to the side: left alone
  });
  it("leaves callouts that already clear each other", () => {
    const pins = [{ x: 0, y: 0 }, { x: 0, y: 40 }];
    spreadLabels(pins);
    expect(pins.map(p => p.y)).toEqual([0, 40]);
  });
  it("moves a stack out of the bottom strip, keeping the gaps", () => {
    const pins = [{ x: 0, y: 380 }, { x: 0, y: 390 }];
    spreadLabels(pins, 400);
    expect(pins.map(p => p.y)).toEqual([370, 400]);
  });
});
