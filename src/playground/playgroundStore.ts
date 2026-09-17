/**
 * Pure reducer for Playground room state — no React, no WebSocket, so the
 * cursor/catch-up/mute logic is testable without a socket.
 *
 * Two invariants this file exists to hold:
 *
 *  1. `seq` is the only ordering authority. An event whose `seq` is <= the
 *     applied cursor is a duplicate (retry, reconnect replay, or a live event
 *     already covered by a REST catch-up). Crucially, a HIGHER seq arriving
 *     first must not advance the cursor past a gap — otherwise the missing
 *     lower seq is marked fetched and never delivered. Out-of-order arrivals
 *     are therefore held aside until the gap fills.
 *
 *  2. The server speaks two dialects for the same post and the client
 *     normalizes them here. The bootstrap PROJECTION renames the columns
 *     (`app_ref`, `activity_ref`) and nests reaction counts, while the
 *     durable EVENT payload carries the raw column names
 *     (`public_app_ref`, `public_activity_ref`) and no counts at all —
 *     reaction events are `{post_id, user_id, reaction}`, so counts are
 *     derived by applying the delta. Normalizing at the edge keeps that
 *     difference out of the UI.
 */
import type {
  PlaygroundBootstrap,
  PlaygroundCards,
  PlaygroundEvent,
  PlaygroundPost,
  PlaygroundViewer,
} from "./types";
import { isWorldId } from "./world/types";

export interface PlaygroundState {
  roomId: string | null;
  viewer: PlaygroundViewer | null;
  posts: Map<string, PlaygroundPost>;
  order: string[];
  cards: PlaygroundCards;
  mutedUserIds: Set<string>;
  cursor: number;
  online: number;
  /** Live events received before bootstrap resolved, or ahead of a gap. */
  pending: PlaygroundEvent[];
  bootstrapped: boolean;
}

export function createPlaygroundState(): PlaygroundState {
  return {
    roomId: null,
    viewer: null,
    posts: new Map(),
    order: [],
    cards: { apps: {}, activities: {} },
    mutedUserIds: new Set(),
    cursor: 0,
    online: 0,
    pending: [],
    bootstrapped: false,
  };
}

/** The event payload's raw column names, normalized to the projection's. */
function postFromEventPayload(payload: unknown): PlaygroundPost | null {
  if (!payload || typeof payload !== "object") return null;
  const raw = payload as Record<string, unknown>;
  if (typeof raw.id !== "string") return null;
  const world = raw.world;
  return {
    id: raw.id,
    author_actor: raw.author_actor as
      | import("./types").VerifiedActorMetadata
      | undefined,
    author_user_id:
      typeof raw.author_user_id === "string" ? raw.author_user_id : "",
    kind: (raw.kind as PlaygroundPost["kind"]) ?? "text",
    text: typeof raw.text === "string" ? raw.text : null,
    app_ref:
      typeof raw.public_app_ref === "string"
        ? raw.public_app_ref
        : typeof raw.app_ref === "string"
          ? raw.app_ref
          : null,
    activity_ref:
      typeof raw.public_activity_ref === "string"
        ? raw.public_activity_ref
        : typeof raw.activity_ref === "string"
          ? raw.activity_ref
          : null,
    created_at:
      typeof raw.created_at === "string" ? raw.created_at : new Date().toISOString(),
    reactions: {},
    viewer_reactions: [],
    // App Room ops carry the World; legacy server payloads predate it and
    // stay undefined (the server filtered before sending).
    world: isWorldId(world) ? world : undefined,
  };
}

export function applyBootstrap(
  state: PlaygroundState,
  bootstrap: PlaygroundBootstrap,
): PlaygroundState {
  const posts = new Map<string, PlaygroundPost>();
  const order: string[] = [];
  for (const post of bootstrap.posts) {
    posts.set(post.id, post);
    order.push(post.id);
  }
  const next: PlaygroundState = {
    roomId: bootstrap.room_id,
    viewer: bootstrap.viewer,
    posts,
    order,
    cards: bootstrap.cards ?? { apps: {}, activities: {} },
    mutedUserIds: new Set(bootstrap.muted_user_ids),
    cursor: bootstrap.cursor,
    online: bootstrap.online,
    pending: [],
    bootstrapped: true,
  };
  // Replay whatever the socket delivered while bootstrap was in flight. The
  // server reads its cursor BEFORE the posts, so the overlap direction is
  // safe: we may re-see an event we already have and drop it by seq, rather
  // than miss one.
  return drain({ ...next, pending: [...state.pending] });
}

export function bufferEvent(
  state: PlaygroundState,
  event: PlaygroundEvent,
): PlaygroundState {
  return drain({ ...state, pending: [...state.pending, event] });
}

