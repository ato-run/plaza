/**
 * Where every resident is at any moment — a pure function of the clock.
 *
 * Residents live like villagers: walk somewhere, stay a while (sit on a
 * bench, look at the sea, chat with whoever else is there), then go
 * somewhere else. Nothing about it is networked or stored. Each resident's
 * day is a deterministic sequence of one-minute slots seeded by their index,
 * and position is computed from wall-clock time, so every visitor sees the
 * same resident on the same bench at the same moment without a server.
 *
 * Paths come from an A* grid over the plaza's static colliders and its
 * walkable ground, smoothed by line of sight, cached per slot.
 */
import type { Collider } from "../collision";

export type SpotPose = "stand" | "sit";

export interface Spot {
  id: string;
  x: number;
  z: number;
  /** Facing while staying here, radians (camera convention: 0 looks −Z). */
  yaw: number;
  pose: SpotPose;
  /** Where to step from/to before entering the spot (benches sit inside their collider). */
  approach?: { x: number; z: number };
  /** Spots sharing a `group` are conversation partners. */
  group?: string;
}

export interface Grid {
  minX: number;
  minZ: number;
  cell: number;
  width: number;
  height: number;
  blocked: Uint8Array;
}

export function buildGrid(
  colliders: readonly Collider[],
  walkable: (x: number, z: number) => boolean,
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number },
  cell = 0.5,
  clearance = 0.4,
): Grid {
  const width = Math.ceil((bounds.maxX - bounds.minX) / cell);
  const height = Math.ceil((bounds.maxZ - bounds.minZ) / cell);
  const blocked = new Uint8Array(width * height);
  for (let row = 0; row < height; row += 1) {
    const z = bounds.minZ + (row + 0.5) * cell;
    for (let column = 0; column < width; column += 1) {
      const x = bounds.minX + (column + 0.5) * cell;
      let solid = !walkable(x, z);
      if (!solid) {
        for (const collider of colliders) {
          if (collider.shape === "circle") {
            if (Math.hypot(x - collider.x, z - collider.z) < collider.r + clearance) {
              solid = true;
              break;
            }
          } else {
            const angle = -(collider.rotation ?? 0);
            const dx = x - collider.x;
            const dz = z - collider.z;
            const lx = dx * Math.cos(angle) - dz * Math.sin(angle);
            const lz = dx * Math.sin(angle) + dz * Math.cos(angle);
            if (
              Math.abs(lx) < collider.width / 2 + clearance &&
              Math.abs(lz) < collider.depth / 2 + clearance
            ) {
              solid = true;
              break;
            }
          }
        }
      }
      blocked[row * width + column] = solid ? 1 : 0;
    }
  }
  return { minX: bounds.minX, minZ: bounds.minZ, cell, width, height, blocked };
}

const cellOf = (grid: Grid, x: number, z: number) => [
  Math.floor((x - grid.minX) / grid.cell),
  Math.floor((z - grid.minZ) / grid.cell),
];
const free = (grid: Grid, column: number, row: number) =>
  column >= 0 &&
  row >= 0 &&
  column < grid.width &&
  row < grid.height &&
  grid.blocked[row * grid.width + column] === 0;
const centre = (grid: Grid, column: number, row: number) => ({
  x: grid.minX + (column + 0.5) * grid.cell,
  z: grid.minZ + (row + 0.5) * grid.cell,
});

/** Nearest free cell to a point (spots may sit just inside a clearance). */
function nearestFree(grid: Grid, x: number, z: number): [number, number] | null {
  const [c0, r0] = cellOf(grid, x, z);
  for (let ring = 0; ring < 8; ring += 1) {
    let best: [number, number] | null = null;
    let bestDistance = Infinity;
    for (let dr = -ring; dr <= ring; dr += 1) {
      for (let dc = -ring; dc <= ring; dc += 1) {
        if (Math.max(Math.abs(dr), Math.abs(dc)) !== ring) continue;
        if (!free(grid, c0 + dc, r0 + dr)) continue;
        const point = centre(grid, c0 + dc, r0 + dr);
        const distance = Math.hypot(point.x - x, point.z - z);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = [c0 + dc, r0 + dr];
        }
      }
    }
    if (best) return best;
  }
  return null;
}

function lineClear(grid: Grid, a: { x: number; z: number }, b: { x: number; z: number }): boolean {
  const length = Math.hypot(b.x - a.x, b.z - a.z);
  const steps = Math.ceil(length / (grid.cell * 0.5));
  for (let i = 1; i < steps; i += 1) {
    const t = i / steps;
    const [column, row] = cellOf(grid, a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t);
    if (!free(grid, column, row)) return false;
  }
  return true;
}

