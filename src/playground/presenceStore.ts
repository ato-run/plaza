/**
 * The EPHEMERAL lane, kept deliberately away from `playgroundStore`.
 *
 * Two stores rather than one because the two lanes have opposite rules and
 * mixing them is how position data ends up in a database:
 *
 *   `playgroundStore`  durable. D1 is canonical, `seq` orders everything,
 *                      a gap must block, history survives reload.
 *   `presenceStore`    ephemeral. Newest wins, gaps are irrelevant, nothing
 *                      is persisted anywhere, and everything expires.
 *
 * Transforms and face reactions are presence: they never carry a `seq`, never
 * advance the durable cursor, and are never written to D1. A chat bubble is
 * the one crossing point — the MESSAGE is durable and lives in the other
 * store; only its short-lived appearance above a head is tracked here.
 */
import type {
  PlaygroundParticipant,
  PlaygroundWorldId,
  PlaygroundWorldOnline,
} from "./types";
import { sanitizeTransform, type RemoteTransform } from "./world/worldMath";
import { DEFAULT_WORLD_ID, worldIdOr } from "./world/types";

/** How long a speech bubble stays up. Matches the reference. */
export const SPEECH_TTL_MS = 8000;
/** How long a reaction floats above a head. */
export const REACTION_TTL_MS = 2400;
/** Drop anyone who has not reported a transform in this long. */
export const PARTICIPANT_TTL_MS = 20000;

export interface PresenceMember {
  principal_id: string;
  display_name: string;
  animal_emoji: string;
  is_guest: boolean;
  /** Which World they are standing in. Only same-World people are drawn. */
  world_id: PlaygroundWorldId;
  typing: boolean;
  /** Last reported transform, or null until they first move. */
  transform: RemoteTransform | null;
  /** Monotonic clock reading of the last transform. */
  lastTransformAt: number;
  speech: { text: string; until: number } | null;
  reaction: { emoji: string; until: number } | null;
}

/**
 * A reaction aimed at the local viewer.
 *
 * It cannot be drawn the way every other reaction is. Reactions render above
 * the target's head, and the viewer has no avatar in their own first-person
 * view by design — so a reaction aimed at you has no head to sit above, and
 * silently vanished. The sender saw it land; the recipient never knew it
 * happened, which is the half that matters for "somebody waved at me".
 *
 * It carries WHO reacted, because that is the part the viewer cannot infer:
 * they can see the emoji, but not whose 👋 it was.
 */
export interface SelfReaction {
  emoji: string;
  from_display_name: string;
  from_animal_emoji: string;
  until: number;
}

export interface PresenceState {
  self: PlaygroundParticipant | null;
  members: Map<string, PresenceMember>;
  online: number;
  /** Head count per World, for the selector. Global, not World-scoped. */
  worldOnline: PlaygroundWorldOnline;
  /** The World this client is in; the filter for who gets an avatar. */
  worldId: PlaygroundWorldId;
  /** Reaction aimed at the viewer, shown on their own HUD. */
  selfReaction: SelfReaction | null;
}

export function createPresenceState(): PresenceState {
  return {
    self: null,
    members: new Map(),
    online: 0,
    worldOnline: {},
    worldId: DEFAULT_WORLD_ID,
    selfReaction: null,
  };
}

/**
 * Enter a World.
 *
 * The roster is CLEARED, not filtered. The server re-sends a snapshot scoped
 * to the new World, and keeping the old members until it arrives would leave
 * the previous World's people standing in this one for a moment — the exact
 * "stale avatar" artefact that makes a place feel haunted.
 */
export function enterWorld(
  state: PresenceState,
  worldId: PlaygroundWorldId,
): PresenceState {
  if (state.worldId === worldId) return state;
  return { ...state, worldId, members: new Map(), selfReaction: null };
}

/** Only the people in the viewer's own World are drawn. */
export function visibleMembers(state: PresenceState): PresenceMember[] {
  return [...state.members.values()].filter(
    (member) => member.world_id === state.worldId,
  );
}

function baseMember(
  participant: PlaygroundParticipant,
  now: number,
): PresenceMember {
  return {
    principal_id: participant.principal_id,
    display_name: participant.display_name,
    animal_emoji: participant.animal_emoji,
    is_guest: participant.is_guest,
    world_id: worldIdOr(participant.world_id),
    typing: participant.typing,
    transform: sanitizeTransform(
      (participant as { transform?: unknown }).transform,
    ),
    lastTransformAt: now,
    speech: null,
    reaction: null,
  };
}

/**
 * Merge a participant record, preserving anything already known.
 *
 * `snapshot` and `join` may arrive after transforms have started flowing
 * (a reconnect replays the roster), so a naive overwrite would throw away a
 * live position and teleport the avatar back to its spawn point.
 */
function mergeParticipant(
  existing: PresenceMember | undefined,
  participant: PlaygroundParticipant,
  now: number,
): PresenceMember {
  const incoming = baseMember(participant, now);
  if (!existing) return incoming;
  return {
    ...existing,
    display_name: participant.display_name,
    animal_emoji: participant.animal_emoji,
    is_guest: participant.is_guest,
    world_id: worldIdOr(participant.world_id, existing.world_id),
    typing: participant.typing,
    transform: incoming.transform ?? existing.transform,
    lastTransformAt: incoming.transform ? now : existing.lastTransformAt,
  };
}

