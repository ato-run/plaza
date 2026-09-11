/**
 * 06 — MEADOW.
 *
 * The open one: few obstacles, hills for the horizon, the baseline for mobile performance.
 *
 * REGISTERED BUT NOT BUILT YET. It appears in the World Selector — the eight
 * places are the product's shape, and showing only the finished one would make
 * the first look like the whole thing — but it cannot be entered, and
 * `available: false` is what the selector reads to say so.
 *
 * The build order is deliberate (Plaza → Market → Campfire → Meadow →
 * Stargazing → Lookout → Ruins → Treehouse): the first three prove that the
 * Worlds differ in why people gather, not merely in their scenery, before the
 * remaining five are worth building.
 */
import type { WorldDefinition, WorldRuntime } from "../types";

export const meadow: WorldDefinition = {
  id: "meadow",
  name: "MEADOW",
  index: 6,
  tagline: "とりあえず歩き回る。",
  spawn: { x: 0, y: 0, z: 12, yaw: 0 },
  environment: {
    background: "#d6e7bd",
    fog: "#d6e7bd",
    fogNear: 34,
    fogFar: 96,
  },
  available: false,

  build(): WorldRuntime {
    // Unreachable while `available` is false; the engine refuses to mount an
    // unavailable World. Throwing rather than returning an empty room means a
    // future routing bug surfaces as an error instead of dropping somebody
    // into a featureless void with no way to tell it apart from a load
    // failure.
    throw new Error("world_not_built");
  },
};
