import type {
  BrowserRunnerCapabilityClaims,
  RunnerProtocolAdapter,
  RunnerProtocolPayload,
} from "../shared/runnerProtocol";
import {
  PLAYGROUND_FACE_REACTIONS,
  type PlaygroundFaceReaction,
  type PlaygroundTransform,
} from "./types";
import { DEFAULT_WORLD_ID, WORLD_IDS, isWorldId } from "./world/types";

export const PLAYGROUND_RUNNER_PROTOCOL = "ato.playground.world@1" as const;

export interface PlaygroundRunnerMember {
  actor_id: string;
  display_name: string;
  animal_emoji: string;
  is_guest: boolean;
  social_principal_id?: string;
  transform: PlaygroundTransform;
  typing: boolean;
}

export interface PlaygroundRunnerReaction {
  revision: number;
  from_actor_id: string;
  target_actor_id: string;
  emoji: PlaygroundFaceReaction;
  expires_at: number;
}

export interface PlaygroundRunnerProjection {
  mode?: "snapshot";
  revision: number;
  members: PlaygroundRunnerMember[];
  reactions: PlaygroundRunnerReaction[];
  world_online: Record<string, number>;
}

export interface PlaygroundRunnerDelta {
  mode: "delta";
  revision: number;
  upsert?: PlaygroundRunnerMember;
  remove_actor_id?: string;
  reaction?: PlaygroundRunnerReaction;
  world_ids: string[];
  world_online?: Record<string, number>;
}

export type PlaygroundRunnerState =
  | PlaygroundRunnerProjection
  | PlaygroundRunnerDelta;

export interface PlaygroundRunnerSync {
  adapter: RunnerProtocolAdapter;
  projection(observerWorld?: string): PlaygroundRunnerProjection;
}

/**
 * Playground semantics for the common Runner path. Coordinates remain opaque
 * to the bridge; this Adapter is the only layer that knows what a World or a
 * transform means.
 */
