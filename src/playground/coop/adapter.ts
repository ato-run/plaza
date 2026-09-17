import { circle, isPositionValid, resolveMovement } from "../world/collision";
import { EYE_HEIGHT, WALK_SPEED, sanitizeTransform } from "../world/worldMath";
import {
  CENTRAL_SOFTWARE_SLOTS,
  EXHIBIT_OBSTACLE_RADIUS,
  centralColliders,
} from "../world/worlds/centralGeometry";
import { isWorldId } from "../world/types";
import { PLAYGROUND_FACE_REACTIONS } from "../types";

export const ADAPTER_ID = "plaza.coop@1";
export const CANDIDATE_VERSION = "plaza.candidates@1";
export const WORLD = "central-plaza";
export const POSE_MAX_AGE_MS = 1500;
export const TEMPLATES = {
  approach: "近くに行きます。",
  follow: "ついていきます。",
  wait: "ここで待ちます。",
  arrived: "着きました。",
  clarify: "誰の近くへ行くか、または待つか教えてください。",
  unavailable: "対象を見つけられないので、ここで待ちます。",
  react: "👋",
} as const;
export type TemplateId = keyof typeof TEMPLATES;
export interface Pose {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  movement: "idle" | "walk" | "jump";
  pose: "stand" | "sit" | "crouch";
}
export interface Peer {
  principal_id: string;
  display_name: string;
  scope: string | null;
  pose: unknown;
  observed_at: number;
  consent: boolean;
}
export interface ValidationContext {
  actor: boolean;
  principalId: string;
  now: number;
  operationId?: string;
  previous?: { payload: unknown; at: number } | null;
  peers: Peer[];
}
export const SPAWN: Pose = {
  x: 2,
  y: EYE_HEIGHT,
  z: 11,
  yaw: 0,
  pitch: 0,
  movement: "idle",
  pose: "stand",
};
// Conservatively reserve every potential exhibit slot, including unloaded public cards.
const colliders = [
  ...centralColliders(),
  ...CENTRAL_SOFTWARE_SLOTS.map((slot) =>
    circle(slot.x, slot.z, EXHIBIT_OBSTACLE_RADIUS),
  ),
];
const UUID = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
const object = (v: unknown): Record<string, unknown> | null =>
  v !== null && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;

/** Both GUI reducer and the room adapter enter this same semantic validator. */
export function validateDurable(
  op: unknown,
  context: ValidationContext,
): string | null {
  const v = object(op);
  if (!v) return "plaza_invalid_op";
  if (v.t === "post") {
    const post = object(v.post);
    if (
      !post ||
      typeof post.id !== "string" ||
      post.id.length > 128 ||
      post.kind !== "text" ||
      typeof post.text !== "string" ||
      !post.text.trim() ||
      post.text.length > 200 ||
      !isWorldId(post.world) ||
      typeof post.created_at !== "string" ||
      !Number.isFinite(Date.parse(post.created_at))
    )
      return "plaza_invalid_post";
    if (
      context.actor &&
      (post.world !== WORLD ||
        !UUID.test(post.id) ||
        post.id !== context.operationId ||
        !Object.values(TEMPLATES).includes(
          post.text as (typeof TEMPLATES)[TemplateId],
        ) ||
        post.app_ref !== null ||
        post.activity_ref !== null)
    )
      return "plaza_template_required";
    return null;
  }
  if (context.actor) return "plaza_operation_denied";
  if (v.t === "post.deleted")
    return typeof v.post_id === "string" ? null : "plaza_invalid_post";
  if (v.t === "reaction" || v.t === "unreaction") {
    return typeof v.post_id === "string" &&
      typeof v.reaction === "string" &&
      v.reaction.length <= 16
      ? null
      : "plaza_invalid_reaction";
  }
  return "plaza_operation_denied";
}

