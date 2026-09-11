/**
 * Plaza room translation: App Room ops in, durable-lane events out.
 *
 * Pins the load-bearing rules: authorship comes from the server-stamped
 * envelope (never the payload), a stranger's delete advances the cursor
 * without deleting, foreign-World posts stay out of this World's view, and
 * seals round-trip through bootstrap.
 */
import { describe, expect, it } from "vitest";

import {
  applyEventsPage,
  bufferEvent,
  createPlaygroundState,
  visiblePosts,
} from "./playgroundStore";
import {
  buildSealPayload,
  roomBootstrapToState,
  roomOpToEvent,
  viewerFromHello,
  worldOfParticipant,
  type AppRoomOpEvent,
  type PlazaOp,
} from "./roomProtocol";
import { DEFAULT_WORLD_ID } from "./world/types";
import type { PlaygroundPost, PlaygroundViewer } from "./types";

function opEvent(
  seq: number,
  actor: string,
  op: PlazaOp,
): AppRoomOpEvent {
  return {
    kind: "op",
    seq,
    operation_id: `op-${seq}`,
    actor_id: actor,
    actor_kind: "account",
    state_schema_id: "plaza.room@1",
    room_epoch: 0,
    op,
  };
}

const VIEWER: PlaygroundViewer = {
  signed_in: true,
  can_post: true,
  principal_id: "user_alice",
  display_name: "Alice",
  animal_emoji: "🦊",
  is_guest: false,
};

function postOp(seq: number, actor: string, id: string, text = "hi", world = DEFAULT_WORLD_ID) {
  return opEvent(seq, actor, {
    t: "post",
    post: {
      id,
      world,
      kind: "text",
      text,
      app_ref: null,
      activity_ref: null,
      created_at: "2026-09-12T00:00:00.000Z",
    },
  });
}

describe("roomOpToEvent", () => {
  it("maps posts, deletes, and reactions onto the durable lane", () => {
    let state = roomBootstrapToState(createPlaygroundState(), VIEWER, { v: 1, posts: [], cursor: 0 }, 1);
    const feed = (event: AppRoomOpEvent) => {
      state = bufferEvent(state, roomOpToEvent(event, state.posts, DEFAULT_WORLD_ID));
    };

    feed(postOp(1, "user_alice", "p1"));
    feed(opEvent(2, "user_bob", { t: "reaction", post_id: "p1", reaction: "❤️" }));
    expect(visiblePosts(state).map((p) => p.id)).toEqual(["p1"]);
    expect(state.posts.get("p1")?.reactions).toEqual({ "❤️": 1 });

    // A stranger's delete advances the cursor but deletes nothing.
    feed(opEvent(3, "user_bob", { t: "post.deleted", post_id: "p1" }));
    expect(state.cursor).toBe(3);
    expect(visiblePosts(state).map((p) => p.id)).toEqual(["p1"]);

    // The author's delete lands.
    feed(opEvent(4, "user_alice", { t: "post.deleted", post_id: "p1" }));
    expect(visiblePosts(state)).toEqual([]);
  });

  it("keeps foreign-World posts out of this World's view", () => {
    let state = roomBootstrapToState(createPlaygroundState(), VIEWER, { v: 1, posts: [], cursor: 0 }, 1);
    const feed = (event: AppRoomOpEvent) => {
      state = bufferEvent(state, roomOpToEvent(event, state.posts, DEFAULT_WORLD_ID));
    };
    feed(postOp(1, "user_alice", "p1", "plaza talk"));
    feed(postOp(2, "user_alice", "p2", "market talk", "market"));
    expect(state.cursor).toBe(2);
    expect(visiblePosts(state).map((p) => p.id)).toEqual(["p1"]);
  });

  it("advances past unknown op shapes instead of wedging the log", () => {
    let state = roomBootstrapToState(createPlaygroundState(), VIEWER, { v: 1, posts: [], cursor: 0 }, 1);
    state = bufferEvent(
      state,
      roomOpToEvent(
        { ...postOp(1, "user_alice", "p1"), op: { t: "future.op" } },
        state.posts,
        DEFAULT_WORLD_ID,
      ),
    );
    expect(state.cursor).toBe(1);
    expect(visiblePosts(state)).toEqual([]);
  });

  it("ignores reactions for unknown posts", () => {
    let state = roomBootstrapToState(createPlaygroundState(), VIEWER, { v: 1, posts: [], cursor: 0 }, 1);
    state = bufferEvent(
      state,
      roomOpToEvent(
        opEvent(1, "user_bob", { t: "reaction", post_id: "missing", reaction: "❤️" }),
        state.posts,
        DEFAULT_WORLD_ID,
      ),
    );
    expect(state.cursor).toBe(1);
    expect(visiblePosts(state)).toEqual([]);
  });
});