export function createPlaygroundRunnerSync(
  onProjection?: (projection: PlaygroundRunnerState) => void,
): PlaygroundRunnerSync {
  const members = new Map<string, PlaygroundTransform>();
  const typing = new Map<string, boolean>();
  const reactions = new Map<string, PlaygroundRunnerReaction>();
  const actorConnections = new Map<string, number>();
  const presentations = new Map<string, PlaygroundRunnerPresentation>();
  let revision = 0;
  let appliedProjection: PlaygroundRunnerDelta | undefined;

  const projection = (
    observerWorld?: string,
  ): PlaygroundRunnerProjection => {
    const visibleActors = new Set(
      [...members.entries()]
        .filter(([, transform]) =>
          observerWorld ? transform.world_id === observerWorld : true,
        )
        .map(([actorId]) => actorId),
    );
    const worldOnline = projectWorldOnline(members);
    return {
      revision,
      world_online: worldOnline,
      members: [...members.entries()]
        .filter(([actorId]) => visibleActors.has(actorId))
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([actor_id, transform]) => ({
          actor_id,
          ...presentationFor(actor_id, presentations),
          transform,
          typing: typing.get(actor_id) ?? false,
        })),
      reactions: [...reactions.values()].filter(
        (reaction) =>
          reaction.expires_at > Date.now() &&
          visibleActors.has(reaction.target_actor_id),
      ),
    };
  };

  const adapter: RunnerProtocolAdapter = {
    protocol_id: PLAYGROUND_RUNNER_PROTOCOL,
    operations: [
      { kind: "transform", description: "Move this Actor in a shared Plaza world.", input_schema: {
        type: "object", properties: { type: { const: "transform" }, world_id: { enum: WORLD_IDS },
          x: { type: "number" }, y: { type: "number" }, z: { type: "number" }, yaw: { type: "number" }, pitch: { type: "number" },
          movement: { enum: ["idle", "walk"] }, pose: { enum: ["stand", "sit"] } },
        required: ["type", "world_id", "x", "y", "z", "yaw", "pitch", "movement", "pose"], additionalProperties: false,
      } },
      { kind: "typing", description: "Share whether this Actor is typing.", input_schema: { type: "object", properties: { type: { const: "typing" }, typing: { type: "boolean" } }, required: ["type", "typing"], additionalProperties: false } },
      { kind: "face_reaction", description: "React to another Actor in Plaza.", input_schema: { type: "object", properties: { type: { const: "face_reaction" }, target_actor_id: { type: "string", minLength: 8 }, emoji: { enum: PLAYGROUND_FACE_REACTIONS } }, required: ["type", "target_actor_id", "emoji"], additionalProperties: false } },
      { kind: "presentation", description: "Set this Actor's visible presentation. Presentation is not authentication or a grant.", input_schema: { type: "object", properties: { type: { const: "presentation" }, display_name: { type: "string", minLength: 1, maxLength: 80 }, animal_emoji: { type: "string", maxLength: 8 }, is_guest: { type: "boolean" }, social_principal_id: { type: "string", maxLength: 160 } }, required: ["type", "display_name", "animal_emoji", "is_guest"], additionalProperties: false } },
    ],
    validate(kind, payload): asserts payload is RunnerProtocolPayload {
      if (kind === "transform") return validateTransform(payload);
      if (kind === "typing") return validateTyping(payload);
      if (kind === "face_reaction") return validateFaceReaction(payload);
      if (kind === "presentation") return validatePresentation(payload);
      throw new Error("unsupported_operation");
    },
    apply(payload, authority: BrowserRunnerCapabilityClaims) {
      revision += 1;
      appliedProjection = undefined;
      if (payload.type === "transform") {
        const previousWorld = members.get(authority.actor_id)?.world_id;
        members.set(authority.actor_id, {
          ...(payload as unknown as PlaygroundTransform),
        });
        appliedProjection = {
          mode: "delta",
          revision,
          upsert: memberProjection(
            authority.actor_id,
            members,
            typing,
            presentations,
          ),
          world_ids: uniqueWorlds([
            previousWorld,
            (payload as unknown as PlaygroundTransform).world_id,
          ]),
        };
      } else if (payload.type === "typing") {
        typing.set(
          authority.actor_id,
          Boolean((payload as { typing?: unknown }).typing),
        );
        const member = memberProjection(
          authority.actor_id,
          members,
          typing,
          presentations,
        );
        appliedProjection = member
          ? {
              mode: "delta",
              revision,
              upsert: member,
              world_ids: [member.transform.world_id],
            }
          : undefined;
      } else if (payload.type === "face_reaction") {
        const reaction = payload as {
          target_actor_id?: unknown;
          emoji?: unknown;
        };
        const projectedReaction = {
          revision,
          from_actor_id: authority.actor_id,
          target_actor_id: String(reaction.target_actor_id),
          emoji: reaction.emoji as PlaygroundFaceReaction,
          expires_at: Date.now() + 2_400,
        };
        reactions.set(String(reaction.target_actor_id), projectedReaction);
        const targetWorld = members.get(projectedReaction.target_actor_id)?.world_id;
        appliedProjection = {
          mode: "delta",
          revision,
          reaction: projectedReaction,
          world_ids: uniqueWorlds([targetWorld]),
        };
      } else {
        const presentation = payload as unknown as PlaygroundRunnerPresentation;
        presentations.set(authority.actor_id, {
          display_name: presentation.display_name,
          animal_emoji: presentation.animal_emoji,
          is_guest: presentation.is_guest,
          ...(presentation.social_principal_id
            ? { social_principal_id: presentation.social_principal_id }
            : {}),
        });
        const member = memberProjection(
          authority.actor_id,
          members,
          typing,
          presentations,
        );
        appliedProjection = member
          ? {
              mode: "delta",
              revision,
              upsert: member,
              world_ids: [member.transform.world_id],
            }
          : undefined;
      }
      if (appliedProjection) {
        appliedProjection = {
          ...appliedProjection,
          world_online: projectWorldOnline(members),
        };
        onProjection?.(appliedProjection);
      }
    },
    actorAttached(authority) {
      actorConnections.set(
        authority.actor_id,
        (actorConnections.get(authority.actor_id) ?? 0) + 1,
      );
    },
    actorDetached(authority) {
      const remaining = (actorConnections.get(authority.actor_id) ?? 1) - 1;
      if (remaining > 0) {
        actorConnections.set(authority.actor_id, remaining);
        return;
      }
      actorConnections.delete(authority.actor_id);
      typing.delete(authority.actor_id);
      reactions.delete(authority.actor_id);
      presentations.delete(authority.actor_id);
      const previousWorld = members.get(authority.actor_id)?.world_id;
      if (!members.delete(authority.actor_id)) return;
      revision += 1;
      const detached: PlaygroundRunnerDelta = {
        mode: "delta",
        revision,
        remove_actor_id: authority.actor_id,
        world_ids: uniqueWorlds([previousWorld]),
        world_online: projectWorldOnline(members),
      };
      onProjection?.(detached);
      return { revision, summary: detached };
    },
    projectState: () => ({
      revision,
      summary: projection(),
    }),
    projectSnapshotFor: (observer) => ({
      revision,
      summary: projection(
        members.get(observer.actor_id)?.world_id ?? DEFAULT_WORLD_ID,
      ),
    }),
    projectAppliedState: () =>
      appliedProjection
        ? { revision: appliedProjection.revision, summary: appliedProjection }
        : undefined,
    observesProjection: (projected, observer) => {
      const state = projected.summary as Partial<PlaygroundRunnerDelta>;
      if (state.mode !== "delta" || state.world_ids?.length === 0) return true;
      const observerWorld = members.get(observer.actor_id)?.world_id;
      return !observerWorld || Boolean(state.world_ids?.includes(observerWorld));
    },
  };

  return { adapter, projection };
}

