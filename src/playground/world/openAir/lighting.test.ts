import { describe, it, expect } from "vitest";
import { DAY_MS, worldMoment } from "./clock";
import { visibleSky, nightVisibility } from "./lighting";
import { centralPlaza } from "../worlds/central-plaza";
const times = centralPlaza.environment.timesOfDay!;
describe("shared sky interpolation and personal lighting", () => {
  it("interpolates continuously across shared phase boundaries", () => {
    for (const fraction of [0.55, 0.64, 0.68, 0.74, 0.93, 0.98]) {
      const a = visibleSky(times, DAY_MS * fraction - 1, null)!,
        b = visibleSky(times, DAY_MS * fraction + 1, null)!;
      expect(Math.abs(a.sunIntensity - b.sunIntensity)).toBeLessThan(0.001);
      expect(Math.abs(a.exposure - b.exposure)).toBeLessThan(0.001);
    }
  });
  it("uses a personal sky without altering the shared conditions", () => {
    const now = DAY_MS * 0.2,
      moment = worldMoment(now);
    expect(visibleSky(times, now, "night")).toEqual(
      times.find((t) => t.id === "night")!.sky,
    );
    expect(worldMoment(now)).toEqual(moment);
    expect(moment.phase).toBe("day");
    expect(nightVisibility(DAY_MS * 0.8)).toBe(1);
    expect(nightVisibility(now)).toBe(0);
  });
});
