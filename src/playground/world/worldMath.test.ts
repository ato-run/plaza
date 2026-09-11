import { describe, expect, it } from "vitest";

import {
  chooseTarget,
  clampPitch,
  movementVector,
  sanitizeTransform,
  SendCadence,
  shortestAngleDelta,
  smoothing,
  WORLD_RADIUS,
} from "./worldMath";
import { circle, isPositionValid, resolveMovement } from "./collision";

describe("movementVector", () => {
  it("walks toward -Z at yaw 0, which is where the camera looks", () => {
    const { vx, vz } = movementVector({ forward: 1, right: 0 }, 0, 1, 3.4);
    expect(vx).toBeCloseTo(0, 6);
    expect(vz).toBeCloseTo(-3.4, 6);
  });

  it("strafes toward +X at yaw 0", () => {
    const { vx, vz } = movementVector({ forward: 0, right: 1 }, 0, 1, 3.4);
    expect(vx).toBeCloseTo(3.4, 6);
    expect(vz).toBeCloseTo(0, 6);
  });

  it("turns with yaw", () => {
    // Facing -X (yaw = +90°), forward should move along -X.
    const { vx, vz } = movementVector(
      { forward: 1, right: 0 },
      Math.PI / 2,
      1,
      3.4,
    );
    expect(vx).toBeCloseTo(-3.4, 6);
    expect(vz).toBeCloseTo(0, 6);
  });

  it("does not let diagonals outrun straight lines", () => {
    const straight = movementVector({ forward: 1, right: 0 }, 0, 1, 3.4);
    const diagonal = movementVector({ forward: 1, right: 1 }, 0, 1, 3.4);
    const straightSpeed = Math.hypot(straight.vx, straight.vz);
    const diagonalSpeed = Math.hypot(diagonal.vx, diagonal.vz);
    expect(diagonalSpeed).toBeCloseTo(straightSpeed, 6);
  });

  it("keeps partial joystick deflection slow", () => {
    const half = movementVector({ forward: 0.5, right: 0 }, 0, 1, 3.4);
    expect(Math.hypot(half.vx, half.vz)).toBeCloseTo(1.7, 6);
    expect(half.magnitude).toBeCloseTo(0.5, 6);
  });
});

describe("isPositionValid", () => {
  const obstacles = [circle(5, 0, 1)];

  it("keeps you inside the world disc", () => {
    expect(isPositionValid(0, 0, obstacles)).toBe(true);
    expect(isPositionValid(WORLD_RADIUS + 1, 0, obstacles)).toBe(false);
  });

  it("rejects a position inside an obstacle, allowing for body width", () => {
    // The obstacle stops you at its radius PLUS your own half-width (1 + 0.25),
    // so you are held off the surface rather than clipping into it.
    expect(isPositionValid(5, 0, obstacles)).toBe(false);
    expect(isPositionValid(6.1, 0, obstacles)).toBe(false);
    expect(isPositionValid(6.3, 0, obstacles)).toBe(true);
  });

  it("rejects non-finite coordinates rather than propagating them", () => {
    expect(isPositionValid(Number.NaN, 0, obstacles)).toBe(false);
    expect(isPositionValid(0, Number.POSITIVE_INFINITY, obstacles)).toBe(false);
  });
});

describe("resolveMovement", () => {
  const obstacles = [circle(0, -2, 1)];

  it("slides along an obstacle instead of stopping dead", () => {
    // Walking diagonally into the obstacle from just outside its stop
    // distance: advancing Z would enter it and is refused, while the X
    // component is still clear and resolves — so you slide rather than stick.
    const next = resolveMovement(
      { x: 0, z: -0.6 },
      { vx: 0.5, vz: -0.5 },
      obstacles,
    );
    expect(next.x).toBeCloseTo(0.5, 6);
    expect(next.z).toBeCloseTo(-0.6, 6);
  });

  it("lets unobstructed movement through untouched", () => {
    const next = resolveMovement({ x: 0, z: 5 }, { vx: 0.3, vz: 0.4 }, obstacles);
    expect(next.x).toBeCloseTo(0.3, 6);
    expect(next.z).toBeCloseTo(5.4, 6);
  });
});

describe("clampPitch", () => {
  it("stops you looking far enough up or down to invert", () => {
    expect(clampPitch(99)).toBeCloseTo(1.2, 6);
    expect(clampPitch(-99)).toBeCloseTo(-1.2, 6);
    expect(clampPitch(0.4)).toBeCloseTo(0.4, 6);
  });

  it("treats a non-finite pitch as level", () => {
    expect(clampPitch(Number.NaN)).toBe(0);
  });
});