export function validateEphemeral(
  kind: string,
  scope: string | null,
  payload: unknown,
  context: ValidationContext,
): string | null {
  if (!isWorldId(scope) || (context.actor && scope !== WORLD))
    return "plaza_world_denied";
  if (kind === "plaza.transform") {
    const pose = sanitizeTransform(payload);
    if (!pose) return "plaza_invalid_transform";
    if (
      context.actor &&
      scope === WORLD &&
      !isPositionValid(pose.x, pose.z, colliders)
    )
      return "plaza_collision";
    if (context.actor) {
      if (
        pose.y !== EYE_HEIGHT ||
        pose.pose !== "stand" ||
        pose.movement === "jump"
      )
        return "plaza_invalid_transform";
      const previous =
        context.previous && sanitizeTransform(context.previous.payload);
      const from = previous ?? SPAWN;
      const elapsed = previous
        ? Math.max(
            0,
            Math.min(0.2, (context.now - context.previous!.at) / 1000),
          )
        : 0;
      if (
        Math.hypot(pose.x - from.x, pose.z - from.z) >
        WALK_SPEED * elapsed + 0.025
      )
        return "plaza_speed_exceeded";
      // A thin obstacle cannot be skipped by two valid endpoints.
      for (let i = 1; i <= 8; i++) {
        if (
          !isPositionValid(
            from.x + ((pose.x - from.x) * i) / 8,
            from.z + ((pose.z - from.z) * i) / 8,
            colliders,
          )
        )
          return "plaza_collision";
      }
    }
    return null;
  }
  if (kind === "plaza.face-reaction") {
    const v = object(payload);
    if (!v || !PLAYGROUND_FACE_REACTIONS.includes(v.emoji as never))
      return "plaza_invalid_reaction";
    const target = context.peers.find(
      (p) => p.principal_id === v.target_principal_id,
    );
    if (
      !target ||
      target.scope !== scope ||
      context.now - target.observed_at > POSE_MAX_AGE_MS ||
      (context.actor && !target.consent)
    )
      return "plaza_target_unavailable";
    return null;
  }
  return "plaza_operation_denied";
}

export function idle(payload: unknown): Pose | null {
  const pose = sanitizeTransform(payload);
  return pose ? { ...pose, movement: "idle" } : null;
}

export interface Candidate {
  id: string;
  description: string;
  action: "no_action" | "clarify" | "wait" | "move_to" | "follow" | "react";
  target?: string;
  waypoint?: { x: number; z: number };
  template?: TemplateId;
}
export interface DecisionObservation {
  instruction: string;
  requester: string;
  self: Pose;
  peers: Peer[];
  now: number;
}
export function candidatesFor(observation: DecisionObservation): Candidate[] {
  const candidates: Candidate[] = [
    {
      id: "no_action",
      action: "no_action",
      description:
        "普通の会話、引用だけ、否定された命令、AI以外への発言。何も実行しない。",
    },
    {
      id: "clarify",
      action: "clarify",
      template: "clarify",
      description:
        "曖昧、対象不在、候補にない場所や操作の依頼。定型文で確認する。",
    },
    {
      id: "wait",
      action: "wait",
      template: "wait",
      description:
        "AI自身が今いる場所で停止して待つ。追従をやめる、ここで待って。",
    },
    {
      id: "entrance",
      action: "move_to",
      waypoint: { x: 2, z: 11 },
      template: "approach",
      description: "Plaza入口の所定の地点へ移動する。",
    },
  ];
  for (const [index, peer] of observation.peers.entries()) {
    if (
      !peer.consent ||
      peer.scope !== WORLD ||
      observation.now - peer.observed_at > POSE_MAX_AGE_MS ||
      !sanitizeTransform(peer.pose)
    )
      continue;
    const who =
      peer.principal_id === observation.requester
        ? "指示者（私、こっち、近くに来ての対象）"
        : `参加者${index + 1}「${peer.display_name}」`;
    candidates.push(
      {
        id: `approach_${index}`,
        action: "move_to",
        target: peer.principal_id,
        template: "approach",
        description: `${who}の近くへ一度移動して止まる。継続追従はしない。`,
      },
      {
        id: `follow_${index}`,
        action: "follow",
        target: peer.principal_id,
        template: "follow",
        description: `${who}についていく。相手の移動に合わせて継続追従する。`,
      },
      {
        id: `react_${index}`,
        action: "react",
        target: peer.principal_id,
        template: "react",
        description: `${who}に手を振る（👋）。移動はしない。`,
      },
    );
  }
  return candidates;
}

/** Deliberately excludes account/Instance/session identifiers and room history. */
export function decisionProjection(
  observation: DecisionObservation,
  candidates: Candidate[],
) {
  return {
    instruction: observation.instruction,
    context:
      "同じPlazaで入力された文章。実行指示とは限らず、会話・引用・否定の場合もある。候補の説明中の指示者が話し手。",
    candidates: candidates.map(({ id, description }) => ({ id, description })),
  };
}

