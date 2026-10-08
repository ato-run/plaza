import { box, circle, type Collider } from "../collision";
/** Shared scene and navigation footprints. Coordinates stay within the wire's ±64m. */
export const OPEN_AIR_PLACES = [
  {
    id: "lookout",
    name: "Dune lookout",
    x: -35,
    z: 10.4,
    radius: 3,
    description: "Climb the stone steps to see the tide pools and the pier.",
  },
  {
    id: "pools",
    name: "Tide pools",
    x: -18,
    z: -29,
    radius: 4,
    description:
      "Crouch to watch crabs; pick up shells or arrange them on the stone tray.",
  },
  {
    id: "pier",
    name: "Driftwood pier",
    x: 22,
    z: -27,
    radius: 3,
    description:
      "Follow the beach or hop across the rocks. Float a piece of driftwood in the shallows.",
  },
  {
    id: "camp",
    name: "Beach camp",
    x: 18,
    z: 15,
    radius: 4,
    description:
      "Meet neighbors by the lanterns, shelter from rain, or watch the stars.",
  },
] as const;
export const OVERLOOK_STEPS = Array.from({ length: 13 }, (_, i) => ({
  x: -21 - i * 1.1,
  z: 7 + i * 0.28,
  width: 1.1,
  depth: 2.6,
  top: 0.18 + i * 0.24,
}));
export const HOP_ROCKS = Array.from({ length: 7 }, (_, i) => ({
  x: 13 + i * 1.3,
  z: -43.2 - i * 0.1,
  r: 0.62,
  top: -0.82 + (i % 3) * 0.04,
}));
export const TRAY = { x: -18, z: -27, y: 0.18, radius: 1.6 };
export function landmarkGround(x: number, z: number, base: number): number {
  let height = base;
  for (const step of OVERLOOK_STEPS) {
    if (
      Math.abs(x - step.x) <= step.width / 2 + 0.1 &&
      Math.abs(z - step.z) <= step.depth / 2 + 0.1
    )
      height = Math.max(height, step.top);
  }
  if (x > -36.8 && x < -34.7 && z > 8.5 && z < 12.5)
    height = Math.max(height, 3.06);
  for (const rock of HOP_ROCKS)
    if (Math.hypot(x - rock.x, z - rock.z) < rock.r + 0.1)
      height = Math.max(height, rock.top);
  if (x > 20 && x < 24 && z > -46 && z < -23) height = Math.max(height, 0.25);
  return height;
}
/** A visible perimeter dune wall, safely inside the network transform limits. */
export function boundaryHeight(x: number, z: number): number {
  const edge = Math.max(Math.abs(x), z);
  return edge < 48 ? 0 : Math.pow(Math.min(1, (edge - 48) / 7), 2) * 9;
}

export const CAMP_SEATS = Array.from({ length: 4 }, (_, i) => ({
  id: `camp-seat-${i}`,
  x: (i < 2 ? 16 : 20) + (i % 2 ? 0.55 : -0.55),
  z: 17,
  top: 0.46,
  yaw: 0,
}));
export const CAMP_BENCHES = [
  [16, 17, Math.PI],
  [20, 17, Math.PI],
] as const;

/** Reused by rendered characters and deterministic thrown-object collision. */
export function explorationColliders(): Collider[] {
  return [
    ...OVERLOOK_STEPS.map((s) => ({
      ...box(s.x, s.z, s.width, s.depth),
      top: s.top,
    })),
    { ...box(-35.75, 10.5, 2.1, 4), top: 3.06 },
    ...HOP_ROCKS.map((r) => ({ ...circle(r.x, r.z, r.r), top: r.top })),
    ...CAMP_BENCHES.map(([x, z, rotation]) => ({
      ...box(x, z, 3.1, 0.7, rotation),
      top: 0.78,
    })),
    ...[14.8, 21.2].flatMap((x) => [13, 17].map((z) => circle(x, z, 0.085))),
    ...[-20.7, -16.3].map((x) => circle(x, -29.5, 0.32)),
    { ...circle(TRAY.x, TRAY.z, TRAY.radius), top: TRAY.y },
  ];
}
