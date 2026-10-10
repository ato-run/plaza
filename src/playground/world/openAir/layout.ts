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
export const LOOKOUT_ROCKS = Array.from({ length: 8 }, (_, i) => ({
  x: -23.5 - i * 1.6,
  z: 13.4 - i * 0.38,
  r: 0.8,
  top: 0.3 + i * 0.38,
}));
export const CANOPY = { x: 18, z: 16, width: 9.4, depth: 7, y: 2.8 };
export const CANOPY_POLES = [13.3, 22.7].flatMap((x) =>
  [12.5, 19.5].map((z) => ({ x, z })),
);
export function roofHeight(x: number, z: number, repairs = 0): number | null {
  const dx = x - CANOPY.x,
    dz = z - CANOPY.z;
  if (Math.abs(dx) >= CANOPY.width / 2 || Math.abs(dz) >= CANOPY.depth / 2)
    return null;
  return (
    CANOPY.y +
    0.35 * Math.cos(((dx / (CANOPY.width / 2)) * Math.PI) / 2) -
    (repairs >= 2 ? 0 : 0.17 * Math.max(0, 1 - Math.abs(dx) / 4))
  );
}
export function sheltered(
  x: number,
  y: number,
  z: number,
  repairs = 0,
): boolean {
  const roof = roofHeight(x, z, repairs);
  return roof !== null && y < roof;
}
export const HOP_ROCKS = Array.from({ length: 7 }, (_, i) => ({
  x: 12.8 + i * 1.42,
  z: -42.6 - (i % 2) * 0.5,
  r: i < 3 ? 0.82 : 0.62,
  top: -0.72 + (i % 3) * 0.17,
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
  for (const rock of [...HOP_ROCKS, ...LOOKOUT_ROCKS])
    if (Math.hypot(x - rock.x, z - rock.z) < rock.r + 0.1)
      height = Math.max(height, rock.top);
  if (x > 20 && x < 24 && z > -46 && z < -23) height = Math.max(height, 0.25);
  const trayDistance = Math.hypot(x - TRAY.x, z - TRAY.z);
  if (trayDistance < TRAY.radius + 1)
    height = Math.max(
      height,
      base +
        (TRAY.y - base) *
          Math.max(0, Math.min(1, TRAY.radius + 1 - trayDistance)),
    );
  return height;
}
/** A visible perimeter dune wall, safely inside the network transform limits. */
export function boundaryHeight(x: number, z: number): number {
  const edge = Math.max(Math.abs(x), z);
  return edge < 48
    ? 0
    : Math.pow(Math.min(1, (edge - 48) / 7), 2) *
        (8 + 1.4 * Math.sin(x * 0.16) + 0.8 * Math.cos(z * 0.2));
}

export const CAMP_SEATS = Array.from({ length: 4 }, (_, i) => ({
  id: `camp-seat-${i}`,
  x: (i < 2 ? 16 : 20) + (i % 2 ? 0.55 : -0.55),
  z: 15.8,
  top: 0.46,
  yaw: 0,
}));
export const CAMP_BENCHES = [
  [16, 15.8, Math.PI],
  [20, 15.8, Math.PI],
] as const;

/** Reused by rendered characters and deterministic thrown-object collision. */
export function explorationColliders(): Collider[] {
  return [
    ...OVERLOOK_STEPS.map((s) => ({
      ...box(s.x, s.z, s.width, s.depth),
      top: s.top,
    })),
    { ...box(-35.75, 10.5, 2.1, 4), top: 3.06 },
    ...[...HOP_ROCKS, ...LOOKOUT_ROCKS].map((r) => ({
      ...circle(r.x, r.z, r.r),
      top: r.top,
    })),
    ...CAMP_BENCHES.map(([x, z, rotation]) => ({
      ...box(x, z, 3.1, 0.7, rotation),
      top: 0.78,
    })),
    ...CANOPY_POLES.map(({ x, z }) => circle(x, z, 0.085)),
    ...[-20.7, -16.3].map((x) => circle(x, -29.5, 0.32)),
    { ...circle(TRAY.x, TRAY.z, TRAY.radius), top: TRAY.y },
  ];
}