export function applySnapshot(
  state: PresenceState,
  participants: readonly PlaygroundParticipant[],
  online: number,
  now: number,
  worldOnline?: PlaygroundWorldOnline,
): PresenceState {
  const members = new Map<string, PresenceMember>();
  for (const participant of participants) {
    members.set(
      participant.principal_id,
      mergeParticipant(state.members.get(participant.principal_id), participant, now),
    );
  }
  return {
    ...state,
    members,
    online,
    worldOnline: worldOnline ?? state.worldOnline,
  };
}

export function applyJoin(
  state: PresenceState,
  participant: PlaygroundParticipant,
  online: number,
  now: number,
): PresenceState {
  const members = new Map(state.members);
  members.set(
    participant.principal_id,
    mergeParticipant(members.get(participant.principal_id), participant, now),
  );
  return { ...state, members, online };
}

export function applyLeave(
  state: PresenceState,
  principalId: string,
  online: number,
): PresenceState {
  const members = new Map(state.members);
  members.delete(principalId);
  return { ...state, members, online };
}

export function applyTyping(
  state: PresenceState,
  principalId: string,
  typing: boolean,
): PresenceState {
  const existing = state.members.get(principalId);
  if (!existing) return state;
  const members = new Map(state.members);
  members.set(principalId, { ...existing, typing });
  return { ...state, members };
}

/**
 * A transform for somebody not in the roster still creates them.
 *
 * Losing a `join` (a dropped frame, a reconnect race) would otherwise leave a
 * person permanently invisible even though their position is arriving —
 * far worse than showing an avatar whose display name is briefly unknown.
 */
export function applyTransform(
  state: PresenceState,
  principalId: string,
  raw: unknown,
  now: number,
): PresenceState {
  const transform = sanitizeTransform(raw);
  if (!transform) return state;
  const existing = state.members.get(principalId);
  const members = new Map(state.members);
  members.set(principalId, {
    ...(existing ?? {
      principal_id: principalId,
      display_name: "",
      animal_emoji: "",
      is_guest: true,
      // A transform is only ever relayed within one World, so one arriving
      // for somebody unknown means they are HERE — assuming the viewer's own
      // World is what keeps them visible instead of invisibly filtered.
      world_id: state.worldId,
      typing: false,
      speech: null,
      reaction: null,
    }),
    principal_id: principalId,
    transform,
    lastTransformAt: now,
  } as PresenceMember);
  return { ...state, members };
}

export function applyFaceReaction(
  state: PresenceState,
  targetPrincipalId: string,
  emoji: string,
  now: number,
  fromPrincipalId?: string,
): PresenceState {
  // Aimed at the viewer: there is no avatar of your own to hang it on, so it
  // goes to the HUD instead of being dropped. Checked BEFORE `members`, since
  // a second tab of the same account puts the viewer's own principal in the
  // member map too — and a reaction aimed at you should read as "you", not as
  // a floating emoji over a copy of yourself across the plaza.
  if (state.self && targetPrincipalId === state.self.principal_id) {
    const sender = fromPrincipalId
      ? state.members.get(fromPrincipalId)
      : undefined;
    return {
      ...state,
      selfReaction: {
        emoji,
        from_display_name: sender?.display_name ?? "",
        from_animal_emoji: sender?.animal_emoji ?? "",
        until: now + REACTION_TTL_MS,
      },
    };
  }
  const existing = state.members.get(targetPrincipalId);
  if (!existing) return state;
  const members = new Map(state.members);
  members.set(targetPrincipalId, {
    ...existing,
    reaction: { emoji, until: now + REACTION_TTL_MS },
  });
  return { ...state, members };
}

/**
 * Show a durable post as a transient bubble above its author.
 *
 * The post itself is already in the durable store; this only decides that a
 * bubble is visible for the next few seconds. Posts loaded from bootstrap
 * deliberately do NOT come through here — replaying an hour of history as
 * simultaneous speech bubbles would be nonsense.
 */
export function applySpeech(
  state: PresenceState,
  principalId: string,
  text: string,
  now: number,
): PresenceState {
  const existing = state.members.get(principalId);
  if (!existing) return state;
  const members = new Map(state.members);
  members.set(principalId, {
    ...existing,
    speech: { text, until: now + SPEECH_TTL_MS },
  });
  return { ...state, members };
}

/**
 * Drop expired bubbles, reactions and stale participants.
 *
 * Called from the render loop rather than a timer: expiry only matters when
 * something is being drawn, and a background tab should not keep waking up
 * to prune a scene nobody is looking at.
 */
export function expire(state: PresenceState, now: number): PresenceState {
  let changed = false;
  const members = new Map<string, PresenceMember>();
  for (const [id, member] of state.members) {
    if (member.transform && now - member.lastTransformAt > PARTICIPANT_TTL_MS) {
      changed = true;
      continue;
    }
    let next = member;
    if (member.speech && member.speech.until <= now) {
      next = { ...next, speech: null };
      changed = true;
    }
    if (member.reaction && member.reaction.until <= now) {
      next = { ...next, reaction: null };
      changed = true;
    }
    members.set(id, next);
  }
  // The viewer's own reaction expires on the same sweep. Without this the HUD
  // would hold the last 👋 for the rest of the session.
  if (state.selfReaction && state.selfReaction.until <= now) {
    return { ...state, members, selfReaction: null };
  }
  return changed ? { ...state, members } : state;
}

/** The principal id a post's author would have, if they are here. */
export function principalIdForAuthor(authorUserId: string): string {
  return `user:${authorUserId}`;
}
