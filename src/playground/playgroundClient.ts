/**
 * Playground REST client — SAME-ORIGIN, by design.
 *
 * Playground is served from its own canonical app host, so this lane has no
 * `accountApiBase()` and sends no bearer token. Identity is the host's own
 * cookie, resolved server-side by the same session resolver a Personal App
 * uses; the browser's job is simply to send credentials and let the server
 * decide. Putting a token in here would create a second, weaker way to prove
 * who you are — the thing the app-host migration exists to remove.
 *
 * `credentials: "same-origin"` is explicit rather than defaulted: this code
 * also runs under tests and dev where the default could differ, and the
 * cookie IS the authentication.
 */
import type {
  PlaygroundBootstrap,
  PlaygroundEvent,
  PlaygroundEventsPage,
  PlaygroundReaction,
} from "./types";
import type { PlaygroundWorldId } from "./types";

export class PlaygroundApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(typeof message === "string" && message ? message : code);
  }
}

/** The one place the API prefix is written down. */
export const PLAYGROUND_API_PREFIX = "/__ato/playground";

export const PLAYGROUND_ROOM_ID = "global-v1";

async function request<T>(
  path: string,
  options: { method?: "GET" | "POST" | "DELETE"; body?: unknown } = {},
): Promise<T> {
  const response = await fetch(`${PLAYGROUND_API_PREFIX}${path}`, {
    method: options.method ?? "GET",
    headers: {
      Accept: "application/json",
      ...(options.body === undefined
        ? {}
        : { "Content-Type": "application/json" }),
    },
    credentials: "same-origin",
    cache: "no-store",
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const payload = (await response.json().catch(() => ({}))) as {
    error?: string;
    message?: string;
  };
  if (!response.ok) {
    throw new PlaygroundApiError(
      response.status,
      payload.error ?? `http_${response.status}`,
      payload.message ?? "",
    );
  }
  return payload as T;
}

/**
 * The socket lives on this same origin. Derived from `location` rather than
 * from configuration: the document was served by the canonical host, so the
 * host that served it is by definition the right one to talk to, and there
 * is no configured value that could point it somewhere else.
 */
export function playgroundSocketUrl(
  worldId: PlaygroundWorldId,
  location: { protocol: string; host: string } = window.location,
): string {
  const scheme = location.protocol === "http:" ? "ws:" : "wss:";
  return `${scheme}//${location.host}${PLAYGROUND_API_PREFIX}/connect?world=${encodeURIComponent(
    worldId,
  )}`;
}

function worldPath(path: string, worldId: PlaygroundWorldId): string {
  return `${path}${path.includes("?") ? "&" : "?"}world=${encodeURIComponent(worldId)}`;
}

export const playgroundClient = {
  bootstrap(worldId: PlaygroundWorldId): Promise<PlaygroundBootstrap> {
    return request<PlaygroundBootstrap>(worldPath("/bootstrap", worldId));
  },

  events(after: number, worldId: PlaygroundWorldId): Promise<PlaygroundEventsPage> {
    return request<PlaygroundEventsPage>(
      worldPath(`/events?after=${encodeURIComponent(String(after))}`, worldId),
    );
  },

  onlineCount(): Promise<{ online: number }> {
    return request<{ online: number }>("/online");
  },

  postText(text: string, operationId: string, worldId: PlaygroundWorldId) {
    return request<{ event: PlaygroundEvent }>(worldPath("/posts", worldId), {
      method: "POST",
      body: { kind: "text", text, operation_id: operationId },
    });
  },

  /** `app_ref` is the existing public Discover App id — a string, not an object. */
  postAppCard(appRef: string, operationId: string, worldId: PlaygroundWorldId) {
    return request<{ event: PlaygroundEvent }>(worldPath("/posts", worldId), {
      method: "POST",
      body: { kind: "app", app_ref: appRef, operation_id: operationId },
    });
  },

  /** `activity_ref` is the existing public share id. */
  postActivityCard(activityRef: string, operationId: string, worldId: PlaygroundWorldId) {
    return request<{ event: PlaygroundEvent }>(worldPath("/posts", worldId), {
      method: "POST",
      body: {
        kind: "activity",
        activity_ref: activityRef,
        operation_id: operationId,
      },
    });
  },

  deletePost(postId: string, operationId: string) {
    return request<{ event: PlaygroundEvent }>(
      `/posts/${encodeURIComponent(postId)}`,
      { method: "DELETE", body: { operation_id: operationId } },
    );
  },

  react(postId: string, reaction: PlaygroundReaction, operationId: string) {
    return request<{ event: PlaygroundEvent }>(
      `/posts/${encodeURIComponent(postId)}/reactions`,
      { method: "POST", body: { reaction, operation_id: operationId } },
    );
  },

  unreact(postId: string, reaction: PlaygroundReaction, operationId: string) {
    return request<{ event: PlaygroundEvent }>(
      `/posts/${encodeURIComponent(postId)}/reactions/${encodeURIComponent(reaction)}`,
      { method: "DELETE", body: { operation_id: operationId } },
    );
  },

  mute(mutedUserId: string) {
    return request<{ ok: true }>("/mutes", {
      method: "POST",
      body: { muted_user_id: mutedUserId },
    });
  },

  unmute(mutedUserId: string) {
    return request<{ ok: true }>(
      `/mutes/${encodeURIComponent(mutedUserId)}`,
      { method: "DELETE" },
    );
  },

  report(postId: string, reason: string) {
    return request<{ ok: true }>("/reports", {
      method: "POST",
      body: { post_id: postId, reason },
    });
  },
};

export type PlaygroundApiClient = typeof playgroundClient;
