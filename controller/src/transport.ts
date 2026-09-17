import { createHash } from "node:crypto";
import WebSocket from "ws";
import {
  ADAPTER_ID,
  WORLD,
  type Peer,
} from "../../src/playground/coop/adapter";

export interface Fence {
  session_id: string;
  session_epoch: number;
  execution_epoch: number;
  goal_revision: number;
  room_epoch: number;
  executor_id: string;
}
export interface Control {
  instance_id: string;
  activity_id: string;
  actor_id: string;
  actor_run_id: string;
  application_run_id: string;
  adapter_id: string;
  scope: string;
  status: "ready" | "running" | "paused" | "ended" | "degraded";
  reason: string | null;
  fence: Fence;
  durable_cursor: number;
  observed_at: number;
  live_version: number;
  goal: { instruction: string; principalId: string; receivedAt: number } | null;
  peers: Peer[];
  deadline: number;
  calls: number;
  lease_expires_at: number;
}
export class ControllerError extends Error {
  constructor(
    readonly code: string,
    readonly status = 0,
  ) {
    super(code);
  }
}
export function fenceKey(f: Fence): string {
  return [
    f.session_id,
    f.session_epoch,
    f.execution_epoch,
    f.goal_revision,
    f.room_epoch,
    f.executor_id,
  ].join(":");
}
const canonical = (value: unknown): string =>
  JSON.stringify(value, (_key, item) =>
    item && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(
          Object.keys(item)
            .sort()
            .map((key) => [key, item[key]]),
        )
      : item,
  );