describe("seal round-trip", () => {
  it("rebuilds the same conversation from a seal plus suffix", () => {
    let live = roomBootstrapToState(createPlaygroundState(), VIEWER, { v: 1, posts: [], cursor: 0 }, 2);
    const feed = (event: AppRoomOpEvent) => {
      live = bufferEvent(live, roomOpToEvent(event, live.posts, DEFAULT_WORLD_ID));
    };
    feed(postOp(1, "user_alice", "p1", "one"));
    feed(postOp(2, "user_bob", "p2", "two"));
    feed(opEvent(3, "user_alice", { t: "reaction", post_id: "p2", reaction: "🔥" }));

    const seal = buildSealPayload(live);
    expect(seal.cursor).toBe(3);

    // A fresh client restores from the seal, then replays the suffix.
    let restored = roomBootstrapToState(createPlaygroundState(), VIEWER, seal, 2);
    expect(visiblePosts(restored).map((p) => p.id)).toEqual(["p1", "p2"]);
    expect(restored.posts.get("p2")?.reactions).toEqual({ "🔥": 1 });

    restored = applyEventsPage(restored, [], seal.cursor);
    expect(restored.cursor).toBe(3);
  });

  it("starts empty on a missing or corrupt seal", () => {
    const state = roomBootstrapToState(createPlaygroundState(), VIEWER, null, 0);
    expect(visiblePosts(state)).toEqual([]);
    expect(state.cursor).toBe(0);
    const corrupt = roomBootstrapToState(createPlaygroundState(), VIEWER, { v: 2 }, 0);
    expect(visiblePosts(corrupt)).toEqual([]);
  });

  it("preserves viewer-local mutes across re-bootstrap", () => {
    const posts: PlaygroundPost[] = [
      {
        id: "p1",
        author_user_id: "user_bob",
        kind: "text",
        text: "hi",
        app_ref: null,
        activity_ref: null,
        created_at: "2026-09-12T00:00:00.000Z",
        reactions: {},
        viewer_reactions: [],
      },
    ];
    let state = roomBootstrapToState(createPlaygroundState(), VIEWER, { v: 1, posts, cursor: 1 }, 1);
    const muted = new Set(state.mutedUserIds);
    muted.add("user_bob");
    state = { ...state, mutedUserIds: muted };
    const again = roomBootstrapToState(state, VIEWER, { v: 1, posts, cursor: 1 }, 1);
    expect(visiblePosts(again)).toEqual([]);
  });
});

describe("viewerFromHello", () => {
  it("grants posting to owners and editors, gates viewers on open_posting", () => {
    const base = {
      self: {
        principal_id: "user_x",
        display_name: "X Y",
        animal_emoji: "🐼",
        color: "red",
        role: "viewer" as const,
        presence: null,
        typing: false,
      },
      actor_kind: "account" as const,
      open_posting: false,
    };
    expect(viewerFromHello({ ...base, role: "owner" }).can_post).toBe(true);
    expect(viewerFromHello({ ...base, role: "editor" }).can_post).toBe(true);
    expect(viewerFromHello({ ...base, role: "viewer" }).can_post).toBe(false);
    expect(viewerFromHello({ ...base, role: "viewer", open_posting: true }).can_post).toBe(true);
  });

  it("marks invite guests as guests", () => {
    const viewer = viewerFromHello({
      self: {
        principal_id: "guest:abc",
        display_name: "Guest",
        animal_emoji: "🐧",
        color: "blue",
        role: "editor",
        presence: null,
        typing: false,
      },
      role: "editor",
      actor_kind: "guest",
      open_posting: false,
    });
    expect(viewer.is_guest).toBe(true);
    expect(viewer.signed_in).toBe(false);
  });
});

describe("worldOfParticipant", () => {
  it("reads the live ephemeral scope, else the fallback", () => {
    const participant = {
      principal_id: "u",
      display_name: "U",
      animal_emoji: "🦊",
      color: "c",
      role: "editor" as const,
      presence: null,
      typing: false,
      ephemeral: {
        kind: "plaza.transform",
        scope: "market",
        payload: {},
        expires_at: Date.now() + 4000,
      },
    };
    expect(worldOfParticipant(participant, DEFAULT_WORLD_ID)).toBe("market");
    expect(
      worldOfParticipant({ ...participant, ephemeral: null }, DEFAULT_WORLD_ID),
    ).toBe(DEFAULT_WORLD_ID);
    expect(
      worldOfParticipant(
        {
          ...participant,
          ephemeral: { kind: "plaza.transform", scope: "nope", payload: {}, expires_at: Date.now() + 4000 },
        },
        DEFAULT_WORLD_ID,
      ),
    ).toBe(DEFAULT_WORLD_ID);
    expect(
      worldOfParticipant(
        {
          ...participant,
          ephemeral: { kind: "plaza.transform", scope: "market", payload: {}, expires_at: Date.now() - 1 },
        },
        DEFAULT_WORLD_ID,
      ),
    ).toBe(DEFAULT_WORLD_ID);
  });
});
