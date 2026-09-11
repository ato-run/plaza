/**
 * The Playground world's arithmetic, with no three.js and no DOM.
 *
 * Everything here is a pure function so the parts that decide where a person
 * ends up — movement, what the crosshair is aimed at, how a remote avatar
 * catches up to its last reported transform — can be tested directly. The
 * rendering module keeps only the code that genuinely needs a scene graph.
 *
 * Collision moved to `collision.ts` when colliders stopped being circles:
 * boxes brought their own vocabulary (shape union, rotation, nearest-point
 * test) and it earns a file rather than doubling the size of this one.
 *
 * Conventions, taken from the reference implementation and kept exactly:
 *   - Right-handed, ground at y=0, eye height 1.65.
 *   - Angles in radians. `yaw` rotates around +Y; at yaw=0 the camera looks
 *     down -Z, so pressing forward DECREASES z.
 *   - `pitch` is clamped to ±1.2 rad so nobody can look far enough to invert.
 */

export const EYE_HEIGHT = 1.65;
export const WALK_SPEED = 3.4;
export const WORLD_RADIUS = 22;
export const MAX_PITCH = 1.2;
/** Beyond this a target is out of reach even when perfectly centred. */
export const INTERACT_DISTANCE = 4.6;
/**
 * Minimum dot product between "where you look" and "where the thing is".
 * 0.94 is roughly a 20° cone — tight enough that two people standing near
 * each other do not both light up.
 */
export const TARGET_MIN_DOT = 0.94;
/** ~12Hz. The server rate-limits and coalesces; this keeps us under it. */
export const TRANSFORM_SEND_INTERVAL_MS = 83;

export interface Vec2 {
  x: number;
  z: number;
}

export type MovementState = "idle" | "walk";

/**
 * Turn held keys and joystick deflection into a world-space velocity.
 *
 * The input vector is normalized BEFORE rotation so that holding two keys
 * (or a fully deflected joystick plus a key) cannot produce a faster
 * diagonal than a straight line — the classic "strafe-running" bug.
 */
export function movementVector(
  input: { forward: number; right: number },
  yaw: number,
  dt: number,
  speed: number = WALK_SPEED,
): { vx: number; vz: number; magnitude: number } {
  let right = input.right;
  let forward = input.forward;
  const length = Math.hypot(right, forward);
  if (length > 1) {
    right /= length;
    forward /= length;
  }
  const magnitude = Math.min(length, 1);
  const vx = (right * Math.cos(yaw) - forward * Math.sin(yaw)) * dt * speed;
  const vz = (-right * Math.sin(yaw) - forward * Math.cos(yaw)) * dt * speed;
  return { vx, vz, magnitude };
}

export function clampPitch(pitch: number, limit = MAX_PITCH): number {
  if (!Number.isFinite(pitch)) return 0;
  return Math.max(-limit, Math.min(limit, pitch));
}

/**
 * Smoothing factor for exponential decay toward a target.
 *
 * Frame-rate independent on purpose: a plain `lerp(a, b, 0.2)` per frame
 * moves twice as fast at 120fps as at 60fps, so a fast machine and a slow
 * one would disagree about where a remote avatar is.
 */
export function smoothing(dt: number, rate: number): number {
  return 1 - Math.exp(-dt * rate);
}

export function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

/** Signed shortest way round from `from` to `to`, in (-π, π]. */
export function shortestAngleDelta(from: number, to: number): number {
  const difference = to - from;
  return Math.atan2(Math.sin(difference), Math.cos(difference));
}

/** Rotate `from` toward `to` the short way, frame-rate independently. */
export function approachAngle(
  from: number,
  to: number,
  dt: number,
  rate = 12,
): number {
  return from + shortestAngleDelta(from, to) * smoothing(dt, rate);
}

export interface TargetCandidate<T> {
  item: T;
  /** The point that must be centred — a head, not a pair of feet. */
  position: { x: number; y: number; z: number };
  maxDistance?: number;
}

