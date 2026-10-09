import startupSource from "../../vendor/ato-startup-v1.js?raw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

async function settle() {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

describe("world asset startup", () => {
  const frames = new Map<number, FrameRequestCallback>();
  let deferWorldAssets: typeof import("./startup").deferWorldAssets;
  let windowEvents: EventTarget;
  let documentEvents: EventTarget & { hidden: boolean };
  let nextFrame = 0;

  beforeEach(async () => {
    vi.resetModules();
    vi.useFakeTimers();
    frames.clear();
    windowEvents = new EventTarget();
    documentEvents = Object.assign(new EventTarget(), { hidden: false });
    vi.stubGlobal("window", windowEvents);
    vi.stubGlobal("document", documentEvents);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frames.set(++nextFrame, callback);
      return nextFrame;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
    ({ deferWorldAssets } = await import("./startup"));
  });

  afterEach(() => {
    windowEvents.dispatchEvent(new Event("pagehide"));
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  async function yieldToAssets() {
    const callbacks = [...frames.values()];
    frames.clear();
    callbacks.forEach((callback) => callback(0));
    await vi.runOnlyPendingTimersAsync();
    await settle();
  }

  it("keeps the common SDK byte-identical to its pinned distribution", async () => {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(startupSource));
    expect([...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join(""))
      .toBe("d4ff8dc34a839cf3a4143f4d221e6005db04ac4d4fac021ff77b59f66c4a2d1e");
  });

  it("waits for the rendered frame and a browser yield before loading, then runs groups sequentially", async () => {
    let finishFirst!: () => void;
    const first = vi.fn(() => new Promise<void>((resolve) => { finishFirst = resolve; }));
    const second = vi.fn(async () => {});
    const rendered = deferWorldAssets(new AbortController(), [first, second]);
    await settle();
    await yieldToAssets();
    expect(first).not.toHaveBeenCalled();
    rendered();
    await settle();
    expect(first).not.toHaveBeenCalled();
    await yieldToAssets();
    expect(first).toHaveBeenCalledTimes(1);
    await yieldToAssets();
    expect(second).not.toHaveBeenCalled();
    finishFirst();
    await settle();
    await yieldToAssets();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("does not let a disposed World's late frame start loaders in either generation", async () => {
    const oldWorld = new AbortController();
    const oldLoad = vi.fn(async () => {});
    const oldFrame = deferWorldAssets(oldWorld, [oldLoad]);
    await settle();
    oldWorld.abort();
    const currentLoad = vi.fn(async () => {});
    const currentFrame = deferWorldAssets(new AbortController(), [currentLoad]);
    oldFrame();
    await settle();
    await yieldToAssets();
    expect(oldLoad).not.toHaveBeenCalled();
    expect(currentLoad).not.toHaveBeenCalled();
    currentFrame();
    await settle();
    await yieldToAssets();
    expect(currentLoad).toHaveBeenCalledTimes(1);
  });

  it("forwards page exit to existing World loaders and cancels remaining work", async () => {
    const world = new AbortController();
    let finishLoad!: () => void;
    const first = vi.fn(() => new Promise<void>((resolve) => { finishLoad = resolve; }));
    const later = vi.fn(async () => {});
    deferWorldAssets(world, [first, later])();
    await settle();
    await yieldToAssets();
    expect(first).toHaveBeenCalledTimes(1);
    windowEvents.dispatchEvent(new Event("pagehide"));
    expect(world.signal.aborted).toBe(true);
    finishLoad();
    await settle();
    await yieldToAssets();
    expect(later).not.toHaveBeenCalled();
    expect(frames.size).toBe(0);
  });

  it("keeps optional work dormant while the document is hidden", async () => {
    documentEvents.hidden = true;
    const load = vi.fn(async () => {});
    deferWorldAssets(new AbortController(), [load])();
    await settle();
    await yieldToAssets();
    expect(load).not.toHaveBeenCalled();
    documentEvents.hidden = false;
    documentEvents.dispatchEvent(new Event("visibilitychange"));
    await yieldToAssets();
    expect(load).toHaveBeenCalledTimes(1);
  });
});
