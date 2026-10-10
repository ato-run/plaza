import { Color } from "three";
import type { TimeOfDay, WorldSky } from "../types";
import { worldMoment } from "./clock";
export function nightVisibility(now: number): number {
  const p = worldMoment(now).progress;
  return p < 0.64 || p > 0.99
    ? 0
    : Math.min(1, (p - 0.64) / 0.1, (0.99 - p) / 0.06);
}
export function visibleSky(
  times: readonly TimeOfDay[],
  now: number,
  override: string | null,
): WorldSky | undefined {
  if (override) return times.find((entry) => entry.id === override)?.sky;
  const keys = [
    [0, "day"],
    [0.5, "day"],
    [0.64, "magic-hour"],
    [0.74, "night"],
    [0.93, "night"],
    [0.98, "dawn"],
    [1, "day"],
  ] as const;
  const p = worldMoment(now).progress;
  let i = 1;
  while (i < keys.length - 1 && p > keys[i][0]) i++;
  const a = times.find((entry) => entry.id === keys[i - 1][1])?.sky,
    b = times.find((entry) => entry.id === keys[i][1])?.sky;
  if (!a || !b) return a ?? b;
  const t = (p - keys[i - 1][0]) / (keys[i][0] - keys[i - 1][0]),
    ease = t * t * (3 - 2 * t);
  const mix = (x: number, y: number) => x + (y - x) * ease,
    color = (x: string, y: string) =>
      `#${new Color(x).lerp(new Color(y), ease).getHexString()}`;
  return {
    ...a,
    sunDirection: a.sunDirection.map((x, j) =>
      mix(x, b.sunDirection[j]),
    ) as unknown as WorldSky["sunDirection"],
    sunColor: color(a.sunColor, b.sunColor),
    zenith: color(a.zenith, b.zenith),
    horizon: color(a.horizon, b.horizon),
    ground: color(a.ground, b.ground),
    sunIntensity: mix(a.sunIntensity, b.sunIntensity),
    exposure: mix(a.exposure, b.exposure),
    environmentIntensity: mix(a.environmentIntensity, b.environmentIntensity),
    clouds: mix(a.clouds, b.clouds),
    sunDisc: mix(a.sunDisc ?? 40, b.sunDisc ?? 40),
  };
}