/**
 * Pick what the crosshair is on: the best-centred candidate within reach.
 *
 * Selection is by ANGLE, not by distance, so a far-off thing you are looking
 * straight at beats a near one at the edge of vision — which is how aiming
 * at something feels like it should work.
 */
export function chooseTarget<T>(
  eye: { x: number; y: number; z: number },
  forward: { x: number; y: number; z: number },
  candidates: readonly TargetCandidate<T>[],
  minDot = TARGET_MIN_DOT,
): T | null {
  let best = minDot;
  let chosen: T | null = null;
  for (const candidate of candidates) {
    const dx = candidate.position.x - eye.x;
    const dy = candidate.position.y - eye.y;
    const dz = candidate.position.z - eye.z;
    const distance = Math.hypot(dx, dy, dz);
    const reach = candidate.maxDistance ?? INTERACT_DISTANCE;
    if (distance === 0 || distance > reach) continue;
    const dot =
      (dx / distance) * forward.x +
      (dy / distance) * forward.y +
      (dz / distance) * forward.z;
    if (dot > best) {
      best = dot;
      chosen = candidate.item;
    }
  }
  return chosen;
}

/**
 * Cadence limiter for outbound transforms.
 *
 * Sending every animation frame would be ~60Hz per person, which the server
 * would only have to throttle away; this keeps the client honest at the
 * agreed ~12Hz.
 */
export class SendCadence {
  private last = Number.NEGATIVE_INFINITY;

  constructor(private readonly intervalMs: number = TRANSFORM_SEND_INTERVAL_MS) {}

  /** True at most once per interval; records the time when it returns true. */
  due(now: number): boolean {
    if (now - this.last < this.intervalMs) return false;
    this.last = now;
    return true;
  }

  reset(): void {
    this.last = Number.NEGATIVE_INFINITY;
  }
}

/**
 * Bounds outside which a coordinate is a broken client, not a person.
 *
 * Matched to ato-api's `WORLD_HORIZONTAL_LIMIT` / `WORLD_Y_MIN` / `WORLD_Y_MAX`
 * rather than to this World's own radius. A client stricter than the server
 * would silently drop positions the server had already accepted and
 * broadcast — the peer would simply stop moving, with nothing logged anywhere.
 */
export const TRANSFORM_HORIZONTAL_LIMIT = 64;
export const TRANSFORM_Y_MIN = -1;
export const TRANSFORM_Y_MAX = 16;

export interface RemoteTransform {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  movement: MovementState;
  /** Sitting is a World affordance, not a movement. */
  pose: "stand" | "sit";
}

/**
 * Accept a transform from the wire, or reject it.
 *
 * The server validates too, but a client that trusted the wire blindly could
 * be pushed into NaN positions by a single bad frame and would then render
 * nothing at all, with no clue why. Rejecting here keeps one bad message
 * from poisoning the scene graph.
 */
export function sanitizeTransform(input: unknown): RemoteTransform | null {
  if (!input || typeof input !== "object") return null;
  const raw = input as Record<string, unknown>;
  const numbers = ["x", "y", "z", "yaw", "pitch"] as const;
  const values: Record<string, number> = {};
  for (const key of numbers) {
    const value = raw[key];
    if (typeof value !== "number" || !Number.isFinite(value)) return null;
    values[key] = value;
  }
  if (
    Math.abs(values.x) > TRANSFORM_HORIZONTAL_LIMIT ||
    Math.abs(values.z) > TRANSFORM_HORIZONTAL_LIMIT
  ) {
    return null;
  }
  if (values.y < TRANSFORM_Y_MIN || values.y > TRANSFORM_Y_MAX) return null;
  const movement = raw.movement === "walk" ? "walk" : "idle";
  // Unknown pose defaults to standing rather than rejecting the whole message:
  // a position is still useful, and a server that later adds a third pose
  // should not make everybody invisible to older clients.
  const pose = raw.pose === "sit" ? "sit" : "stand";
  return {
    x: values.x,
    y: values.y,
    z: values.z,
    yaw: values.yaw,
    pitch: clampPitch(values.pitch),
    movement,
    pose,
  };
}
