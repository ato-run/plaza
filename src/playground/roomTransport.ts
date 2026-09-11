/**
 * App Room transport — same-origin REST + WebSocket for one instance room.
 *
 * The room and the UI share one origin (the instance host), so identity is
 * the host's own session and there is no token to configure. Reconnection
 * mirrors `PlaygroundRoomClient`: jittered backoff, and the server's bounded
 * socket-lifetime close (4001) is an expected re-auth, not a failure.
 *
 * Op payloads and seals are Plaza's (`roomProtocol.ts`); this file only
 * moves bytes and tracks the room epoch/cursor the server reports.
 */
import {
  APP_ROOM_API_PREFIX,
  APP_ROOM_PROTOCOL,
  PLAZA_ROOM_SCHEMA_ID,
  type AppRoomBootstrap,
  type AppRoomEventsPage,
  type AppRoomHello,
  type PlazaOp,
} from "./roomProtocol";

const APP_ROOM_WEBSOCKET_PROTOCOL = "ato.app-room.v1";
export const APP_ROOM_REAUTH_CLOSE_CODE = 4001;

const BASE_RECONNECT_DELAY_MS = 500;
const MAX_RECONNECT_DELAY_MS = 15_000;

export type AppRoomMessage =
  | ({ kind: "hello" } & AppRoomHello)
  | {
      kind: "snapshot";
      online: number;
      participants: import("./roomProtocol").AppRoomParticipant[];
    }
  | {
      kind: "join";
      participant: import("./roomProtocol").AppRoomParticipant;
      online: number;
    }
  | { kind: "leave"; principal_id: string; online: number }
  | {
      kind: "presence";
      principal_id: string;
      payload: { type: string; typing?: boolean };
    }
  | {
      kind: "ephemeral";
      principal_id: string;
      ephemeral: { kind: string; scope: string | null; payload: unknown; expires_at: number };
    }
  | { kind: "event"; cursor: number; event: import("./roomProtocol").AppRoomOpEvent }
  | { kind: "sync"; room_epoch: number; high_water_cursor: number; min_available_cursor: number }
  | { kind: "checkpoint_requested" }
  | { kind: "reset"; room_epoch: number };

export interface RoomTransportOptions {
  createWebSocket?: (url: string, protocols: string[]) => WebSocket;
  onMessage: (message: AppRoomMessage) => void;
  onConnected?: () => void;
  /** Fired on every connect AFTER the first — the cue to catch up over REST. */
  onReconnected?: () => void;
  onDisconnected?: () => void;
  onError?: (message: string) => void;
  setTimeoutFn?: (handler: () => void, ms: number) => number;
  clearTimeoutFn?: (handle: number) => void;
  backoffMs?: (attempt: number) => number;
}

export function roomSocketUrl(
  location: { protocol: string; host: string } = window.location,
): string {
  const scheme = location.protocol === "http:" ? "ws:" : "wss:";
  return `${scheme}//${location.host}${APP_ROOM_API_PREFIX}/connect`;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${APP_ROOM_API_PREFIX}${path}`, {
    cache: "no-store",
    credentials: "same-origin",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    ...init,
  });
  const payload = (await response.json().catch(() => ({}))) as {
    error?: string;
  };
  if (!response.ok) {
    throw new Error(payload.error ?? `http_${response.status}`);
  }
  return payload as T;
}

export class AppRoomTransport {
  private readonly options: RoomTransportOptions;
  private socket: WebSocket | null = null;
  private intentionallyClosed = false;
  private attempt = 0;
  private everConnected = false;
  private reconnectHandle: number | null = null;
  roomEpoch = 0;

  constructor(options: RoomTransportOptions) {
    this.options = options;
  }

  async probe(): Promise<boolean> {
    try {
      const boot = await this.bootstrap();
      return typeof boot.room_epoch === "number";
    } catch {
      return false;
    }
  }

  bootstrap(): Promise<AppRoomBootstrap> {
    return request<AppRoomBootstrap>("/bootstrap");
  }

  events(after: number): Promise<AppRoomEventsPage> {
    return request<AppRoomEventsPage>(`/events?after=${encodeURIComponent(String(after))}`);
  }

  mutate(op: PlazaOp): Promise<{ seq: number; replay: boolean }> {
    return request<{ seq: number; replay: boolean }>("/mutate", {
      method: "POST",
      body: JSON.stringify({
        protocol: APP_ROOM_PROTOCOL,
        operation_id: crypto.randomUUID(),
        room_epoch: this.roomEpoch,
        state_schema_id: PLAZA_ROOM_SCHEMA_ID,
        op,
      }),
    });
  }

  seal(
    baseCursor: number,
    payload: unknown,
  ): Promise<{ seq: number; revision_id: string | null }> {
    return request<{ seq: number; revision_id: string | null }>("/checkpoint", {
      method: "POST",
      body: JSON.stringify({
        protocol: APP_ROOM_PROTOCOL,
        operation_id: crypto.randomUUID(),
        room_epoch: this.roomEpoch,
        state_schema_id: PLAZA_ROOM_SCHEMA_ID,
        base_cursor: baseCursor,
        payload,
      }),
    });
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
      socket = create(roomSocketUrl(), [APP_ROOM_WEBSOCKET_PROTOCOL]);
    } catch {
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

  sendPresence(payload: { type: string; typing?: boolean }): void {
    this.send({ type: "presence", payload });
  }

  sendEphemeral(
    kind: string,
    scope: string | null,
    payload: unknown,
    ttlMs?: number,
  ): void {
    this.send({ type: "ephemeral", kind, scope, payload, ttl_ms: ttlMs ?? null });
  }

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
    this.requestSync();
    if (reconnected) this.options.onReconnected?.();
  };

  private onMessage = (event: MessageEvent): void => {
    try {
      const message = JSON.parse(event.data as string) as {
        protocol?: string;
        room_epoch?: unknown;
      } & AppRoomMessage;
      if (message.protocol !== APP_ROOM_PROTOCOL) return;
      // Every epoch-carrying message advances the client's fence: a stale
      // client must fail its next write (409), never apply into a dead
      // generation.
      if (typeof message.room_epoch === "number") {
        this.roomEpoch = message.room_epoch;
      }
      if (message.kind === "event") {
        const epoch = (message.event as { room_epoch?: unknown }).room_epoch;
        if (typeof epoch === "number") this.roomEpoch = epoch;
      }
      this.options.onMessage(message as AppRoomMessage);
    } catch {
      this.options.onError?.("Received a malformed room message.");
    }
  };

  private onClose = (event: CloseEvent): void => {
    this.socket = null;
    if (this.intentionallyClosed) return;
    if (event?.code === APP_ROOM_REAUTH_CLOSE_CODE) this.attempt = 0;
    this.options.onDisconnected?.();
    this.scheduleReconnect();
  };

  private onError = (): void => {
    this.options.onError?.("Room connection error.");
  };
}
