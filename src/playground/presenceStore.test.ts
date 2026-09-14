import { describe, expect, it } from "vitest";

import {
  applyFaceReaction,
  applyJoin,
  applyLeave,
  applySnapshot,
  applySpeech,
  applyTransform,
  applyTyping,
  createPresenceState,
  expire,
  PARTICIPANT_TTL_MS,
  principalIdForAuthor,
  REACTION_TTL_MS,
  SPEECH_TTL_MS,
  enterWorld,
  visibleMembers
} from "./presenceStore";
import type { PlaygroundParticipant } from "./types";

function participant(
  overrides: Partial<PlaygroundParticipant> = {},
): PlaygroundParticipant {
  return {
    principal_id: "user:alice",
    display_name: "Alice",
    animal_emoji: "🦊",
    is_guest: false,
    typing: false,
    ...overrides,
  };
}

/**
 * What the RENDERER keeps: no `world_id`, because a member already carries
 * the World it is in and repeating it per-frame on the position would be a
 * second source of truth for the same fact.
 */
const transform = {
  x: 3,
  y: 1.65,
  z: -4,
  yaw: 0.5,
  pitch: 0.1,
  movement: "walk" as const,
  pose: "stand" as const,
};

/** What the SERVER sends — the same position, plus the scoping World id. */
const wireTransform = { ...transform, world_id: "central-plaza" as const };

describe("roster", () => {
  it("places people from a snapshot's transform immediately", () => {
    const state = applySnapshot(
      createPresenceState(),
      [participant({ transform: wireTransform })],
      1,
      1000,
    );
    expect(state.members.get("user:alice")?.transform).toEqual(transform);
    expect(state.online).toBe(1);
  });

  it("tolerates a server that sends no transform yet", () => {
    const state = applySnapshot(createPresenceState(), [participant()], 1, 1000);
    expect(state.members.get("user:alice")?.transform).toBeNull();
  });

  it("does not teleport somebody back to spawn when a roster re-arrives", () => {
    // A reconnect replays snapshot/join after transforms are already flowing.
    let state = applyTransform(
      createPresenceState(),
      "user:alice",
      transform,
      1000,
    );
    state = applySnapshot(state, [participant()], 1, 2000);
    expect(state.members.get("user:alice")?.transform).toEqual(transform);
  });

  it("removes somebody on leave", () => {
    let state = applyJoin(createPresenceState(), participant(), 2, 1000);
    state = applyLeave(state, "user:alice", 1);
    expect(state.members.has("user:alice")).toBe(false);
    expect(state.online).toBe(1);
  });

  it("tracks typing", () => {
    let state = applyJoin(createPresenceState(), participant(), 1, 1000);
    state = applyTyping(state, "user:alice", true);
    expect(state.members.get("user:alice")?.typing).toBe(true);
  });
});

describe("transforms", () => {
  it("creates a member for a transform that arrives before their join", () => {
    // Losing the join would otherwise leave a moving person invisible.
    const state = applyTransform(
      createPresenceState(),
      "user:ghost",
      transform,
      1000,
    );
    expect(state.members.get("user:ghost")?.transform).toEqual(transform);
  });

  it("drops a malformed transform without disturbing what is known", () => {
    const before = applyTransform(
      createPresenceState(),
      "user:alice",
      transform,
      1000,
    );
    const after = applyTransform(before, "user:alice", { x: Number.NaN }, 2000);
    expect(after.members.get("user:alice")?.transform).toEqual(transform);
  });

  it("keeps jump movement and crouch pose from the wire", () => {
    const state = applyTransform(
      createPresenceState(),
      "user:alice",
      { ...transform, movement: "jump", pose: "crouch" },
      1000,
    );
    expect(state.members.get("user:alice")?.transform).toMatchObject({
      movement: "jump",
      pose: "crouch",
    });
  });
});

describe("ephemeral overlays", () => {
  it("shows a reaction above the target, not the sender", () => {
    let state = applyJoin(createPresenceState(), participant(), 1, 1000);
    state = applyJoin(
      state,
      participant({ principal_id: "user:bob", display_name: "Bob" }),
      2,
      1000,
    );
    state = applyFaceReaction(state, "user:bob", "👋", 1000);
    expect(state.members.get("user:bob")?.reaction?.emoji).toBe("👋");
    expect(state.members.get("user:alice")?.reaction).toBeNull();
  });

  it("ignores a reaction aimed at somebody who is not here", () => {
    const state = applyFaceReaction(
      createPresenceState(),
      "user:nobody",
      "👋",
      1000,
    );
    expect(state.members.size).toBe(0);
  });

  it("puts a durable post's text above its author", () => {
    let state = applyJoin(createPresenceState(), participant(), 1, 1000);
    state = applySpeech(state, "user:alice", "hello", 1000);
    expect(state.members.get("user:alice")?.speech?.text).toBe("hello");
  });

  it("maps a post's author id to the principal that owns the avatar", () => {
    // `author_user_id` is a bare user id; presence is keyed `user:<id>`.
    expect(principalIdForAuthor("alice")).toBe("user:alice");
  });
});

