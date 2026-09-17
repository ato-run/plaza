/**
 * Contract test — REAL server payloads through the real decoder.
 *
 * The fixtures below are not invented. `BOOTSTRAP_LIVE`, `ONLINE_LIVE` and
 * `EVENTS_LIVE` were captured verbatim from
 * `https://playground.stg-app.ato.run/__ato/playground/*` (guest, empty
 * lobby). The post/event fixtures are transcribed from the server's own
 * projection and event-payload construction in ato-api
 * (`services/lobby/api.ts`, `services/lobby/store.ts`).
 *
 * This file exists because the first version of this client was written
 * against an imagined schema and disagreed with the server on nearly every
 * field name — `public_app_ref` vs `app_ref`, `participant_id` vs
 * `principal_id`, `emoji` vs `animal_emoji`, reactions as a side list vs
 * nested. Unit tests all passed, because they tested the client against
 * itself. Pinning real shapes is what makes that class of bug impossible to
 * repeat silently.
 *
 * Note the deliberate asymmetry it also documents: the bootstrap PROJECTION
 * renames the ref columns, while the durable EVENT payload keeps the raw
 * column names. Both are exercised here.
 */
import { describe, expect, it } from "vitest";

import {
  applyBootstrap,
  applyEventsPage,
  bufferEvent,
  createPlaygroundState,
  visiblePosts,
} from "./playgroundStore";
import {
  applyFaceReaction,
  applyJoin,
  applySnapshot,
  applyTransform,
  createPresenceState,
} from "./presenceStore";
import { AppRoomTransport } from "./roomTransport";
import {
  PLAZA_EPHEMERAL_FACE_REACTION_KIND,
  PLAZA_EPHEMERAL_TRANSFORM_KIND,
} from "./roomProtocol";
import type { PlaygroundBootstrap, PlaygroundEvent } from "./types";

/** Captured live, guest viewer, empty lobby. */
const BOOTSTRAP_LIVE = {
  room_id: "global-v1",
  viewer: {
    signed_in: false,
    can_post: false,
    principal_id: "guest:02b1d7c6-7e31-4cc6-99af-52d8e0932fa6",
    display_name: "Gentle Whale",
    animal_emoji: "🐋",
    is_guest: true,
  },
  posts: [],
  cards: { apps: {}, activities: {} },
  muted_user_ids: [],
  cursor: 0,
  online: 0,
} satisfies PlaygroundBootstrap;

const ONLINE_LIVE = { online: 0 };
const EVENTS_LIVE = { events: [], cursor: 0 };

/** Server projection shape for a populated lobby (ato-api api.ts:172-182). */
const BOOTSTRAP_POPULATED = {
  room_id: "global-v1",
  viewer: {
    signed_in: true,
    can_post: true,
    principal_id: "usr_alice",
    display_name: "Alice",
    animal_emoji: "🦊",
    is_guest: false,
  },
  posts: [
    {
      id: "lbp_01",
      author_user_id: "usr_bob",
      kind: "app" as const,
      text: "これ面白い",
      app_ref: "app_excalidraw",
      activity_ref: null,
      created_at: "2026-09-06T10:00:00.000Z",
      reactions: { "❤️": 3, "😂": 1 },
      viewer_reactions: ["❤️"],
    },
  ],
  cards: {
    apps: {
      app_excalidraw: {
        ref: "app_excalidraw",
        title: "Excalidraw",
        icon: null,
        thumbnail_url: null,
        app_path: "/a/excalidraw",
        usable: true,
      },
    },
    activities: {},
  },
  muted_user_ids: [],
  cursor: 42,
  online: 2,
} satisfies PlaygroundBootstrap;

/** Durable event payload — RAW column names, unlike the projection. */
const POST_CREATED_EVENT: PlaygroundEvent = {
  seq: 43,
  operation_id: "op-1",
  room_id: "global-v1",
  kind: "post.created",
  entity_id: "lbp_02",
  payload: {
    id: "lbp_02",
    room_id: "global-v1",
    author_user_id: "usr_carol",
    kind: "activity",
    text: null,
    public_app_ref: null,
    public_activity_ref: "act_2048",
  },
  created_at: "2026-09-06T10:01:00.000Z",
};

/** Reaction events carry no count — the client derives it. */
function reactionEvent(
  seq: number,
  kind: "reaction.added" | "reaction.removed",
  userId: string,
): PlaygroundEvent {
  return {
    seq,
    operation_id: `op-${seq}`,
    room_id: "global-v1",
    kind,
    entity_id: "lbp_01",
    payload: { post_id: "lbp_01", user_id: userId, reaction: "❤️" },
    created_at: "2026-09-06T10:02:00.000Z",
  };
}

