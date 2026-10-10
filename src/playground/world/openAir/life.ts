import { worldMoment } from "./clock";
import {
  findPath,
  pathLength,
  type Grid,
  type Schedule,
  type Spot,
  type ResidentState,
} from "../residents/schedule";
import type { ResidentSpec } from "../residents/cast";
/** Continuous routes between minute-long activities, using the shared room clock. */
export function lifeSchedule(
  base: Schedule,
  grid: Grid,
  cast: readonly ResidentSpec[],
): Schedule {
  const routes = new Map<
    string,
    { points: { x: number; z: number }[]; length: number; target: Spot }
  >();
  const targetOf = (i: number, period: number): Spot => {
    const moment = worldMoment(period * 60000),
      resident = cast[i];
    if (
      moment.weather === "rain" ||
      moment.phase === "sunset" ||
      moment.phase === "night"
    )
      return {
        id: `camp-${resident.id}`,
        x: 14.5 + (i % 5) * 1.65,
        z: 18.1 + Math.floor(i / 5) * 0.75,
        yaw: moment.phase === "sunset" ? 0 : Math.PI,
        pose: "stand",
        group: "camp",
      };
    if (period % 3 !== 0) {
      const jobs: Record<string, { x: number; z: number; label: string }> = {
        cat: { x: -6.6, z: -1.4, label: "rest" },
        dog: { x: 7, z: 8, label: "ball" },
        panda: { x: 19, z: -24, label: "driftwood" },
        fox: { x: 3.2, z: -9.8, label: "apps" },
        penguin: { x: 2, z: -30, label: "dance" },
        rabbit: { x: -24, z: 9, label: "exercise" },
        bear: { x: 23, z: 17, label: "repair" },
        koala: { x: 9.5, z: 6.3, label: "flowers" },
        frog: { x: -16, z: -27, label: "crabs" },
        owl: { x: -19, z: -25, label: "shells" },
      };
      const job = jobs[resident.id];
      return {
        id: `job-${job.label}`,
        x: job.x,
        z: job.z,
        yaw: 0,
        pose: "stand",
      };
    }
    return base.spotOf(i, period);
  };
  return {
    spotOf: targetOf,
    stateAt(i, seconds): ResidentState {
      seconds -= i * 3.7;
      const period = Math.floor(seconds / 60),
        into = seconds - period * 60,
        key = `${i}:${period}`;
      let route = routes.get(key);
      if (!route) {
        const from = targetOf(i, period - 1),
          target = targetOf(i, period);
        const points = findPath(
          grid,
          from.approach ?? from,
          target.approach ?? target,
        );
        points.unshift(from);
        points.push(target);
        route = { points, length: pathLength(points), target };
        routes.set(key, route);
        if (routes.size > 60) routes.delete(routes.keys().next().value!);
      }
      const speed = Math.max(
        cast[i].id === "dog" ? 1.8 : 1.15,
        route.length / 50,
      );
      let distance = into * speed;
      let point = { x: route.target.x, z: route.target.z },
        yaw = route.target.yaw,
        moving = false;
      for (let j = 1; j < route.points.length; j++) {
        const a = route.points[j - 1],
          b = route.points[j],
          length = Math.hypot(b.x - a.x, b.z - a.z);
        if (distance < length) {
          point = {
            x: a.x + ((b.x - a.x) * distance) / length,
            z: a.z + ((b.z - a.z) * distance) / length,
          };
          yaw = Math.atan2(-(b.x - a.x), -(b.z - a.z));
          moving = true;
          break;
        }
        distance -= length;
      }
      return {
        ...point,
        yaw,
        moving,
        pose: moving ? "stand" : route.target.pose,
        spot: route.target,
        stayed: moving ? -1 : into - route.length / speed,
      };
    },
  };
}
