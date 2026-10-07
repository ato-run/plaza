import { describe, expect, it } from "vitest";

import { circle } from "../collision";
import { beachWalkable, waterDepth } from "../beach/coast";
import { sceneryColliders } from "../beach/scenery";
import { CENTRAL_BENCHES, CENTRAL_PLANTERS, CENTRAL_SOFTWARE_SLOTS, CENTRAL_TREES, CENTRAL_LANTERNS, EXHIBIT_OBSTACLE_RADIUS } from "../worlds/centralGeometry";
import { plazaSpots, RESIDENTS } from "./cast";
import { buildGrid, createSchedule, findPath, separate, SLOT_SECONDS } from "./schedule";

const statics = [
  circle(0, 0, 3.3),
  ...CENTRAL_TREES.map(([x, z]) => circle(x, z, 0.5)),
  ...CENTRAL_PLANTERS.map(([x, z]) => circle(x, z, 1.6)),
  ...CENTRAL_BENCHES.map(([x, z]) => circle(x, z, 1.5)),
  ...CENTRAL_LANTERNS.map(([x, z]) => circle(x, z, 0.3)),
  ...CENTRAL_SOFTWARE_SLOTS.map((slot) => circle(slot.x, slot.z, EXHIBIT_OBSTACLE_RADIUS)),
  ...sceneryColliders(),
];
const walk = (x: number, z: number) => beachWalkable(x, z) && waterDepth(x, z) < 0.05;
const grid = buildGrid(statics, walk, { minX: -34, maxX: 34, minZ: -40, maxZ: 24 });
const tagged = plazaSpots();
const spots = tagged.map((entry) => entry.spot);

const blockedAt = (x: number, z: number) => {
  const column = Math.floor((x - grid.minX) / grid.cell);
  const row = Math.floor((z - grid.minZ) / grid.cell);
  return grid.blocked[row * grid.width + column] === 1;
};

describe("resident schedule", () => {
  it("finds a real route between every pair of spots", () => {
    for (const from of spots) {
      for (const to of spots) {
        if (from === to) continue;
        const path = findPath(grid, from.approach ?? from, to.approach ?? to);
        // A failed search returns just the two ends; every real route either
        // has corners or is a clear straight line.
        for (let i = 1; i < path.length - 1; i += 1) {
          expect(blockedAt(path[i].x, path[i].z), `${from.id}->${to.id}`).toBe(false);
        }
        const length = path.reduce((sum, point, i) => (i ? sum + Math.hypot(point.x - path[i - 1].x, point.z - path[i - 1].z) : 0), 0);
        expect(length, `${from.id}->${to.id}`).toBeLessThan(110);
      }
    }
  });

  it("is the same for everyone and moves continuously", () => {
    const a = createSchedule(grid, spots, RESIDENTS.length);
    const b = createSchedule(grid, spots, RESIDENTS.length);
    const start = 1_800_000_000;
    for (let resident = 0; resident < RESIDENTS.length; resident += 1) {
      let previous = a.stateAt(resident, start);
      for (let t = start; t < start + SLOT_SECONDS * 4; t += 0.25) {
        const state = a.stateAt(resident, t);
        expect(b.stateAt(resident, t)).toEqual(state);
        // No teleports: at most a brisk walk per quarter second.
        expect(Math.hypot(state.x - previous.x, state.z - previous.z)).toBeLessThan(0.75);
        previous = state;
      }
    }
  });

  it("never puts two residents on the same spot at the same time", () => {
    const schedule = createSchedule(grid, spots, RESIDENTS.length);
    const start = 1_800_000_000;
    for (let t = start; t < start + SLOT_SECONDS * 30; t += 2) {
      const held = new Map<string, number>();
      for (let resident = 0; resident < RESIDENTS.length; resident += 1) {
        const state = schedule.stateAt(resident, t);
        if (state.moving) continue;
        expect(held.has(state.spot.id), `${state.spot.id} at ${t}`).toBe(false);
        held.set(state.spot.id, resident);
      }
    }
  });

  it("answers the same whatever order it is asked in", () => {
    const start = 1_800_000_000;
    const forward = createSchedule(grid, spots, RESIDENTS.length);
    const backward = createSchedule(grid, spots, RESIDENTS.length);
    const times = Array.from({ length: 40 }, (_, i) => start + i * 37);
    const a = times.map((t) => RESIDENTS.map((_, r) => forward.stateAt(r, t).spot.id));
    const b = [...times].reverse().map((t) => [...RESIDENTS.keys()].reverse().map((r) => backward.stateAt(r, t).spot.id).reverse()).reverse();
    expect(b).toEqual(a);
  });

  it("keeps characters apart after separation", () => {
    const schedule = createSchedule(grid, spots, RESIDENTS.length);
    const start = 1_800_000_000;
    for (let t = start; t < start + SLOT_SECONDS * 10; t += 0.5) {
      const states = RESIDENTS.map((_, r) => schedule.stateAt(r, t));
      const points = [...states.map((s) => ({ x: s.x, z: s.z })), { x: 2.6, z: 8.4 }];
      separate(points, [...states.map((s) => s.pose === "sit"), true]);
      for (let a = 0; a < points.length; a += 1) {
        for (let b = a + 1; b < points.length; b += 1) {
          const bothSeated = states[a]?.pose === "sit" && states[b]?.pose === "sit";
          if (bothSeated) continue;
          expect(Math.hypot(points[a].x - points[b].x, points[a].z - points[b].z), `t=${t} ${a}/${b}`).toBeGreaterThan(0.7);
        }
      }
    }
  });
});
