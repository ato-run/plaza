/**
 * Plaza over an App Room (per-instance shared-state lane).
 *
 * The durable lane reuses `playgroundStore`'s seq-ordered reducer UNCHANGED:
 * App Room op events are translated here into the `PlaygroundEvent` shapes
 * the reducer already understands (`post.created`, `post.deleted`,
 * `reaction.added/removed`), with the op's server-recorded `actor_id` as
 * the author. Authorship is unforgeable — identity is edge-injected, never
 * taken from the wire — so author-only rules (delete your own post) are
 * enforced at this translation, not in the UI.
 *
 * Two translation rules keep the log moving forward:
 *
 *  - An op that is invalid (delete by a stranger, unknown shape) still
 *    advances the cursor: it maps to a no-op delete of an empty id, which
 *    the reducer applies as cursor-only. Dropping a seq would wedge every
 *    later event behind the gap; stalling the log on one bad op would let
 *    anyone halt the room.
 *  - Posts carry their World. A post for another World maps to the same
 *    cursor-only no-op, so one room log serves all Worlds and each World
 *    sees its own conversation.
 */

import {
  applyBootstrap as applyLobbyBootstrap,
  createPlaygroundState,
  type PlaygroundState,
} from "./playgroundStore";
import {
  DEFAULT_WORLD_ID,
  isWorldId,
  type WorldId,
} from "./world/types";
import type {
  PlaygroundBootstrap,
  PlaygroundEvent,
  PlaygroundPost,
  PlaygroundViewer,
} from "./types";

/** App Room `state_schema_id` for every Plaza op and seal. */
export const PLAZA_ROOM_SCHEMA_ID = "plaza.room@1" as const;

/** App Room wire protocol all room REST bodies carry. */
export const APP_ROOM_PROTOCOL = "ato.app-room@1" as const;

/** REST + WS prefix, same-origin on the instance host. */
export const APP_ROOM_API_PREFIX = "/__ato/app-room";

/** Public catalogue card projections, same-origin on the instance host. */
export const CATALOG_CARDS_PATH = "/__ato/catalog/cards";

export const PLAZA_EPHEMERAL_TRANSFORM_KIND = "plaza.transform" as const;
export const PLAZA_EPHEMERAL_FACE_REACTION_KIND = "plaza.face-reaction" as const;

/** Sealed state keeps the latest N posts; older ones live in the suffix. */
export const PLAZA_SEAL_POST_LIMIT = 200;
/** A publisher re-seals once the unsealed drift passes this many ops. */
export const PLAZA_SEAL_DRIFT_OPS = 200;

export type PlazaOp =
  | {
      t: "post";
      post: {
        id: string;
        world: WorldId;
        kind: "text";
        text: string;
        app_ref: string | null;
        activity_ref: string | null;
        created_at: string;
      };
    }
  | { t: "post.deleted"; post_id: string }
  | { t: "reaction"; post_id: string; reaction: string }
  | { t: "unreaction"; post_id: string; reaction: string };

export interface AppRoomOpEvent {
  kind: "op";
  seq: number;
  operation_id: string;
  actor_id: string;
  actor_kind: "account" | "guest";
  state_schema_id: string;
  room_epoch: number;
  op: unknown;
}

export interface AppRoomCheckpointMeta {
  base_cursor: number;
  seq: number;
  revision_id: string | null;
  content_digest: string;
  byte_size: number;
  state_schema_id: string;
  room_epoch: number;
}

export interface AppRoomBootstrap {
  room_epoch: number;
  checkpoint: AppRoomCheckpointMeta | null;
  checkpoint_payload: unknown;
  events: AppRoomOpEvent[];
  high_water_cursor: number;
  min_available_cursor: number;
  open_posting: boolean;
}

export interface AppRoomEventsPage {
  room_epoch: number;
  events: AppRoomOpEvent[];
  high_water_cursor: number;
  min_available_cursor: number;
}

export interface AppRoomParticipant {
  principal_id: string;
  display_name: string;
  animal_emoji: string;
  color: string;
  role: "owner" | "editor" | "viewer";
  presence: { type: string; typing?: boolean } | null;
  typing: boolean;
  ephemeral?: {
    kind: string;
    scope: string | null;
    payload: unknown;
    expires_at: number;
  } | null;
}

export interface AppRoomHello {
  self: AppRoomParticipant;
  role: "owner" | "editor" | "viewer";
  actor_kind?: "account" | "guest";
  online: number;
  room_epoch: number;
  open_posting: boolean;
}

