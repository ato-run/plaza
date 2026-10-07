import { describe, expect, it } from "vitest";

import {
  BEACH_WIDTH,
  bakeCoastField,
  FLAT_RADIUS,
  SEA_LEVEL,
  shoreDistance,
  terrainHeight,
} from "./coast";
import { WORLD_RADIUS } from "../worldMath";

describe("coast", () => {
  it("keeps the whole walkable plaza flat at y=0", () => {
    // People, the AI Controller and the renderer all assume feet at 0 here.
    for (let x = -FLAT_RADIUS; x <= FLAT_RADIUS; x += 0.5) {
      for (let z = -FLAT_RADIUS; z <= FLAT_RADIUS; z += 0.5) {
        if (Math.hypot(x, z) > WORLD_RADIUS) continue;
        expect(terrainHeight(x, z)).toBe(0);
      }
    }
  });

  it("starts the beach slope outside the walk limit, all the way round", () => {
    for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 180) {
      const x = Math.sin(angle) * (FLAT_RADIUS + 3);
      const z = -Math.cos(angle) * (FLAT_RADIUS + 3);
      expect(shoreDistance(x, z)).toBeGreaterThanOrEqual(BEACH_WIDTH);
    }
  });

  it("puts open water ahead of the spawn and dry land behind it", () => {
    expect(terrainHeight(0, -60)).toBeLessThan(SEA_LEVEL - 1);
    expect(shoreDistance(0, -60)).toBeLessThan(0);
    expect(terrainHeight(0, 40)).toBeGreaterThanOrEqual(0);
  });

  it("is not a circle: the waterline distance varies along the coast", () => {
    const distances = [-30, -15, 0, 15, 30].map((x) => {
      let z = -20;
      while (shoreDistance(x, z) > 0) z -= 0.05;
      return Math.hypot(x, z);
    });
    expect(Math.max(...distances) - Math.min(...distances)).toBeGreaterThan(3);
  });

  it("bakes exactly what the functions say", () => {
    const field = bakeCoastField(32, 240);
    const row = 7;
    const column = 19;
    const x = ((column + 0.5) / 32 - 0.5) * 240;
    const z = ((row + 0.5) / 32 - 0.5) * 240;
    const index = (row * 32 + column) * 4;
    expect(field.data[index]).toBeCloseTo(terrainHeight(x, z), 4);
    expect(field.data[index + 1]).toBeCloseTo(shoreDistance(x, z), 4);
  });
});
