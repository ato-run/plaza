import { describe, it, expect } from "vitest";
import {
  emptyOpenAir,
  applyOpenAir,
  heldItem,
  activeLease,
  itemPosition,
  ITEMS,
  restoreOpenAir,
  isOpenAirAction,
} from "./model";
import { worldMoment, DAY_MS } from "./clock";
import { boundaryHeight, landmarkGround, OVERLOOK_STEPS } from "./layout";
import { beachWalkable } from "../beach/coast";
import { centralColliders, CENTRAL_BENCHES } from "../worlds/centralGeometry";
import {
  isPositionValid,
  overlaps,
  resolveMovement,
  blockingColliders,
} from "../collision";
const item = ITEMS[0],
  at = DAY_MS * 100;
describe("ordered shared exploration", () => {
  it("three clients converge when two people pick the same object", () => {
    const events = [
      {
        actor: "a",
        action: { kind: "take", id: item.id, x: item.x, z: item.z },
      },
      {
        actor: "b",
        action: { kind: "take", id: item.id, x: item.x, z: item.z },
      },
      { actor: "c", action: { kind: "take", id: item.id, x: 0, z: 0 } },
    ];
    const clients = Array.from({ length: 3 }, () => emptyOpenAir());
    events.forEach((e, i) =>
      clients.forEach(
        (s, j) =>
          (clients[j] = applyOpenAir(s, i + 1, e.actor, at + i, e.action)),
      ),
    );
    expect(clients[0]).toEqual(clients[1]);
    expect(clients[2]).toEqual(clients[0]);
    expect(heldItem(clients[0], "a", at + 10)).toBe(item.id);
    expect(heldItem(clients[0], "b", at + 10)).toBeUndefined();
  });
  it("cannot release someone else’s item; a duplicate event is a no-op", () => {
    const picked = applyOpenAir(emptyOpenAir(), 1, "a", at, {
      kind: "take",
      id: item.id,
      x: item.x,
      z: item.z,
    });
    const stolen = applyOpenAir(picked, 2, "b", at + 1, {
      kind: "place",
      id: item.id,
      x: 0,
      z: 0,
      vx: 0,
      vz: 0,
    });
    expect(stolen.objects[item.id].owner).toBe("a");
    expect(
      applyOpenAir(stolen, 2, "a", at + 1, {
        kind: "place",
        id: item.id,
        x: 0,
        z: 0,
        vx: 0,
        vz: 0,
      }),
    ).toBe(stolen);
  });
  it("limits inventory to one item, validates reach, expires disconnected holders", () => {
    let state = applyOpenAir(emptyOpenAir(), 1, "a", at, {
      kind: "take",
      id: item.id,
      x: item.x,
      z: item.z,
    });
    const other = ITEMS[1];
    state = applyOpenAir(state, 2, "a", at + 1, {
      kind: "take",
      id: other.id,
      x: other.x,
      z: other.z,
    });
    expect(heldItem(state, "a", at)).toBe(item.id);
    state = applyOpenAir(state, 3, "b", at + 90001, {
      kind: "take",
      id: item.id,
      x: item.x,
      z: item.z,
    });
    expect(heldItem(state, "b", at + 90002)).toBe(item.id);
  });
  it("keeps resident leases exclusive and renewable; close and disconnect release them", () => {
    let state = applyOpenAir(emptyOpenAir(), 1, "a", at, {
      kind: "lease",
      id: "fox",
      x: 3,
      z: 4,
    });
    state = applyOpenAir(state, 2, "b", at + 1, {
      kind: "lease",
      id: "fox",
      x: 9,
      z: 9,
    });
    expect(activeLease(state, "fox", at + 2)?.owner).toBe("a");
    state = applyOpenAir(state, 3, "a", at + 10000, {
      kind: "lease",
      id: "fox",
      x: 5,
      z: 5,
      goal: "pools",
    });
    expect(state.leases.fox?.startedAt).toBe(at + 10000);
    state = applyOpenAir(state, 4, "a", at + 20000, {
      kind: "lease",
      id: "fox",
      x: 5,
      z: 5,
    });
    expect(state.leases.fox?.startedAt).toBe(at + 20000);
    expect(state.leases.fox?.x).toBe(5);
    expect(activeLease(state, "fox", at + 50001)).toBeUndefined();
    state = applyOpenAir(state, 5, "a", at + 22000, {
      kind: "release",
      id: "fox",
    });
    expect(state.leases.fox).toBeUndefined();
  });
  it("checkpoint + suffix is identical to an uninterrupted client", () => {
    let state = applyOpenAir(emptyOpenAir(), 1, "a", at, {
      kind: "take",
      id: item.id,
      x: item.x,
      z: item.z,
    });
    const restored = restoreOpenAir(JSON.parse(JSON.stringify(state)));
    const action = {
      kind: "throw",
      id: item.id,
      x: item.x,
      z: item.z,
      vx: 2,
      vz: 0,
    };
    state = applyOpenAir(state, 2, "a", at + 1, action);
    const joined = applyOpenAir(restored, 2, "a", at + 1, action);
    expect(joined).toEqual(state);
    expect(itemPosition(item, joined.objects[item.id], at + 400)).toEqual(
      itemPosition(item, state.objects[item.id], at + 400),
    );
  });
  it("bounds untrusted objects, IDs, coordinates and velocities", () => {
    for (const action of [
      { kind: "take", id: "unknown", x: 0, z: 0 },
      { kind: "take", id: item.id, x: NaN, z: 0 },
      { kind: "throw", id: item.id, x: 0, z: 0, vx: 999, vz: 0 },
      { kind: "lease", id: "dragon", x: 0, z: 0 },
      { kind: "lease", id: "fox", x: 0, z: 0, goal: "admin" },
    ])
      expect(isOpenAirAction(action)).toBe(false);
    expect(
      restoreOpenAir({
        v: 1,
        cursor: 0,
        objects: { unknown: {} },
        leases: {},
        encounters: {},
        observations: {},
      }).objects,
    ).toEqual({});
  });
  it("remembers actual reactions, not conversation text", () => {
    let state = emptyOpenAir();
    for (let i = 1; i < 8; i++)
      state = applyOpenAir(state, i, "a", at + i, {
        kind: "react",
        id: "owl",
        emoji: "👋",
        x: 0,
        z: 0,
      });
    expect(state.encounters.a).toHaveLength(4);
    expect(JSON.stringify(state)).not.toContain("message");
  });
  it("floating objects and sinking objects agree with water depth", () => {
    const saved = { owner: null, at, x: 0, z: -44, vx: 0, vz: 0 };
    const wood = ITEMS.find((i) => i.kind === "wood")!,
      stone = ITEMS.find((i) => i.kind === "stone")!;
    expect(itemPosition(wood, saved, at + 1000).y).toBeGreaterThan(
      itemPosition(stone, saved, at + 1000).y,
    );
  });
});
describe("shared clock and continuous terrain", () => {
  it("does not take a personal lighting setting as input", () => {
    expect(worldMoment(at)).toEqual(worldMoment(at));
    expect(worldMoment(at + DAY_MS * 0.7).phase).toBe("night");
    expect(worldMoment(at + DAY_MS * 0.6).phase).toBe("sunset");
  });
  it("exposes dunes while a visible perimeter stays inside the wire bounds", () => {
    expect(beachWalkable(0, 45)).toBe(true);
    expect(boundaryHeight(0, 54)).toBeGreaterThan(3.5);
    expect(beachWalkable(0, 56)).toBe(false);
  });
  it("opens the initial line to the fountain and accurately bounds benches", () => {
    const colliders = centralColliders();
    for (let z = 11; z > 4; z -= 0.2)
      expect(isPositionValid(0, z, colliders)).toBe(true);
    const bench = colliders.find(
      (c) => c.x === CENTRAL_BENCHES[0][0] && c.z === CENTRAL_BENCHES[0][1],
    )!;
    expect(bench.shape).toBe("box");
    expect(overlaps(bench, bench.x, bench.z + 1.2, 0.25)).toBe(false);
  });
  it("allows small steps while preserving taller jump obstacles", () => {
    const step = OVERLOOK_STEPS[0];
    expect(landmarkGround(step.x, step.z, 0)).toBe(step.top);
    expect(blockingColliders([{ shape: "box", ...step }], 0.24)).toHaveLength(
      0,
    );
    expect(
      blockingColliders(
        [{ shape: "circle", x: 0, z: 0, r: 1, top: 0.78 }],
        0.24,
      ),
    ).toHaveLength(1);
  });
  it("slides at an angle instead of freezing both movement axes", () => {
    const moved = resolveMovement({ x: 0, z: 0 }, { vx: 1, vz: 1 }, [
      { shape: "box", x: 1, z: 0, width: 0.5, depth: 2 },
    ]);
    expect(moved.x).toBe(0);
    expect(moved.z).toBe(1);
  });
});