export class ControllerTransport {
  readonly executorId = crypto.randomUUID();
  control: Control | null = null;
  socket: WebSocket | null = null;
  private frameSeq = 0;
  private pending = new Map<
    number,
    {
      resolve: () => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  onControl: (control: Control) => void = () => {};
  onDisconnect: () => void = () => {};
  constructor(
    readonly baseUrl: string,
    private readonly token: string,
  ) {
    const url = new URL(baseUrl);
    if (
      url.protocol !== "https:" &&
      !(
        url.protocol === "http:" &&
        ["localhost", "127.0.0.1", "::1"].includes(url.hostname)
      )
    )
      throw new Error("controller_origin_invalid");
    if (url.username || url.password || url.search || url.hash)
      throw new Error("controller_origin_invalid");
  }
  async request<T>(
    path: string,
    body?: unknown,
    signal?: AbortSignal,
  ): Promise<T> {
    let response: Response;
    try {
      response = await fetch(
        `${this.baseUrl.replace(/\/$/, "")}/v1/controller/app-room${path}`,
        {
          method: body === undefined ? "GET" : "POST",
          headers: {
            Authorization: `Bearer ${this.token}`,
            "content-type": "application/json",
          },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: signal
            ? AbortSignal.any([signal, AbortSignal.timeout(4000)])
            : AbortSignal.timeout(4000),
          redirect: "error",
        },
      );
    } catch {
      throw new ControllerError("transport_failed");
    }
    const value = (await response.json()) as { error?: string };
    if (!response.ok)
      throw new ControllerError(
        typeof value.error === "string" ? value.error : "request_failed",
        response.status,
      );
    return value as T;
  }
  private adopt(control: Control) {
    if (
      !control ||
      control.adapter_id !== ADAPTER_ID ||
      control.scope !== WORLD ||
      control.fence.executor_id !== this.executorId
    )
      throw new ControllerError("invalid_control");
    this.control = control;
    this.onControl(control);
  }
  async register() {
    const result = await this.request<{ control: Control }>("/register", {
      executor_id: this.executorId,
      adapter_id: ADAPTER_ID,
      scope: WORLD,
    });
    this.adopt(result.control);
  }
  async heartbeat() {
    const result = await this.request<{ control: Control }>("/heartbeat", {
      executor_id: this.executorId,
      adapter_id: ADAPTER_ID,
      scope: WORLD,
    });
    this.adopt(result.control);
  }
  async reserve(fence: Fence): Promise<Control> {
    const result = await this.request<{ control: Control }>("/decision", {
      fence,
    });
    this.adopt(result.control);
    return result.control;
  }
  async connect(): Promise<void> {
    if (this.socket?.readyState === WebSocket.OPEN) return;
    if (this.socket) throw new ControllerError("socket_connecting");
    const url = new URL(
      `${this.baseUrl.replace(/\/$/, "")}/v1/controller/app-room/connect`,
    );
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.searchParams.set("executor_id", this.executorId);
    const socket = new WebSocket(url, ["ato.app-room.v1"], {
      headers: { Authorization: `Bearer ${this.token}` },
      handshakeTimeout: 4000,
    });
    this.socket = socket;
    socket.on("message", (raw) => {
      let message: Record<string, unknown>;
      try {
        message = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (message.kind === "controller_state")
        this.adopt(message.control as Control);
      if (message.kind === "apply_receipt") {
        const pending = this.pending.get(Number(message.frame_seq));
        if (!pending) return;
        clearTimeout(pending.timer);
        this.pending.delete(Number(message.frame_seq));
        if (message.status === "applied" || message.status === "duplicate")
          pending.resolve();
        else
          pending.reject(
            new ControllerError(
              typeof message.error === "string"
                ? message.error
                : "apply_rejected",
            ),
          );
      }
    });
    socket.on("close", () => {
      if (this.socket === socket) this.socket = null;
      for (const p of this.pending.values()) {
        clearTimeout(p.timer);
        p.reject(new ControllerError("socket_closed"));
      }
      this.pending.clear();
      this.onDisconnect();
    });
    socket.on("error", () => {});
    await new Promise<void>((resolve, reject) => {
      socket.once("open", resolve);
      socket.once("error", () => reject(new ControllerError("socket_failed")));
    });
  }
  async ephemeral(kind: string, payload: unknown, fence: Fence): Promise<void> {
    if (this.socket?.readyState !== WebSocket.OPEN)
      throw new ControllerError("socket_unavailable");
    const seq = ++this.frameSeq;
    const ack = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(seq);
        reject(new ControllerError("apply_timeout"));
      }, 1500);
      this.pending.set(seq, { resolve, reject, timer });
    });
    this.socket.send(
      JSON.stringify({
        type: "ephemeral",
        kind,
        scope: WORLD,
        payload,
        ttl_ms: 5000,
        fence,
        frame_seq: seq,
      }),
    );
    return ack;
  }
  async post(operationId: string, op: unknown, fence: Fence) {
    // Freeze the entire invocation before the first attempt. Reuse after ambiguous delivery.
    const body = JSON.parse(
      JSON.stringify({
        protocol: "ato.app-room@1",
        operation_id: operationId,
        room_epoch: fence.room_epoch,
        state_schema_id: "plaza.room@1",
        op,
        fence,
      }),
    );
    const receipt = () =>
      this.request<{
        status: string;
        seq?: number;
        actor_id?: string;
        op?: unknown;
        op_digest?: string;
      }>(`/receipt?operation_id=${encodeURIComponent(operationId)}`);
    const confirm = (result: Awaited<ReturnType<typeof receipt>>) => {
      if (
        result.status !== "room-committed" ||
        result.actor_id !== `actor:${this.control?.actor_id}` ||
        (result.op_digest
          ? result.op_digest !==
            createHash("sha256").update(canonical(body.op)).digest("hex")
          : canonical(result.op) !== canonical(body.op))
      )
        throw new ControllerError("commit_unconfirmed");
      return result;
    };
    try {
      await this.request("/mutate", body);
    } catch (error) {
      const committed = await receipt();
      if (committed.status === "room-committed") return confirm(committed);
      if (error instanceof ControllerError && error.status !== 0) throw error;
      if (!this.control || fenceKey(this.control.fence) !== fenceKey(fence))
        throw new ControllerError("controller_fenced");
      await this.request("/mutate", body);
    }
    const result = await receipt();
    return confirm(result);
  }
  async degraded(
    reason:
      | "provider_unavailable"
      | "provider_timeout"
      | "invalid_response"
      | "budget_exhausted"
      | "target_unavailable"
      | "transport_failed",
    fence: Fence,
  ) {
    await this.request("/degraded", { reason, fence });
  }
  close() {
    this.socket?.close();
  }
}