describe("expiry", () => {
  it("clears a bubble after its lifetime, keeping the person", () => {
    let state = applyJoin(createPresenceState(), participant({ transform: wireTransform }), 1, 1000);
    state = applySpeech(state, "user:alice", "hello", 1000);
    state = expire(state, 1000 + SPEECH_TTL_MS + 1);
    expect(state.members.get("user:alice")?.speech).toBeNull();
    expect(state.members.has("user:alice")).toBe(true);
  });

  it("clears a reaction on its own shorter clock", () => {
    let state = applyJoin(createPresenceState(), participant({ transform: wireTransform }), 1, 1000);
    state = applyFaceReaction(state, "user:alice", "❤️", 1000);
    // Still up well before a bubble would have expired.
    state = expire(state, 1000 + REACTION_TTL_MS - 1);
    expect(state.members.get("user:alice")?.reaction?.emoji).toBe("❤️");
    state = expire(state, 1000 + REACTION_TTL_MS + 1);
    expect(state.members.get("user:alice")?.reaction).toBeNull();
  });

  it("drops somebody who has stopped reporting", () => {
    const state = expire(
      applyTransform(createPresenceState(), "user:alice", transform, 1000),
      1000 + PARTICIPANT_TTL_MS + 1,
    );
    expect(state.members.has("user:alice")).toBe(false);
  });

  it("keeps somebody who has joined but never moved", () => {
    // No transform means no staleness clock to judge them by; dropping them
    // would make a motionless person vanish.
    const state = expire(
      applyJoin(createPresenceState(), participant(), 1, 1000),
      1000 + PARTICIPANT_TTL_MS + 1,
    );
    expect(state.members.has("user:alice")).toBe(true);
  });

  it("returns the same object when nothing expired, so React can skip", () => {
    const state = applyJoin(createPresenceState(), participant({ transform: wireTransform }), 1, 1000);
    expect(expire(state, 1001)).toBe(state);
  });
});

describe("a reaction aimed at the viewer", () => {
  // Regression: reactions render above the TARGET's head, and the viewer has
  // no avatar in their own first-person view — so a reaction aimed at you
  // found no member to attach to and was dropped. The sender saw it land on
  // your avatar; you never learned anybody had waved. Only the recipient half
  // was broken, which is why it looked like "reactions work" in one window.
  const self = participant({ principal_id: "user:me", display_name: "Me" });

  function stateWithSelf() {
    const base = applySnapshot(
      createPresenceState(),
      [participant({ principal_id: "user:bob", display_name: "Bob", animal_emoji: "🐼" })],
      2,
      1000,
    );
    return { ...base, self };
  }

  it("shows it on the viewer's own HUD instead of discarding it", () => {
    const state = applyFaceReaction(
      stateWithSelf(),
      "user:me",
      "👋",
      1000,
      "user:bob",
    );
    expect(state.selfReaction).toEqual({
      emoji: "👋",
      from_display_name: "Bob",
      from_animal_emoji: "🐼",
      until: 1000 + REACTION_TTL_MS,
    });
  });

  it("names who reacted, which the viewer cannot infer from the emoji", () => {
    const state = applyFaceReaction(
      stateWithSelf(),
      "user:me",
      "❤️",
      1000,
      "user:bob",
    );
    expect(state.selfReaction?.from_display_name).toBe("Bob");
  });

  it("still renders when the sender is not in the roster yet", () => {
    const state = applyFaceReaction(
      stateWithSelf(),
      "user:me",
      "👍",
      1000,
      "user:ghost",
    );
    expect(state.selfReaction?.emoji).toBe("👍");
    expect(state.selfReaction?.from_display_name).toBe("");
  });

  it("prefers the HUD over a second tab's copy of the viewer", () => {
    // Two tabs of one account put the viewer's own principal in the member
    // map. A reaction aimed at you should read as "you", not as an emoji over
    // a copy of yourself standing across the plaza.
    const base = applySnapshot(
      createPresenceState(),
      [participant({ principal_id: "user:me", display_name: "Me" })],
      1,
      1000,
    );
    const state = applyFaceReaction(
      { ...base, self },
      "user:me",
      "😂",
      1000,
      "user:bob",
    );
    expect(state.selfReaction?.emoji).toBe("😂");
    expect(state.members.get("user:me")?.reaction).toBeNull();
  });

  it("expires on the same sweep as everything else", () => {
    const state = applyFaceReaction(stateWithSelf(), "user:me", "👋", 1000, "user:bob");
    expect(expire(state, 1000 + REACTION_TTL_MS).selfReaction).toBeNull();
  });

  it("leaves a reaction aimed at somebody else on their avatar", () => {
    const state = applyFaceReaction(
      stateWithSelf(),
      "user:bob",
      "👋",
      1000,
      "user:me",
    );
    expect(state.selfReaction).toBeNull();
    expect(state.members.get("user:bob")?.reaction?.emoji).toBe("👋");
  });
});