export function newOperationId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `op-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function postOp(
  text: string,
  world: WorldId,
): { op: PlazaOp; postId: string } {
  const postId = newOperationId();
  return {
    op: {
      t: "post",
      post: {
        id: postId,
        world: world,
        kind: "text",
        text,
        app_ref: null,
        activity_ref: null,
        created_at: new Date().toISOString(),
      },
    },
    postId,
  };
}

/** Cursor-only no-op: advances past an op that must not take effect. */
function noopEvent(seq: number, operationId: string): PlaygroundEvent {
  return {
    seq,
    operation_id: operationId,
    room_id: "room",
    kind: "post.deleted",
    entity_id: "",
    payload: {},
    created_at: new Date().toISOString(),
  };
}

function isPlazaOp(op: unknown): op is PlazaOp {
  if (!op || typeof op !== "object" || Array.isArray(op)) return false;
  const t = (op as { t?: unknown }).t;
  return (
    t === "post" || t === "post.deleted" || t === "reaction" || t === "unreaction"
  );
}

/**
 * Translate one App Room op into the durable lane. `known` is the current
 * post map, needed for the author-only delete rule; `world` filters to the
 * viewer's World. Invalid and foreign-World ops become cursor-only no-ops.
 */
export function roomOpToEvent(
  event: AppRoomOpEvent,
  known: ReadonlyMap<string, PlaygroundPost>,
  world: WorldId,
): PlaygroundEvent {
  const base = {
    seq: event.seq,
    operation_id: event.operation_id,
    room_id: "room",
    created_at: new Date().toISOString(),
  };
  if (!isPlazaOp(event.op)) return noopEvent(event.seq, event.operation_id);
  switch (event.op.t) {
    case "post": {
      const post = event.op.post;
      if (
        typeof post?.id !== "string" ||
        post.kind !== "text" ||
        typeof post.text !== "string" ||
        !isWorldId(post.world) ||
        post.world !== world
      ) {
        return noopEvent(event.seq, event.operation_id);
      }
      return {
        ...base,
        kind: "post.created",
        entity_id: post.id,
        payload: {
          id: post.id,
          author_user_id: event.actor_id,
          kind: "text",
          text: post.text,
          public_app_ref: post.app_ref ?? null,
          public_activity_ref: post.activity_ref ?? null,
          created_at: post.created_at,
          world: post.world,
        },
      };
    }
    case "post.deleted": {
      const existing = known.get(event.op.post_id);
      // Author-only, enforced here — not in the UI. A stranger's delete
      // still advances the cursor so the log never wedges on abuse.
      if (!existing || existing.author_user_id !== event.actor_id) {
        return noopEvent(event.seq, event.operation_id);
      }
      return {
        ...base,
        kind: "post.deleted",
        entity_id: event.op.post_id,
        payload: {},
      };
    }
    case "reaction":
    case "unreaction": {
      if (
        typeof event.op.post_id !== "string" ||
        typeof event.op.reaction !== "string" ||
        !known.has(event.op.post_id)
      ) {
        return noopEvent(event.seq, event.operation_id);
      }
      return {
        ...base,
        kind: event.op.t === "reaction" ? "reaction.added" : "reaction.removed",
        entity_id: event.op.post_id,
        payload: {
          post_id: event.op.post_id,
          user_id: event.actor_id,
          reaction: event.op.reaction,
        },
      };
    }
  }
}

/**
 * Map a whole suffix page, evolving a scratch post map in seq order so
 * same-page pairs (create then reaction, create then delete) resolve the
 * way the reducer will apply them. Unknown/invalid/foreign ops become
 * cursor-only no-ops and never stall the page.
 */
export function mapRoomEventsPage(
  events: AppRoomOpEvent[],
  known: ReadonlyMap<string, PlaygroundPost>,
  world: WorldId,
): PlaygroundEvent[] {
  const scratch = new Map(known);
  return events.map((event) => {
    const mapped = roomOpToEvent(event, scratch, world);
    if (mapped.kind === "post.created") {
      const post = postFromMapped(mapped);
      if (post) scratch.set(post.id, post);
    } else if (mapped.kind === "post.deleted") {
      scratch.delete(mapped.entity_id);
    }
    return mapped;
  });
}

function postFromMapped(event: PlaygroundEvent): PlaygroundPost | null {
  if (event.kind !== "post.created") return null;
  const raw = event.payload as Record<string, unknown>;
  if (typeof raw.id !== "string") return null;
  const world = raw.world;
  return {
    id: raw.id,
    author_user_id: typeof raw.author_user_id === "string" ? raw.author_user_id : "",
    kind: "text",
    text: typeof raw.text === "string" ? raw.text : null,
    app_ref: typeof raw.public_app_ref === "string" ? raw.public_app_ref : null,
    activity_ref:
      typeof raw.public_activity_ref === "string" ? raw.public_activity_ref : null,
    created_at: typeof raw.created_at === "string" ? raw.created_at : new Date().toISOString(),
    reactions: {},
    viewer_reactions: [],
    world: isWorldId(world) ? world : null,
  };
}
/** Sealed Plaza state: the latest posts plus the cursor they cover. */
export interface PlazaSealPayload {
  v: 1;
  posts: PlaygroundPost[];
  cursor: number;
}

export function buildSealPayload(state: PlaygroundState): PlazaSealPayload {
  const posts = state.order
    .map((id) => state.posts.get(id))
    .filter((post): post is PlaygroundPost => Boolean(post))
    .slice(-PLAZA_SEAL_POST_LIMIT);
  return { v: 1, posts, cursor: state.cursor };
}

function isSealPayload(value: unknown): value is PlazaSealPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const seal = value as Record<string, unknown>;
  return seal.v === 1 && Array.isArray(seal.posts) && typeof seal.cursor === "number";
}

/**
 * Bootstrap the durable lane from a room seal + suffix, for one World.
 * The seal holds ALL Worlds' posts (with World tags); only this World's
 * posts (plus untagged legacy posts) restore. Mutes are viewer-local (the
 * room has no per-user store): they pass through from the previous state.
 */
export function roomBootstrapToState(
  previous: PlaygroundState,
  viewer: PlaygroundViewer,
  seal: unknown,
  online: number,
  world: WorldId,
): PlaygroundState {
  const posts = new Map<string, PlaygroundPost>();
  const order: string[] = [];
  let cursor = 0;
  if (isSealPayload(seal)) {
    for (const post of seal.posts) {
      if (!post || typeof post.id !== "string" || posts.has(post.id)) continue;
      const postWorld = isWorldId(post.world) ? post.world : null;
      if (postWorld !== null && postWorld !== world) continue;
      posts.set(post.id, {
        ...post,
        reactions: post.reactions ?? {},
        viewer_reactions: post.viewer_reactions ?? [],
      });
      order.push(post.id);
    }
    cursor = seal.cursor;
  }
  const bootstrap: PlaygroundBootstrap = {
    room_id: "room",
    viewer,
    posts: order.map((id) => posts.get(id) as PlaygroundPost),
    cards: { apps: {}, activities: {} },
    muted_user_ids: [...previous.mutedUserIds],
    cursor,
    online,
  };
  // Live events that arrived before the seal resolved replay through the
  // fresh bootstrap — dropping them would lose posts, not just delay them.
  // (World switches pass a fresh previous, so no stale-World replay.)
  return applyLobbyBootstrap(
    { ...createPlaygroundState(), pending: previous.pending },
    bootstrap,
  );
}

/**
 * Who the room says you are. Display identity is the room pseudonym
 * (adjective + animal) for everyone — the room never sees account data.
 * Posting needs owner/editor, or viewer with the room opened for posting.
 */
export function viewerFromHello(
  hello: Pick<AppRoomHello, "self" | "role" | "actor_kind" | "open_posting">,
): PlaygroundViewer {
  const isGuest = hello.actor_kind === "guest" || hello.self.principal_id.startsWith("guest:");
  const canPost =
    hello.role === "owner" ||
    hello.role === "editor" ||
    (hello.role === "viewer" && hello.open_posting);
  return {
    signed_in: !isGuest,
    can_post: canPost,
    principal_id: hello.self.principal_id,
    display_name: hello.self.display_name,
    animal_emoji: hello.self.animal_emoji,
    is_guest: isGuest,
  };
}

/** World of a participant: its live ephemeral scope, else the given fallback. */
export function worldOfParticipant(
  participant: AppRoomParticipant,
  fallback: WorldId,
): WorldId {
  const scope = participant.ephemeral?.scope;
  if (
    scope &&
    participant.ephemeral &&
    participant.ephemeral.expires_at > Date.now() &&
    isWorldId(scope)
  ) {
    return scope;
  }
  return fallback;
}

export function defaultWorld(): WorldId {
  return DEFAULT_WORLD_ID;
}
