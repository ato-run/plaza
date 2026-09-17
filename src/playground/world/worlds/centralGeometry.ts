/** Shared by the renderer and the headless Controller. No scene graph or DOM. */
import { circle } from "../collision";

export const FOUNTAIN_RADIUS = 3.2;
export const CENTRAL_TREES = [
  [-9, -7, 1.3],
  [10, -9, 1.4],
  [-13, 2, 1.3],
  [13, 4, 1.5],
  [-7, -16, 1.7],
  [6, -18, 1.5],
  [-18, -10, 1.8],
  [18, -13, 1.7],
  [-17, 13, 1.4],
  [17, 16, 1.3],
  [-3, 21, 1.4],
] as const;
export const CENTRAL_PLANTERS = [
  [-9.5, 4],
  [9.5, 4],
  [0, 13],
] as const;
export const CENTRAL_BENCHES = [
  [0, 6.6, Math.PI],
  [6.6, 0, -Math.PI / 2],
  [-6.6, 0, Math.PI / 2],
  [0, -6.6, 0],
] as const;
export const CENTRAL_LANTERNS = [
  [-9, 9],
  [9, 9],
  [-9, -9],
  [9, -9],
  [0, 17],
] as const;
export const CENTRAL_MASCOTS = [
  {
    id: "cat",
    name: "ミケ",
    species: "cat" as const,
    x: -5.4,
    z: 4.6,
    yaw: 2.4,
  },
  {
    id: "dog",
    name: "ソラ",
    species: "dog" as const,
    x: 3.9,
    z: 4.2,
    yaw: -2.6,
  },
  {
    id: "panda",
    name: "モモ",
    species: "panda" as const,
    x: -2.2,
    z: -9.4,
    yaw: 0.4,
  },
] as const;

export function centralColliders() {
  return [
    circle(0, 0, FOUNTAIN_RADIUS + 0.1),
    ...CENTRAL_TREES.map(([x, z]) => circle(x, z, 0.5)),
    ...CENTRAL_PLANTERS.map(([x, z]) => circle(x, z, 1.6)),
    ...CENTRAL_BENCHES.map(([x, z]) => circle(x, z, 1.5)),
    ...CENTRAL_LANTERNS.map(([x, z]) => circle(x, z, 0.3)),
    ...CENTRAL_MASCOTS.map(({ x, z }) => circle(x, z, 0.45)),
  ];
}

export const CENTRAL_SOFTWARE_SLOTS = [
  { id: "plaza-01", x: -6.4, z: -12.6 },
  { id: "plaza-02", x: 0, z: -13.4 },
  { id: "plaza-03", x: 6.4, z: -12.6 },
  { id: "plaza-04", x: -12.4, z: -8.2, rotation: 0.6 },
  { id: "plaza-05", x: 12.4, z: -8.2, rotation: -0.6 },
];
export const EXHIBIT_OBSTACLE_RADIUS = 1.8;