describe("delivery and replay safety", () => {
  it("requires the real held shell and an owned nearby conversation to deliver", () => {
    let state = applyOpenAir(emptyOpenAir(), 1, "a", at, {
      kind: "take",
      id: "keepsake",
      x: -19,
      z: -28,
    });
    state = applyOpenAir(state, 2, "a", at + 1, {
      kind: "deliver",
      id: "owl",
      x: -19,
      z: -28,
    });
    expect(state.observations.a).toBeUndefined();
    state = applyOpenAir(state, 3, "a", at + 2, {
      kind: "lease",
      id: "owl",
      x: -19,
      z: -25,
    });
    const stolen = applyOpenAir(state, 4, "b", at + 3, {
      kind: "deliver",
      id: "owl",
      x: -19,
      z: -25,
    });
    expect(stolen.objects.keepsake.owner).toBe("a");
    const delivered = applyOpenAir(stolen, 5, "a", at + 4, {
      kind: "deliver",
      id: "owl",
      x: -19,
      z: -25,
    });
    expect(delivered.objects.keepsake.owner).toBeNull();
    expect(delivered.observations.a).toContain("keepsake");
    expect(delivered.encounters.a[0].kind).toBe("returned my shell");
  });
  it("sweeps thrown objects against props, including after a late join", () => {
    const stone = ITEMS.find((i) => i.kind === "stone")!,
      saved = { owner: null, at, x: 0, z: 5, vx: 0, vz: -6 };
    const end = itemPosition(stone, saved, at + 2000);
    expect(Math.hypot(end.x, end.z)).toBeGreaterThan(1.25);
    expect(end.y).toBeCloseTo(0.7);
    expect(itemPosition(stone, { ...saved }, at + 2000)).toEqual(end);
  });
  it("rejects a corrupt escort clock and keeps overlapping leases apart", () => {
    const state = applyOpenAir(emptyOpenAir(), 1, "a", at, {
      kind: "lease",
      id: "fox",
      x: 3,
      z: 4,
    });
    const collided = applyOpenAir(state, 2, "b", at + 1, {
      kind: "lease",
      id: "owl",
      x: 3,
      z: 4,
    });
    expect(collided.leases.owl).toBeUndefined();
    expect(
      restoreOpenAir({
        ...state,
        leases: { fox: { ...state.leases.fox, startedAt: NaN } },
      }).leases.fox,
    ).toBeUndefined();
  });
  it("a rising tide changes the shallow boundary and still leaves an inland route", () => {
    expect(beachWalkable(13, -44, -0.18)).toBe(true);
    expect(beachWalkable(13, -44, 0.18)).toBe(false);
    expect(beachWalkable(13, -33, 0.18)).toBe(true);
  });
});

it("orders shared seats and restores them without letting another visitor evict the occupant", () => {
  let state = applyOpenAir(emptyOpenAir(), 1, "a", at, {
    kind: "seat",
    id: "camp-seat-0",
    x: 15.45,
    z: 17,
  });
  state = applyOpenAir(state, 2, "b", at + 1, {
    kind: "seat",
    id: "camp-seat-0",
    x: 15.45,
    z: 17,
  });
  expect(state.seats["camp-seat-0"].owner).toBe("a");
  state = applyOpenAir(state, 3, "b", at + 2, {
    kind: "stand",
    id: "camp-seat-0",
  });
  expect(state.seats["camp-seat-0"].owner).toBe("a");
  expect(restoreOpenAir(state).seats).toEqual(state.seats);
  state = applyOpenAir(state, 4, "a", at + 3, {
    kind: "stand",
    id: "camp-seat-0",
  });
  expect(state.seats).toEqual({});
});
