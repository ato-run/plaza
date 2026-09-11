/**
 * Playground socket — same-origin, and it reconnects.
 *
 * The first cut had an `onDisconnected` that reported the drop and stopped
 * there, which meant a laptop lid, a tunnel change or the server's own
 * re-authentication close ended the session permanently while the UI still
 * looked connected. Reconnection is therefore part of this class, not
 * something each caller reinvents.
 *
 * Three behaviours matter:
 *
 *  - **Backoff with jitter.** A server restart disconnects everyone at once;
 *    reconnecting on a fixed timer would return them as a synchronized
 *    thundering herd.
 *  - **`4001` is normal.** The server bounds socket lifetime so an
 *    authenticated feed cannot outlive its session. That close means
 *    "reconnect and re-authenticate", so it resets the backoff instead of
 *    counting as a failure.
 *  - **Catch-up is the caller's job, announced by `onReconnected`.** The
 *    socket cannot know which events were missed; the caller replays from its
 *    own cursor over REST. `sync` covers the invisible case where only the
 *    LAST broadcast was lost.
 */
import { PLAYGROUND_PROTOCOL, PLAYGROUND_REAUTH_CLOSE_CODE } from "./types";
import type {
  PlaygroundFaceReaction,
  PlaygroundRoomEnvelope,
  PlaygroundTransform,
} from "./types";

const PLAYGROUND_WEBSOCKET_PROTOCOL = "ato.playground.v1";

const BASE_RECONNECT_DELAY_MS = 500;
const MAX_RECONNECT_DELAY_MS = 15_000;

export interface PlaygroundRoomClientOptions {
  url: string;
  createWebSocket?: (url: string, protocols: string[]) => WebSocket;
  onMessage: (message: PlaygroundRoomEnvelope) => void;
  onConnected?: () => void;
  /** Fired on every connect AFTER the first — the cue to catch up over REST. */
  onReconnected?: () => void;
  onDisconnected?: () => void;
  onError?: (message: string) => void;
  /** Injectable for tests. */
  setTimeoutFn?: (handler: () => void, ms: number) => number;
  clearTimeoutFn?: (handle: number) => void;
  /** Injectable for tests; defaults to jittered exponential backoff. */
  backoffMs?: (attempt: number) => number;
}

export class PlaygroundRoomClient {
  private readonly options: PlaygroundRoomClientOptions;
  private socket: WebSocket | null = null;
  private intentionallyClosed = false;
  private attempt = 0;
  private everConnected = false;
  private reconnectHandle: number | null = null;

  constructor(options: PlaygroundRoomClientOptions) {
    this.options = options;
  }

  connect(): void {
    if (this.socket) return;
    this.intentionallyClosed = false;
    this.clearPendingReconnect();
    const create =
      this.options.createWebSocket ??
      ((url: string, protocols: string[]) => new WebSocket(url, protocols));
    let socket: WebSocket;
    try {
      socket = create(this.options.url, [PLAYGROUND_WEBSOCKET_PROTOCOL]);
    } catch {
      // A constructor throw (offline, blocked) is just another failed
      // attempt — schedule a retry rather than dying silently.
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;
    socket.addEventListener("open", this.onOpen);
    socket.addEventListener("message", this.onMessage);
    socket.addEventListener("close", this.onClose);
    socket.addEventListener("error", this.onError);
  }

  close(): void {
    this.intentionallyClosed = true;
    this.clearPendingReconnect();
    const socket = this.socket;
    this.socket = null;
    socket?.close();
  }

  get connected(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  sendTyping(typing: boolean): void {
    this.send({ type: "typing", typing });
  }

  /**
   * Report where this person is standing and looking.
   *
   * Fire-and-forget on purpose: a transform is only interesting until the
   * next one, so a frame that cannot be sent (socket mid-reconnect) is
   * dropped rather than queued. Queueing would deliver a burst of stale
   * positions on reconnect and make the avatar replay its own past.
   *
   * The caller throttles to ~12Hz via `SendCadence`; the server independently
   * rate-limits and coalesces, so neither side trusts the other's restraint.
   */
  sendTransform(transform: PlaygroundTransform): void {
    this.send({ type: "transform", ...transform });
  }

  /** A short-lived reaction aimed at one person. Never persisted. */
  sendFaceReaction(targetPrincipalId: string, emoji: PlaygroundFaceReaction): void {
    this.send({
      type: "face_reaction",
      target_principal_id: targetPrincipalId,
      emoji,
    });
  }

  /**
   * Ask for the room's high-water mark. The one message a reconnected or
   * long-idle client always sends, because a dropped final broadcast leaves
   * no trace for the client to detect on its own.
   */
  requestSync(): void {
    this.send({ type: "sync" });
  }

  private send(message: unknown): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(message));
    }
  }

  private defaultBackoff(attempt: number): number {
    const exponential = Math.min(
      MAX_RECONNECT_DELAY_MS,
      BASE_RECONNECT_DELAY_MS * 2 ** attempt,
    );
    return Math.round(exponential * (0.5 + Math.random() * 0.5));
  }

  private clearPendingReconnect(): void {
    if (this.reconnectHandle === null) return;
    const clear = this.options.clearTimeoutFn ?? ((h: number) => clearTimeout(h));
    clear(this.reconnectHandle);
    this.reconnectHandle = null;
  }

  private scheduleReconnect(): void {
    if (this.intentionallyClosed || this.reconnectHandle !== null) return;
    const delay = (this.options.backoffMs ?? ((a: number) => this.defaultBackoff(a)))(
      this.attempt,
    );
    this.attempt += 1;
    const schedule =
      this.options.setTimeoutFn ??
      ((handler: () => void, ms: number) =>
        setTimeout(handler, ms) as unknown as number);
    this.reconnectHandle = schedule(() => {
      this.reconnectHandle = null;
      this.connect();
    }, delay);
  }

  private onOpen = (): void => {
    this.attempt = 0;
    const reconnected = this.everConnected;
    this.everConnected = true;
    this.options.onConnected?.();
    // Always ask where the room is; on a reconnect the caller also replays
    // its own cursor over REST.
    this.requestSync();
    if (reconnected) this.options.onReconnected?.();
  };

  private onMessage = (event: MessageEvent): void => {
    try {
      const message = JSON.parse(event.data as string) as PlaygroundRoomEnvelope;
      if (message.protocol !== PLAYGROUND_PROTOCOL) return;
      this.options.onMessage(message);
    } catch {
      this.options.onError?.("Received a malformed Playground message.");
    }
  };

  private onClose = (event: CloseEvent): void => {
    this.socket = null;
    if (this.intentionallyClosed) return;
    // The server's bounded-lifetime close is an expected part of staying
    // authenticated, not a failure — come straight back.
    if (event?.code === PLAYGROUND_REAUTH_CLOSE_CODE) this.attempt = 0;
    this.options.onDisconnected?.();
    this.scheduleReconnect();
  };

  private onError = (): void => {
    this.options.onError?.("Playground connection error.");
  };
}
