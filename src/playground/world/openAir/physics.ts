import { terrainHeight, SEA_LEVEL } from "../beach/coast";
import { centralFurnitureColliders } from "../worlds/centralGeometry";
import { landmarkGround, explorationColliders } from "./layout";
import { blockingColliders, resolveMovement, overlaps } from "../collision";
import { worldMoment } from "./clock";
import type { Item, ItemState, OpenAirState } from "./model";

export const ITEM_PHYSICS = {
  shell: { radius: 0.15, height: 0.09, mass: 0.12, floats: false },
  stone: { radius: 0.15, height: 0.2, mass: 1.2, floats: false },
  leaf: { radius: 0.18, height: 0.025, mass: 0.01, floats: true },
  wood: { radius: 0.62, height: 0.18, mass: 0.7, floats: true },
  ball: { radius: 0.22, height: 0.44, mass: 0.2, floats: true },
} as const;
const colliders = [...centralFurnitureColliders(), ...explorationColliders()];
export function objectGround(x: number, z: number): number {
  return Math.max(
    landmarkGround(x, z, terrainHeight(x, z)),
    ...colliders
      .filter((c) => c.top !== undefined && overlaps(c, x, z, 0.025))
      .map((c) => c.top!),
  );
}
export interface ObjectPosition {
  x: number;
  y: number;
  z: number;
  held: boolean;
  yaw: number;
  skips: number;
  carrier?: string;
  roll?: number;
}
const paths = new WeakMap<
  ItemState,
  Map<string, Omit<ObjectPosition, "held">[]>
