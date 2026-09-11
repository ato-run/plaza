/**
 * Playground Runner adapter semantics, driven DIRECTLY.
 *
 * The previous version of this file drove the adapter through the PWA's real
 * `BrowserRunnerBridge` (attach/receive/detach, receipts, REJECT codes,
 * scope fanout). That delivery path — ordering, dedupe, ACK, permission
 * enforcement — is owned by the PWA's bridge and tested there. What belongs
 * to Plaza is the adapter's own semantics: what a transform/presentation/
 * typing/reaction MEANS, and what projection an observer in a World sees.
 * Those are exercised here by calling the adapter directly, with no bridge.
 */
import { describe, expect, it } from "vitest";

import type { BrowserRunnerCapabilityClaims } from "../shared/runnerProtocol";
import {
  createPlaygroundRunnerSync,
  PLAYGROUND_RUNNER_PROTOCOL,
  playgroundFaceReactionPayload,
  playgroundPresentationPayload,
  playgroundTransformPayload,
  playgroundTypingPayload,
  type PlaygroundRunnerDelta,
  type PlaygroundRunnerProjection,
  type PlaygroundRunnerState,
} from "./playgroundRunnerAdapter";

function authority(actor_id: string): BrowserRunnerCapabilityClaims {
  // The adapter reads only `actor_id`. Claims enforcement (observe/interact,
  // epochs, expiry) is the bridge's job, not the adapter's.
  return { actor_id };
}

function transform(x: number, world_id = "central-plaza") {
  return playgroundTransformPayload({
    world_id: world_id as "central-plaza",
    x,
    y: 1.65,
    z: 0,
    yaw: 0,
    pitch: 0,
    movement: "walk",
    pose: "stand",
  });
}

function deltas(seen: PlaygroundRunnerState[]): PlaygroundRunnerDelta[] {
  return seen.filter(
    (state): state is PlaygroundRunnerDelta => state.mode === "delta",
  );
}

