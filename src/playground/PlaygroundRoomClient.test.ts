/**
 * Reconnect behaviour. The previous client reported a disconnect and stopped,
 * so a dropped socket ended the session while the UI still looked live.
 */
import { describe, expect, it, vi } from "vitest";

import { PlaygroundRoomClient } from "./PlaygroundRoomClient";
import { PLAYGROUND_REAUTH_CLOSE_CODE, PLAYGROUND_PROTOCOL } from "./types";

class FakeSocket {
  static instances: FakeSocket[] = [];
  readyState = 1;
  sent: string[] = [];
  private listeners: Record<string, ((event: unknown) => void)[]> = {};

  constructor(
    public url: string,
    public protocols: string[],
  ) {
    FakeSocket.instances.push(this);
  }
  addEventListener(type: string, handler: (event: unknown) => void) {
    (this.listeners[type] ??= []).push(handler);
  }
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.readyState = 3;
  }
  emit(type: string, event: unknown = {}) {
    for (const handler of this.listeners[type] ?? []) handler(event);
  }
}

function makeClient(overrides: Partial<{ onReconnected: () => void; onMessage: (m: unknown) => void }> = {}) {
  const timers: (() => void)[] = [];
  const client = new PlaygroundRoomClient({
    url: "wss://playground.example/__ato/playground/connect",
    createWebSocket: (url, protocols) =>
      new FakeSocket(url, protocols) as unknown as WebSocket,
    onMessage: (overrides.onMessage ?? (() => {})) as never,
    onReconnected: overrides.onReconnected,
    setTimeoutFn: (handler) => {
      timers.push(handler);
      return timers.length;
    },
    clearTimeoutFn: () => {},
    backoffMs: () => 1,
  });
  return { client, timers };
}

describe("PlaygroundRoomClient", () => {
  it("reconnects after an unintended close", () => {
    FakeSocket.instances = [];
    const { client, timers } = makeClient();
    client.connect();
    expect(FakeSocket.instances).toHaveLength(1);

    FakeSocket.instances[0].emit("close", { code: 1006 });
    expect(timers).toHaveLength(1);
    timers[0]();
    expect(FakeSocket.instances).toHaveLength(2);
  });

  it("does not reconnect after an intentional close", () => {
    FakeSocket.instances = [];
    const { client, timers } = makeClient();
    client.connect();
    client.close();
    FakeSocket.instances[0].emit("close", { code: 1000 });
    expect(timers).toHaveLength(0);
  });

  it("treats the server's re-auth close as a normal reconnect", () => {
    FakeSocket.instances = [];
    const { client, timers } = makeClient();
    client.connect();
    FakeSocket.instances[0].emit("close", {
      code: PLAYGROUND_REAUTH_CLOSE_CODE,
    });
    expect(timers).toHaveLength(1);
    timers[0]();
    expect(FakeSocket.instances).toHaveLength(2);
  });

  it("asks for the high-water mark on connect", () => {
    FakeSocket.instances = [];
    const { client } = makeClient();
    client.connect();
    FakeSocket.instances[0].emit("open");
    expect(JSON.parse(FakeSocket.instances[0].sent[0])).toEqual({ type: "sync" });
  });

  it("signals onReconnected only on connections after the first", () => {
    FakeSocket.instances = [];
    const onReconnected = vi.fn();
    const { client, timers } = makeClient({ onReconnected });
    client.connect();
    FakeSocket.instances[0].emit("open");
    expect(onReconnected).not.toHaveBeenCalled();

    FakeSocket.instances[0].emit("close", { code: 1006 });
    timers[0]();
    FakeSocket.instances[1].emit("open");
    expect(onReconnected).toHaveBeenCalledTimes(1);
  });

  it("ignores messages from another protocol", () => {
    FakeSocket.instances = [];
    const onMessage = vi.fn();
    const { client } = makeClient({ onMessage });
    client.connect();
    FakeSocket.instances[0].emit("message", {
      data: JSON.stringify({ protocol: "something.else", kind: "event" }),
    });
    expect(onMessage).not.toHaveBeenCalled();

    FakeSocket.instances[0].emit("message", {
      data: JSON.stringify({ protocol: PLAYGROUND_PROTOCOL, kind: "sync" }),
    });
    expect(onMessage).toHaveBeenCalledTimes(1);
  });

  it("never sends message text over the presence lane", () => {
    FakeSocket.instances = [];
    const { client } = makeClient();
    client.connect();
    FakeSocket.instances[0].emit("open");
    client.sendTyping(true);
    const typing = FakeSocket.instances[0].sent
      .map((raw) => JSON.parse(raw))
      .find((message) => message.type === "typing");
    // Typing is a boolean and nothing else — no draft, no preview.
    expect(typing).toEqual({ type: "typing", typing: true });
  });
});