describe("live staging payloads decode", () => {
  it("accepts the real empty-lobby bootstrap", () => {
    const state = applyBootstrap(createPlaygroundState(), BOOTSTRAP_LIVE);
    expect(state.roomId).toBe("global-v1");
    expect(state.viewer?.principal_id).toMatch(/^guest:/);
    expect(state.viewer?.animal_emoji).toBe("🐋");
    // A guest is a fully identified viewer with zero write capability.
    expect(state.viewer?.can_post).toBe(false);
    expect(state.cursor).toBe(0);
    expect(visiblePosts(state)).toEqual([]);
  });

  it("accepts the real events and online payloads", () => {
    expect(ONLINE_LIVE.online).toBe(0);
    const state = applyEventsPage(
      applyBootstrap(createPlaygroundState(), BOOTSTRAP_LIVE),
      EVENTS_LIVE.events,
      EVENTS_LIVE.cursor,
    );
    expect(state.cursor).toBe(0);
  });
});

describe("the projection's field names, as the server sends them", () => {
  it("reads app_ref as an ID that indexes the cards map", () => {
    const state = applyBootstrap(createPlaygroundState(), BOOTSTRAP_POPULATED);
    const [post] = visiblePosts(state);
    // Not an object: the card body lives in `cards`, re-read server-side.
    expect(post.app_ref).toBe("app_excalidraw");
    expect(state.cards.apps[post.app_ref!].app_path).toBe("/a/excalidraw");
    expect(state.cards.apps[post.app_ref!].usable).toBe(true);
  });

  it("reads reactions nested on the post, with the viewer's own marked", () => {
    const state = applyBootstrap(createPlaygroundState(), BOOTSTRAP_POPULATED);
    const [post] = visiblePosts(state);
    expect(post.reactions).toEqual({ "❤️": 3, "😂": 1 });
    expect(post.viewer_reactions).toEqual(["❤️"]);
  });
});

describe("event payloads use the raw column names", () => {
  it("normalizes public_activity_ref to activity_ref", () => {
    const state = bufferEvent(
      applyBootstrap(createPlaygroundState(), BOOTSTRAP_POPULATED),
      POST_CREATED_EVENT,
    );
    const post = visiblePosts(state).find((p) => p.id === "lbp_02");
    expect(post?.activity_ref).toBe("act_2048");
    expect(post?.kind).toBe("activity");
    expect(state.cursor).toBe(43);
  });

  it("derives reaction counts, since the event carries none", () => {
    let state = applyBootstrap(createPlaygroundState(), BOOTSTRAP_POPULATED);
    state = bufferEvent(state, reactionEvent(43, "reaction.added", "usr_dave"));
    expect(visiblePosts(state)[0].reactions["❤️"]).toBe(4);
    // Somebody else's reaction must not appear as the viewer's own.
    expect(visiblePosts(state)[0].viewer_reactions).toEqual(["❤️"]);

    state = bufferEvent(
      state,
      reactionEvent(44, "reaction.removed", "usr_alice"),
    );
    expect(visiblePosts(state)[0].reactions["❤️"]).toBe(3);
    // The viewer's own removal clears their mark.
    expect(visiblePosts(state)[0].viewer_reactions).toEqual([]);
  });

  it("drops a reaction key entirely once its count reaches zero", () => {
    let state = applyBootstrap(createPlaygroundState(), BOOTSTRAP_POPULATED);
    for (const seq of [43, 44, 45]) {
      state = bufferEvent(
        state,
        reactionEvent(seq, "reaction.removed", `usr_${seq}`),
      );
    }
    expect(visiblePosts(state)[0].reactions["❤️"]).toBeUndefined();
  });
});

/**
 * The presence lane's new message kinds.
 *
 * These are pinned against the agreed wire contract rather than a live
 * capture: the server half ships in the same change set, and the whole point
 * of writing them down here is that the two sides cannot quietly disagree
 * about field names the way the durable lane once did.
 */
