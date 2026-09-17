import { describe, it, expect } from "vitest";
import {
  SPAWN,
  WORLD,
  candidatesFor,
  decisionProjection,
  movementStep,
  navigationPath,
  validateEphemeral,
  validateDurable,
  templatePost,
  authenticateCheckpoint,
} from "./adapter";
import { WALK_SPEED } from "../world/worldMath";

describe("shared Plaza action adapter", () => {
  it("offers only current consented targets and bounded safe alternatives", () => {
    const obs = {
      instruction: "ついてきて",
      requester: "a",
      self: SPAWN,
      now: 5000,
      peers: [
        {
          principal_id: "a",
          display_name: "A",
          scope: WORLD,
          pose: SPAWN,
          observed_at: 4900,
          consent: true,
        },
        {
          principal_id: "b",
          display_name: "B",
          scope: WORLD,
          pose: SPAWN,
          observed_at: 4900,
          consent: false,
        },
        {
          principal_id: "c",
          display_name: "C",
          scope: "market",
          pose: SPAWN,
          observed_at: 4900,
          consent: true,
        },
        {
          principal_id: "d",
          display_name: "D",
          scope: WORLD,
          pose: SPAWN,
          observed_at: 1000,
          consent: true,
        },
      ],
    };
    const candidates = candidatesFor(obs);
    expect(
      candidates.filter((c) => c.target).every((c) => c.target === "a"),
    ).toBe(true);
    expect(candidates.map((c) => c.id)).toEqual(
      expect.arrayContaining(["no_action", "clarify", "wait"]),
    );
    const projection = JSON.stringify(decisionProjection(obs, candidates));
    expect(projection).not.toContain("principal_id");
    expect(projection).not.toContain("observed_at");
  });
  it("routes around the fountain under the same speed and collision checks", () => {
    const target = { x: 0, z: -10 };
    let pose = { ...SPAWN },
      at = 1000;
    const path = navigationPath(pose, target);
    expect(path.length).toBeGreaterThan(10);
    for (const point of path) {
      for (
        let steps = 0;
        Math.hypot(point.x - pose.x, point.z - pose.z) > 0.02 && steps < 20;
        steps++
      ) {
        const next = movementStep(pose, point, 0.1);
        at += 100;
        expect(
          Math.hypot(next.x - pose.x, next.z - pose.z),
        ).toBeLessThanOrEqual(WALK_SPEED * 0.1 + 0.001);
        expect(
          validateEphemeral("plaza.transform", WORLD, next, {
            actor: true,
            principalId: "ai",
            now: at,
            previous: { payload: pose, at: at - 100 },
            peers: [],
          }),
        ).toBeNull();
        pose = next;
      }
    }
    expect(Math.hypot(pose.x - target.x, pose.z - target.z)).toBeLessThan(1.5);
    expect(
      validateEphemeral(
        "plaza.transform",
        WORLD,
        { ...SPAWN, x: 6 },
        { actor: true, principalId: "ai", now: at, peers: [] },
      ),
    ).toBe("plaza_speed_exceeded");
    expect(
      validateEphemeral("plaza.transform", "market", SPAWN, {
        actor: true,
        principalId: "ai",
        now: at,
        peers: [],
      }),
    ).toBe("plaza_world_denied");
  });
  it("restricts the AI to templates and preserves old human post forms", () => {
    const id = "ef02a0fa-419a-4710-9286-94b2855a3e5f",
      op = templatePost("wait", id, 1000),
      context = {
        actor: true,
        principalId: "ai",
        now: 1000,
        operationId: id,
        peers: [],
      };
    expect(validateDurable(op, context)).toBeNull();
    expect(
      validateDurable({ ...op, post: { ...op.post, text: "自由文" } }, context),
    ).toBe("plaza_template_required");
    expect(
      validateDurable(
        { ...op, post: { ...op.post, id: "legacy", text: "普通の投稿" } },
        { ...context, actor: false },
      ),
    ).toBeNull();
    expect(validateDurable({ t: "post.deleted", post_id: id }, context)).toBe(
      "plaza_operation_denied",
    );
  });
  it("strips forged checkpoint AI labels and reattaches verified commit identity", async () => {
    const post = {
      id: "id",
      author_user_id: "actor:ai",
      author_actor: { kind: "ai", display_name: "forged" },
      kind: "text",
      text: "ここで待ちます。",
      world: WORLD,
      created_at: new Date(0).toISOString(),
    };
    const rejected = (await authenticateCheckpoint(
      { v: 1, posts: [post], cursor: 1 },
      async () => null,
    )) as any;
    expect(rejected.posts[0].author_actor).toBeUndefined();
    expect(rejected.posts[0].author_user_id).toBe("");
    const accepted = (await authenticateCheckpoint(
      { v: 1, posts: [post], cursor: 1 },
      async () => ({ kind: "ai", display_name: "Plaza Guide" }),
    )) as any;
    expect(accepted.posts[0].author_actor.display_name).toBe("Plaza Guide");
  });
});
