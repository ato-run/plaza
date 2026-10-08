import { describe, it, expect } from "vitest";
import { lifeSchedule } from "./life";
import { DAY_MS, worldMoment } from "./clock";
import { RESIDENTS, plazaSpots } from "../residents/cast";
import { buildGrid, createSchedule } from "../residents/schedule";
import { centralColliders } from "../worlds/centralGeometry";
import { beachWalkable } from "../beach/coast";
const spots = plazaSpots(),
  grid = buildGrid(centralColliders(), beachWalkable, {
    minX: -34,
    maxX: 34,
    minZ: -40,
    maxZ: 24,
  });
const base = createSchedule(
  grid,
  spots.map((s) => s.spot),
  10,
  RESIDENTS.map((r) =>
    r.likes
      ? spots.flatMap((s, i) => (r.likes!.includes(s.kind) ? [i] : []))
      : undefined,
  ),
);
const schedule = lifeSchedule(base, grid, RESIDENTS);
describe("resident life under the shared clock", () => {
  it("gives every resident a distinct daytime activity", () => {
    const seen = new Set();
    for (let i = 0; i < 10; i++) seen.add(schedule.spotOf(i, 1).id);
    expect(seen.size).toBe(10);
  });
  it("gathers neighbors at camp at night and in rain", () => {
    for (const t of [
      DAY_MS * 0.8,
      Array.from({ length: 200 }, (_, i) => i * 60000).find(
        (t) => worldMoment(t).weather === "rain",
      )!,
    ])
      for (let i = 0; i < 10; i++)
        expect(schedule.spotOf(i, Math.floor(t / 60000)).id).toContain("camp");
  });
  it("is continuous across minute boundaries for two independent viewers", () => {
    const other = lifeSchedule(base, grid, RESIDENTS);
    for (let i = 0; i < 10; i++) {
      const before = schedule.stateAt(i, 119.999),
        after = schedule.stateAt(i, 120.001);
      expect(Math.hypot(before.x - after.x, before.z - after.z)).toBeLessThan(
        0.1,
      );
      expect(after).toEqual(other.stateAt(i, 120.001));
    }
  });
});
