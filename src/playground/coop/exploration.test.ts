import { it, expect } from "vitest";
import {
  validateDurable,
  reduceRoomState,
  materializeCheckpoint,
} from "./adapter";
it("validates actor authority, own live presence and reach", () => {
  const context = {
    actor: false,
    principalId: "a",
    now: 10000,
    peers: [
      {
        principal_id: "a",
        display_name: "A",
        scope: "central-plaza",
        pose: {
          x: -20,
          y: 1.65,
          z: -31,
          yaw: 0,
          pitch: 0,
          movement: "idle",
          pose: "stand",
        },
        observed_at: 9999,
        consent: false,
      },
    ],
  };
  const op = {
    t: "openair",
    action: { kind: "take", id: "shell-0", x: -20, z: -31 },
  };
  expect(validateDurable(op, context)).toBeNull();
  expect(validateDurable(op, { ...context, actor: true })).toBe(
    "plaza_operation_denied",
  );
  expect(validateDurable(op, { ...context, peers: [] })).toBe(
    "plaza_presence_required",
  );
  expect(
    validateDurable({ ...op, action: { ...op.action, x: 0 } }, context),
  ).toBe("plaza_out_of_reach");
});
it("constructs the saved exploration state from commit evidence, ignoring caller claims", () => {
  const state = reduceRoomState(null, {
    seq: 1,
    actor_id: "a",
    committed_at: 1000,
    op: {
      t: "openair",
      action: { kind: "take", id: "shell-0", x: -20, z: -31 },
    },
  });
  expect(
    materializeCheckpoint(
      { v: 1, posts: [], open_air: { objects: {} } },
      state,
    ),
  ).toMatchObject({
    open_air: { objects: { "shell-0": { owner: "a", at: 1000 } } },
  });
});

it("limits NPC memory to actual recent encounters with that visitor and character", async () => {
  const { recentRoomEncounters } = await import("./adapter");
  const state = {
    v: 1,
    cursor: 1,
    objects: {},
    leases: {},
    seats: {},
    observations: {},
    encounters: {
      a: [{ id: "owl", kind: "returned my shell", x: 0, z: 0, at: 1000 }],
      b: [{ id: "owl", kind: "reacted", x: 0, z: 0, at: 1000 }],
    },
  };
  expect(recentRoomEncounters(state, "a", "owl", 2000)).toEqual([
    "returned my shell",
  ]);
  expect(recentRoomEncounters(state, "a", "fox", 2000)).toEqual([]);
  expect(recentRoomEncounters(state, "a", "owl", 1000000)).toEqual([]);
});
it("only describes a real complete gallery and removes a deleted display", async () => {
  const { roomPublicDisplayRefs } = await import("./adapter");
  const post = {
    id: "p",
    world: "central-plaza",
    app_ref: "discover-plaza",
    author_user_id: "a",
  };
  const boot = {
    checkpoint_payload: { v: 1, posts: [post] },
    checkpoint: { base_cursor: 1 },
    events: [],
    high_water_cursor: 1,
  };
  expect(roomPublicDisplayRefs(boot).appRefs).toEqual(["discover-plaza"]);
  expect(
    roomPublicDisplayRefs({ ...boot, high_water_cursor: 2 }).appRefs,
  ).toEqual([]);
  expect(
    roomPublicDisplayRefs({
      ...boot,
      events: [
        {
          seq: 2,
          state_schema_id: "plaza.room@1",
          actor_id: "a",
          op: { t: "post.deleted", post_id: "p" },
        },
      ],
      high_water_cursor: 2,
    }).appRefs,
  ).toEqual([]);
});
