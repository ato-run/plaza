/**
 * What a World is, and what the engine promises it.
 *
 * Playground is ONE runtime with eight places in it. Presence, chat,
 * reactions and Software interaction are shared machinery; a World supplies
 * only scenery, colliders, interactables and an optional per-frame update. It
 * owns no socket, no camera and no input — if a World could reach those, the
 * eight of them would drift into eight applications, which is the outcome
 * this boundary exists to prevent.
 *
 * Exactly one World is in the scene at a time. Switching disposes the current
 * World's `Group` and builds the next, so eight Worlds cost what one costs —
 * the point of the exercise on a phone.
 */
import type * as THREE from "three";

import type { Collider } from "./collision";
import type { SoftwareSlot } from "./exhibit";
import type { WorldBuilder } from "./primitives";

/**
 * The Worlds this Playground hosts.
 *
 * Mirrors ato-api's `services/lobby/world.ts` allowlist EXACTLY. A World id is
 * a routing key on the server — it decides who sees whom — so the two lists
 * disagreeing would put people in a room nobody else can reach.
 */
export const WORLD_IDS = [
  "central-plaza",
  "market",
  "campfire",
  "treehouse",
  "lookout",
  "meadow",
  "ruins",
  "stargazing",
] as const;

export type WorldId = (typeof WORLD_IDS)[number];

/** Where everybody starts, and where an unrecognised id resolves to. */
export const DEFAULT_WORLD_ID: WorldId = "central-plaza";

export function isWorldId(value: unknown): value is WorldId {
  return (
    typeof value === "string" && (WORLD_IDS as readonly string[]).includes(value)
  );
}

/**
 * A World id from the wire, or the default.
 *
 * Deliberately forgiving where the server is strict. The server REFUSES an
 * unrecognised id, because accepting one would silently create a room only
 * its sender inhabits. A client receiving one has already been overruled by
 * that check, so the only useful thing left is to render the person somewhere
 * rather than drop them on the floor.
 */
export function worldIdOr(value: unknown, fallback: WorldId = DEFAULT_WORLD_ID): WorldId {
  return isWorldId(value) ? value : fallback;
}

/** Standing, sitting on something the World provided, or crouching on your own. */
export type Pose = "stand" | "sit" | "crouch";

export interface WorldSpawn {
  x: number;
  y: number;
  z: number;
  yaw: number;
}

export interface WorldEnvironment {
  background: string;
  fog: string;
  fogNear: number;
  fogFar: number;
}

/**
 * Something the crosshair can find.
 *
 * `anchor` is what must be centred — a head or a sign, never a pair of feet,
 * because aiming at the middle of a person is what a player expects to work.
 */
export interface Interactable {
  kind: "software" | "mascot" | "seat";
  /** Stable within a World; used as the target-change key. */
  id: string;
  title: string;
  anchor: THREE.Vector3;
  /** Overrides the default reach when a thing should be readable from afar. */
  maxDistance?: number;
  /** Extra payload the page needs — e.g. which card a plinth shows. */
  meta?: Record<string, string>;
  /**
   * Purely local behaviour, run on interact.
   *
   * A mascot speaking and a bench being sat on happen entirely inside the
   * World; nothing leaves the browser. Software has no `activate` because
   * opening an App is the page's flow, not the World's — keeping that
   * distinction here is what stops a World from growing its own navigation.
   */
  activate?: () => void;
}

/**
 * The handles a World is given at build time.
 *
 * `root` is the only place a World may add anything: the engine removes and
 * disposes that Group on switch, so an object parented anywhere else is a
 * leak that survives into the next World.
 */
export interface WorldBuildContext {
  root: THREE.Group;
  /**
   * Build everything through this. The engine owns it and disposes it after
   * the World's own `dispose()`, so a World never has to remember which of
   * its geometries and materials were shared — and cannot dispose the same
   * subtree twice by keeping a second builder of its own.
   */
  builder: WorldBuilder;
  /** For DOM overlays (mascot name tags), positioned by the engine. */
  labelHost: HTMLElement;
  /** Honour it: an idle animation that ignores this is an accessibility bug. */
  reducedMotion: boolean;
}

export interface WorldRuntime {
  colliders: Collider[];
  /**
   * Fixed things the crosshair can find — mascots, seats. Software is NOT
   * here: it arrives from the server and is placed into `softwareSlots`.
   */
  interactables: Interactable[];
  /**
   * Where this World is willing to put Software, in its own idiom — plinths
   * round a plaza, stalls down a market aisle.
   *
   * Slots rather than exhibits because the World knows the furniture and the
   * server knows the content. A World that embedded a card would keep
   * advertising an App after it stopped being public.
   */
  softwareSlots?: SoftwareSlot[];
  /** Floor height at a point. Absent means flat ground at y=0. */
  groundY?: (x: number, z: number) => number;
  update?: (dt: number, now: number) => void;
  dispose(): void;
}

export interface WorldDefinition {
  id: WorldId;
  /** Shown in the HUD, uppercase — "CENTRAL PLAZA". */
  name: string;
  /** 1-based, shown as `01`…`08`. */
  index: number;
  /** One line in the selector: why you would go there. */
  tagline: string;
  spawn: WorldSpawn;
  environment: WorldEnvironment;
  /**
   * False while a World is registered but not yet built. The selector shows
   * it — the eight places are the product's shape, and hiding seven of them
   * would make the first look like the whole thing — but refuses to enter.
   */
  available: boolean;
  build(context: WorldBuildContext): WorldRuntime;
}