describe("smoothing", () => {
  it("is frame-rate independent: two half-steps ≈ one whole step", () => {
    const once = smoothing(0.1, 12);
    const twice = 1 - (1 - smoothing(0.05, 12)) * (1 - smoothing(0.05, 12));
    expect(twice).toBeCloseTo(once, 10);
  });
});

describe("shortestAngleDelta", () => {
  it("goes the short way round the wrap point", () => {
    // From just below +π to just above -π is a small step, not a full circle.
    expect(shortestAngleDelta(3.1, -3.1)).toBeCloseTo(Math.PI * 2 - 6.2, 6);
    expect(Math.abs(shortestAngleDelta(3.1, -3.1))).toBeLessThan(0.1);
  });

  it("is signed", () => {
    expect(shortestAngleDelta(0, 1)).toBeCloseTo(1, 6);
    expect(shortestAngleDelta(1, 0)).toBeCloseTo(-1, 6);
  });
});

describe("chooseTarget", () => {
  const eye = { x: 0, y: 1.65, z: 0 };
  const forward = { x: 0, y: 0, z: -1 };

  it("picks what is centred, not what is closest", () => {
    const chosen = chooseTarget(
      eye,
      forward,
      [
        // Near, but far off to the side.
        { item: "beside", position: { x: 1.5, y: 1.65, z: -0.2 } },
        // Further away, but dead ahead.
        { item: "ahead", position: { x: 0, y: 1.65, z: -3 } },
      ],
    );
    expect(chosen).toBe("ahead");
  });

  it("ignores anything out of reach", () => {
    const chosen = chooseTarget(eye, forward, [
      { item: "far", position: { x: 0, y: 1.65, z: -40 } },
    ]);
    expect(chosen).toBeNull();
  });

  it("ignores what is behind you", () => {
    const chosen = chooseTarget(eye, forward, [
      { item: "behind", position: { x: 0, y: 1.65, z: 3 } },
    ]);
    expect(chosen).toBeNull();
  });

  it("returns null when nothing is centred enough", () => {
    const chosen = chooseTarget(eye, forward, [
      { item: "edge", position: { x: 3, y: 1.65, z: -1 } },
    ]);
    expect(chosen).toBeNull();
  });
});

describe("SendCadence", () => {
  it("allows roughly 12 sends a second, not one per frame", () => {
    const cadence = new SendCadence(83);
    expect(cadence.due(1000)).toBe(true);
    // The next animation frames, 16ms apart, must not each send.
    expect(cadence.due(1016)).toBe(false);
    expect(cadence.due(1032)).toBe(false);
    expect(cadence.due(1082)).toBe(false);
    expect(cadence.due(1083)).toBe(true);
  });

  it("sends immediately after a reset", () => {
    const cadence = new SendCadence(83);
    expect(cadence.due(1000)).toBe(true);
    cadence.reset();
    expect(cadence.due(1001)).toBe(true);
  });
});

describe("sanitizeTransform", () => {
  const valid = {
    x: 1,
    y: 1.65,
    z: -2,
    yaw: 0.5,
    pitch: 0.2,
    movement: "walk",
    pose: "stand",
  };

  it("accepts a well-formed transform", () => {
    expect(sanitizeTransform(valid)).toEqual(valid);
  });

  it("rejects NaN and Infinity rather than poisoning the scene", () => {
    expect(sanitizeTransform({ ...valid, x: Number.NaN })).toBeNull();
    expect(sanitizeTransform({ ...valid, z: Number.POSITIVE_INFINITY })).toBeNull();
    expect(sanitizeTransform({ ...valid, yaw: Number.NEGATIVE_INFINITY })).toBeNull();
  });

  it("rejects absurd coordinates a hostile client could send", () => {
    expect(sanitizeTransform({ ...valid, x: 1e300 })).toBeNull();
    expect(sanitizeTransform({ ...valid, z: -1e9 })).toBeNull();
  });

  it("clamps pitch instead of rejecting it", () => {
    expect(sanitizeTransform({ ...valid, pitch: 99 })?.pitch).toBeCloseTo(1.2, 6);
  });

  it("treats an unknown movement state as idle", () => {
    expect(sanitizeTransform({ ...valid, movement: "sprint" })?.movement).toBe(
      "idle",
    );
  });

  it("rejects junk", () => {
    expect(sanitizeTransform(null)).toBeNull();
    expect(sanitizeTransform("nope")).toBeNull();
    expect(sanitizeTransform({})).toBeNull();
  });
});