/** A* on the grid, then shortcut by line of sight. Deterministic. */
export function findPath(
  grid: Grid,
  from: { x: number; z: number },
  to: { x: number; z: number },
): { x: number; z: number }[] {
  const start = nearestFree(grid, from.x, from.z);
  const goal = nearestFree(grid, to.x, to.z);
  if (!start || !goal) return [from, to];
  const key = (column: number, row: number) => row * grid.width + column;
  const goalKey = key(goal[0], goal[1]);
  const g = new Map<number, number>([[key(start[0], start[1]), 0]]);
  const parent = new Map<number, number>();
  const open: [number, number][] = [[0, key(start[0], start[1])]];
  const closed = new Set<number>();
  const h = (column: number, row: number) => {
    const dx = Math.abs(column - goal[0]);
    const dz = Math.abs(row - goal[1]);
    return Math.max(dx, dz) + 0.4142 * Math.min(dx, dz);
  };
  const push = (item: [number, number]) => {
    open.push(item);
    let i = open.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (open[p][0] < open[i][0] || (open[p][0] === open[i][0] && open[p][1] <= open[i][1])) break;
      [open[p], open[i]] = [open[i], open[p]];
      i = p;
    }
  };
  const pop = (): [number, number] => {
    const top = open[0];
    const last = open.pop()!;
    if (open.length > 0) {
      open[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        const less = (a: number, b: number) =>
          open[a][0] < open[b][0] || (open[a][0] === open[b][0] && open[a][1] < open[b][1]);
        if (l < open.length && less(l, m)) m = l;
        if (r < open.length && less(r, m)) m = r;
        if (m === i) break;
        [open[m], open[i]] = [open[i], open[m]];
        i = m;
      }
    }
    return top;
  };
  let found = false;
  let guard = 0;
  while (open.length > 0 && guard < 40000) {
    guard += 1;
    const [, current] = pop();
    if (current === goalKey) {
      found = true;
      break;
    }
    if (closed.has(current)) continue;
    closed.add(current);
    const column = current % grid.width;
    const row = (current - column) / grid.width;
    for (let dr = -1; dr <= 1; dr += 1) {
      for (let dc = -1; dc <= 1; dc += 1) {
        if (!dr && !dc) continue;
        const nc = column + dc;
        const nr = row + dr;
        if (!free(grid, nc, nr)) continue;
        // No cutting corners past a blocked cell.
        if (dr && dc && (!free(grid, column + dc, row) || !free(grid, column, row + dr))) continue;
        const next = key(nc, nr);
        const cost = (g.get(current) ?? 0) + (dr && dc ? 1.4142 : 1);
        if (cost < (g.get(next) ?? Infinity)) {
          g.set(next, cost);
          parent.set(next, current);
          push([cost + h(nc, nr), next]);
        }
      }
    }
  }
  if (!found) return [from, to];
  const cells: { x: number; z: number }[] = [];
  for (let at: number | undefined = goalKey; at !== undefined; at = parent.get(at)) {
    const column = at % grid.width;
    cells.push(centre(grid, column, (at - column) / grid.width));
  }
  cells.reverse();
  // String-pull: keep only the corners line of sight needs.
  const points = [from, ...cells, to];
  const smooth = [points[0]];
  let anchor = 0;
  for (let i = 2; i < points.length; i += 1) {
    if (!lineClear(grid, points[anchor], points[i])) {
      smooth.push(points[i - 1]);
      anchor = i - 1;
    }
  }
  smooth.push(points[points.length - 1]);
  return smooth;
}

export function pathLength(points: readonly { x: number; z: number }[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    total += Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z);
  }
  return total;
}

