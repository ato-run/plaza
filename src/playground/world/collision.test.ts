import { describe, expect, it } from "vitest";

import {
  BODY_RADIUS,
  box,
  circle,
  isPositionValid,
  overlaps,
  resolveMovement,
} from "./collision";

describe("circle colliders keep the movement they always had", () => {
  const obstacles = [circle(5, 0, 1)];

  it("stops you at the radius plus your own half-width", () => {
    expect(isPositionValid(6.1, 0, obstacles)).toBe(false);
    expect(isPositionValid(6.3, 0, obstacles)).toBe(true);
  });

  it("still slides along an obstacle instead of stopping dead", () => {
    const next = resolveMovement(
      { x: 0, z: -0.6 },
      { vx: 0.5, vz: -0.5 },
      [circle(0, -2, 1)],
    );
    expect(next.x).toBeCloseTo(0.5, 6);
    expect(next.z).toBeCloseTo(-0.6, 6);
  });
});

describe("box colliders", () => {
  // A 6m × 1m wall centred at the origin, running along X.
  const wall = box(0, 0, 6, 1);

  it("blocks along the whole face, where a circle would leak at the ends", () => {
    // A circle big enough to cover a 6m wall would have radius 3 and block a
    // disc; a box blocks the wall and nothing else. Both ends are solid:
    expect(overlaps(wall, -2.9, 0, BODY_RADIUS)).toBe(true);
    expect(overlaps(wall, 2.9, 0, BODY_RADIUS)).toBe(true);
    // ...and just past the end you walk round it.
    expect(overlaps(wall, 3.3, 0, BODY_RADIUS)).toBe(false);
  });

  it("holds you off the face by your own half-width", () => {
    // Half-depth is 0.5, so the surface is at z = 0.5 and a body stops at
    // 0.5 + 0.25.
    expect(overlaps(wall, 0, 0.7, BODY_RADIUS)).toBe(true);
    expect(overlaps(wall, 0, 0.8, BODY_RADIUS)).toBe(false);
  });

  it("is solid inside", () => {
    expect(overlaps(wall, 0, 0, BODY_RADIUS)).toBe(true);
  });

  it("rounds its corners by the body radius rather than squaring them", () => {
    // Diagonally off the corner (3, 0.5) by slightly more than the body
    // radius: a naive "inside the expanded rectangle" test would call this a
    // collision, but the nearest-point test correctly does not.
    expect(overlaps(wall, 3.2, 0.7, BODY_RADIUS)).toBe(false);
    expect(overlaps(wall, 3.1, 0.6, BODY_RADIUS)).toBe(true);
  });

  it("respects rotation", () => {
    // The same wall turned 90°: now it blocks along Z and is thin along X.
    const turned = box(0, 0, 6, 1, Math.PI / 2);
    expect(overlaps(turned, 0, 2.9, BODY_RADIUS)).toBe(true);
    expect(overlaps(turned, 0, 3.3, BODY_RADIUS)).toBe(false);
    expect(overlaps(turned, 0.8, 0, BODY_RADIUS)).toBe(false);
  });

  it("mixes with circles in one collider list", () => {
    const colliders = [circle(-5, 0, 1), box(5, 0, 2, 2)];
    expect(isPositionValid(-5, 0, colliders)).toBe(false);
    expect(isPositionValid(5, 0, colliders)).toBe(false);
    expect(isPositionValid(0, 0, colliders)).toBe(true);
  });

  it("slides along a wall the same way it slides around a tree", () => {
    // Walking diagonally into the wall's face: Z is refused, X still moves.
    const next = resolveMovement({ x: 0, z: 1.1 }, { vx: 0.4, vz: -0.4 }, [wall]);
    expect(next.x).toBeCloseTo(0.4, 6);
    expect(next.z).toBeCloseTo(1.1, 6);
  });
});