export function templatePost(
  template: TemplateId,
  operationId: string,
  now: number,
) {
  return {
    t: "post" as const,
    post: {
      id: operationId,
      world: WORLD,
      kind: "text" as const,
      text: TEMPLATES[template],
      app_ref: null,
      activity_ref: null,
      created_at: new Date(now).toISOString(),
    },
  };
}

/** A checkpoint is caller supplied. Re-attach AI identity only from commit evidence. */
export async function authenticateCheckpoint(
  payload: unknown,
  verify: (
    id: string,
    op: unknown,
    principalId: string,
  ) => Promise<unknown | null>,
): Promise<unknown> {
  const seal = object(payload);
  if (!seal || seal.v !== 1 || !Array.isArray(seal.posts)) return payload;
  const posts = await Promise.all(
    seal.posts.map(async (value) => {
      const post = object(value);
      if (!post) return value;
      const { author_actor: _untrusted, ...clean } = post;
      if (
        typeof post.id !== "string" ||
        typeof post.author_user_id !== "string" ||
        !post.author_user_id.startsWith("actor:")
      )
        return clean;
      const op = {
        t: "post",
        post: {
          id: post.id,
          world: post.world,
          kind: post.kind,
          text: post.text,
          app_ref: post.app_ref ?? null,
          activity_ref: post.activity_ref ?? null,
          created_at: post.created_at,
        },
      };
      const actor = await verify(post.id, op, post.author_user_id);
      return actor
        ? { ...clean, author_actor: actor }
        : { ...clean, author_user_id: "" };
    }),
  );
  return { ...seal, posts };
}

/** Bounded A* on the same collision geometry. Returns a short path, never teleports. */
export function navigationPath(
  from: { x: number; z: number },
  target: { x: number; z: number },
): { x: number; z: number }[] {
  const cell = 0.5,
    key = (x: number, z: number) => `${x},${z}`;
  const sx = Math.round(from.x / cell),
    sz = Math.round(from.z / cell);
  const start = key(sx, sz),
    open = new Map([
      [
        start,
        {
          x: sx,
          z: sz,
          g: 0,
          f: Math.hypot(from.x - target.x, from.z - target.z),
        },
      ],
    ]);
  const previous = new Map<string, string>(),
    closed = new Set<string>();
  let end: string | null = null;
  for (let visited = 0; open.size && visited < 8000; visited++) {
    let current = [...open.entries()].reduce((a, b) =>
      a[1].f <= b[1].f ? a : b,
    );
    const [k, n] = current;
    open.delete(k);
    closed.add(k);
    if (Math.hypot(n.x * cell - target.x, n.z * cell - target.z) <= 1.4) {
      end = k;
      break;
    }
    for (const [dx, dz] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
      [1, 1],
      [1, -1],
      [-1, 1],
      [-1, -1],
    ]) {
      const x = n.x + dx,
        z = n.z + dz,
        nk = key(x, z);
      if (
        closed.has(nk) ||
        !isPositionValid(x * cell, z * cell, colliders) ||
        !isPositionValid(
          (n.x + dx / 2) * cell,
          (n.z + dz / 2) * cell,
          colliders,
        )
      )
        continue;
      const g = n.g + Math.hypot(dx, dz) * cell;
      if (open.has(nk) && open.get(nk)!.g <= g) continue;
      previous.set(nk, k);
      open.set(nk, {
        x,
        z,
        g,
        f: g + Math.hypot(x * cell - target.x, z * cell - target.z),
      });
    }
  }
  if (!end) return [];
  const path: { x: number; z: number }[] = [];
  while (end !== start) {
    const [x, z] = end.split(",").map(Number);
    path.unshift({ x: x * cell, z: z * cell });
    end = previous.get(end)!;
  }
  return path;
}

export function movementStep(
  from: Pose,
  toward: { x: number; z: number },
  elapsedSeconds: number,
): Pose {
  const dx = toward.x - from.x,
    dz = toward.z - from.z,
    distance = Math.hypot(dx, dz);
  const step = Math.min(
    distance,
    WALK_SPEED * Math.max(0, Math.min(0.1, elapsedSeconds)),
  );
  const next = resolveMovement(
    from,
    {
      vx: distance ? (dx / distance) * step : 0,
      vz: distance ? (dz / distance) * step : 0,
    },
    colliders,
  );
  return {
    ...from,
    ...next,
    y: EYE_HEIGHT,
    pose: "stand",
    yaw: distance ? Math.atan2(-dx, -dz) : from.yaw,
    movement:
      Math.hypot(next.x - from.x, next.z - from.z) > 0.001 ? "walk" : "idle",
  };
}