describe("Playground Runner adapter", () => {
  it("advertises its protocol id and four operations", () => {
    const { adapter } = createPlaygroundRunnerSync();
    expect(adapter.protocol_id).toBe(PLAYGROUND_RUNNER_PROTOCOL);
    expect(adapter.operations?.map((operation) => operation.kind).sort()).toEqual(
      ["face_reaction", "presentation", "transform", "typing"],
    );
  });

  it("applies transforms and projects members", () => {
    const { adapter, projection } = createPlaygroundRunnerSync();
    adapter.validate("transform", transform(3));
    adapter.apply(transform(3), authority("actor_a_01"));
    expect(projection()).toMatchObject({
      revision: 1,
      members: [{ actor_id: "actor_a_01", transform: { x: 3 } }],
    });
  });

  it("rejects unknown Worlds without advancing the revision", () => {
    const { adapter, projection } = createPlaygroundRunnerSync();
    expect(() =>
      adapter.validate("transform", {
        ...transform(1),
        world_id: "not-a-world",
      }),
    ).toThrow("invalid_transform");
    expect(projection().revision).toBe(0);
  });

  it("rejects unknown operation kinds", () => {
    const { adapter } = createPlaygroundRunnerSync();
    expect(() => adapter.validate("dance", { type: "dance" })).toThrow(
      "unsupported_operation",
    );
  });

  it("scopes snapshots to the observer's World", () => {
    const { adapter, projection } = createPlaygroundRunnerSync();
    adapter.apply(transform(1), authority("actor_a_01"));
    adapter.apply(transform(2, "market"), authority("actor_b_01"));

    const snapshot = projection("market");
    expect(snapshot.members.map((member) => member.actor_id)).toEqual([
      "actor_b_01",
    ]);
    expect(snapshot.world_online).toEqual({
      "central-plaza": 1,
      market: 1,
    });
  });

  it("filters deltas to affected subscription scopes", () => {
    const seen: PlaygroundRunnerState[] = [];
    const { adapter } = createPlaygroundRunnerSync((state) => {
      seen.push(state);
    });
    adapter.apply(transform(1), authority("actor_a_01"));
    adapter.apply(transform(2, "market"), authority("actor_b_01"));

    const [latest] = deltas(seen).slice(-1);
    expect(latest.world_ids).toEqual(["market"]);
    // An observer standing in central-plaza must not receive it…
    expect(
      adapter.observesProjection?.(
        { revision: latest.revision, summary: latest },
        authority("actor_a_01"),
      ),
    ).toBe(false);
    // …while the market observer must.
    expect(
      adapter.observesProjection?.(
        { revision: latest.revision, summary: latest },
        authority("actor_b_01"),
      ),
    ).toBe(true);
  });

  it("moves with the actor across Worlds, notifying both", () => {
    const seen: PlaygroundRunnerState[] = [];
    const { adapter } = createPlaygroundRunnerSync((state) => {
      seen.push(state);
    });
    adapter.apply(transform(1), authority("actor_a_01"));
    adapter.apply(transform(2, "market"), authority("actor_a_01"));

    const [latest] = deltas(seen).slice(-1);
    expect([...latest.world_ids].sort()).toEqual([
      "central-plaza",
      "market",
    ]);
  });

  it("projects public presentation without putting it in capability claims", () => {
    const { adapter, projection } = createPlaygroundRunnerSync();
    adapter.apply(transform(1), authority("actor_a_01"));
    adapter.apply(
      playgroundPresentationPayload({
        display_name: "Alice",
        animal_emoji: "🦊",
        is_guest: false,
        social_principal_id: "user:alice",
      }),
      authority("actor_a_01"),
    );
    expect(projection().members[0]).toMatchObject({
      actor_id: "actor_a_01",
      display_name: "Alice",
      animal_emoji: "🦊",
      is_guest: false,
      social_principal_id: "user:alice",
    });
    expect(authority("actor_a_01")).not.toHaveProperty("display_name");
  });

  it("falls back to a deterministic guest presentation", () => {
    const { adapter, projection } = createPlaygroundRunnerSync();
    adapter.apply(transform(1), authority("actor_a_01"));
    const [member] = projection().members;
    expect(member.is_guest).toBe(true);
    expect(member.display_name).toContain("actor_a_01".slice(-6));
  });

  it("tracks typing on the member", () => {
    const { adapter, projection } = createPlaygroundRunnerSync();
    adapter.apply(transform(1), authority("actor_a_01"));
    adapter.validate("typing", { type: "typing", typing: true });
    adapter.apply(playgroundTypingPayload(true), authority("actor_a_01"));
    expect(projection().members[0].typing).toBe(true);
  });

  it("emits face reactions as ephemeral deltas", () => {
    const seen: PlaygroundRunnerState[] = [];
    const { adapter, projection } = createPlaygroundRunnerSync((state) => {
      seen.push(state);
    });
    adapter.apply(transform(1), authority("actor_a_01"));
    adapter.apply(transform(2), authority("actor_b_01"));
    adapter.apply(
      playgroundFaceReactionPayload("actor_a_01", "👋"),
      authority("actor_b_01"),
    );

    const [latest] = deltas(seen).slice(-1);
    expect(latest.reaction).toMatchObject({
      from_actor_id: "actor_b_01",
      target_actor_id: "actor_a_01",
      emoji: "👋",
    });
    const snapshot = projection() as PlaygroundRunnerProjection;
    expect(
      snapshot.reactions.map((reaction) => reaction.target_actor_id),
    ).toContain("actor_a_01");
  });

  it("rejects malformed face reactions", () => {
    const { adapter } = createPlaygroundRunnerSync();
    expect(() =>
      adapter.validate("face_reaction", {
        type: "face_reaction",
        target_actor_id: "short",
        emoji: "👋",
      }),
    ).toThrow("invalid_face_reaction");
  });

  it("detaches actors as remove deltas", () => {
    const seen: PlaygroundRunnerState[] = [];
    const { adapter, projection } = createPlaygroundRunnerSync((state) => {
      seen.push(state);
    });
    adapter.actorAttached?.(authority("actor_a_01"));
    adapter.apply(transform(1), authority("actor_a_01"));
    expect(projection().members).toHaveLength(1);

    const detached = adapter.actorDetached?.(authority("actor_a_01"));
    expect(detached?.summary).toMatchObject({
      mode: "delta",
      remove_actor_id: "actor_a_01",
    });
    expect(projection().members).toHaveLength(0);
    const [latest] = deltas(seen).slice(-1);
    expect(latest.remove_actor_id).toBe("actor_a_01");
  });

  it("exposes the last applied delta for fanout", () => {
    const { adapter } = createPlaygroundRunnerSync();
    expect(
      adapter.projectAppliedState?.(transform(0), authority("nobody")),
    ).toBeUndefined();
    adapter.apply(transform(5), authority("actor_a_01"));
    expect(
      adapter.projectAppliedState?.(transform(5), authority("actor_a_01"))
        ?.summary,
    ).toMatchObject({
      mode: "delta",
      upsert: { actor_id: "actor_a_01" },
    });
  });
});