/** Deterministic hash → [0, 1). */
export function hash01(a: number, b: number): number {
  let h = (Math.imul(a | 0, 0x9e3779b1) ^ Math.imul(b | 0, 0x85ebca77)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39) >>> 0;
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

export const SLOT_SECONDS = 60;
export const WALK_SPEED = 1.15;

export interface ResidentState {
  x: number;
  z: number;
  /** Direction of travel or the spot's facing. */
  yaw: number;
  moving: boolean;
  pose: SpotPose;
  /** The spot being walked to or occupied. */
  spot: Spot;
  /** Seconds into the stay (negative while still walking). */
  stayed: number;
}

export interface Schedule {
  stateAt(resident: number, seconds: number): ResidentState;
  spotOf(resident: number, slot: number): Spot;
}

/**
 * `homes[i]` limits which spots resident i visits (an index list into
 * `spots`), so a shy resident keeps to the edges and a sociable one to the
 * benches; undefined means any.
 */
export function createSchedule(
  grid: Grid,
  spots: readonly Spot[],
  residents: number,
  homes: readonly (readonly number[] | undefined)[] = [],
): Schedule {
  const cache = new Map<string, { points: { x: number; z: number }[]; length: number }>();
  const offset = (i: number) => hash01(i, 7) * SLOT_SECONDS;
  /**
   * Which spot resident i holds in a slot — never one another resident holds
   * at the same time. Reservations go by index: resident i avoids every
   * spot that residents 0..i-1 hold during any of their slots overlapping
   * i's slot (deterministic, so every visitor resolves it the same way).
   * Spot i occupies from its slot's start (it may still be walking there)
   * until the next slot starts.
   */
  const picks = new Map<string, number>();
  const pickOf = (i: number, slot: number): number => {
    const key = `${i}:${slot}`;
    const known = picks.get(key);
    if (known !== undefined) return known;
    const pool = homes[i] ?? spots.map((_, index) => index);
    const taken = new Set<number>();
    const start = slot * SLOT_SECONDS - offset(i);
    const end = start + SLOT_SECONDS;
    for (let j = 0; j < i; j += 1) {
      const first = Math.floor((start + offset(j)) / SLOT_SECONDS);
      const last = Math.floor((end + offset(j)) / SLOT_SECONDS);
      for (let m = first; m <= last; m += 1) taken.add(pickOf(j, m));
      // Still standing at the previous spot while setting off.
      taken.add(pickOf(j, first - 1));
    }
    // (Picking the spot you already hold is allowed: you simply stay on.)
    const startAt = Math.floor(hash01(i * 131 + 3, slot) * pool.length);
    let pick = pool[startAt];
    for (let step = 0; step < pool.length; step += 1) {
      const candidate = pool[(startAt + step) % pool.length];
      if (!taken.has(candidate)) {
        pick = candidate;
        break;
      }
    }
    picks.set(key, pick);
    if (picks.size > residents * 400) picks.delete(picks.keys().next().value as string);
    return pick;
  };
  const spotOf = (i: number, slot: number): Spot => spots[pickOf(i, slot)];
  const route = (i: number, slot: number) => {
    const key = `${i}:${slot}`;
    let cached = cache.get(key);
    if (!cached) {
      const from = spotOf(i, slot - 1);
      const to = spotOf(i, slot);
      const middle = findPath(grid, from.approach ?? from, to.approach ?? to);
      const points = [
        { x: from.x, z: from.z },
        ...middle,
        { x: to.x, z: to.z },
      ].filter(
        (point, index, all) =>
          index === 0 || Math.hypot(point.x - all[index - 1].x, point.z - all[index - 1].z) > 0.01,
      );
      cached = { points, length: pathLength(points) };
      cache.set(key, cached);
      if (cache.size > residents * 4) cache.delete(cache.keys().next().value as string);
    }
    return cached;
  };

  return {
    spotOf,
    stateAt(i, seconds) {
      const local = seconds + offset(i);
      const slot = Math.floor(local / SLOT_SECONDS);
      const into = local - slot * SLOT_SECONDS;
      const { points, length } = route(i, slot);
      const to = spotOf(i, slot);
      // Long trips walk a little faster so every trip fits its slot.
      const speed = Math.max(WALK_SPEED, length / (SLOT_SECONDS * 0.7));
      let travelled = into * speed;
      if (travelled >= length) {
        return {
          x: to.x,
          z: to.z,
          yaw: to.yaw,
          moving: false,
          pose: to.pose,
          spot: to,
          stayed: into - length / speed,
        };
      }
      for (let k = 1; k < points.length; k += 1) {
        const a = points[k - 1];
        const b = points[k];
        const segment = Math.hypot(b.x - a.x, b.z - a.z);
        if (travelled <= segment || k === points.length - 1) {
          const t = segment > 0 ? Math.min(1, travelled / segment) : 1;
          return {
            x: a.x + (b.x - a.x) * t,
            z: a.z + (b.z - a.z) * t,
            yaw: Math.atan2(-(b.x - a.x), -(b.z - a.z)),
            moving: true,
            pose: "stand",
            spot: to,
            stayed: -(length - into * speed) / speed,
          };
        }
        travelled -= segment;
      }
      return { x: to.x, z: to.z, yaw: to.yaw, moving: false, pose: to.pose, spot: to, stayed: 0 };
    },
  };
}

/**
 * Push apart characters closer than `minDistance`, deterministically (fixed
 * order, fixed iterations), so two residents never stand inside each other
 * while passing. `fixed[i]` marks ones that must not move (seated, or
 * someone else's character); the other side of the pair moves the whole way.
 */
export function separate(
  points: { x: number; z: number }[],
  fixed: readonly boolean[],
  minDistance = 0.75,
  iterations = 4,
): void {
  for (let round = 0; round < iterations; round += 1) {
    for (let a = 0; a < points.length; a += 1) {
      for (let b = a + 1; b < points.length; b += 1) {
        const dx = points[b].x - points[a].x;
        const dz = points[b].z - points[a].z;
        const distance = Math.hypot(dx, dz);
        if (distance >= minDistance || (fixed[a] && fixed[b])) continue;
        let nx: number;
        let nz: number;
        if (distance < 1e-4) {
          // Exactly on top of each other: split along a direction fixed by the pair.
          const angle = hash01(a, b) * Math.PI * 2;
          nx = Math.cos(angle);
          nz = Math.sin(angle);
        } else {
          nx = dx / distance;
          nz = dz / distance;
        }
        const overlap = minDistance - distance;
        const shareA = fixed[a] ? 0 : fixed[b] ? 1 : 0.5;
        const shareB = 1 - shareA;
        points[a].x -= nx * overlap * shareA;
        points[a].z -= nz * overlap * shareA;
        points[b].x += nx * overlap * shareB;
        points[b].z += nz * overlap * shareB;
      }
    }
  }
}
