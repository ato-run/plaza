/**
 * The ordering rules, as tests.
 *
 * The one that matters most: a higher `seq` arriving first must NOT advance
 * the cursor past the gap. Doing so marks the missing lower event as fetched,
 * and nothing ever delivers it — a silently lost post.
 */
import { describe, expect, it } from "vitest";

import {
  applyBootstrap,
  applyEventsPage,
  bufferEvent,
  createPlaygroundState,
  isBehind,
  mute,
  unmute,
  visiblePosts,
} from "./playgroundStore";
import type { PlaygroundBootstrap, PlaygroundEvent } from "./types";

function bootstrap(overrides: Partial<PlaygroundBootstrap> = {}): PlaygroundBootstrap {
  return {
    room_id: "global-v1",
    viewer: {
      signed_in: true,
      can_post: true,
      principal_id: "usr_alice",
      display_name: "Alice",
      animal_emoji: "🦊",
      is_guest: false,
    },
    posts: [],
    cards: { apps: {}, activities: {} },
    muted_user_ids: [],
    cursor: 0,
    online: 1,
    ...overrides,
  };
}

function postEvent(seq: number, id: string, author = "usr_bob"): PlaygroundEvent {
  return {
    seq,
    operation_id: `op-${seq}`,
    room_id: "global-v1",
    kind: "post.created",
    entity_id: id,
    payload: {
      id,
      room_id: "global-v1",
      author_user_id: author,
      kind: "text",
      text: `post ${seq}`,
      public_app_ref: null,
      public_activity_ref: null,
    },
    created_at: "2026-09-06T10:00:00.000Z",
  };
}

describe("sequence integrity", () => {
  it("holds an out-of-order event instead of skipping the gap", () => {
    let state = applyBootstrap(createPlaygroundState(), bootstrap());
    // seq 3 arrives while 1 and 2 are still missing.
    state = bufferEvent(state, postEvent(3, "lbp_3"));
    // The cursor must NOT jump to 3 — that would mark 1 and 2 as delivered.
    expect(state.cursor).toBe(0);
    expect(visiblePosts(state)).toHaveLength(0);

    state = bufferEvent(state, postEvent(1, "lbp_1"));
    expect(state.cursor).toBe(1);

    // Filling the gap releases the held event too.
    state = bufferEvent(state, postEvent(2, "lbp_2"));
    expect(state.cursor).toBe(3);
    expect(visiblePosts(state).map((p) => p.id)).toEqual([
      "lbp_1",
      "lbp_2",
      "lbp_3",
    ]);
  });

  it("ignores a duplicate seq", () => {
    let state = applyBootstrap(createPlaygroundState(), bootstrap());
    state = bufferEvent(state, postEvent(1, "lbp_1"));
    state = bufferEvent(state, postEvent(1, "lbp_1"));
    expect(state.cursor).toBe(1);
    expect(visiblePosts(state)).toHaveLength(1);
  });

  it("ignores events already covered by the bootstrap cursor", () => {
    let state = applyBootstrap(createPlaygroundState(), bootstrap({ cursor: 10 }));
    state = bufferEvent(state, postEvent(7, "lbp_old"));
    expect(visiblePosts(state)).toHaveLength(0);
    expect(state.cursor).toBe(10);
  });

  it("buffers events that arrive before bootstrap, then replays them", () => {
    let state = createPlaygroundState();
    state = bufferEvent(state, postEvent(1, "lbp_1"));
    // Nothing can be judged yet: the cursor to compare against is unknown.
    expect(state.bootstrapped).toBe(false);
    expect(visiblePosts(state)).toHaveLength(0);

    state = applyBootstrap(state, bootstrap({ cursor: 0 }));
    expect(visiblePosts(state).map((p) => p.id)).toEqual(["lbp_1"]);
    expect(state.cursor).toBe(1);
  });
});

describe("catch-up pages", () => {
  it("applies a page and adopts its high-water cursor", () => {
    let state = applyBootstrap(createPlaygroundState(), bootstrap());
    state = applyEventsPage(state, [postEvent(1, "lbp_1"), postEvent(2, "lbp_2")], 9);
    expect(visiblePosts(state)).toHaveLength(2);
    // 9 is the server's high-water at read time — later events were filtered
    // (muted authors), so trusting it prevents re-requesting an empty range.
    expect(state.cursor).toBe(9);
  });

  it("does not adopt a page cursor while an event is still held by a gap", () => {
    let state = applyBootstrap(createPlaygroundState(), bootstrap());
    state = bufferEvent(state, postEvent(5, "lbp_5"));
    state = applyEventsPage(state, [postEvent(1, "lbp_1")], 9);
    // Adopting 9 here would skip 2-4, which are genuinely still missing.
    expect(state.cursor).toBe(1);
    expect(visiblePosts(state).map((p) => p.id)).toEqual(["lbp_1"]);
  });

  it("knows when it is behind the room", () => {
    const state = applyBootstrap(createPlaygroundState(), bootstrap({ cursor: 4 }));
    expect(isBehind(state, 7)).toBe(true);
    expect(isBehind(state, 4)).toBe(false);
  });
});

describe("mute", () => {
  it("hides an author's existing and live posts, and unmute restores them", () => {
    let state = applyBootstrap(
      createPlaygroundState(),
      bootstrap({
        posts: [
          {
            id: "lbp_1",
            author_user_id: "usr_bob",
            kind: "text",
            text: "hi",
            app_ref: null,
            activity_ref: null,
            created_at: "2026-09-06T10:00:00.000Z",
            reactions: {},
            viewer_reactions: [],
          },
        ],
      }),
    );
    expect(visiblePosts(state)).toHaveLength(1);

    state = mute(state, "usr_bob");
    expect(visiblePosts(state)).toHaveLength(0);

    // A live post from the muted author stays hidden too.
    state = bufferEvent(state, postEvent(1, "lbp_2", "usr_bob"));
    expect(visiblePosts(state)).toHaveLength(0);

    state = unmute(state, "usr_bob");
    expect(visiblePosts(state)).toHaveLength(2);
  });

  it("applies bootstrap's muted list", () => {
    const state = applyBootstrap(
      createPlaygroundState(),
      bootstrap({
        muted_user_ids: ["usr_bob"],
        posts: [
          {
            id: "lbp_1",
            author_user_id: "usr_bob",
            kind: "text",
            text: "hi",
            app_ref: null,
            activity_ref: null,
            created_at: "2026-09-06T10:00:00.000Z",
            reactions: {},
            viewer_reactions: [],
          },
        ],
      }),
    );
    expect(visiblePosts(state)).toHaveLength(0);
  });
});

describe("deletion", () => {
  it("removes a deleted post from the feed", () => {
    let state = applyBootstrap(createPlaygroundState(), bootstrap());
    state = bufferEvent(state, postEvent(1, "lbp_1"));
    state = bufferEvent(state, {
      ...postEvent(2, "lbp_1"),
      kind: "post.deleted",
      entity_id: "lbp_1",
      payload: { id: "lbp_1", room_id: "global-v1" },
    });
    expect(visiblePosts(state)).toHaveLength(0);
    expect(state.cursor).toBe(2);
  });
});