function memberProjection(
  actorId: string,
  members: ReadonlyMap<string, PlaygroundTransform>,
  typing: ReadonlyMap<string, boolean>,
  presentations: ReadonlyMap<string, PlaygroundRunnerPresentation>,
): PlaygroundRunnerMember | undefined {
  const transform = members.get(actorId);
  return transform
    ? {
        actor_id: actorId,
        ...presentationFor(actorId, presentations),
        transform,
        typing: typing.get(actorId) ?? false,
      }
    : undefined;
}

export interface PlaygroundRunnerPresentation {
  display_name: string;
  animal_emoji: string;
  is_guest: boolean;
  social_principal_id?: string;
}

const FALLBACK_ANIMALS = ["🦊", "🐼", "🐧", "🦉", "🐙", "🐯"] as const;

function presentationFor(
  actorId: string,
  presentations: ReadonlyMap<string, PlaygroundRunnerPresentation>,
): PlaygroundRunnerPresentation {
  const known = presentations.get(actorId);
  if (known) return known;
  let hash = 0;
  for (const character of actorId) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }
  return {
    display_name: `Actor ${actorId.slice(-6)}`,
    animal_emoji: FALLBACK_ANIMALS[hash % FALLBACK_ANIMALS.length],
    is_guest: true,
  };
}

function uniqueWorlds(worlds: Array<string | undefined>): string[] {
  return [...new Set(worlds.filter((world): world is string => Boolean(world)))];
}

function projectWorldOnline(
  members: ReadonlyMap<string, PlaygroundTransform>,
): Record<string, number> {
  return [...members.values()].reduce<Record<string, number>>(
    (counts, transform) => {
      counts[transform.world_id] = (counts[transform.world_id] ?? 0) + 1;
      return counts;
    },
    {},
  );
}

export function playgroundTransformPayload(
  transform: PlaygroundTransform,
): RunnerProtocolPayload {
  return { type: "transform", ...transform };
}

export function playgroundTypingPayload(
  typing: boolean,
): RunnerProtocolPayload {
  return { type: "typing", typing } as RunnerProtocolPayload;
}

export function playgroundFaceReactionPayload(
  targetActorId: string,
  emoji: PlaygroundFaceReaction,
): RunnerProtocolPayload {
  return {
    type: "face_reaction",
    target_actor_id: targetActorId,
    emoji,
  } as RunnerProtocolPayload;
}

export function playgroundPresentationPayload(
  presentation: PlaygroundRunnerPresentation,
): RunnerProtocolPayload {
  return { type: "presentation", ...presentation } as RunnerProtocolPayload;
}

function validateTransform(value: unknown): asserts value is RunnerProtocolPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("invalid_transform");
  }
  const transform = value as Record<string, unknown>;
  if (
    transform.type !== "transform" ||
    !isWorldId(transform.world_id) ||
    !finite(transform.x) ||
    !finite(transform.y) ||
    !finite(transform.z) ||
    !finite(transform.yaw) ||
    !finite(transform.pitch) ||
    (transform.movement !== "idle" && transform.movement !== "walk") ||
    (transform.pose !== "stand" && transform.pose !== "sit")
  ) {
    throw new Error("invalid_transform");
  }
}

function validatePresentation(value: unknown): asserts value is RunnerProtocolPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("invalid_presentation");
  }
  const presentation = value as Record<string, unknown>;
  if (
    presentation.type !== "presentation" ||
    typeof presentation.display_name !== "string" ||
    presentation.display_name.trim().length === 0 ||
    [...presentation.display_name].length > 80 ||
    typeof presentation.animal_emoji !== "string" ||
    [...presentation.animal_emoji].length > 8 ||
    typeof presentation.is_guest !== "boolean" ||
    (presentation.social_principal_id !== undefined &&
      (typeof presentation.social_principal_id !== "string" ||
        presentation.social_principal_id.length > 160))
  ) {
    throw new Error("invalid_presentation");
  }
}

function validateTyping(value: unknown): asserts value is RunnerProtocolPayload {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    (value as { type?: unknown }).type !== "typing" ||
    typeof (value as { typing?: unknown }).typing !== "boolean"
  ) {
    throw new Error("invalid_typing");
  }
}

function validateFaceReaction(
  value: unknown,
): asserts value is RunnerProtocolPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("invalid_face_reaction");
  }
  const reaction = value as Record<string, unknown>;
  if (
    reaction.type !== "face_reaction" ||
    typeof reaction.target_actor_id !== "string" ||
    reaction.target_actor_id.length < 8 ||
    !PLAYGROUND_FACE_REACTIONS.includes(
      reaction.emoji as PlaygroundFaceReaction,
    )
  ) {
    throw new Error("invalid_face_reaction");
  }
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
