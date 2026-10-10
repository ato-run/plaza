import { worldMoment } from "./clock";
/** One shared-time work cycle; the carried piece remains an ordinary pickable object when set down. */
export function driftwoodWork(now: number): {
  x: number;
  z: number;
  yaw: number;
  carrying: boolean;
  active: boolean;
} {
  const moment = worldMoment(now),
    cycle = (((now % 120000) + 120000) % 120000) / 1000;
  const active = moment.phase === "day" && moment.weather !== "rain";
  const t =
    cycle < 15
      ? 0
      : cycle < 60
        ? (cycle - 15) / 45
        : cycle < 75
          ? 1
          : Math.max(0, 1 - (cycle - 75) / 45);
  return {
    x: 17 + 6 * t,
    z: -31 + 48 * t,
    yaw: cycle < 60 ? Math.PI : 0,
    carrying: active && ((cycle >= 15 && cycle < 60) || cycle >= 75),
    active,
  };
}
