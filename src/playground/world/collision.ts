/**
 * What you cannot walk through.
 *
 * Circles were enough for a plaza of trees and planters. They are not enough
 * for the Worlds coming next: a market stall, a ruined wall and a treehouse
 * deck are rectangles, and approximating a 6m wall with a circle either lets
 * people through its corners or blocks a wide invisible disc around it. So a
 * collider is a discriminated union, and the caller says which shape it meant.
 *
 * Axis-aligned boxes only, with an optional rotation about Y. Full arbitrary
 * hulls would be a physics engine; a rotated rectangle covers every structure
 * these Worlds actually contain, and the test is still a couple of
 * subtractions once the point is rotated into the box's frame.
 *
 * Pure functions, no three.js: this is the arithmetic that decides where a
 * person ends up, and it should be testable without a scene graph.
 */

import { WORLD_RADIUS } from "./worldMath";

export interface CircleCollider {
  shape: "circle";
  x: number;
  z: number;
  r: number;
}

export interface BoxCollider {
  shape: "box";
  x: number;
  z: number;
  /** Full extents, not half-extents — the same numbers a BoxGeometry takes. */
  width: number;
  depth: number;
  /** Radians about +Y. Optional because most walls are axis-aligned. */
  rotation?: number;
}

export type Collider = CircleCollider | BoxCollider;

export function circle(x: number, z: number, r: number): CircleCollider {
  return { shape: "circle", x, z, r };
}

export function box(
  x: number,
  z: number,
  width: number,
  depth: number,
  rotation = 0,
): BoxCollider {
  return { shape: "box", x, z, width, depth, rotation };
}

/** How wide a person is. Their feet, not their outstretched arms. */
export const BODY_RADIUS = 0.25;

/**
 * Does a body of `radius` at (x, z) overlap this collider?
 *
 * The box case is the standard circle-vs-rectangle test: clamp the circle's
 * centre into the rectangle to find the nearest point on it, then compare
 * distance to radius. Doing it in the box's own rotated frame means one
 * `rotation` field buys arbitrary orientation without a separate code path.
 */
export function overlaps(
  collider: Collider,
  x: number,
  z: number,
  radius: number,
): boolean {
  if (collider.shape === "circle") {
    return Math.hypot(x - collider.x, z - collider.z) < collider.r + radius;
  }
  let dx = x - collider.x;
  let dz = z - collider.z;
  if (collider.rotation) {
    // Rotate the point INTO the box's frame, i.e. by -rotation.
    const cos = Math.cos(-collider.rotation);
    const sin = Math.sin(-collider.rotation);
    const rx = dx * cos - dz * sin;
    const rz = dx * sin + dz * cos;
    dx = rx;
    dz = rz;
  }
  const halfWidth = collider.width / 2;
  const halfDepth = collider.depth / 2;
  const nearestX = Math.max(-halfWidth, Math.min(halfWidth, dx));
  const nearestZ = Math.max(-halfDepth, Math.min(halfDepth, dz));
  return Math.hypot(dx - nearestX, dz - nearestZ) < radius;
}

/** Inside the World disc and clear of every collider. */
export function isPositionValid(
  x: number,
  z: number,
  colliders: readonly Collider[],
  bodyRadius = BODY_RADIUS,
  worldRadius = WORLD_RADIUS,
): boolean {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return false;
  if (Math.hypot(x, z) >= worldRadius) return false;
  return !colliders.some((collider) => overlaps(collider, x, z, bodyRadius));
}

/**
 * Move, testing each axis separately.
 *
 * Testing the combined position instead would make a body walking into a wall
 * at an angle stop dead; resolving per-axis lets it slide along the obstacle,
 * which is what every player expects.
 */
export function resolveMovement(
  from: { x: number; z: number },
  velocity: { vx: number; vz: number },
  colliders: readonly Collider[],
  bodyRadius = BODY_RADIUS,
  worldRadius = WORLD_RADIUS,
): { x: number; z: number } {
  let { x, z } = from;
  if (isPositionValid(x + velocity.vx, z, colliders, bodyRadius, worldRadius)) {
    x += velocity.vx;
  }
  if (isPositionValid(x, z + velocity.vz, colliders, bodyRadius, worldRadius)) {
    z += velocity.vz;
  }
  return { x, z };
}
