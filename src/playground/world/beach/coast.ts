/**
 * The one definition of where the land stops.
 *
 * Terrain height, water depth, distance to the waterline and the direction
 * toward land all come from the functions below, and nothing else draws its
 * own shoreline. The terrain mesh evaluates them per vertex; the ocean and the
 * wet sand read them from `bakeCoastField`, a texture baked from the same
 * functions. When the sand, the foam and the water each kept a coastline of
 * their own, the seams between them were exactly where the eye looks.
 *
 * Pure arithmetic, no three.js: the property that matters most — the walkable
 * plaza stays flat at y=0, so people, the AI Controller and the renderer
 * agree on where feet are — is a test, not a hope.
 *
 * Layout: the plaza sits on the tip of a sandy point. Open sea lies north (the
 * spawn faces it), the coast bends back south on both sides, and dunes rise
 * behind the spawn.
 */
import { boundaryHeight } from "../openAir/layout";
import { WORLD_RADIUS } from "../worldMath";

/** Calm-water level. The walkable plaza is at 0; the sea sits below its edge. */
export const SEA_LEVEL = -0.8;
/** Everything within this radius is flat ground at y=0 (walk limit + margin). */
export const FLAT_RADIUS = WORLD_RADIUS + 0.6;
/** Width of the dry berm slope, waterline → plaza height, in metres. */
export const BEACH_WIDTH = 7.5;

/**
 * The waterline as z at a given x: open sea is `z < shoreZ(x)`.
 *
 * Two incommensurate sines keep it from reading as a drawn curve; the
 * quadratic bends the coast south so the sea wraps both sides of the point.
 */
export function shoreZ(x: number): number {
  return (
    -(34 + 2.2 * Math.sin(0.09 * x + 0.6) + 1.3 * Math.sin(0.21 * x + 2.1)) +
    0.0055 * x * x -
    3.8 * Math.exp(-(((x + 18) / 5) ** 2))
  );
}

function shoreSlope(x: number): number {
  return (
    -(
      2.2 * 0.09 * Math.cos(0.09 * x + 0.6) +
      1.3 * 0.21 * Math.cos(0.21 * x + 2.1)
    ) +
    0.011 * x +
    ((3.8 * 2 * (x + 18)) / 25) * Math.exp(-(((x + 18) / 5) ** 2))
  );
}

/**
 * Signed distance to the waterline in metres: positive on land, negative at
 * sea. First-order (implicit function over its gradient) — exact enough for a
 * coast that bends over tens of metres, and cheap enough to bake.
 */
export function shoreDistance(x: number, z: number): number {
  const slope = shoreSlope(x);
  return (z - shoreZ(x)) / Math.sqrt(1 + slope * slope);
}

/** Unit direction toward land (the way breaking waves travel), as [x, z]. */
export function landward(x: number): [number, number] {
  const slope = shoreSlope(x);
  const length = Math.sqrt(1 + slope * slope);
  return [-slope / length, 1 / length];
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** Deterministic value noise in [0, 1] — dunes must look the same for everyone. */
function hash(ix: number, iz: number): number {
  const s = Math.sin(ix * 127.1 + iz * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

function valueNoise(x: number, z: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx);
  const uz = fz * fz * (3 - 2 * fz);
  const a = hash(ix, iz);
  const b = hash(ix + 1, iz);
  const c = hash(ix, iz + 1);
  const d = hash(ix + 1, iz + 1);
  return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
}

/** Beach profile by distance from the waterline alone. */
export function profileHeight(distance: number): number {
  if (distance >= 0) {
    // Flat at the waterline (the swash zone), steepest mid-berm, flat on top.
    return SEA_LEVEL * (1 - smoothstep(0, BEACH_WIDTH, distance));
  }
  const out = -distance;
  // A wide turquoise shelf first, then the drop to blue water.
  const shelf = SEA_LEVEL - 0.065 * Math.min(out, 26);
  const drop = Math.max(0, out - 26);
  return Math.max(-22, shelf - 0.32 * drop);
}

/**
 * Ground height anywhere in the World.
 *
 * Inside FLAT_RADIUS it is exactly 0, whatever the coast does: sand ripples
 * there are normal-mapped, not modelled. Dunes start beyond it, inland only.
 */
export function terrainHeight(x: number, z: number): number {
  const radius = Math.hypot(x, z);
  if (radius <= FLAT_RADIUS) return 0;
  const distance = shoreDistance(x, z);
  let height = profileHeight(distance);
  // A shallow basin carved into the same terrain sampled by the water shader.
  const pool = Math.hypot(x + 19, z + 30);
  if (pool < 2.4)
    height = Math.min(
      height,
      SEA_LEVEL - 0.14 * (1 - smoothstep(1.5, 2.4, pool)),
    );
  if (distance > BEACH_WIDTH) {
    // Dunes: only on dry land, rising away from the plaza edge.
    const inland = smoothstep(BEACH_WIDTH, BEACH_WIDTH + 14, distance);
    const away = smoothstep(FLAT_RADIUS, FLAT_RADIUS + 16, radius);
    const dunes =
      valueNoise(x * 0.045, z * 0.045) * 3.2 +
      valueNoise(x * 0.12 + 7, z * 0.12 - 3) * 0.9;
    height += dunes * inland * away;
  }
  // Blend the edge of the flat disc so there is no step at FLAT_RADIUS.
  const edge = smoothstep(FLAT_RADIUS, FLAT_RADIUS + 3, radius);
  return height * edge + boundaryHeight(x, z);
}

/** Deepest water people wade into: about knee to thigh height. */
export const WADE_DEPTH = 0.7;
/** How far inland from the waterline the walkable beach runs. */
export const BEACH_WALK_BAND = 20;
/** Walking stays well inside the transform limits every client accepts (±64). */
export const WALK_EXTENT = 60;

/**
 * Where people may walk: the plaza disc, plus the beach from the dunes'
 * foot down into the shallows, along the coast in both directions.
 */
export function beachWalkable(x: number, z: number, tide = 0): boolean {
  if (Math.hypot(x, z) < WORLD_RADIUS) return true;
  if (Math.abs(x) > WALK_EXTENT || Math.abs(z) > WALK_EXTENT) return false;
  if (Math.abs(x) > 54 || z > 54 || boundaryHeight(x, z) > 3.5) return false;
  return SEA_LEVEL + tide - terrainHeight(x, z) <= WADE_DEPTH;
}

/** Still-water depth above the ground at a point (negative on dry land). */
export function waterDepth(x: number, z: number): number {
  return SEA_LEVEL - terrainHeight(x, z);
}

/**
 * A baked view of the coast for the GPU: per texel, ground height, signed
 * shore distance and the landward direction. RGBA float, row-major, +x right,
 * +z down the rows.
 */
export interface CoastField {
  size: number;
  /** World-space width covered by the field, centred on the origin. */
  extent: number;
  data: Float32Array;
}

export function bakeCoastField(size = 256, extent = 240): CoastField {
  const data = new Float32Array(size * size * 4);
  for (let row = 0; row < size; row += 1) {
    const z = ((row + 0.5) / size - 0.5) * extent;
    for (let column = 0; column < size; column += 1) {
      const x = ((column + 0.5) / size - 0.5) * extent;
      const index = (row * size + column) * 4;
      const [lx, lz] = landward(x);
      data[index] = terrainHeight(x, z);
      data[index + 1] = shoreDistance(x, z);
      data[index + 2] = lx;
      data[index + 3] = lz;
    }
  }
  return { size, extent, data };
}
