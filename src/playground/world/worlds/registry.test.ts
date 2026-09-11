import { describe, expect, it } from "vitest";

import { WORLDS, resolveOpenableWorld, worldDefinition } from "./index";
import { DEFAULT_WORLD_ID, WORLD_IDS, isWorldId, worldIdOr } from "../types";

describe("the World registry", () => {
  it("has a definition for every declared World id, and no strays", () => {
    // The ids are also ato-api's allowlist. A World in one list and not the
    // other is a room somebody can be routed into and never rendered.
    expect(WORLDS.map((world) => world.id).sort()).toEqual([...WORLD_IDS].sort());
  });

  it("numbers them 01–08 without gaps or repeats", () => {
    expect(WORLDS.map((world) => world.index)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("gives every World a name and a reason to go there", () => {
    for (const world of WORLDS) {
      expect(world.name).toMatch(/^[A-Z ]+$/);
      expect(world.tagline.length).toBeGreaterThan(0);
    }
  });

  it("spawns everybody inside their World, not on its boundary", () => {
    for (const world of WORLDS) {
      expect(Math.hypot(world.spawn.x, world.spawn.z)).toBeLessThan(22);
    }
  });

  it("opens Central Plaza by default", () => {
    expect(DEFAULT_WORLD_ID).toBe("central-plaza");
    expect(worldDefinition(DEFAULT_WORLD_ID).available).toBe(true);
  });
});

describe("entering a World", () => {
  it("falls back to the default rather than mounting an unbuilt World", () => {
    // The seven stubs throw from `build()` on purpose. Routing must never
    // reach that throw: an unavailable World resolves to the plaza instead.
    const unbuilt = WORLDS.filter((world) => !world.available);
    expect(unbuilt.length).toBeGreaterThan(0);
    for (const world of unbuilt) {
      expect(resolveOpenableWorld(world.id).id).toBe(DEFAULT_WORLD_ID);
    }
  });

  it("opens an available World as itself", () => {
    expect(resolveOpenableWorld("central-plaza").id).toBe("central-plaza");
  });
});

describe("world ids from the wire", () => {
  it("accepts the eight and rejects anything else", () => {
    expect(isWorldId("market")).toBe(true);
    expect(isWorldId("atlantis")).toBe(false);
    expect(isWorldId(undefined)).toBe(false);
  });

  it("reads an absent or unknown World as the default", () => {
    // Deliberately forgiving where the server is strict: the server REFUSES
    // an unknown id, so anything reaching a client has already been checked.
    // Dropping the person would make them invisible for no further safety.
    expect(worldIdOr(undefined)).toBe(DEFAULT_WORLD_ID);
    expect(worldIdOr("atlantis")).toBe(DEFAULT_WORLD_ID);
    expect(worldIdOr("campfire")).toBe("campfire");
  });

  it("can fall back to a caller-supplied World", () => {
    expect(worldIdOr(undefined, "meadow")).toBe("meadow");
  });
});