describe("Worlds keep their people apart", () => {
  function participantIn(
    principalId: string,
    worldId: "central-plaza" | "campfire",
  ) {
    return participant({
      principal_id: principalId,
      display_name: principalId,
      world_id: worldId,
    });
  }

  it("draws only the people in the viewer's own World", () => {
    const state = applySnapshot(
      createPresenceState(),
      [participantIn("user:here", "central-plaza"), participantIn("user:away", "campfire")],
      2,
      1000,
    );
    expect(visibleMembers(state).map((m) => m.principal_id)).toEqual([
      "user:here",
    ]);
  });

  it("reads a participant with no World as being in the default one", () => {
    // A server that has not shipped `world_id` yet must not make everybody
    // vanish; absent means the plaza, which is where they actually are.
    const state = applySnapshot(
      createPresenceState(),
      [participant({ principal_id: "user:legacy" })],
      1,
      1000,
    );
    expect(state.members.get("user:legacy")?.world_id).toBe("central-plaza");
    expect(visibleMembers(state)).toHaveLength(1);
  });

  it("clears the roster on entering a World, rather than filtering it", () => {
    // Keeping the old members until the new snapshot lands would leave the
    // previous World's people standing in this one for a moment.
    const before = applySnapshot(
      createPresenceState(),
      [participantIn("user:here", "central-plaza")],
      1,
      1000,
    );
    const after = enterWorld(before, "campfire");
    expect(after.members.size).toBe(0);
    expect(after.worldId).toBe("campfire");
  });

  it("does nothing when entering the World you are already in", () => {
    const before = applySnapshot(
      createPresenceState(),
      [participantIn("user:here", "central-plaza")],
      1,
      1000,
    );
    expect(enterWorld(before, "central-plaza")).toBe(before);
  });

  it("drops a reaction aimed at you when you change World", () => {
    const withReaction = applyFaceReaction(
      { ...createPresenceState(), self: participant({ principal_id: "user:me" }) },
      "user:me",
      "👋",
      1000,
      "user:bob",
    );
    expect(enterWorld(withReaction, "campfire").selfReaction).toBeNull();
  });

  it("places a transform from an unknown sender in the viewer's World", () => {
    // A transform is only ever relayed within one World, so its sender is
    // here — assuming otherwise would file them somewhere invisible.
    const state = applyTransform(
      enterWorld(createPresenceState(), "campfire"),
      "user:ghost",
      transform,
      1000,
    );
    expect(state.members.get("user:ghost")?.world_id).toBe("campfire");
    expect(visibleMembers(state).map((m) => m.principal_id)).toEqual([
      "user:ghost",
    ]);
  });

  it("keeps per-World head counts for the selector", () => {
    const state = applySnapshot(createPresenceState(), [], 3, 1000, {
      "central-plaza": 2,
      campfire: 1,
    });
    expect(state.worldOnline["central-plaza"]).toBe(2);
    expect(state.worldOnline.campfire).toBe(1);
    // Absent is not zero: an unshipped count must not read as "empty".
    expect(state.worldOnline.meadow).toBeUndefined();
  });

  it("keeps the last known counts when a snapshot omits them", () => {
    const withCounts = applySnapshot(createPresenceState(), [], 1, 1000, {
      campfire: 4,
    });
    const without = applySnapshot(withCounts, [], 1, 1000);
    expect(without.worldOnline.campfire).toBe(4);
  });
});