describe("presence lane envelopes", () => {
  it("reads a transform broadcast into the presence store", () => {
    const message = {
      protocol: "ato.playground@1",
      kind: "transform",
      principal_id: "user:alice",
      x: 3.5,
      y: 1.65,
      z: -4.25,
      yaw: 0.7853981633974483,
      pitch: -0.03,
      movement: "walk",
    };
    const state = applyTransform(
      createPresenceState(),
      message.principal_id,
      message,
      1000,
    );
    expect(state.members.get("user:alice")?.transform).toEqual({
      pose: "stand",
      x: 3.5,
      y: 1.65,
      z: -4.25,
      yaw: 0.7853981633974483,
      pitch: -0.03,
      movement: "walk",
    });
  });

  it("reads a face_reaction onto its TARGET, not its sender", () => {
    const message = {
      protocol: "ato.playground@1",
      kind: "face_reaction",
      from_principal_id: "user:alice",
      target_principal_id: "user:bob",
      emoji: "👋",
    };
    let state = applyJoin(
      createPresenceState(),
      {
        principal_id: "user:bob",
        display_name: "Bob",
        animal_emoji: "🐼",
        is_guest: false,
        typing: false,
      },
      2,
      1000,
    );
    state = applyFaceReaction(
      state,
      message.target_principal_id,
      message.emoji,
      1000,
    );
    expect(state.members.get("user:bob")?.reaction?.emoji).toBe("👋");
  });

  it("accepts a participant carrying a transform in snapshot/join", () => {
    const state = applySnapshot(
      createPresenceState(),
      [
        {
          principal_id: "user:alice",
          display_name: "Alice",
          animal_emoji: "🦊",
          is_guest: false,
          typing: false,
          transform: {
            world_id: "central-plaza" as const,
            x: 1,
            y: 1.65,
            z: 2,
            yaw: 0,
            pitch: 0,
            movement: "idle" as const,
            pose: "stand" as const,
          },
        },
      ],
      1,
      1000,
    );
    expect(state.members.get("user:alice")?.transform?.x).toBe(1);
  });
});

describe("the socket sends what the room expects", () => {
  it("freezes a retryable invocation before pose/epoch or caller payload changes", () => {
    const transport = new AppRoomTransport({ onMessage() {} });
    transport.roomEpoch = 7;
    const op = { t: "post.deleted" as const, post_id: "original" };
    const prepared = transport.prepareMutation(
      op,
      "81f27b27-6040-4d47-aa2b-e76a98f7e59e",
    );
    op.post_id = "changed";
    transport.roomEpoch = 8;
    expect(JSON.parse(prepared.body)).toMatchObject({
      room_epoch: 7,
      op: { post_id: "original" },
      operation_id: "81f27b27-6040-4d47-aa2b-e76a98f7e59e",
    });
    expect(Object.isFrozen(prepared)).toBe(true);
    expect(transport.prepareMutation(op).body).not.toBe(
      transport.prepareMutation(op).body,
    );
  });
  it("sends scoped transforms and reactions in the agreed shape", () => {
    const sent: unknown[] = [];
    const socket = {
      readyState: 1,
      send: (raw: string) => sent.push(JSON.parse(raw)),
      addEventListener() {},
      close() {},
    };
    const transport = new AppRoomTransport({
      createWebSocket: () => socket as unknown as WebSocket,
      onMessage() {},
    });
    transport.connect("wss://example.test/__ato/app-room/connect");
    transport.sendEphemeral(
      PLAZA_EPHEMERAL_TRANSFORM_KIND,
      "central-plaza",
      {
        x: 1,
        y: 1.65,
        z: 2,
        yaw: 0.5,
        pitch: 0.1,
        pose: "stand",
        movement: "walk",
      },
      5000,
    );
    transport.sendEphemeral(
      PLAZA_EPHEMERAL_FACE_REACTION_KIND,
      "central-plaza",
      { target_principal_id: "user:bob", emoji: "👍" },
      2400,
    );
    // No `sync` here: `open` never fired, so the on-connect handshake has
    // not run. Only the explicit sends appear.
    expect(sent).toEqual([
      {
        type: "ephemeral",
        kind: PLAZA_EPHEMERAL_TRANSFORM_KIND,
        // `scope` rides on every transform: it is what scopes delivery to
        // the World, so a client that omitted it would spray every World.
        scope: "central-plaza",
        payload: {
          x: 1,
          y: 1.65,
          z: 2,
          yaw: 0.5,
          pitch: 0.1,
          pose: "stand",
          movement: "walk",
        },
        ttl_ms: 5000,
      },
      {
        type: "ephemeral",
        kind: PLAZA_EPHEMERAL_FACE_REACTION_KIND,
        scope: "central-plaza",
        payload: { target_principal_id: "user:bob", emoji: "👍" },
        ttl_ms: 2400,
      },
    ]);
  });
});