/**
 * Apply every buffered event that is exactly next in sequence, holding the
 * rest. Before bootstrap nothing can be applied, because the cursor those
 * events must be judged against is not known yet.
 */
function drain(state: PlaygroundState): PlaygroundState {
  if (!state.bootstrapped) return state;
  let current = state;
  for (;;) {
    const ready = current.pending
      .filter((event) => event.seq <= current.cursor + 1)
      .sort((a, b) => a.seq - b.seq);
    if (ready.length === 0) return current;
    const applied = ready.reduce(applyOrdered, {
      ...current,
      pending: current.pending.filter(
        (event) => !ready.some((r) => r.seq === event.seq),
      ),
    });
    if (applied.cursor === current.cursor && applied.pending.length === current.pending.length) {
      return applied;
    }
    current = applied;
  }
}

/** Apply one event that is known to be in order (or a duplicate). */
function applyOrdered(
  state: PlaygroundState,
  event: PlaygroundEvent,
): PlaygroundState {
  if (event.seq <= state.cursor) return state; // duplicate
  const cursor = event.seq;
  switch (event.kind) {
    case "post.created": {
      const post = postFromEventPayload(event.payload);
      if (!post || state.posts.has(post.id)) return { ...state, cursor };
      const posts = new Map(state.posts);
      posts.set(post.id, post);
      return { ...state, posts, order: [...state.order, post.id], cursor };
    }
    case "post.deleted": {
      const postId = event.entity_id;
      if (!state.posts.has(postId)) return { ...state, cursor };
      const posts = new Map(state.posts);
      posts.delete(postId);
      return {
        ...state,
        posts,
        order: state.order.filter((id) => id !== postId),
        cursor,
      };
    }
    case "reaction.added":
    case "reaction.removed": {
      const raw = (event.payload ?? {}) as Record<string, unknown>;
      const postId =
        typeof raw.post_id === "string" ? raw.post_id : event.entity_id;
      const reaction = typeof raw.reaction === "string" ? raw.reaction : null;
      const userId = typeof raw.user_id === "string" ? raw.user_id : null;
      const existing = state.posts.get(postId);
      if (!existing || !reaction) return { ...state, cursor };

      const delta = event.kind === "reaction.added" ? 1 : -1;
      const count = (existing.reactions[reaction] ?? 0) + delta;
      const reactions = { ...existing.reactions };
      if (count > 0) reactions[reaction] = count;
      else delete reactions[reaction];

      // Whether it was THIS viewer is decided by the principal the server
      // gave us, never by optimistic local bookkeeping.
      let viewer_reactions = existing.viewer_reactions;
      if (userId && state.viewer && userId === state.viewer.principal_id) {
        viewer_reactions =
          delta > 0
            ? [...new Set([...viewer_reactions, reaction])]
            : viewer_reactions.filter((item) => item !== reaction);
      }

      const posts = new Map(state.posts);
      posts.set(postId, { ...existing, reactions, viewer_reactions });
      return { ...state, posts, cursor };
    }
    default:
      return { ...state, cursor };
  }
}

/** Apply a REST catch-up page, then whatever that unblocked. */
export function applyEventsPage(
  state: PlaygroundState,
  events: PlaygroundEvent[],
  cursor: number,
): PlaygroundState {
  const next = drain({
    ...state,
    pending: [...state.pending, ...events],
  });
  // The page's cursor is the server's high-water at read time. Trust it only
  // when nothing is still held back by a gap, otherwise it would skip them.
  if (next.pending.length === 0 && cursor > next.cursor) {
    return { ...next, cursor };
  }
  return next;
}

export function setOnline(
  state: PlaygroundState,
  online: number,
): PlaygroundState {
  return { ...state, online };
}

export function mute(
  state: PlaygroundState,
  mutedUserId: string,
): PlaygroundState {
  const mutedUserIds = new Set(state.mutedUserIds);
  mutedUserIds.add(mutedUserId);
  return { ...state, mutedUserIds };
}

export function unmute(
  state: PlaygroundState,
  mutedUserId: string,
): PlaygroundState {
  const mutedUserIds = new Set(state.mutedUserIds);
  mutedUserIds.delete(mutedUserId);
  return { ...state, mutedUserIds };
}

/**
 * True when the client knows it is behind the server. `sync` exists because a
 * lost LAST broadcast is otherwise invisible — there is no later message to
 * notice the gap with.
 */
export function isBehind(
  state: PlaygroundState,
  highWaterCursor: number,
): boolean {
  return highWaterCursor > state.cursor;
}

/** Chronological, non-muted posts — the only view the UI reads. */
export function visiblePosts(state: PlaygroundState): PlaygroundPost[] {
  return state.order
    .map((id) => state.posts.get(id))
    .filter((post): post is PlaygroundPost => {
      if (!post) return false;
      return !state.mutedUserIds.has(post.author_user_id);
    });
}
