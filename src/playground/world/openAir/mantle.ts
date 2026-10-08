import {
  blockingColliders,
  isPositionValid,
  overlaps,
  type Collider,
} from "../collision";
/** A jump at an unobstructed low ledge pulls the feet onto its actual surface. */
export function mantleTarget(
  position: { x: number; z: number },
  direction: { x: number; z: number },
  feet: number,
  colliders: readonly Collider[],
  walkable?: (x: number, z: number) => boolean,
): { x: number; z: number; top: number } | null {
  const length = Math.hypot(direction.x, direction.z);
  if (length < 0.001) return null;
  const dx = direction.x / length,
    dz = direction.z / length;
  for (const distance of [0.35, 0.5, 0.65, 0.8]) {
    const x = position.x + dx * distance,
      z = position.z + dz * distance;
    const ledge = colliders.find(
      (c) =>
        c.top !== undefined &&
        c.top - feet > 0.24 &&
        c.top - feet <= 1 &&
        overlaps(c, x, z, 0.05),
    );
    if (!ledge || ledge.top === undefined || (walkable && !walkable(x, z)))
      continue;
    if (
      isPositionValid(
        x,
        z,
        blockingColliders(colliders, ledge.top),
        0.25,
        Infinity,
      )
    )
      return { x, z, top: ledge.top };
  }
  return null;
}