>();
function trajectory(item: Item, saved: ItemState, contactActive = true) {
  const cacheKey = `${item.kind}:${contactActive}`;
  const cached = paths.get(saved)?.get(cacheKey);
  if (cached) return cached;
  const shape = ITEM_PHYSICS[item.kind],
    dt = 1 / 40;
  let { x, z, vx, vz } = saved,
    y = saved.y ?? objectGround(x, z) + shape.height / 2;
  let vy = saved.vy ?? (Math.hypot(vx, vz) > 0 ? 4.2 : 0),
    skips = 0;
  const path = [{ x, y, z, yaw: saved.yaw ?? 0, skips }];
  for (let i = 1; i <= 400; i++) {
    if (
      contactActive &&
      saved.contact &&
      i === Math.ceil(saved.contact.delay * 40)
    ) {
      x = saved.contact.x;
      y = saved.contact.y;
      z = saved.contact.z;
      vx = saved.contact.vx;
      vz = saved.contact.vz;
      vy = saved.contact.vy;
    }
    const now = saved.at + i * 25,
      moment = worldMoment(now),
      water = SEA_LEVEL + moment.tide;
    const next = resolveMovement(
      { x, z },
      { vx: vx * dt, vz: vz * dt },
      blockingColliders(colliders, y - shape.height / 2),
      shape.radius,
      Infinity,
      (px, pz) => Math.abs(px) < 53.4 && Math.abs(pz) < 53.4,
    );
    if (Math.abs(next.x - x - vx * dt) > 0.001)
      vx = item.kind === "ball" ? -vx * 0.65 : 0;
    if (Math.abs(next.z - z - vz * dt) > 0.001)
      vz = item.kind === "ball" ? -vz * 0.65 : 0;
    x = next.x;
    z = next.z;
    vy -= 9.8 * dt;
    y += vy * dt;
    const floor = objectGround(x, z) + shape.height / 2;
    if (
      item.kind === "stone" &&
      water > floor &&
      y < water &&
      path[i - 1].y >= water &&
      Math.hypot(vx, vz) > 3 &&
      vy > -3.2 &&
      vy < -0.2 &&
      skips < 4
    ) {
      y = water + 0.025;
      vy = Math.max(0.9, -vy * 0.72);
      vx *= 0.77;
      vz *= 0.77;
      skips++;
    } else if (
      shape.floats &&
      water > floor &&
      y < water + shape.height * 0.3
    ) {
      y = water + shape.height * 0.3;
      vy = 0;
      vx *= 0.97;
      vz *= 0.97;
    } else if (y < floor) {
      y = floor;
      const bounce = item.kind === "ball" && vy < -1 ? -vy * 0.48 : 0;
      vy = bounce;
      vx *= item.kind === "ball" ? 0.987 : 0.83;
      vz *= item.kind === "ball" ? 0.987 : 0.83;
    }
    if (!saved.owner && !saved.support) {
      const afloat = shape.floats && water > floor;
      const drift = afloat
        ? 0.045
        : item.kind === "leaf" && moment.weather !== "rain" && y <= floor + 0.03
          ? 0.1 * moment.wind
          : 0;
      if (drift) {
        const moved = resolveMovement(
          { x, z },
          {
            vx: (afloat ? moment.currentX : moment.windX) * drift * dt,
            vz: (afloat ? moment.currentZ : moment.windZ) * drift * dt,
          },
          blockingColliders(colliders, y),
          shape.radius,
          Infinity,
          (px, pz) => Math.abs(px) < 53.4 && Math.abs(pz) < 53.4,
        );
        x = moved.x;
        z = moved.z;
      }
    }
    path.push({
      x,
      y,
      z,
      yaw:
        (saved.yaw ?? 0) +
        (item.kind === "ball"
          ? (i * Math.hypot(vx, vz) * dt) / shape.radius
          : 0),
      skips,
    });
  }
  // Integrate the same changing weather after the flight. A current wind
  // direction multiplied by the entire age would teleport a leaf at a front.
  for (let second = 11; second <= 180; second++) {
    const moment = worldMoment(saved.at + second * 1000),
      floor = objectGround(x, z),
      water = SEA_LEVEL + moment.tide;
    const afloat = shape.floats && floor < water;
    const drift =
      saved.owner || saved.support
        ? 0
        : afloat
          ? 0.045
          : item.kind === "leaf" && moment.weather !== "rain"
            ? 0.1 * moment.wind
            : 0;
    const moved = resolveMovement(
      { x, z },
      {
        vx: (afloat ? moment.currentX : moment.windX) * drift,
        vz: (afloat ? moment.currentZ : moment.windZ) * drift,
      },
      blockingColliders(colliders, y),
      shape.radius,
      Infinity,
      (px, pz) => Math.abs(px) < 53.4 && Math.abs(pz) < 53.4,
    );
    x = moved.x;
    z = moved.z;
    y = afloat
      ? water + shape.height * 0.3
      : objectGround(x, z) + shape.height / 2;
    path.push({ x, y, z, yaw: path[400].yaw, skips });
  }
  let cache = paths.get(saved);
  if (!cache) {
    cache = new Map();
    paths.set(saved, cache);
  }
  cache.set(cacheKey, path);
  return path;
}
export function freeObjectPosition(
  item: Item,
  saved: ItemState | undefined,
  now: number,
  state?: OpenAirState,
): ObjectPosition {
  const shape = ITEM_PHYSICS[item.kind];
  if (saved?.previous && now < saved.at)
    return freeObjectPosition(item, saved.previous, now, state);
  if (!saved)
    return {
      x: item.x,
      z: item.z,
      y: objectGround(item.x, item.z) + shape.height / 2,
      held: false,
      yaw: 0,
      skips: 0,
    };
  if (saved.owner && now - saved.at < 90000)
    return {
      x: saved.x,
      z: saved.z,
      y: saved.y ?? objectGround(saved.x, saved.z) + shape.height / 2,
      held: true,
      yaw: saved.yaw ?? 0,
      skips: 0,
    };
  const age = Math.max(0, (now - saved.at) / 1000),
    path = trajectory(
      item,
      saved,
      !saved.contact?.target ||
        !state ||
        (state.objects[saved.contact.target]?.at ?? 0) >=
          (saved.contact.targetAt ?? 0),
    ),
    t = age <= 10 ? age * 40 : 400 + Math.min(age - 10, 170),
    i = Math.floor(t),
    a = path[i],
    b = path[Math.min(i + 1, path.length - 1)];
  let x = a.x + (b.x - a.x) * (t - i),
    z = a.z + (b.z - a.z) * (t - i),
    y = a.y + (b.y - a.y) * (t - i);
  const moment = worldMoment(now),
    water = SEA_LEVEL + moment.tide;
  if (
    shape.floats &&
    objectGround(x, z) < water &&
    y < water + shape.height * 0.5
  )
    y = water + shape.height * 0.3 + Math.sin(now / 700 + x) * 0.012;
  return { x, y, z, held: false, yaw: a.yaw, skips: a.skips };
}
export function supportsObject(
  base: Item,
  p: ObjectPosition,
  x: number,
  z: number,
): boolean {
  if (base.kind === "wood") {
    const dx = x - p.x,
      dz = z - p.z;
    return (
      Math.abs(dx * Math.cos(p.yaw) - dz * Math.sin(p.yaw)) < 0.6 &&
      Math.abs(dx * Math.sin(p.yaw) + dz * Math.cos(p.yaw)) < 0.16
    );
  }
  return Math.hypot(x - p.x, z - p.z) < ITEM_PHYSICS[base.kind].radius;
}
